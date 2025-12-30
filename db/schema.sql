-- =========================================================
-- Sentinel Core — Agentic DeFAI PoC Schema
-- PostgreSQL 16
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- 1. Closed 1-Minute BTC Candles (Immutable Ground Truth)
-- ---------------------------------------------------------
CREATE TABLE candles_1m (
    bucket        TIMESTAMPTZ PRIMARY KEY,
    open          NUMERIC(18,8) NOT NULL,
    high          NUMERIC(18,8) NOT NULL,
    low           NUMERIC(18,8) NOT NULL,
    close         NUMERIC(18,8) NOT NULL,
    volume        NUMERIC(18,8),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE candles_1m IS
'Closed BTC 1-minute candles. Immutable once written. Used for agent reasoning.';

-- ---------------------------------------------------------
-- 2. Indicator Snapshots (Deterministic, Optional History)
-- ---------------------------------------------------------
CREATE TABLE indicator_snapshots (
    bucket        TIMESTAMPTZ PRIMARY KEY,
    ema_9         NUMERIC(18,8),
    ema_21        NUMERIC(18,8),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE indicator_snapshots IS
'Indicator values computed only from closed candles. Deterministic.';

-- ---------------------------------------------------------
-- 3. Agent Decisions (The Agent’s Memory)
-- ---------------------------------------------------------
CREATE TABLE agent_decisions (
    id            BIGSERIAL PRIMARY KEY,
    symbol        TEXT NOT NULL,
    bucket        TIMESTAMPTZ NOT NULL,
    action        TEXT NOT NULL CHECK (action IN ('BUY','SELL','HOLD')),
    confidence    NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    reason        TEXT NOT NULL,
    decided_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT one_decision_per_symbol_bucket UNIQUE (symbol, bucket)
);

COMMENT ON TABLE agent_decisions IS
'Every decision produced by the agent. One decision per symbol per closed candle.';

-- ---------------------------------------------------------
-- 4. Trades (Paper Execution Results)
-- ---------------------------------------------------------
CREATE TABLE trades (
    id             BIGSERIAL PRIMARY KEY,
    side           TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
    price          NUMERIC(18,8) NOT NULL,
    btc_amount     NUMERIC(18,8) NOT NULL,
    usd_amount     NUMERIC(18,8) NOT NULL,
    executed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE trades IS
'Simulated trade executions driven exclusively by agent decisions.';

-- ---------------------------------------------------------
-- 5. Portfolio State (Single-Row Truth)
-- ---------------------------------------------------------
CREATE TABLE portfolio_state (
    id               BOOLEAN PRIMARY KEY DEFAULT TRUE,
    usd_balance      NUMERIC(18,8) NOT NULL,
    btc_balance      NUMERIC(18,8) NOT NULL,
    avg_entry_price  NUMERIC(18,8),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT single_row CHECK (id = TRUE)
);

COMMENT ON TABLE portfolio_state IS
'Single-row table representing current portfolio state.';

-- Seed initial portfolio
INSERT INTO portfolio_state (
    usd_balance,
    btc_balance,
    avg_entry_price
) VALUES (
    10000.00,
    0.0,
    NULL
);

-- ---------------------------------------------------------
-- 6. Daily Performance Summary
-- ---------------------------------------------------------
CREATE TABLE daily_performance (
    trade_date        DATE PRIMARY KEY,
    realized_pnl_usd  NUMERIC(18,8) NOT NULL DEFAULT 0,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE daily_performance IS
'Daily realized PnL summary. Recomputed incrementally on SELLs.';

COMMIT;
