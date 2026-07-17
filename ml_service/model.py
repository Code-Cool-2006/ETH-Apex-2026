"""
model.py — Custom MLP Neural Network implemented in pure NumPy.

Architecture:  Input(43) → Hidden(20, ReLU) → Urgency(3, Softmax)
                                              → RedFlags(5, Sigmoid)

Exact port of the JavaScript NeuralNetwork class from neural_network.js,
including Xavier initialization, forward pass, and backpropagation.
Reads/writes the same model_weights.json format.
"""

import json
import os
import numpy as np


class NeuralNetwork:
    def __init__(
        self,
        input_size: int = 43,
        hidden_size: int = 20,
        output_size_urgency: int = 3,
        output_size_red_flags: int = 5,
    ):
        self.input_size = input_size
        self.hidden_size = hidden_size
        self.output_size_urgency = output_size_urgency
        self.output_size_red_flags = output_size_red_flags

        # Initialize weights (will be overwritten by load_weights if file exists)
        self._init_weights()

    # ── Weight Initialization (Xavier / Glorot) ──────────────────────────────

    def _init_weights(self):
        def _xavier(rows: int, cols: int) -> np.ndarray:
            limit = np.sqrt(6.0 / (rows + cols))
            return np.random.uniform(-limit, limit, size=(rows, cols))

        self.weights1 = _xavier(self.input_size, self.hidden_size)
        self.bias1 = np.full(self.hidden_size, 0.01)

        self.weights2_urgency = _xavier(self.hidden_size, self.output_size_urgency)
        self.bias2_urgency = np.full(self.output_size_urgency, 0.01)

        self.weights2_red_flags = _xavier(self.hidden_size, self.output_size_red_flags)
        self.bias2_red_flags = np.full(self.output_size_red_flags, 0.01)

    # ── Activation Functions ─────────────────────────────────────────────────

    @staticmethod
    def _sigmoid(x: np.ndarray) -> np.ndarray:
        x_clip = np.clip(x, -15, 15)
        return 1.0 / (1.0 + np.exp(-x_clip))

    @staticmethod
    def _relu(x: np.ndarray) -> np.ndarray:
        return np.maximum(0, x)

    @staticmethod
    def _softmax(x: np.ndarray) -> np.ndarray:
        x_shifted = x - np.max(x)
        x_clip = np.clip(x_shifted, -15, 15)
        exps = np.exp(x_clip)
        total = exps.sum()
        return exps / (total if total != 0 else 1)

    # ── Forward Pass ─────────────────────────────────────────────────────────

    def forward(self, inputs: np.ndarray) -> dict:
        """
        Run a single forward pass.
        Returns dict with 'hidden', 'urgency_probs', 'red_flags_probs'.
        """
        # Hidden layer: ReLU(X @ W1 + b1)
        hidden = self._relu(inputs @ self.weights1 + self.bias1)

        # Urgency head: Softmax(H @ W2u + b2u)
        urgency_logits = hidden @ self.weights2_urgency + self.bias2_urgency
        urgency_probs = self._softmax(urgency_logits)

        # Red-flags head: Sigmoid(H @ W2r + b2r)
        red_flags_logits = hidden @ self.weights2_red_flags + self.bias2_red_flags
        red_flags_probs = self._sigmoid(red_flags_logits)

        return {
            "hidden": hidden,
            "urgency_probs": urgency_probs,
            "red_flags_probs": red_flags_probs,
        }

    # ── Single-Step Backpropagation ──────────────────────────────────────────

    def train_step(
        self,
        inputs: np.ndarray,
        target_urgency: np.ndarray,
        target_red_flags: np.ndarray,
        lr: float = 0.01,
    ) -> float:
        """One gradient-descent step. Returns the combined loss."""
        result = self.forward(inputs)
        hidden = result["hidden"]
        urgency_probs = result["urgency_probs"]
        red_flags_probs = result["red_flags_probs"]

        # ── Output gradients ──
        d_urgency = urgency_probs - target_urgency          # (3,)
        d_red_flags = red_flags_probs - target_red_flags    # (5,)

        # ── Backprop to hidden ──
        d_hidden = (d_urgency @ self.weights2_urgency.T) + \
                   (d_red_flags @ self.weights2_red_flags.T)
        d_hidden_relu = d_hidden * (hidden > 0).astype(np.float64)

        # ── Weight updates ──
        # Urgency head
        self.weights2_urgency -= lr * np.outer(hidden, d_urgency)
        self.bias2_urgency -= lr * d_urgency

        # Red-flags head
        self.weights2_red_flags -= lr * np.outer(hidden, d_red_flags)
        self.bias2_red_flags -= lr * d_red_flags

        # Hidden layer
        self.weights1 -= lr * np.outer(inputs, d_hidden_relu)
        self.bias1 -= lr * d_hidden_relu

        # ── Loss calculation ──
        # Cross-entropy for urgency
        loss_urgency = -np.sum(
            target_urgency * np.log(np.maximum(urgency_probs, 1e-15))
        )
        # Binary cross-entropy for red flags
        loss_flags = -np.sum(
            target_red_flags * np.log(np.maximum(red_flags_probs, 1e-15)) +
            (1 - target_red_flags) * np.log(np.maximum(1 - red_flags_probs, 1e-15))
        )

        return float(loss_urgency + loss_flags)

    # ── Save / Load Weights (JSON, compatible with JS format) ────────────────

    def save_weights(self, filepath: str = "model_weights.json"):
        """Save weights to JSON in the same format as the JS version."""
        state = {
            "weights1": self.weights1.tolist(),
            "bias1": self.bias1.tolist(),
            "weights2Urgency": self.weights2_urgency.tolist(),
            "bias2Urgency": self.bias2_urgency.tolist(),
            "weights2RedFlags": self.weights2_red_flags.tolist(),
            "bias2RedFlags": self.bias2_red_flags.tolist(),
        }
        with open(filepath, "w") as f:
            json.dump(state, f, indent=2)
        print(f"Weights saved to {filepath}")

    def load_weights(self, filepath: str = "model_weights.json") -> bool:
        """Load weights from the shared JSON format."""
        if not os.path.exists(filepath):
            return False
        with open(filepath, "r") as f:
            data = json.load(f)
        self.weights1 = np.array(data["weights1"])
        self.bias1 = np.array(data["bias1"])
        self.weights2_urgency = np.array(data["weights2Urgency"])
        self.bias2_urgency = np.array(data["bias2Urgency"])
        self.weights2_red_flags = np.array(data["weights2RedFlags"])
        self.bias2_red_flags = np.array(data["bias2RedFlags"])
        print(f"Weights loaded from {filepath}")
        return True
