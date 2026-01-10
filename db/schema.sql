-- =========================================================
-- Sentinel Core — Agentic DeFAI PoC Schema
-- PostgreSQL 16
-- =========================================================
-- Generated: 2026-01-09
-- This file reflects the current production database schema
-- Last updated: After implementing Execution API Contract (Phase 2)

--
-- PostgreSQL database dump
--

-- Dumped from database version 16.11 (Debian 16.11-1.pgdg13+1)
-- Dumped by pg_dump version 16.11 (Debian 16.11-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: compute_ema_on_candle(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_ema_on_candle() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  prev_ema_9  NUMERIC(18,8);
  prev_ema_21 NUMERIC(18,8);
BEGIN
  -- Get previous EMA snapshot
  SELECT ema_9, ema_21
  INTO prev_ema_9, prev_ema_21
  FROM indicator_snapshots
  WHERE bucket < NEW.bucket
  ORDER BY bucket DESC
  LIMIT 1;

  -- Insert indicator snapshot
  INSERT INTO indicator_snapshots (
    bucket,
    ema_9,
    ema_21
  )
  VALUES (
    NEW.bucket,
    COALESCE(
      NEW.close,
      0
    ) * (2.0 / 10.0) + COALESCE(prev_ema_9, NEW.close) * (1 - 2.0 / 10.0),

    COALESCE(
      NEW.close,
      0
    ) * (2.0 / 22.0) + COALESCE(prev_ema_21, NEW.close) * (1 - 2.0 / 22.0)
  )
  ON CONFLICT (bucket) DO NOTHING;

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION compute_ema_on_candle(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.compute_ema_on_candle() IS 'Computes EMA(9) and EMA(21) on candle insert. Deterministic.';


--
-- Name: execute_next_paper_trade(); Type: FUNCTION; Schema: public; Owner: -
-- NOTE: This function is LEGACY and no longer used.
-- Execution now happens exclusively via POST /api/execution/execute
--

CREATE FUNCTION public.execute_next_paper_trade() RETURNS TABLE(executed boolean, reason text, decision_id bigint, decision_bucket timestamp with time zone, side text, executed_bucket timestamp with time zone, executed_price numeric, btc_amount numeric, usd_amount numeric)
    LANGUAGE plpgsql
    AS $$
DECLARE
  d RECORD;
  pos RECORD;
  ps  RECORD;
  next_bucket timestamptz;
  px numeric(18,8);
  btc numeric(18,8);
  usd numeric(18,8);
BEGIN
  executed := false;
  reason := NULL;
  decision_id := NULL;
  decision_bucket := NULL;
  side := NULL;
  executed_bucket := NULL;
  executed_price := NULL;
  btc_amount := NULL;
  usd_amount := NULL;

  -- Find oldest unexecuted BUY or SELL decision (skip HOLD)
  SELECT ad.*
  INTO d
  FROM agent_decisions ad
  LEFT JOIN trades t ON t.legacy_decision_id = ad.id
  WHERE t.legacy_decision_id IS NULL
    AND ad.symbol = 'BTC'
    AND ad.action IN ('BUY', 'SELL')
  ORDER BY ad.bucket ASC
  LIMIT 1;

  IF NOT FOUND THEN
    reason := 'NO_PENDING_DECISIONS';
    RETURN NEXT;
    RETURN;
  END IF;

  decision_id := d.id;
  decision_bucket := d.bucket;
  side := d.action;

  -- Require next candle for execution
  next_bucket := d.bucket + interval '1 minute';

  SELECT c.open
  INTO px
  FROM candles_1m c
  WHERE c.bucket = next_bucket;

  IF NOT FOUND THEN
    reason := 'NEXT_CANDLE_NOT_AVAILABLE';
    RETURN NEXT;
    RETURN;
  END IF;

  executed_bucket := next_bucket;
  executed_price := px;

  -- Lock state for atomic execution
  SELECT * INTO pos FROM positions WHERE id = true FOR UPDATE;
  SELECT * INTO ps  FROM portfolio_state WHERE id = true FOR UPDATE;

  -- Position-aware execution
  IF pos.state = 'FLAT' THEN
    IF d.action = 'SELL' THEN
      reason := 'INVALID_ACTION_SELL_WHEN_FLAT';
      RETURN NEXT;
      RETURN;
    END IF;

    -- Execute BUY
    usd := ps.usd_balance * 0.25;
    IF usd <= 0 THEN
      reason := 'INSUFFICIENT_USD';
      RETURN NEXT;
      RETURN;
    END IF;

    btc := trunc(usd / px, 8);
    IF btc <= 0 THEN
      reason := 'BTC_SIZE_ZERO_AFTER_TRUNC';
      RETURN NEXT;
      RETURN;
    END IF;

    usd := btc * px;

    INSERT INTO trades (
      side, price, btc_amount, usd_amount,
      legacy_decision_id, decision_bucket, executed_bucket,
      execution_decision_id, confidence, decision_source, bucket
    )
    VALUES (
      'BUY', px, btc, usd,
      d.id, d.bucket, next_bucket,
      'legacy_' || d.id::TEXT, 0.0, '{"agent": "legacy", "validator": "none", "validator_changed": false}'::jsonb, d.bucket
    );

    UPDATE positions SET
      state = 'LONG',
      entry_bucket = next_bucket,
      entry_price = px,
      size_btc = btc,
      updated_at = now()
    WHERE id = true;

    UPDATE portfolio_state SET
      usd_balance = usd_balance - usd,
      btc_balance = btc_balance + btc,
      avg_entry_price = px,
      updated_at = now()
    WHERE id = true;

    executed := true;
    reason := 'EXECUTED_BUY';
    btc_amount := btc;
    usd_amount := usd;
    RETURN NEXT;
    RETURN;

  ELSIF pos.state = 'LONG' THEN
    IF d.action = 'BUY' THEN
      reason := 'INVALID_ACTION_BUY_WHEN_LONG';
      RETURN NEXT;
      RETURN;
    END IF;

    -- Execute SELL
    btc := pos.size_btc;
    IF btc IS NULL OR btc <= 0 THEN
      reason := 'INVALID_POSITION_SIZE';
      RETURN NEXT;
      RETURN;
    END IF;

    usd := btc * px;

    INSERT INTO trades (
      side, price, btc_amount, usd_amount,
      legacy_decision_id, decision_bucket, executed_bucket,
      execution_decision_id, confidence, decision_source, bucket
    )
    VALUES (
      'SELL', px, btc, usd,
      d.id, d.bucket, next_bucket,
      'legacy_' || d.id::TEXT, 0.0, '{"agent": "legacy", "validator": "none", "validator_changed": false}'::jsonb, d.bucket
    );

    UPDATE positions SET
      state = 'FLAT',
      entry_bucket = NULL,
      entry_price = NULL,
      size_btc = NULL,
      updated_at = now()
    WHERE id = true;

    UPDATE portfolio_state SET
      usd_balance = usd_balance + usd,
      btc_balance = 0,
      avg_entry_price = NULL,
      updated_at = now()
    WHERE id = true;

    executed := true;
    reason := 'EXECUTED_SELL';
    btc_amount := btc;
    usd_amount := usd;
    RETURN NEXT;
    RETURN;
  ELSE
    reason := 'UNKNOWN_POSITION_STATE';
    RETURN NEXT;
    RETURN;
  END IF;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_decisions (
    id bigint NOT NULL,
    bucket timestamp with time zone NOT NULL,
    action text NOT NULL,
    confidence numeric(4,3) NOT NULL,
    reason text NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    symbol text DEFAULT 'BTC'::text NOT NULL,
    ppo_action text,
    ppo_confidence numeric(4,3),
    ppo_meta jsonb,
    validator_changed boolean DEFAULT false NOT NULL,
    decision_source text DEFAULT 'validator'::text NOT NULL,
    CONSTRAINT agent_decisions_action_check CHECK ((action = ANY (ARRAY['BUY'::text, 'SELL'::text, 'HOLD'::text]))),
    CONSTRAINT agent_decisions_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT decision_source_check CHECK ((decision_source = ANY (ARRAY['ppo'::text, 'validator'::text]))),
    CONSTRAINT ppo_action_check CHECK (((ppo_action IS NULL) OR (ppo_action = ANY (ARRAY['BUY'::text, 'SELL'::text, 'HOLD'::text]))))
);


--
-- Name: TABLE agent_decisions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.agent_decisions IS 'Every decision produced by the agent. No silent cycles.';


--
-- Name: agent_decisions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_decisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_decisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_decisions_id_seq OWNED BY public.agent_decisions.id;


--
-- Name: candles_1m; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candles_1m (
    bucket timestamp with time zone NOT NULL,
    open numeric(18,8) NOT NULL,
    high numeric(18,8) NOT NULL,
    low numeric(18,8) NOT NULL,
    close numeric(18,8) NOT NULL,
    volume numeric(18,8),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ema_9 numeric(18,8),
    ema_21 numeric(18,8)
);


--
-- Name: TABLE candles_1m; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.candles_1m IS 'Closed BTC 1-minute candles. Immutable once written. Used for agent reasoning.';


--
-- Name: daily_performance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_performance (
    trade_date date NOT NULL,
    realized_pnl_usd numeric(18,8) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE daily_performance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.daily_performance IS 'Daily realized PnL summary. Recomputed incrementally on SELLs.';


--
-- Name: indicator_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indicator_snapshots (
    bucket timestamp with time zone NOT NULL,
    ema_9 numeric(18,8),
    ema_21 numeric(18,8),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE indicator_snapshots; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.indicator_snapshots IS 'Indicator values computed only from closed candles. Deterministic.';


--
-- Name: portfolio_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_state (
    id boolean DEFAULT true NOT NULL,
    usd_balance numeric(18,8) NOT NULL,
    btc_balance numeric(18,8) NOT NULL,
    avg_entry_price numeric(18,8),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT single_row CHECK ((id = true))
);


--
-- Name: TABLE portfolio_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.portfolio_state IS 'Single-row table representing current portfolio state.';


--
-- Name: positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions (
    id boolean DEFAULT true NOT NULL,
    state text NOT NULL,
    entry_bucket timestamp with time zone,
    entry_price numeric(18,8),
    size_btc numeric(18,8),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT positions_long_requires_entry_fields CHECK ((((state = 'FLAT'::text) AND (entry_bucket IS NULL) AND (entry_price IS NULL) AND (size_btc IS NULL)) OR ((state = 'LONG'::text) AND (entry_bucket IS NOT NULL) AND (entry_price IS NOT NULL) AND (size_btc IS NOT NULL) AND (size_btc > (0)::numeric)))),
    CONSTRAINT positions_state_check CHECK ((state = ANY (ARRAY['FLAT'::text, 'LONG'::text])))
);


--
-- Name: trades; Type: TABLE; Schema: public; Owner: -
-- NOTE: execution_decision_id is the authoritative decision ID for Phase 2 execution.
-- legacy_decision_id is preserved for backward compatibility but is nullable.
--

CREATE TABLE public.trades (
    id bigint NOT NULL,
    side text NOT NULL,
    price numeric(18,8) NOT NULL,
    btc_amount numeric(18,8) NOT NULL,
    usd_amount numeric(18,8) NOT NULL,
    executed_at timestamp with time zone DEFAULT now() NOT NULL,
    legacy_decision_id bigint,
    decision_bucket timestamp with time zone NOT NULL,
    executed_bucket timestamp with time zone NOT NULL,
    execution_decision_id text NOT NULL,
    confidence numeric(5,4) NOT NULL,
    decision_source jsonb NOT NULL,
    bucket timestamp with time zone NOT NULL,
    CONSTRAINT trades_side_check CHECK ((side = ANY (ARRAY['BUY'::text, 'SELL'::text])))
);


--
-- Name: TABLE trades; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.trades IS 'Simulated trade executions driven exclusively by agent decisions.';


--
-- Name: trades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trades_id_seq OWNED BY public.trades.id;


--
-- Name: agent_decisions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_decisions ALTER COLUMN id SET DEFAULT nextval('public.agent_decisions_id_seq'::regclass);


--
-- Name: trades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades ALTER COLUMN id SET DEFAULT nextval('public.trades_id_seq'::regclass);


--
-- Name: agent_decisions agent_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_decisions
    ADD CONSTRAINT agent_decisions_pkey PRIMARY KEY (id);


--
-- Name: candles_1m candles_1m_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candles_1m
    ADD CONSTRAINT candles_1m_pkey PRIMARY KEY (bucket);


--
-- Name: daily_performance daily_performance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_performance
    ADD CONSTRAINT daily_performance_pkey PRIMARY KEY (trade_date);


--
-- Name: indicator_snapshots indicator_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indicator_snapshots
    ADD CONSTRAINT indicator_snapshots_pkey PRIMARY KEY (bucket);


--
-- Name: agent_decisions one_decision_per_bucket; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_decisions
    ADD CONSTRAINT one_decision_per_bucket UNIQUE (bucket);


--
-- Name: portfolio_state portfolio_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_state
    ADD CONSTRAINT portfolio_state_pkey PRIMARY KEY (id);


--
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (id);


--
-- Name: trades trades_execution_decision_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_execution_decision_id_unique UNIQUE (execution_decision_id);


--
-- Name: trades trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (id);


--
-- Name: agent_decisions_symbol_bucket_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_decisions_symbol_bucket_idx ON public.agent_decisions USING btree (symbol, bucket);


--
-- Name: trades_one_execution_per_decision; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX trades_one_execution_per_decision ON public.trades USING btree (legacy_decision_id);


--
-- Name: candles_1m candles_ema_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER candles_ema_trigger AFTER INSERT ON public.candles_1m FOR EACH ROW EXECUTE FUNCTION public.compute_ema_on_candle();


--
-- PostgreSQL database dump complete
--
