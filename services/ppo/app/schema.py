from pydantic import BaseModel, Field
from typing import Dict, Literal

Action = Literal["HOLD", "BUY", "SELL"]

class DecideRequest(BaseModel):
    return_1: float
    return_5: float
    ema_spread: float
    ema_9_slope: float
    ema_21_slope: float
    position: int = Field(..., ge=0, le=1)  # 0=FLAT, 1=LONG
    unrealized_pnl: float

class DecideResponse(BaseModel):
    action: Action
    confidence: float
    agent: Literal["ppo"] = "ppo"
    meta: Dict
