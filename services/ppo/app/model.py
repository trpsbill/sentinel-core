from __future__ import annotations

import time
from typing import Dict, Tuple

import numpy as np

from stable_baselines3 import PPO

# SB3 uses torch internally
import torch

from .config import MODEL_PATH, MODEL_VERSION, DEVICE


IDX_TO_ACTION = {
    0: "HOLD",
    1: "BUY",
    2: "SELL",
}


def _pick_device() -> str:
    if DEVICE == "cpu":
        return "cpu"
    if DEVICE == "cuda":
        return "cuda"
    # auto
    return "cuda" if torch.cuda.is_available() else "cpu"


class PPOInference:
    def __init__(self):
        self.device = _pick_device()
        self.model = PPO.load(MODEL_PATH, device=self.device)

    def decide(self, obs_7: np.ndarray) -> Tuple[str, float, Dict[str, float], int, float]:
        """
        Returns:
          action_str, confidence, probs_dict, action_idx, latency_ms
        """
        if obs_7.shape != (7,):
            raise ValueError(f"Expected obs shape (7,), got {obs_7.shape}")

        start = time.perf_counter()

        # SB3 expects batch dimension for distributions; predict accepts (7,)
        action_idx, _ = self.model.predict(obs_7, deterministic=True)
        action_idx = int(action_idx)

        # Get action probabilities
        obs_tensor = torch.as_tensor(obs_7, dtype=torch.float32, device=self.model.device).unsqueeze(0)
        with torch.no_grad():
            dist = self.model.policy.get_distribution(obs_tensor)
            # Categorical distribution for Discrete action spaces
            probs = dist.distribution.probs.squeeze(0).detach().cpu().numpy()

        probs_dict = {
            "HOLD": float(probs[0]),
            "BUY": float(probs[1]),
            "SELL": float(probs[2]),
        }

        confidence = probs_dict[IDX_TO_ACTION[action_idx]]

        latency_ms = (time.perf_counter() - start) * 1000.0
        return IDX_TO_ACTION[action_idx], confidence, probs_dict, action_idx, latency_ms

    @property
    def version(self) -> str:
        return MODEL_VERSION
