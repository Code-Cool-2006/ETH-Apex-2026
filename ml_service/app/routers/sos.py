from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime

router = APIRouter(prefix="/api/sos", tags=["sos"])


class SOSContact(BaseModel):
    name: str
    phone: str
    email: str = ""
    relation: str = "Family"


class SOSTriggerPayload(BaseModel):
    patient_name: str
    lat: float
    lng: float
    condition: str = "Medical Emergency"
    contacts: List[SOSContact]


def _maps_link(lat: float, lng: float) -> str:
    return f"https://www.google.com/maps?q={lat},{lng}"


def _build_email_html(patient_name: str, condition: str, lat: float, lng: float, contact_name: str) -> str:
    maps = _maps_link(lat, lng)
    now = datetime.now().strftime("%d %b %Y, %I:%M %p")
    coords = f"{lat:.5f}, {lng:.5f}" if lat != 0 else "Location unavailable"
    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"/>
<style>
  body{{font-family:'Segoe UI',sans-serif;margin:0;padding:0;background:#f0f4ff}}
  .wrap{{max-width:560px;margin:0 auto;padding:20px}}
  .card{{background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.15)}}
  .top{{background:linear-gradient(135deg,#ff2a55,#ff007f);padding:35px 30px;text-align:center;color:#fff}}
  .top h1{{margin:0 0 8px;font-size:24px;font-weight:900}}
  .top p{{margin:0;opacity:.85;font-size:13px}}
  .body{{padding:30px}}
  .name{{font-size:32px;font-weight:900;color:#ff2a55;text-align:center;margin:0 0 4px}}
  .sub{{text-align:center;font-size:15px;color:#334155;margin:0 0 24px}}
  .box{{background:#fff5f7;border:2px solid #ff2a5520;border-radius:14px;padding:18px;margin-bottom:20px}}
  .row{{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px}}
  .row:last-child{{border:none}}
  .lbl{{color:#64748b}}.val{{font-weight:700;color:#0f172a}}
  .btn{{display:block;text-align:center;background:linear-gradient(135deg,#ff2a55,#ff007f);color:#fff;
        padding:18px;border-radius:14px;text-decoration:none;font-weight:800;font-size:16px;
        margin:20px 0;box-shadow:0 8px 20px rgba(255,42,85,.3)}}
  .footer{{padding:18px;text-align:center;font-size:12px;color:#94a3b8;background:#f8fafc}}
</style></head>
<body><div class="wrap"><div class="card">
  <div class="top">
    <div style="font-size:52px;margin-bottom:10px">🚨</div>
    <h1>MEDICAL EMERGENCY</h1>
    <p>Alert sent at {now} — Please respond immediately</p>
  </div>
  <div class="body">
    <div class="name">{patient_name}</div>
    <div class="sub">needs immediate medical help</div>
    <div class="box">
      <div class="row"><span class="lbl">Condition</span><span class="val">{condition}</span></div>
      <div class="row"><span class="lbl">GPS Location</span><span class="val">{coords}</span></div>
      <div class="row"><span class="lbl">Time of Alert</span><span class="val">{now}</span></div>
    </div>
    <a href="{maps}" class="btn">📍 TAP TO SEE LIVE LOCATION ON MAP</a>
    <p style="font-size:13px;color:#64748b;text-align:center;line-height:1.6">
      Dear {contact_name},<br/>
      {patient_name} has triggered an emergency SOS.<br/>
      Please call them or go to their location immediately.
    </p>
  </div>
  <div class="footer">MediSyncAI Emergency Alert • Do not reply to this email</div>
</div></div></body></html>"""


def _send_email(to_email: str, to_name: str, patient_name: str, condition: str, lat: float, lng: float) -> dict:
    if not to_email:
        return {"ok": False, "error": "No email address"}

    smtp_user = os.environ.get("SMTP_USER", "").strip()
    smtp_password = os.environ.get("SMTP_PASSWORD", "").strip()
    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("SMTP_PORT", 587))

    if not smtp_user or smtp_user == "your_gmail@gmail.com" or not smtp_password or smtp_password == "your_16_char_app_password":
        return {"ok": False, "error": "Email not configured — go to Settings tab"}

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"🚨 EMERGENCY: {patient_name} needs help NOW!"
        msg["From"] = f"MediSyncAI Emergency <{smtp_user}>"
        msg["To"] = f"{to_name} <{to_email}>"
        msg.attach(MIMEText(_build_email_html(patient_name, condition, lat, lng, to_name), "html"))

        with smtplib.SMTP(smtp_host, smtp_port, timeout=12) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, [to_email], msg.as_string())

        print(f"[SOS EMAIL] ✅ Sent to {to_name} <{to_email}>")
        return {"ok": True}
    except smtplib.SMTPAuthenticationError:
        return {"ok": False, "error": "Gmail auth failed — enter App Password WITHOUT spaces in Settings"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/trigger")
async def trigger_sos(payload: SOSTriggerPayload):
    """Send email alerts. SMS is handled natively by the browser (no Twilio)."""
    results = []
    for contact in payload.contacts:
        email_result = _send_email(
            contact.email, contact.name,
            payload.patient_name, payload.condition,
            payload.lat, payload.lng
        )
        results.append({
            "name": contact.name,
            "phone": contact.phone,
            "email": contact.email,
            "email_result": email_result,
        })
        print(f"[SOS] {contact.name} | Email: {email_result}")

    return {
        "triggered": True,
        "contacts_notified": len(results),
        "results": results,
    }


@router.get("/check-config")
async def check_config():
    smtp_user = os.environ.get("SMTP_USER", "").strip()
    smtp_pass = os.environ.get("SMTP_PASSWORD", "").strip()
    email_ok = (
        bool(smtp_user) and smtp_user != "your_gmail@gmail.com"
        and bool(smtp_pass) and smtp_pass != "your_16_char_app_password"
    )
    return {"email_ready": email_ok, "sms_ready": True}  # SMS is always "ready" via native