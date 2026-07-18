"""
auth.py — Token-based authentication for MediSyncAI backend.

In production this would validate against a database of issued JWTs.
For now we use a hardcoded secret per role, sufficient for hackathon + demo.

Roles
-----
- EMT_UNIT  : can publish patient telemetry and GPS updates
- HOSPITAL  : can subscribe to patient broadcasts (read-only)
- ADMIN     : can read/write system settings
"""

import os
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# ── Token store (replace with DB lookup / JWT verify in production) ──────────
VALID_TOKENS: dict[str, dict] = {
    os.environ.get("EMT_TOKEN", "ems_device_token_UNIT_A42"): {
        "role": "EMT_UNIT",
        "unit_id": "AMB-UNIT-A42",
        "hospital_scope": "HOSP-01",
    },
    os.environ.get("HOSPITAL_TOKEN", "hospital_dashboard_token_H01"): {
        "role": "HOSPITAL",
        "hospital_scope": "HOSP-01",
    },
    os.environ.get("ADMIN_TOKEN", "admin_master_token_MEDISYNC"): {
        "role": "ADMIN",
        "hospital_scope": "*",
    },
}

bearer_scheme = HTTPBearer(auto_error=False)


def _resolve_token(raw_token: str | None) -> dict:
    """Look up a raw token string and return its principal dict."""
    if not raw_token or raw_token not in VALID_TOKENS:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing authorization token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return VALID_TOKENS[raw_token]


# ── REST dependency helpers ──────────────────────────────────────────────────

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
) -> dict:
    """Generic authenticated user — any valid token."""
    token = credentials.credentials if credentials else None
    return _resolve_token(token)


def get_current_admin_user(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
) -> dict:
    """Admin-only guard. Used on sensitive write endpoints (settings, etc.)."""
    principal = get_current_user(credentials)
    if principal["role"] != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required for this operation.",
        )
    return principal


def get_current_emt_user(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
) -> dict:
    """EMT-unit guard. Used on telemetry publish endpoints."""
    principal = get_current_user(credentials)
    if principal["role"] not in ("EMT_UNIT", "ADMIN"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="EMT unit credentials required.",
        )
    return principal


# ── WebSocket helper (query-param token, since WS cannot carry headers) ──────

def verify_ws_token(token: str | None, required_role: str = "EMT_UNIT") -> dict:
    """
    Called at WebSocket connection time.
    Raises ValueError on failure so the caller can close with 1008.
    """
    if not token or token not in VALID_TOKENS:
        raise ValueError("Invalid WebSocket token")
    principal = VALID_TOKENS[token]
    allowed = {"EMT_UNIT", "HOSPITAL", "ADMIN"}
    if required_role != "ANY" and principal["role"] not in allowed:
        raise ValueError("Insufficient role for this channel")
    return principal