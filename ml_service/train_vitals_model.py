import os
import joblib
import numpy as np
import pandas as pd

from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, accuracy_score
from sklearn.model_selection import train_test_split


# ==========================================================
# SETTINGS
# ==========================================================

np.random.seed(42)

NUM_SAMPLES = 20000

MODEL_DIR = os.path.join("app", "models_ml")

os.makedirs(MODEL_DIR, exist_ok=True)


# ==========================================================
# NEWS2 SCORING
# ==========================================================

def news2_score(hr, rr, spo2, sbp, temp, consciousness="alert"):

    score = 0

    # Heart Rate
    if hr <= 40 or hr >= 131:
        score += 3
    elif 41 <= hr <= 50:
        score += 1
    elif 91 <= hr <= 110:
        score += 1
    elif 111 <= hr <= 130:
        score += 2

    # Respiratory Rate
    if rr <= 8:
        score += 3
    elif 9 <= rr <= 11:
        score += 1
    elif 21 <= rr <= 24:
        score += 2
    elif rr >= 25:
        score += 3

    # Oxygen Saturation
    if spo2 <= 91:
        score += 3
    elif 92 <= spo2 <= 93:
        score += 2
    elif 94 <= spo2 <= 95:
        score += 1

    # Systolic BP
    if sbp <= 90:
        score += 3
    elif 91 <= sbp <= 100:
        score += 2
    elif 101 <= sbp <= 110:
        score += 1
    elif sbp >= 220:
        score += 3

    # Temperature
    if temp <= 35:
        score += 3
    elif 35.1 <= temp <= 36:
        score += 1
    elif 38.1 <= temp <= 39:
        score += 1
    elif temp >= 39.1:
        score += 2

    # Consciousness
    if consciousness.lower() != "alert":
        score += 3

    return score


# ==========================================================
# SYNTHETIC DATA
# ==========================================================

print("Generating synthetic patient dataset...")

df = pd.DataFrame({

    "hr": np.random.normal(85, 25, NUM_SAMPLES).clip(30, 200),

    "rr": np.random.normal(16, 5, NUM_SAMPLES).clip(6, 40),

    "spo2": np.random.normal(96, 3.5, NUM_SAMPLES).clip(70, 100),

    "sbp": np.random.normal(120, 25, NUM_SAMPLES).clip(60, 220),

    "dbp": np.random.normal(80, 15, NUM_SAMPLES).clip(40, 140),

    "temp": np.random.normal(37, 1.2, NUM_SAMPLES).clip(33, 41)

})


df["consciousness"] = np.random.choice(
    ["alert", "altered"],
    size=NUM_SAMPLES,
    p=[0.95, 0.05]
)


df["symptom_severity"] = np.random.choice(
    [0, 1, 2, 3],
    size=NUM_SAMPLES,
    p=[0.55, 0.25, 0.15, 0.05]
)


print(df.head())
# ==========================================================
# FEATURE ENGINEERING
# ==========================================================

print("Engineering features...")

# Mean Arterial Pressure
df["map"] = (df["sbp"] + 2 * df["dbp"]) / 3

# Shock Index
df["shock_index"] = df["hr"] / df["sbp"]


# ==========================================================
# LABEL GENERATION
# ==========================================================

def generate_label(row):

    score = news2_score(
        hr=row.hr,
        rr=row.rr,
        spo2=row.spo2,
        sbp=row.sbp,
        temp=row.temp,
        consciousness=row.consciousness
    )

    # Clinical override using symptom severity
    score += row.symptom_severity * 2

    # Additional red-flag escalation
    if row.symptom_severity == 3 and score < 7:
        score += 6

    # Final urgency label
    if score >= 13:
        return 1      # Critical
    elif score >= 7:
        return 2      # Urgent
    elif score >= 3:
        return 3      # Moderate
    else:
        return 4      # Non-Urgent


print("Generating labels...")

df["urgency_level"] = df.apply(generate_label, axis=1)


# ==========================================================
# FEATURES
# ==========================================================

FEATURE_COLUMNS = [

    "hr",

    "rr",

    "spo2",

    "sbp",

    "dbp",

    "temp",

    "map",

    "shock_index",

    "symptom_severity"

]

TARGET_COLUMN = "urgency_level"

X = df[FEATURE_COLUMNS]

y = df[TARGET_COLUMN]


# ==========================================================
# TRAIN / TEST SPLIT
# ==========================================================

print("Splitting dataset...")

X_train, X_test, y_train, y_test = train_test_split(

    X,

    y,

    test_size=0.2,

    random_state=42,

    stratify=y

)


# ==========================================================
# RANDOM FOREST
# ==========================================================

print("Training Random Forest...")

model = RandomForestClassifier(

    n_estimators=300,

    max_depth=12,

    random_state=42,

    class_weight="balanced"

)

model.fit(X_train, y_train)


print("Training completed.")
# ==========================================================
# MODEL EVALUATION
# ==========================================================

print("\nEvaluating model...")

y_pred = model.predict(X_test)

print(f"Accuracy: {accuracy_score(y_test, y_pred):.4f}")

print("\nClassification Report:\n")
print(classification_report(y_test, y_pred))


# ==========================================================
# SAVE MODEL
# ==========================================================

print("\nSaving model files...")

joblib.dump(
    model,
    os.path.join(MODEL_DIR, "vitals_model.joblib")
)

joblib.dump(
    FEATURE_COLUMNS,
    os.path.join(MODEL_DIR, "vitals_model_features.joblib")
)

df.to_csv(
    "synthetic_vitals_dataset.csv",
    index=False
)

print("\nFiles saved successfully!")

print("\nGenerated files:")

print("app/models_ml/vitals_model.joblib")

print("app/models_ml/vitals_model_features.joblib")

print("synthetic_vitals_dataset.csv")