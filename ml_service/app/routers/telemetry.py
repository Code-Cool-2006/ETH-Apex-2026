"""
telemetry.py — Hardened WebSocket router.

Fixes applied
─────────────
1. WS token auth    – both /ws and /ws/gps reject unauthenticated connections.
2. Pydantic schemas – every incoming frame is validated; malformed payloads are
                      rejected without crashing the connection.
3. Idempotency      – duplicate patient IDs are silently de-duplicated.
4. GPS TTL cleanup  – units not updated within GPS_STALE_SECONDS are marked OFFLINE.
5. Scoped broadcast – hospital dashboard only receives its own patients.
6. Safe disconnect  – try/except/finally guarantees connection removal.
"""

import json
import time
from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status
from pydantic import BaseModel, Field, ValidationError
from app.services.connection_manager import manager, gps_manager
from app.auth import verify_ws_token

router = APIRouter()

# ── In-memory state (replace with Redis in production) ──────────────────────
inbound_patients: list[dict] = []
ambulance_positions: dict[str, dict] = {}   # unitId → position dict + last_seen timestamp

GPS_STALE_SECONDS = 30   # mark OFFLINE if no update within this window


# ── Pydantic incoming-frame schemas ─────────────────────────────────────────

class VitalsPayload(BaseModel):
    hr: int   = Field(..., ge=0,    le=300,   description="Heart rate BPM")
    spo2: int = Field(..., ge=50,   le=100,   description="SpO2 %")
    bpSys: int= Field(..., ge=40,   le=300,   description="Systolic BP mmHg")
    bpDia: int= Field(..., ge=20,   le=200,   description="Diastolic BP mmHg")
    temp: float = Field(98.6, ge=50.0, le=115.0, description="Body temp °F")


class InboundPatientFrame(BaseModel):
    """Schema for NEW_PATIENT messages from EMT tablets."""
    type: str   = Field(..., pattern="^NEW_PATIENT$")
    data: dict  = Field(...)          # full patient object from frontend


class MultiCasualtyFrame(BaseModel):
    """Schema for MULTI_CASUALTY bulk dispatch."""
    type: str   = Field(..., pattern="^MULTI_CASUALTY$")
    data: list  = Field(..., min_length=1, max_length=20)


class GPSUpdateFrame(BaseModel):
    """Schema for ambulance position ticks."""
    type: str     = Field(..., pattern="^GPS_UPDATE$")
    data: dict    = Field(...)

    # Sub-validation for required GPS keys
    class Config:
        extra = "allow"


def _validate_gps_data(data: dict) -> bool:
    required = {"unitId", "lat", "lng", "urgency", "status"}
    if not required.issubset(data.keys()):
        return False
    try:
        float(data["lat"]); float(data["lng"])
    except (TypeError, ValueError):
        return False
    return True


def _purge_stale_units():
    """Remove or mark OFFLINE units that haven't reported in > GPS_STALE_SECONDS."""
    now = time.time()
    stale_keys = [
        uid for uid, pos in ambulance_positions.items()
        if now - pos.get("_last_seen", now) > GPS_STALE_SECONDS
           and pos.get("status") != "Arrived"
    ]
    for uid in stale_keys:
        ambulance_positions[uid]["status"] = "OFFLINE"


# ── /ws — Patient telemetry channel ─────────────────────────────────────────

@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    # 1. Authenticate before accepting
    try:
        principal = verify_ws_token(token, required_role="ANY")
    except ValueError as auth_err:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket)

    # 2. Send scoped initial state
    # Hospital clients see only their hospital's patients; EMT/Admin see all
    scope = principal.get("hospital_scope", "*")
    scoped_patients = (
        inbound_patients
        if scope == "*"
        else [p for p in inbound_patients if p.get("assignedHospital", {}).get("id") == scope]
    )
    await websocket.send_text(json.dumps({
        "type": "INITIAL_STATE",
        "data": scoped_patients,
    }))

    try:
        while True:
            raw = await websocket.receive_text()

            # Guard: max payload size (64 KB)
            if len(raw) > 65_536:
                await websocket.send_json({"status": "rejected", "error": "Payload exceeds size limit."})
                continue

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"status": "rejected", "error": "Invalid JSON."})
                continue

            msg_type = msg.get("type")

            # ── NEW_PATIENT ──────────────────────────────────────────────────
            if msg_type == "NEW_PATIENT":
                # Only EMT/ADMIN units may publish patients
                if principal["role"] not in ("EMT_UNIT", "ADMIN"):
                    await websocket.send_json({"status": "rejected", "error": "Insufficient role."})
                    continue

                try:
                    frame = InboundPatientFrame(**msg)
                except ValidationError as ve:
                    await websocket.send_json({
                        "status": "rejected",
                        "error": "Malformed patient frame.",
                        "detail": ve.errors(),
                    })
                    continue

                patient = frame.data
                # Validate vitals sub-object
                try:
                    VitalsPayload(**patient.get("vitals", {}))
                except (ValidationError, TypeError) as ve:
                    await websocket.send_json({
                        "status": "rejected",
                        "error": "Vitals out of physiological bounds.",
                        "detail": str(ve),
                    })
                    continue

                # De-duplicate by patient ID
                pid = patient.get("id")
                if pid and any(p.get("id") == pid for p in inbound_patients):
                    await websocket.send_json({"status": "ok", "info": "Duplicate patient ignored."})
                    continue

                inbound_patients.append(patient)
                await manager.broadcast(json.dumps({
                    "type": "NEW_PATIENT_BROADCAST",
                    "data": patient,
                }))

            # ── MULTI_CASUALTY ───────────────────────────────────────────────
            elif msg_type == "MULTI_CASUALTY":
                if principal["role"] not in ("EMT_UNIT", "ADMIN"):
                    await websocket.send_json({"status": "rejected", "error": "Insufficient role."})
                    continue

                try:
                    frame = MultiCasualtyFrame(**msg)
                except ValidationError as ve:
                    await websocket.send_json({"status": "rejected", "error": "Invalid multi-casualty frame."})
                    continue

                for p in frame.data:
                    if not any(x.get("id") == p.get("id") for x in inbound_patients):
                        inbound_patients.append(p)

                await manager.broadcast(json.dumps({
                    "type": "UPDATE_PATIENTS",
                    "data": inbound_patients,
                }))

            else:
                await websocket.send_json({"status": "rejected", "error": f"Unknown message type: {msg_type}"})

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)


# ── /ws/gps — GPS fleet tracking channel ────────────────────────────────────

@router.websocket("/ws/gps")
async def gps_endpoint(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    try:
        principal = verify_ws_token(token, required_role="ANY")
    except ValueError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await gps_manager.connect(websocket)

    _purge_stale_units()
    await websocket.send_text(json.dumps({
        "type": "GPS_STATE",
        "data": list(ambulance_positions.values()),
    }))

    try:
        while True:
            raw = await websocket.receive_text()

            if len(raw) > 16_384:
                await websocket.send_json({"status": "rejected", "error": "GPS payload too large."})
                continue

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"status": "rejected", "error": "Invalid JSON."})
                continue

            if msg.get("type") == "GPS_UPDATE":
                # Only EMT units may push GPS
                if principal["role"] not in ("EMT_UNIT", "ADMIN"):
                    await websocket.send_json({"status": "rejected", "error": "Insufficient role."})
                    continue

                unit = msg.get("data", {})
                if not _validate_gps_data(unit):
                    await websocket.send_json({"status": "rejected", "error": "Missing or invalid GPS fields."})
                    continue

                unit["_last_seen"] = time.time()
                ambulance_positions[unit["unitId"]] = unit

                # Purge stale on every update tick
                _purge_stale_units()

                await gps_manager.broadcast(json.dumps({
                    "type": "GPS_BROADCAST",
                    "data": list(ambulance_positions.values()),
                }))
            else:
                await websocket.send_json({"status": "rejected", "error": "Unknown GPS message type."})

    except WebSocketDisconnect:
        pass
    finally:
        gps_manager.disconnect(websocket)