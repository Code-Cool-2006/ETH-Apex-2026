"""
server.py — FastAPI microservice for the triage neural network.

Endpoints:
    POST /predict   — Run inference on vitals + symptoms
    POST /train     — Retrain the model from scratch
    GET  /health    — Health-check / readiness probe

Start:
    cd ml_service && uvicorn server:app --host 0.0.0.0 --port 8000 --reload
"""

import os
import sys
import traceback

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from data import RED_FLAGS_LIST, URGENCY_CLASSES, vectorize_input
from model import NeuralNetwork

# ─── App Setup ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="ResQLink AI — Python ML Service",
    version="1.0.0",
    description="Lightweight triage neural network inference server",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Model Singleton ─────────────────────────────────────────────────────────

WEIGHTS_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "model_weights.json")
)

model: NeuralNetwork | None = None


def load_model():
    """Load (or reload) the neural network from disk."""
    global model
    net = NeuralNetwork()
    if net.load_weights(WEIGHTS_PATH):
        model = net
        print(f"✓ Model loaded from {WEIGHTS_PATH}")
    else:
        print(f"⚠ No weights file found at {WEIGHTS_PATH}. Model is uninitialized.")
        model = net  # still usable, just with random weights


@app.on_event("startup")
def on_startup():
    load_model()


# ─── Request / Response Schemas ──────────────────────────────────────────────

class Vitals(BaseModel):
    hr: float = Field(75, description="Heart rate (bpm)")
    spo2: float = Field(98, description="Blood oxygen saturation (%)")
    systolicBP: float = Field(120, description="Systolic blood pressure (mmHg)")
    temp: float = Field(36.6, description="Body temperature (°C)")
    respRate: float = Field(14, description="Respiratory rate (breaths/min)")


class PredictRequest(BaseModel):
    vitals: Vitals
    symptoms: str = ""
    age: int = 45


class PredictResponse(BaseModel):
    urgency_probs: list[float]
    red_flags_probs: list[float]
    urgency_classes: list[str] = URGENCY_CLASSES
    red_flags_list: list[str] = RED_FLAGS_LIST


class TrainRequest(BaseModel):
    epochs: int = 150
    lr: float = 0.015
    data_count: int = 2500


class TrainResponse(BaseModel):
    urgency_acc: float
    flags_acc: float
    loss: float


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    """Run triage inference on a single patient case."""
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    vitals_dict = req.vitals.model_dump()
    inputs = vectorize_input(vitals_dict, req.symptoms, req.age)
    result = model.forward(inputs)

    return PredictResponse(
        urgency_probs=result["urgency_probs"].tolist(),
        red_flags_probs=result["red_flags_probs"].tolist(),
    )


@app.post("/train", response_model=TrainResponse)
def train_endpoint(req: TrainRequest):
    """Retrain the model from synthetic data and reload weights."""
    try:
        # Import here to avoid circular startup issues
        from train import train as run_training

        result = run_training(req.epochs, req.lr, req.data_count)
        load_model()  # reload freshly saved weights
        return TrainResponse(**result)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health():
    """Readiness probe for the Node.js server."""
    return {
        "status": "ok",
        "model_loaded": model is not None,
        "weights_path": WEIGHTS_PATH,
    }


# ─── Direct Run ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("ML_PORT", 8000))
    print(f"Starting Python ML service on port {port}...")
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=True)
