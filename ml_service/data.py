"""
data.py — Vocabulary, vectorization, and synthetic data generation.

Direct port of the JavaScript neural_network.js data pipeline to Python/NumPy.
Keeps the exact same feature ordering and normalization so that existing
model_weights.json files remain compatible.
"""

import numpy as np

# ─── Constants ────────────────────────────────────────────────────────────────

RED_FLAGS_LIST = [
    "unconscious",
    "not breathing",
    "severe bleeding",
    "chest pain",
    "stroke symptoms",
]

URGENCY_CLASSES = ["stable", "urgent", "critical"]

VOCABULARY = [
    "unconscious", "passed out", "fainted", "unresponsive",
    "breathing", "not breathing", "stop", "struggling", "apnea", "arrest", "suffocating",
    "bleeding", "severe bleeding", "heavy", "profuse", "hemorrhage",
    "chest pain", "cardiac", "heart attack", "pressure in chest",
    "stroke", "slurred", "drooping", "numbness", "weakness", "facial droop",
    "pain", "fever", "cough", "dizzy", "headache", "accident", "fall",
    "injury", "injured", "vomit", "nausea",
]

# ─── Feature Engineering ─────────────────────────────────────────────────────

def vectorize_input(vitals: dict, symptoms: str = "", age: int = 45) -> np.ndarray:
    """
    Convert patient vitals + free-text symptoms into a 43-dim feature vector.
    Matches the JS `vectorizeInput` exactly.
    """
    hr    = float(vitals.get("hr", vitals.get("heartRate", 75)))
    spo2  = float(vitals.get("spo2", 98))
    sbp   = float(vitals.get("systolicBP", vitals.get("systolic_bp", 120)))
    temp  = float(vitals.get("temp", vitals.get("temperature", 36.6)))
    rr    = float(vitals.get("respRate", vitals.get("resp_rate", 14)))

    # Z-score-style normalization (same constants as JS)
    norm_hr   = (hr   - 75)  / 40
    norm_spo2 = (spo2 - 95)  / 5
    norm_sbp  = (sbp  - 110) / 30
    norm_temp = (temp - 37)   / 2
    norm_rr   = (rr   - 16)  / 6
    norm_age  = (float(age) - 45) / 25

    notes_lower = (symptoms or "").lower()
    word_features = [1.0 if word in notes_lower else 0.0 for word in VOCABULARY]

    return np.array(
        [norm_hr, norm_spo2, norm_sbp, norm_temp, norm_rr, norm_age] + word_features,
        dtype=np.float64,
    )


# ─── Expert Rule Engine (label generator) ────────────────────────────────────

def calculate_expert_triage(vitals: dict, symptoms: str, age: int) -> dict:
    """
    Deterministic NEWS2-style scorer used to generate ground-truth labels
    for synthetic training data.  Mirrors the JS `calculateExpertTriage`.
    """
    score = 0

    spo2 = float(vitals["spo2"])
    if spo2 < 90:
        score += 3
    elif spo2 < 94:
        score += 1

    hr = float(vitals["hr"])
    if hr > 130 or hr < 40:
        score += 2
    elif hr > 110 or hr < 50:
        score += 1

    sbp = float(vitals["systolicBP"])
    if sbp < 90:
        score += 3
    elif sbp < 100:
        score += 1

    temp = float(vitals["temp"])
    if temp > 39.5 or temp < 35.0:
        score += 1

    rr = float(vitals["respRate"])
    if rr > 24 or rr < 9:
        score += 3
    elif rr > 20:
        score += 1

    if score >= 5:
        vitals_urgency = "critical"
    elif score >= 2:
        vitals_urgency = "urgent"
    else:
        vitals_urgency = "stable"

    # Red-flag NLP extraction (keyword matching)
    notes_lower = (symptoms or "").lower()
    red_flags = []

    if any(w in notes_lower for w in ("unconscious", "passed out", "fainted", "unresponsive")):
        red_flags.append("unconscious")
    if "breathing" in notes_lower and any(w in notes_lower for w in ("not", "stop", "struggling", "apnea", "arrest")):
        red_flags.append("not breathing")
    if "bleeding" in notes_lower and any(w in notes_lower for w in ("severe", "heavy", "hemorrhage", "arterial", "profuse")):
        red_flags.append("severe bleeding")
    if any(w in notes_lower for w in ("chest pain", "cardiac", "heart attack", "pressure in chest")):
        red_flags.append("chest pain")
    if any(w in notes_lower for w in ("stroke", "slurred", "numbness", "weakness", "facial droop", "drooping")):
        red_flags.append("stroke symptoms")

    # Precedence escalation
    urgency = vitals_urgency
    rank = {"stable": 0, "urgent": 1, "critical": 2}
    has_override = any(f in RED_FLAGS_LIST for f in red_flags)

    if has_override and rank[urgency] < rank["critical"]:
        urgency = "critical"
    elif len(red_flags) > 0 and rank[urgency] < rank["urgent"]:
        urgency = "urgent"

    return {
        "score": score,
        "vitals_urgency": vitals_urgency,
        "red_flags": red_flags,
        "urgency": urgency,
    }


# ─── Synthetic Data Generator ────────────────────────────────────────────────

SYMPTOMS_BANK = [
    {"text": "Patient reports severe chest pain radiating to left arm. Shortness of breath.", "flags": ["chest pain"]},
    {"text": "Unconscious male found on street, unresponsive to pain. Slow shallow breathing.", "flags": ["unconscious"]},
    {"text": "Not breathing, cardiac arrest. CPR is in progress.", "flags": ["not breathing"]},
    {"text": "Profuse arterial bleeding from leg laceration due to power tool accident.", "flags": ["severe bleeding"]},
    {"text": "Left sided weakness, facial droop, slurred speech started 30 mins ago.", "flags": ["stroke symptoms"]},
    {"text": "Mild cough and fever for 3 days. Patient is awake and talking.", "flags": []},
    {"text": "Sprained ankle after falling down two steps. In mild pain.", "flags": []},
    {"text": "Nausea, vomiting and abdominal distress, no other red flags.", "flags": []},
    {"text": "Severe headache and dizziness. Vitals are currently stable.", "flags": []},
    {"text": "Patient fainted but is now responsive. Complaining of weakness.", "flags": ["unconscious"]},
    {"text": "Crushing pressure in chest accompanied by shortness of breath and left arm numbness.", "flags": ["chest pain"]},
    {"text": "Sudden onset of slurred speech, facial drooping, and right-sided numbness.", "flags": ["stroke symptoms"]},
    {"text": "Found unresponsive, passed out, and completely fainted on the floor. GCS 6.", "flags": ["unconscious"]},
    {"text": "Patient is choking, suffocating, and not breathing. Emergency airway required.", "flags": ["not breathing"]},
    {"text": "Heavy hemorrhage and severe bleeding from a deep laceration on the forearm.", "flags": ["severe bleeding"]},
    {"text": "High fever, persistent cough, and body aches. No chest pain or respiratory distress.", "flags": []},
    {"text": "Severe headache with dizziness and nausea. Vitals are otherwise stable.", "flags": []},
    {"text": "Injured left shoulder after a fall. Moderate pain on movement, minor bruising.", "flags": []},
    {"text": "Experiencing cardiac discomfort and pressure in chest radiating to jaw.", "flags": ["chest pain"]},
    {"text": "Drooping face and weakness in left leg, suspect acute stroke symptoms.", "flags": ["stroke symptoms"]}
]


def generate_synthetic_data(count: int = 2000) -> list[dict]:
    """Generate `count` synthetic labelled training examples."""
    rng = np.random.default_rng()
    dataset = []

    for _ in range(count):
        hr        = int(rng.integers(35, 156))
        spo2      = int(rng.integers(85, 101))
        systolicBP = int(rng.integers(70, 171))
        temp      = round(float(rng.uniform(34.0, 40.0)), 1)
        respRate  = int(rng.integers(6, 32))
        age       = int(rng.integers(12, 93))

        vitals = {"hr": hr, "spo2": spo2, "systolicBP": systolicBP, "temp": temp, "respRate": respRate}

        symptom_entry = SYMPTOMS_BANK[int(rng.integers(0, len(SYMPTOMS_BANK)))]
        text = symptom_entry["text"] if rng.random() > 0.15 else ""

        truth = calculate_expert_triage(vitals, text, age)
        inputs = vectorize_input(vitals, text, age)

        target_urgency = np.array([
            1.0 if truth["urgency"] == "stable"  else 0.0,
            1.0 if truth["urgency"] == "urgent"  else 0.0,
            1.0 if truth["urgency"] == "critical" else 0.0,
        ])

        target_red_flags = np.array([
            1.0 if f in truth["red_flags"] else 0.0 for f in RED_FLAGS_LIST
        ])

        dataset.append({
            "inputs": inputs,
            "target_urgency": target_urgency,
            "target_red_flags": target_red_flags,
            "meta": {
                "vitals": vitals,
                "text": text,
                "age": age,
                "urgency": truth["urgency"],
                "red_flags": truth["red_flags"],
            },
        })

    return dataset
