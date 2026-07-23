from pathlib import Path
import joblib
import pandas as pd

from app.utils.news2 import news2_score

BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = BASE_DIR / "models_ml"
print("=" * 60)
print("MODEL_DIR =", MODEL_DIR)

import os

print("vitals exists:", os.path.exists(MODEL_DIR / "vitals_model.joblib"))
print("symptom exists:", os.path.exists(MODEL_DIR / "symptom_model.joblib"))
print("features exists:", os.path.exists(MODEL_DIR / "vitals_model_features.joblib"))

print("vitals modified:",
      os.path.getmtime(MODEL_DIR / "vitals_model.joblib"))

print("symptom modified:",
      os.path.getmtime(MODEL_DIR / "symptom_model.joblib"))

print("=" * 60)

# Load models once
vitals_model = joblib.load(MODEL_DIR / "vitals_model.joblib")
symptom_model = joblib.load(MODEL_DIR / "symptom_model.joblib")
feature_columns = joblib.load(MODEL_DIR / "vitals_model_features.joblib")


def rule_based_urgency_level(news_score, symptom_severity):
    """
    Deterministic clinical safety-net check, mirroring the exact NEWS2 +
    symptom-severity threshold rule used to build the training labels
    (see train_vitals_model.py -> generate_label). NEWS2 is a real,
    internationally recognized early-warning score (Royal College of
    Physicians). This exists so the system never silently under-triages
    a patient purely because the ML classifier was uncertain near a
    decision boundary -- the ML model was never given news2_score as a
    feature, so it has to approximate this threshold logic from raw
    vitals alone, which isn't always precise right at the edges.
    """
    score = news_score + symptom_severity * 2

    if symptom_severity == 3 and score < 7:
        score += 6

    if score >= 13:
        return 1  # Critical
    elif score >= 7:
        return 2  # Urgent
    elif score >= 3:
        return 3  # Moderate
    return 4  # Non-Urgent


def predict_triage(
    hr,
    rr,
    spo2,
    sbp,
    dbp,
    temp,
    symptoms,
    consciousness="alert"
):

    # -----------------------------
    # NEWS2 Score
    # -----------------------------
    news_score = news2_score(
        hr=hr,
        rr=rr,
        spo2=spo2,
        sbp=sbp,
        temp=temp,
        consciousness=consciousness
    )

    # -----------------------------
    # Symptom Severity Prediction
    # -----------------------------
    symptom_severity = int(
        symptom_model.predict([symptoms])[0]
    )
    print("Symptoms received:", symptoms)
    print("Predicted severity:", symptom_severity)

    # -----------------------------
    # Engineered Features
    # -----------------------------
    map_value = (sbp + (2 * dbp)) / 3

    shock_index = hr / max(sbp, 1)

    # -----------------------------
    # Prepare Input
    # -----------------------------
    sample = pd.DataFrame([{
        "hr": hr,
        "rr": rr,
        "spo2": spo2,
        "sbp": sbp,
        "dbp": dbp,
        "temp": temp,
        "map": map_value,
        "shock_index": shock_index,
        "symptom_severity": symptom_severity
    }])

    sample = sample[feature_columns]

    # -----------------------------
    # ML Prediction
    # -----------------------------
    ml_prediction = int(vitals_model.predict(sample)[0])

    confidence = float(
        max(vitals_model.predict_proba(sample)[0])
    )

    # -----------------------------
    # Clinical Safety-Net Override
    # -----------------------------
    # Numerically lower urgency_level == more severe (1 = Critical).
    # Escalate to whichever of the two (ML model vs. NEWS2 rule) is more
    # severe -- never let the rule silently downgrade what the ML model
    # flagged as urgent, only escalate.
    rule_prediction = rule_based_urgency_level(news_score, symptom_severity)
    prediction = min(ml_prediction, rule_prediction)
    escalated_by_safety_net = prediction != ml_prediction

    urgency_map = {
        1: "Critical",
        2: "Urgent",
        3: "Moderate",
        4: "Non-Urgent"
    }

    return {
        "urgency_level": prediction,
        "urgency": urgency_map[prediction],
        "confidence": round(confidence, 3),
        "news2_score": news_score,
        "symptom_severity": symptom_severity,
        "map": round(map_value, 2),
        "shock_index": round(shock_index, 2),
        "ml_model_urgency_level": ml_prediction,
        "escalated_by_safety_net": escalated_by_safety_net
    }