import smtplib
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime
from dotenv import load_dotenv
from pathlib import Path

# Load from the backend .env file
ENV_PATH = Path(__file__).parent.parent.parent / ".env"
load_dotenv(ENV_PATH)

FROM_NAME = "MediSyncAI Emergency System"


def build_email_html(payload) -> str:
    urgency_color = {
        "Critical": "#ff2a55",
        "High":     "#ff9d00",
        "Low":      "#00ff88",
    }.get(payload.urgency, "#0a74ff")

    maps_url = (
        f"https://www.google.com/maps/dir/"
        f"{payload.patientLat},{payload.patientLng}/"
        f"{payload.ambulanceLat},{payload.ambulanceLng}"
    )

    return f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    body {{ font-family: 'Segoe UI', sans-serif; background: #f0f4ff; margin:0; padding:20px; }}
    .card {{ max-width:620px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden;
             box-shadow:0 10px 30px rgba(0,0,0,0.12); }}
    .header {{ background: linear-gradient(135deg, #0a74ff, #00b4d8); color:#fff; padding:30px; }}
    .header h1 {{ margin:0; font-size:22px; }}
    .badge {{ display:inline-block; background:{urgency_color}; color:#fff;
              padding:4px 14px; border-radius:20px; font-size:12px; font-weight:bold;
              margin-top:10px; }}
    .body {{ padding:30px; }}
    .section {{ margin-bottom:24px; }}
    .section h3 {{ margin:0 0 12px 0; font-size:13px; text-transform:uppercase;
                   letter-spacing:1px; color:#64748b; }}
    .row {{ display:flex; justify-content:space-between; padding:10px 0;
            border-bottom:1px solid #f1f5f9; font-size:14px; }}
    .row .label {{ color:#64748b; }}
    .row .val {{ font-weight:600; color:#0f172a; }}
    .summary-box {{ background:#f8fafc; border-left:4px solid {urgency_color};
                    padding:15px; border-radius:0 10px 10px 0;
                    font-size:14px; color:#334155; line-height:1.6; }}
    .map-btn {{ display:block; text-align:center; background:#0a74ff; color:#fff;
                padding:15px; border-radius:10px; text-decoration:none;
                font-weight:bold; margin-top:20px; font-size:15px; }}
    .footer {{ background:#f8fafc; padding:20px; text-align:center;
               font-size:12px; color:#94a3b8; }}
  </style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>🚨 MediSyncAI — Emergency Alert</h1>
    <p style="margin:8px 0 0; opacity:.85">Automated notification sent at {datetime.now().strftime('%d %b %Y, %I:%M %p')}</p>
    <span class="badge">URGENCY: {payload.urgency.upper()}</span>
  </div>
  <div class="body">
    <div class="section">
      <h3>Patient Overview</h3>
      <div class="row"><span class="label">Patient ID</span><span class="val">{payload.patientId}</span></div>
      <div class="row"><span class="label">Name</span><span class="val">{payload.patientName}</span></div>
      <div class="row"><span class="label">Urgency Level</span><span class="val" style="color:{urgency_color}">{payload.urgency}</span></div>
      <div class="row"><span class="label">Reported Symptoms</span><span class="val">{payload.symptoms[:120]}...</span></div>
    </div>
    <div class="section">
      <h3>AI Triage Summary</h3>
      <div class="summary-box">{payload.summary}</div>
    </div>
    <div class="section">
      <h3>Dispatch Details</h3>
      <div class="row"><span class="label">Assigned Hospital</span><span class="val">{payload.hospitalName}</span></div>
      <div class="row"><span class="label">Estimated Arrival</span><span class="val">{payload.hospitalEta} minutes</span></div>
      <div class="row"><span class="label">Ambulance GPS</span><span class="val">{payload.ambulanceLat:.5f}, {payload.ambulanceLng:.5f}</span></div>
    </div>
    <a href="{maps_url}" class="map-btn">📍 Track Live on Google Maps</a>
  </div>
  <div class="footer">
    This alert was sent by the MediSyncAI Emergency Response System.<br/>
    Do not reply to this email. For emergencies call <strong>112</strong>.
  </div>
</div>
</body>
</html>
"""


def send_alert_email(to_email: str, to_name: str, payload) -> bool:
    """Send a real HTML email via Gmail SMTP. Reads credentials fresh from env each call."""
    # Always read credentials fresh (supports hot-reload from settings page)
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_password = os.environ.get("SMTP_PASSWORD", "")
    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("SMTP_PORT", 587))

    if not smtp_user or not smtp_password or smtp_user == "your_gmail@gmail.com":
        print("[EMAIL] ❌ SMTP credentials not configured — go to /settings in the app to set them up.")
        return False

    try:
        html_content = build_email_html(payload)

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"🚨 MediSyncAI Emergency Alert — {payload.urgency} | {payload.patientName}"
        msg["From"] = f"{FROM_NAME} <{smtp_user}>"
        msg["To"] = f"{to_name} <{to_email}>"
        msg.attach(MIMEText(html_content, "html"))

        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, [to_email], msg.as_string())

        print(f"[EMAIL] ✅ Alert sent to {to_name} <{to_email}>")
        return True

    except smtplib.SMTPAuthenticationError:
        print("[EMAIL] ❌ Authentication failed. Make sure you used an App Password, not your regular Gmail password.")
        return False
    except Exception as e:
        print(f"[EMAIL] ❌ Failed to send email: {e}")
        return False