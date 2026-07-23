import os
import random
import pandas as pd
import joblib

from sklearn.pipeline import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

# ----------------------------------------------------
# Save Location
# ----------------------------------------------------

MODEL_DIR = os.path.join("app", "models_ml")
os.makedirs(MODEL_DIR, exist_ok=True)

random.seed(42)

# ----------------------------------------------------
# Templates
# ----------------------------------------------------

severity_templates = {

    0: [
        "routine checkup",
        "annual health check",
        "minor scrape",
        "prescription refill",
        "general consultation",
        "small bruise",
        "mild fatigue",
        "sore throat",
        "runny nose",
        "itchy skin",
        "mild cold",
        "seasonal allergies"
    ],

    1: [
        "headache",
        "low fever",
        "cough",
        "vomiting",
        "diarrhea",
        "back pain",
        "joint pain",
        "mild stomach pain",
        "ear pain",
        "mild dizziness",
        "swollen ankle",
        "mild dehydration"
    ],

    2: [
        "chest pain",
        "high fever",
        "difficulty breathing",
        "palpitations",
        "persistent vomiting",
        "fracture",
        "burn injury",
        "severe abdominal pain",
        "asthma attack",
        "blood in urine",
        "confusion",
        "high blood pressure symptoms"
    ],

    3: [
        "crushing chest pain radiating to left arm",
        "loss of consciousness",
        "slurred speech",
        "stroke symptoms",
        "heart attack",
        "uncontrolled bleeding",
        "blue lips",
        "seizure",
        "cardiac arrest",
        "difficulty breathing with chest pain",
        "one sided weakness",
        "severe trauma"
    ]
}

# ----------------------------------------------------
# Generate Dataset
# ----------------------------------------------------

texts = []
labels = []

for severity, phrases in severity_templates.items():

    for phrase in phrases:

        for _ in range(300):

            texts.append(phrase)
            labels.append(severity)

df = pd.DataFrame({

    "symptoms": texts,
    "severity": labels

})

print(df.head())

# ----------------------------------------------------
# Train Model
# ----------------------------------------------------

pipeline = Pipeline([

    (

        "tfidf",

        TfidfVectorizer(
            lowercase=True,
            stop_words="english"
        )

    ),

    (

        "classifier",

        LogisticRegression(
            max_iter=1000
        )

    )

])

pipeline.fit(df["symptoms"], df["severity"])

# ----------------------------------------------------
# Save
# ----------------------------------------------------

joblib.dump(

    pipeline,

    os.path.join(
        MODEL_DIR,
        "symptom_model.joblib"
    )

)

df.to_csv(

    "synthetic_symptom_dataset.csv",

    index=False

)

print()

print("Symptom model trained successfully.")

print("Saved:")

print("app/models_ml/symptom_model.joblib")

print("synthetic_symptom_dataset.csv")