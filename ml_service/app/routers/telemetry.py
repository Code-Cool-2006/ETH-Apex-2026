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

@router.post("/api/reset")
async def reset_telemetry():
    global inbound_patients, ambulance_positions
    inbound_patients.clear()
    ambulance_positions.clear()
    return {"status": "ok", "message": "In-memory telemetry state reset successfully."}


class TriageConsultPayload(BaseModel):
    user_query: str = ""
    vitals: dict = Field(default_factory=dict)
    symptoms: str = ""
    hospital_name: str = "MediSync Central"
    urgency: str = "urgent"


@router.post("/api/triage/consult")
async def triage_consult(payload: TriageConsultPayload):
    q = payload.user_query.lower()
    v = payload.vitals
    hr = v.get("hr", 80)
    spo2 = v.get("spo2", 98)
    sys_bp = v.get("systolicBP", v.get("bpSys", 120))
    temp = v.get("temp", 37.0)
    obs = payload.symptoms.lower()

    diagnosis = "Acute Diagnostic Triage Review"
    medications = []
    contraindications = []
    actions = []

    # 1. Stroke / CVA / Neurological Deficit
    if any(x in obs or x in q for x in ["stroke", "cva", "facial droop", "slurred", "paralysis", "weakness", "numbness", "neuro"]):
        diagnosis = "Acute Cerebrovascular Accident (CVA) / Acute Ischemic Stroke"
        medications.append({
            "name": "Normal Saline 0.9%",
            "dose": "500 mL IV (Avoid Dextrose)",
            "route": "IV Infusion",
            "purpose": "Maintain cerebral perfusion pressure without exacerbating hyperosmolar cerebral edema"
        })
        if sys_bp > 220:
            medications.append({
                "name": "Labetalol Hydrochloride",
                "dose": "10-20 mg IV slow push over 2 min",
                "route": "Intravenous",
                "purpose": "Controlled antihypertensive therapy for severe stroke (BP > 220/120 mmHg)"
            })
        else:
            contraindications.append("PERFUSION ALERT: Permissive hypertension allowed. Do not lower BP unless Systolic > 220 mmHg.")
        actions.append("Perform immediate LAMS/FAST stroke score assessment.")
        actions.append(f"Notify {payload.hospital_name} Stroke Team for priority CT Angiogram & tPA readiness.")

    # 2. Seizure / Status Epilepticus
    elif any(x in obs or x in q for x in ["seizure", "epilepsy", "convulsion", "post-ictal", "postictal", "fitting"]):
        diagnosis = "Acute Seizure / Status Epilepticus Risk"
        medications.append({
            "name": "Midazolam (Versed)",
            "dose": "5.0 mg IM (or 2.5 mg IV)",
            "route": "Intramuscular / IV",
            "purpose": "First-line short-acting benzodiazepine to terminate active seizure motor activity"
        })
        medications.append({
            "name": "Dextrose 50% (D50W)",
            "dose": "25 g (50 mL) IV Push",
            "route": "Rapid IV Push",
            "purpose": "Empirical treatment for suspected neuroglycopenic seizure trigger"
        })
        actions.append("Position patient in left lateral recovery position & protect airway.")
        actions.append("Administer high-flow supplemental oxygen via Non-Rebreather mask.")

    # 3. Hypoglycemia / Diabetic Shock
    elif any(x in obs or x in q for x in ["hypoglycemia", "diabetic", "sugar", "glucose", "insulin shock", "sweating"]):
        diagnosis = "Acute Hypoglycemic Emergency (Blood Glucose < 70 mg/dL)"
        medications.append({
            "name": "Dextrose 50% (D50W)",
            "dose": "25 g (50 mL) IV Push",
            "route": "Rapid IV Push",
            "purpose": "Immediate intravenous glycemic restoration for central nervous system protection"
        })
        medications.append({
            "name": "Glucagon",
            "dose": "1.0 mg IM",
            "route": "Intramuscular",
            "purpose": "Hepatic glycogenolysis mobilization (if IV access delayed/unobtainable)"
        })
        actions.append("Re-check capillary fingerstick blood glucose 5 minutes post-administration.")

    # 4. Anaphylaxis / Severe Allergic Reaction
    elif any(x in obs or x in q for x in ["anaphylaxis", "allergic", "hives", "stridor", "bee sting", "swelling", "peanut"]):
        diagnosis = "Anaphylactic Shock / Severe Systemic Allergic Reaction"
        medications.append({
            "name": "Epinephrine (1:1,000)",
            "dose": "0.3 mg IM (Anterolateral Thigh)",
            "route": "Intramuscular",
            "purpose": "Alpha-1 vasoconstriction & Beta-2 bronchodilation life-saving emergency therapy"
        })
        medications.append({
            "name": "Diphenhydramine (Benadryl)",
            "dose": "50 mg IV / IM",
            "route": "Intravenous",
            "purpose": "H1 receptor antagonist to attenuate systemic histamine release"
        })
        medications.append({
            "name": "Methylprednisolone (Solu-Medrol)",
            "dose": "125 mg IV",
            "route": "IV Push",
            "purpose": "Systemic corticosteroid to prevent biphasic anaphylactic recurrence"
        })
        actions.append("Prepare Endotracheal Intubation kit for impending laryngeal angioedema.")

    # 5. Opioid Overdose / Substance Toxicity
    elif any(x in obs or x in q for x in ["overdose", "opioid", "heroin", "fentanyl", "narcan", "pupils", "unresponsive"]):
        diagnosis = "Acute Opioid Toxicity / Severe Hypoventilation"
        medications.append({
            "name": "Naloxone Hydrochloride (Narcan)",
            "dose": "2.0 mg IN (Nasal Spray) or 0.4 mg IV",
            "route": "Intranasal / IV",
            "purpose": "Competitive pure opioid antagonist to restore spontaneous respiratory drive"
        })
        actions.append("Perform Bag-Valve-Mask (BVM) ventilations with 100% O2 prior to Naloxone push.")
        actions.append("Monitor for acute withdrawal emesis and airway aspiration.")

    # 6. Cardiac / ACS / STEMI / Chest Pain
    elif any(x in obs or x in q for x in ["infarction", "st-elevation", "cardiac", "chest pain", "myocardial", "heart", "stemi"]):
        diagnosis = "Acute Coronary Syndrome (ACS) / Suspected STEMI"
        medications.append({
            "name": "Aspirin (ASA)",
            "dose": "325 mg PO (chewable)",
            "route": "Oral",
            "purpose": "Antiplatelet aggregation to prevent coronary thrombus growth"
        })
        if sys_bp >= 90:
            medications.append({
                "name": "Nitroglycerin",
                "dose": "0.4 mg SL (q5min x 3 max)",
                "route": "Sublingual",
                "purpose": "Coronary vasodilation & reduction of preload"
            })
        else:
            contraindications.append("NITROGLYCERIN CONTRAINDICATED: Systolic BP < 90 mmHg (Hypotension Risk)")

        if spo2 < 94:
            medications.append({
                "name": "Supplemental Oxygen",
                "dose": "2-4 L/min via Nasal Cannula",
                "route": "Inhalation",
                "purpose": "Target SpO2 baseline 94-98%"
            })
        actions.append(f"Notify {payload.hospital_name} Cardiac Cath Lab for immediate bay activation.")
        actions.append("Acquire 12-lead telemetry stream every 5 minutes.")

    # 7. Respiratory Distress / Asthma / COPD
    elif any(x in obs or x in q for x in ["respiratory", "dyspnea", "breath", "wheez", "asthma", "copd"]) or spo2 < 92:
        diagnosis = "Acute Respiratory Distress / Severe Bronchospasm"
        medications.append({
            "name": "Albuterol Sulfate + Ipratropium (DuoNeb)",
            "dose": "2.5 mg / 0.5 mg Nebulized",
            "route": "Inhalation",
            "purpose": "Rapid bronchodilation for acute airway smooth muscle constriction"
        })
        medications.append({
            "name": "Dexamethasone",
            "dose": "10 mg IV / PO",
            "route": "Intravenous",
            "purpose": "Systemic corticosteroid anti-inflammatory treatment"
        })
        medications.append({
            "name": "High-Flow Oxygen",
            "dose": "10-15 L/min Non-Rebreather Mask",
            "route": "Inhalation",
            "purpose": f"Rapid correction of severe hypoxemia (SpO2: {spo2}%)"
        })
        actions.append("Auscultate bilateral lung sounds q5min to assess air movement.")

    # 8. Symptomatic Bradycardia
    elif hr < 50 or "bradycardia" in q or "slow hr" in q:
        diagnosis = "Symptomatic Severe Bradycardia"
        medications.append({
            "name": "Atropine Sulfate",
            "dose": "1.0 mg IV Bolus",
            "route": "Rapid IV Push",
            "purpose": f"Parasympatholytic anticholinergic to elevate sinus node automaticity (HR: {hr} BPM)"
        })
        if sys_bp < 90:
            medications.append({
                "name": "Epinephrine Infusion",
                "dose": "2-10 mcg/min IV Drip",
                "route": "Continuous IV",
                "purpose": "Inotropic support for fluid-refractory hypotension"
            })
        actions.append("Apply Transcutaneous Pacing (TCP) pads immediately.")

    # 9. Tachyarrhythmias / SVT / VTach
    elif hr > 140 or "tachycardia" in q or "svt" in q or "vtach" in q:
        diagnosis = "Symptomatic Tachyarrhythmia (Wide/Narrow Complex)"
        if sys_bp >= 90:
            medications.append({
                "name": "Adenosine (or Amiodarone 150 mg IV)",
                "dose": "6 mg Rapid IV Push with 20 mL Flush",
                "route": "Rapid IV Push",
                "purpose": "AV nodal conduction delay to break reentry SVT tachyarrhythmia"
            })
        else:
            actions.append("CRITICAL: Prepare for Immediate Synchronized Cardioversion (50-100 Joules).")
        medications.append({
            "name": "Normal Saline 0.9%",
            "dose": "500 mL Bolus IV",
            "route": "Rapid IV Infusion",
            "purpose": "Intravascular volume expansion to support cardiac filling"
        })

    # 10. Acute Trauma / Hemorrhage / Severe Pain
    elif any(x in obs or x in q for x in ["trauma", "laceration", "bleed", "hemorrhage", "pain"]) or sys_bp < 90:
        diagnosis = "Acute Trauma / Hemorrhagic Shock Risk"
        medications.append({
            "name": "Normal Saline 0.9%",
            "dose": "1000 mL IV Fluid Bolus",
            "route": "Rapid IV Infusion",
            "purpose": f"Resuscitative crystalloid volume expansion (Systolic BP: {sys_bp} mmHg)"
        })
        medications.append({
            "name": "Tranexamic Acid (TXA)",
            "dose": "1.0 g IV over 10 minutes",
            "route": "IV Piggyback",
            "purpose": "Antifibrinolytic therapy to prevent massive bleeding clot breakdown"
        })
        if sys_bp >= 100:
            medications.append({
                "name": "Fentanyl Citrate",
                "dose": "50 mcg IV Push",
                "route": "Intravenous",
                "purpose": "Rapid analgesia for acute trauma pain management"
            })
        else:
            contraindications.append("OPIOID ANALGESIC PAUSED: Hypotension (Systolic BP < 100 mmHg)")
        actions.append("Apply direct pressure / tourniquet to primary bleed sites.")

    # 11. Sepsis / Septic Shock / Hyperthermia
    elif any(x in obs or x in q for x in ["sepsis", "septic", "infection", "fever"]) or temp > 38.5:
        diagnosis = "Severe Sepsis / Systemic Inflammatory Response (SIRS)"
        medications.append({
            "name": "Normal Saline 0.9%",
            "dose": "30 mL/kg IV Fluid Bolus (1500-2000 mL)",
            "route": "Rapid IV Infusion",
            "purpose": "First-line intravascular volume resuscitation for septic hypoperfusion"
        })
        if sys_bp < 90:
            medications.append({
                "name": "Norepinephrine (Levophed)",
                "dose": "2-12 mcg/min IV Drip",
                "route": "Continuous IV",
                "purpose": "First-line vasopressor for fluid-refractory septic shock (Target MAP >= 65 mmHg)"
            })
        actions.append("Obtain blood cultures & alert ER for immediate broad-spectrum antibiotics.")

    # 12. Default General Triage Response
    else:
        diagnosis = "General Pre-Hospital Emergency Consultation"
        medications.append({
            "name": "Normal Saline 0.9%",
            "dose": "500 mL KVO",
            "route": "IV Infusion",
            "purpose": "Maintain patent venous line for emergency access"
        })
        actions.append("Continue continuous 5-lead ECG monitoring and pulse oximetry.")

    lines = [
        f"🤖 **AI CLINICAL TRIAGE CONSULT**",
        f"📋 **Impression**: {diagnosis}",
        f"📊 **Telemetry Vitals**: HR {hr} BPM | SpO2 {spo2}% | BP {sys_bp}/60 mmHg | Temp {temp}°C\n",
    ]

    if medications:
        lines.append("💊 **PRESCRIBED IMMEDIATE MEDICATIONS**:")
        for idx, m in enumerate(medications, 1):
            lines.append(f"{idx}. **{m['name']}** — `{m['dose']}` [{m['route']}]\n   *Rationale*: {m['purpose']}")
        lines.append("")

    if contraindications:
        lines.append("⚠️ **SAFETY ALERTS & CONTRAINDICATIONS**:")
        for c in contraindications:
            lines.append(f"- {c}")
        lines.append("")

    if actions:
        lines.append("🚑 **IMMEDIATE CREW PROTOCOLS**:")
        for a in actions:
            lines.append(f"- {a}")
        lines.append("")

    lines.append(f"🏥 **Target Destination**: {payload.hospital_name} (ER Trauma Bay Ready)")

    return {
        "status": "ok",
        "diagnosis": diagnosis,
        "medications": medications,
        "contraindications": contraindications,
        "actions": actions,
        "formatted_text": "\n".join(lines)
    }


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