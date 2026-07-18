from pydantic import BaseModel, EmailStr
from typing import List

class EmergencyContact(BaseModel):
    name: str
    phone: str
    email: str
    relation: str


class AlertPayload(BaseModel):
    contacts: List[EmergencyContact]
    patientId: str = "TBD"
    patientName: str
    urgency: str = "Critical"
    summary: str = "User initiated SOS request."
    symptoms: str = "Unknown / Automatic SOS"
    hospitalName: str = "Pending Dispatch"
    hospitalEta: int = 0
    ambulanceLat: float = 0.0
    ambulanceLng: float = 0.0
    patientLat: float = 0.0
    patientLng: float = 0.0