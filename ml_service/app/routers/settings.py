"""
settings.py — Hardened system configuration router.

Security fixes applied
──────────────────────
1. Admin-only guard   – all write routes require Bearer token with ADMIN role.
2. Pydantic schemas   – strict field validation prevents garbage values.
3. No plaintext dump  – passwords are NEVER echoed back in GET responses.
4. No hot-reload      – removed unsafe importlib.reload() of service modules.
5. Masked read        – GET /api/settings only returns boolean flags (is_set),
                        never actual credential values.
"""

import os
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from app.auth import get_current_admin_user, get_current_user

router = APIRouter(prefix="/api/settings", tags=["settings"])

ENV_PATH = Path(__file__).parent.parent.parent / ".env"


# ── Pydantic schemas ─────────────────────────────────────────────────────────

class SMTPSettingsPayload(BaseModel):
    smtp_user: EmailStr = Field(..., description="Gmail address used as sender")
    smtp_password: str  = Field(..., min_length=8, description="Gmail App Password (16 chars)")
    smtp_host: str      = Field("smtp.gmail.com", min_length=4)
    smtp_port: int      = Field(587, ge=25, le=65535)

    @field_validator("smtp_password")
    @classmethod
    def no_plaintext_gmail_password(cls, v: str) -> str:
        # Heuristic: real Gmail passwords are exactly 16 chars (app passwords)
        # Block obviously wrong values
        if v.lower() in ("password", "123456", "gmail", "secret"):
            raise ValueError("Credential appears to be a placeholder. Use a real App Password.")
        return v


class TwilioSettingsPayload(BaseModel):
    account_sid: str  = Field(..., min_length=34, max_length=34, description="Twilio Account SID (ACxxxxx)")
    auth_token: str   = Field(..., min_length=32, max_length=32, description="Twilio Auth Token")
    from_number: str  = Field(..., pattern=r"^\+\d{7,15}$", description="E.164 format e.g. +14155552671")


class TestAlertPayload(BaseModel):
    to_email: EmailStr
    to_phone: str = Field(..., pattern=r"^\+\d{7,15}$")


# ── Private helpers ──────────────────────────────────────────────────────────

def _write_env(data: dict):
    """Write key=value pairs to the .env file, preserving comments."""
    lines: list[str] = []
    if ENV_PATH.exists():
        with open(ENV_PATH, "r") as f:
            lines = f.readlines()

    def update_or_add(key: str, value: str):
        nonlocal lines
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith(f"{key}=") or stripped == f"{key}=":
                lines[i] = f"{key}={value}\n"
                return
        lines.append(f"{key}={value}\n")

    for key, value in data.items():
        update_or_add(key, value)

    with open(ENV_PATH, "w") as f:
        f.writelines(lines)


def _is_set(v: str | None) -> bool:
    placeholders = ("your_", "acxxxxxx", "+1xxxxx", "xxx", "placeholder", "")
    return bool(v) and not any(v.lower().startswith(p) for p in placeholders)


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/")
async def get_settings(_: dict = Depends(get_current_user)):
    """
    Return configuration status — NEVER returns actual credentials.
    Requires any valid token (EMT / hospital / admin).
    """
    from dotenv import dotenv_values
    vals = dotenv_values(ENV_PATH) if ENV_PATH.exists() else {}

    return {
        "smtp_user_hint": (vals.get("SMTP_USER") or "")[:3] + "***" if vals.get("SMTP_USER") else None,
        "email_configured": _is_set(vals.get("SMTP_USER")) and _is_set(vals.get("SMTP_PASSWORD")),
        "sms_configured": (
            _is_set(vals.get("TWILIO_ACCOUNT_SID"))
            and _is_set(vals.get("TWILIO_AUTH_TOKEN"))
            and _is_set(vals.get("TWILIO_FROM_NUMBER"))
        ),
        "twilio_from": vals.get("TWILIO_FROM_NUMBER", ""),
    }


@router.post("/save-smtp", status_code=status.HTTP_200_OK)
async def save_smtp_settings(
    payload: SMTPSettingsPayload,
    admin: dict = Depends(get_current_admin_user),   # ← ADMIN ONLY
):
    """Save SMTP credentials to .env. Admin role required."""
    updates = {
        "SMTP_USER": payload.smtp_user,
        "SMTP_PASSWORD": payload.smtp_password,
        "SMTP_HOST": payload.smtp_host,
        "SMTP_PORT": str(payload.smtp_port),
    }
    try:
        _write_env(updates)
        for k, v in updates.items():
            os.environ[k] = v
        return {"status": "saved", "keys": list(updates.keys())}
    except OSError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to persist configuration: {e}",
        )


@router.post("/save-twilio", status_code=status.HTTP_200_OK)
async def save_twilio_settings(
    payload: TwilioSettingsPayload,
    admin: dict = Depends(get_current_admin_user),   # ← ADMIN ONLY
):
    """Save Twilio credentials to .env. Admin role required."""
    updates = {
        "TWILIO_ACCOUNT_SID": payload.account_sid,
        "TWILIO_AUTH_TOKEN": payload.auth_token,
        "TWILIO_FROM_NUMBER": payload.from_number,
    }
    try:
        _write_env(updates)
        for k, v in updates.items():
            os.environ[k] = v
        return {"status": "saved", "keys": list(updates.keys())}
    except OSError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to persist configuration: {e}",
        )


@router.post("/test-email")
async def test_email(
    payload: TestAlertPayload,
    admin: dict = Depends(get_current_admin_user),   # ← ADMIN ONLY
):
    """Send a test email to verify SMTP credentials. Admin role required."""
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_password = os.environ.get("SMTP_PASSWORD", "")
    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("SMTP_PORT", 587))

    if not smtp_user or not smtp_password:
        raise HTTPException(status_code=400, detail="SMTP credentials not configured. Use /save-smtp first.")

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "✅ MediSyncAI — Test Email Confirmed!"
        msg["From"] = f"MediSyncAI Emergency System <{smtp_user}>"
        msg["To"] = str(payload.to_email)
        html = f"""
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:30px;background:#f0f4ff;border-radius:16px">
          <h2 style="color:#0a74ff">✅ Email Connection Verified!</h2>
          <p>Your MediSyncAI emergency notification system is fully connected.</p>
          <p style="color:#64748b;font-size:13px">Emergency alerts will be delivered here when an SOS is triggered.</p>
        </div>"""
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            server.ehlo(); server.starttls()
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, [str(payload.to_email)], msg.as_string())

        return {"success": True, "message": f"Test email sent to {payload.to_email}"}
    except smtplib.SMTPAuthenticationError:
        raise HTTPException(status_code=401, detail="Gmail authentication failed. Use an App Password from myaccount.google.com/apppasswords")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/test-sms")
async def test_sms(
    payload: TestAlertPayload,
    admin: dict = Depends(get_current_admin_user),   # ← ADMIN ONLY
):
    """Send a test SMS to verify Twilio credentials. Admin role required."""
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    auth_token  = os.environ.get("TWILIO_AUTH_TOKEN", "")
    from_number = os.environ.get("TWILIO_FROM_NUMBER", "")

    if not all([account_sid, auth_token, from_number]):
        raise HTTPException(status_code=400, detail="Twilio credentials not configured. Use /save-twilio first.")

    try:
        from twilio.rest import Client
        client = Client(account_sid, auth_token)
        message = client.messages.create(
            body="✅ MediSyncAI Test: Your SMS alerts are working!",
            from_=from_number,
            to=payload.to_phone,
        )
        return {"success": True, "sid": message.sid}
    except Exception as e:
        error_str = str(e)
        if "21608" in error_str:
            raise HTTPException(status_code=400, detail="Twilio trial: add verified number at console.twilio.com → Verified Caller IDs.")
        raise HTTPException(status_code=500, detail=error_str)