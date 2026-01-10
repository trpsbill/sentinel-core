from __future__ import annotations

from fastapi import FastAPI, HTTPException
import numpy as np

from .schema import DecideRequest, DecideResponse
from .model import PPOInference

app = FastAPI(title="Sentinel PPO Inference Service", version="v1")

ppo = PPOInference()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_version": ppo.version,
        "device": ppo.device,
    }


@app.post("/decide", response_model=DecideResponse)
def decide(req: DecideRequest):
    try:
        obs = np.array(
            [
                req.return_1,
                req.return_5,
                req.ema_spread,
                req.ema_9_slope,
                req.ema_21_slope,
                float(req.position),
                req.unrealized_pnl,
            ],
            dtype=np.float32,
        )

        action, confidence, probs, action_idx, latency_ms = ppo.decide(obs)

        return DecideResponse(
            action=action,  # HOLD|BUY|SELL
            confidence=float(confidence),
            meta={
                "model_version": ppo.version,
                "probs": probs,
                "action_idx": action_idx,
                "latency_ms": float(latency_ms),
                "obs": {
                    "return_1": req.return_1,
                    "return_5": req.return_5,
                    "ema_spread": req.ema_spread,
                    "ema_9_slope": req.ema_9_slope,
                    "ema_21_slope": req.ema_21_slope,
                    "position": req.position,
                    "unrealized_pnl": req.unrealized_pnl,
                },
            },
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
