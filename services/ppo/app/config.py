import os

MODEL_PATH = os.getenv("PPO_MODEL_PATH", "/app/models/ppo_trading_v2")
MODEL_VERSION = os.getenv("PPO_MODEL_VERSION", "ppo_trading_v2")
DEVICE = os.getenv("PPO_DEVICE", "auto")  # "cpu", "cuda", or "auto"
