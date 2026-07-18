import os
from pathlib import Path
from dotenv import load_dotenv

ENV_PATH = Path(__file__).parent.parent.parent / ".env"
load_dotenv(ENV_PATH)


def send_alert_sms(to_phone: str, payload) -> bool:
    """Send a real SMS via Twilio. Reads credentials fresh from env each call."""
    # Always read credentials fresh (supports hot-reload from settings page)
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    from_number = os.environ.get("TWILIO_FROM_NUMBER", "")

    placeholder = account_sid.startswith("ACxxxxxx") or not account_sid or not auth_token or not from_number
    if placeholder:
        print("[SMS] ❌ Twilio credentials not configured — go to /settings in the app to set them up.")
        return False

    try:
        from twilio.rest import Client

        maps_url = (
            f"https://www.google.com/maps/dir/"
            f"{payload.patientLat},{payload.patientLng}/"
            f"{payload.ambulanceLat},{payload.ambulanceLng}"
        )

        sms_body = (
            f"🚨 MediSyncAI EMERGENCY ALERT\n"
            f"Patient: {payload.patientName}\n"
            f"Urgency: {payload.urgency}\n"
            f"Hospital: {payload.hospitalName}\n"
            f"ETA: {payload.hospitalEta} min\n"
            f"Track Live:\n{maps_url}"
        )

        client = Client(account_sid, auth_token)
        message = client.messages.create(
            body=sms_body,
            from_=from_number,
            to=to_phone
        )

        print(f"[SMS] ✅ SMS sent to {to_phone} — SID: {message.sid}")
        return True

    except ImportError:
        print("[SMS] ❌ Twilio not installed. Run: pip install twilio")
        return False
    except Exception as e:
        print(f"[SMS] ❌ Failed to send SMS to {to_phone}: {e}")
        return False