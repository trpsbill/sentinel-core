/**
 * PPO Feature Builder
 * Mirrors env/trading_env.py exactly
 *
 * Input candles MUST be:
 * - closed candles only
 * - ordered oldest → newest
 */

function pctChange(curr, prev) {
  return (curr - prev) / prev;
}

function buildPpoObservation({
  candles,
  indicators,
  position,
  entryPrice
}) {
  if (!candles || candles.length < 6) {
    throw new Error("Insufficient candles for PPO features");
  }

  const latest = candles[candles.length - 1];
  const prev1 = candles[candles.length - 2];
  const prev5 = candles[candles.length - 6];

  // === returns ===
  const return_1 = pctChange(latest.close, prev1.close);
  const return_5 = pctChange(latest.close, prev5.close);

  // === EMA features (must already be computed) ===
  const ema9 = indicators.ema_9;
  const ema21 = indicators.ema_21;
  const ema9Prev = indicators.ema_9_prev;
  const ema21Prev = indicators.ema_21_prev;

  const ema_spread = ema9 - ema21;
  const ema_9_slope = ema9 - ema9Prev;
  const ema_21_slope = ema21 - ema21Prev;

  // === position ===
  const pos = position === "LONG" ? 1 : 0;

  // === unrealized pnl ===
  let unrealized_pnl = 0.0;
  if (pos === 1 && entryPrice) {
    unrealized_pnl = (latest.close - entryPrice) / entryPrice;
  }

  return {
    return_1,
    return_5,
    ema_spread,
    ema_9_slope,
    ema_21_slope,
    position: pos,
    unrealized_pnl
  };
}

module.exports = {
  buildPpoObservation
};
