"""
Maps symptom keywords to severity levels.

0 = No urgency
1 = Mild
2 = Moderate
3 = High Risk
"""

SYMPTOM_WEIGHTS = {

    # -------------------------
    # Cardiac
    # -------------------------
    "chest pain": 2,
    "crushing chest pain": 3,
    "radiating pain": 3,
    "heart attack": 3,
    "palpitations": 2,

    # -------------------------
    # Respiratory
    # -------------------------
    "difficulty breathing": 3,
    "shortness of breath": 3,
    "blue lips": 3,
    "wheezing": 2,
    "asthma attack": 3,

    # -------------------------
    # Neurological
    # -------------------------
    "slurred speech": 3,
    "weakness": 2,
    "one sided weakness": 3,
    "seizure": 3,
    "loss of consciousness": 3,
    "confusion": 2,
    "dizziness": 1,

    # -------------------------
    # Trauma
    # -------------------------
    "bleeding": 3,
    "uncontrolled bleeding": 3,
    "fracture": 2,
    "burn": 2,
    "major burn": 3,

    # -------------------------
    # Infection
    # -------------------------
    "fever": 1,
    "high fever": 2,
    "cough": 1,
    "vomiting": 1,
    "diarrhea": 1,

    # -------------------------
    # General
    # -------------------------
    "headache": 1,
    "fatigue": 0,
    "sore throat": 0,
    "minor cut": 0,
    "routine checkup": 0
}


def symptom_severity(symptoms: str):

    symptoms = symptoms.lower()

    highest = 0

    for keyword, weight in SYMPTOM_WEIGHTS.items():

        if keyword in symptoms:
            highest = max(highest, weight)

    return highest