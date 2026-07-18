from fastapi import APIRouter
from app.models.schemas import AlertPayload
from app.services.email_service import send_alert_email
from app.services.sms_service import send_alert_sms

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.post("/send")
async def send_emergency_alert(payload: AlertPayload):
    results = []

    for contact in payload.contacts:
        # 1. Send real email via Gmail SMTP
        email_sent = send_alert_email(contact.email, contact.name, payload)

        # 2. Send real SMS via Twilio
        sms_sent = send_alert_sms(contact.phone, payload)

        results.append({
            "contact": contact.name,
            "email": contact.email,
            "phone": contact.phone,
            "email_sent": email_sent,
            "sms_sent": sms_sent,
        })

    return {
        "status": "dispatched",
        "patient": payload.patientId,
        "notifications": results,
        "total": len(results),
    }