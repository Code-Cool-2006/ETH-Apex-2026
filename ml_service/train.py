"""
train.py — Standalone training script for the triage MLP.

Usage:
    python train.py                        # defaults: 150 epochs, lr=0.015, 2500 samples
    python train.py --epochs 200 --lr 0.01 --samples 5000

Generates synthetic data, trains the network, and saves model_weights.json
to the project root (one directory up from ml_service/).
"""

import argparse
import os
import sys
import time

import numpy as np

from data import RED_FLAGS_LIST, generate_synthetic_data
from model import NeuralNetwork


def train(epochs: int = 150, lr: float = 0.015, data_count: int = 2500) -> dict:
    """Train the MLP and return accuracy metrics."""
    print(f"Generating {data_count} synthetic training examples...")
    dataset = generate_synthetic_data(data_count)

    net = NeuralNetwork()

    # Path to shared weights file in project root
    weights_path = os.path.join(os.path.dirname(__file__), "..", "model_weights.json")
    weights_path = os.path.abspath(weights_path)

    print(f"Starting Neural Network training for {epochs} epochs...")
    last_loss = 0.0

    for epoch in range(1, epochs + 1):
        # Shuffle
        np.random.shuffle(dataset)

        epoch_loss = 0.0
        for sample in dataset:
            epoch_loss += net.train_step(
                sample["inputs"],
                sample["target_urgency"],
                sample["target_red_flags"],
                lr,
            )
        epoch_loss /= len(dataset)
        last_loss = epoch_loss

        if epoch % 30 == 0 or epoch == 1 or epoch == epochs:
            print(f"  Epoch {epoch}/{epochs} — Avg Loss: {epoch_loss:.6f}")

    # ── Evaluate training accuracy ──
    correct_urgency = 0
    correct_flags = 0
    total_flags = 0

    for sample in dataset:
        pred = net.forward(sample["inputs"])

        pred_idx = int(np.argmax(pred["urgency_probs"]))
        true_idx = int(np.argmax(sample["target_urgency"]))
        if pred_idx == true_idx:
            correct_urgency += 1

        for j in range(len(RED_FLAGS_LIST)):
            p_flag = 1.0 if pred["red_flags_probs"][j] >= 0.5 else 0.0
            t_flag = sample["target_red_flags"][j]
            if p_flag == t_flag:
                correct_flags += 1
            total_flags += 1

    urgency_acc = (correct_urgency / len(dataset)) * 100
    flags_acc = (correct_flags / total_flags) * 100

    print(f"\n✓ Training complete.")
    print(f"  Urgency Accuracy : {urgency_acc:.2f}%")
    print(f"  Red Flags Accuracy: {flags_acc:.2f}%")
    print(f"  Final Loss        : {last_loss:.6f}")

    net.save_weights(weights_path)

    return {
        "urgency_acc": urgency_acc,
        "flags_acc": flags_acc,
        "loss": last_loss,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train the EMS triage neural network")
    parser.add_argument("--epochs", type=int, default=150)
    parser.add_argument("--lr", type=float, default=0.015)
    parser.add_argument("--samples", type=int, default=2500)
    args = parser.parse_args()

    start = time.time()
    result = train(args.epochs, args.lr, args.samples)
    duration = time.time() - start

    print(f"\nTotal training time: {duration:.1f}s")
    print("Weights saved to model_weights.json")
