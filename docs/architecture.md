# Sentinel Core — Agentic DeFAI Architecture

## Overview

**Sentinel Core** is a minimal, fully agentic DeFAI Proof of Concept (PoC) that demonstrates how an autonomous AI agent can observe market data, reason about it, make decisions, simulate execution, persist memory, and clearly account for its performance.

The system implements a complete DeFAI loop:

**Market Data → Agent Reasoning → Decision + Confidence → Simulated Execution → Memory → Performance Visibility**

Sentinel Core is intentionally focused, reproducible, and transparent. It is designed to demonstrate *agentic finance with measurable outcomes*, not to optimize for trading profitability.

---

## Asset Scope

Sentinel Core operates on **Bitcoin (BTC) only**.

* Trading pair: `BTC-USD`
* Base asset: BTC
* Quote currency: USD (paper balance)
* Exposure model: LONG or FLAT (no shorting in v1)

Restricting the PoC to BTC reduces complexity and keeps the focus on agentic decision-making and accountability.

---

## Core Principles

### Agentic by Design

All trading decisions are produced by an AI agent.
There is **no rule-based fallback logic**.

The agent reasons over structured market data and portfolio context and produces a structured decision on every execution cycle.

---

### Closed-Data Reasoning

The agent reasons **only on fully closed candles**.

* No partial candles
* No forming candle inputs
* No historical recomputation

This prevents lookahead bias and indicator repainting.

---

### Explicit Memory & Accountability

Every decision, trade, and portfolio change is persisted.

The database is treated as **agent memory**, not logging.
All outcomes are auditable.

---

### Performance Is First-Class

Profit and loss are not hidden.

The system makes it immediately obvious:

* whether the agent is currently holding BTC
* how much profit or loss was generated **today**
* how much profit or loss was generated **all time**

---

## High-Level Architecture

* Exchange REST API (BTC 1-minute candles)
* Sentinel API (Node.js / Express)
* Indicator pipeline
* Agent (LLM-based)
* Paper execution simulator
* PostgreSQL
* Web dashboard (TradingView Lightweight Charts)
* n8n for scheduling and orchestration

---

## System Components

### 1. Market Data Ingestion

**Responsibility**

* Fetch closed 1-minute BTC-USD candles
* Normalize data into a canonical candle format

**Implementation**

* Implemented inside the Sentinel API
* Triggered by n8n on a fixed schedule
* Uses exchange REST APIs (e.g., Coinbase, Kraken, Binance)

**Notes**

* No tick ingestion
* No candle aggregation
* Single symbol (BTC-USD)

---

### 2. Indicator Pipeline

**Responsibility**

* Compute indicators from stored closed candles

**Initial Indicators**

* EMA(9)
* EMA(21)

**Notes**

* Indicators are recomputed deterministically
* Indicator values are passed to the agent as structured input
* Indicator snapshots may be persisted

---

### 3. Agent (Core DeFAI Component)

The agent is the **sole decision-maker**.

**Inputs**

* Recent closed BTC candles
* Indicator values
* Current portfolio state
* Optional recent decision history

**Output (strict JSON schema)**

```json
{
  "action": "BUY",
  "confidence": 0.73,
  "reason": "BTC momentum is strengthening while medium-term trend remains positive. Risk is acceptable relative to recent volatility."
}
```

**Characteristics**

* LLM-driven reasoning
* Schema-validated output
* No embedded trading rules
* Guardrails apply to format, not behavior

This component is what makes Sentinel Core *agentic*, not algorithmic.

---

### 4. Paper Execution Simulator

**Responsibility**

* Simulate BTC trade execution
* Maintain portfolio state

**Tracked State**

* USD cash balance
* BTC position size
* Average BTC entry price
* Unrealized PnL
* Realized PnL

**Execution Semantics**

* Trades execute at a documented price (e.g., next candle open)
* No slippage modeling
* No fees (explicitly documented)

The simulator allows the agent to experience consequences without real risk.

---

### 5. Memory Store (PostgreSQL)

PostgreSQL serves as the **long-term memory** of the agent.

**Persisted Entities**

* BTC candles
* Indicator snapshots
* Agent decisions
* Simulated trades
* Portfolio snapshots
* Daily performance summaries

This supports auditing, analysis, and future learning loops.

---

## Visualization Layer

### Dashboard Overview

The dashboard is designed so that **performance is immediately obvious**.

It is read-only and observational.

---

### Charting

* BTC 1-minute candlestick chart
* EMA(9) and EMA(21) overlays
* BUY / SELL markers aligned with agent decisions
* Time-aligned with simulated executions

Charting provides market context, not judgment.

---

### Portfolio Summary (Always Visible)

The portfolio summary is persistent and prominent.

**Current Position**

* Position state: LONG or FLAT
* BTC position size
* Entry price (USD)
* Current BTC price
* Unrealized PnL (USD)

**Performance Metrics**

* Realized PnL today (USD)
* Realized PnL all time (USD)
* Unrealized PnL
* Total equity (USD)

There must be no ambiguity about exposure or profitability.

---

### Open Trades & Position Detail

When a BTC position is open, the dashboard displays:

* Entry timestamp
* Entry price
* BTC amount
* Confidence at entry
* Current PnL
* Time in trade

If the agent is flat, this is clearly indicated.

---

## Backend API (Node.js / Express)

### Market & Decision Data

* `GET /api/candles?limit=300`
* `GET /api/decisions?limit=100`
* `GET /api/trades?limit=100`

### Portfolio & Performance

* `GET /api/portfolio`
* `GET /api/performance`

  * realized PnL today
  * realized PnL all time
  * trade count

### Agent Execution

* `POST /api/agent/run`

This endpoint is invoked by **n8n**, not directly by users.

---

## Orchestration with n8n

n8n handles **time-based execution**, not logic.

**Typical workflow**

1. Cron trigger (every minute)
2. HTTP request to `/api/agent/run`
3. Sentinel API:

   * fetches BTC candles
   * computes indicators
   * invokes the agent
   * simulates execution
   * updates portfolio and performance
   * persists memory

This cleanly separates orchestration from decision-making.

---

## Dockerized Deployment

### Containers

* `sentinel-api` — Node.js / Express backend
* `sentinel-postgres` — PostgreSQL database
* `sentinel-n8n` — scheduling and orchestration
* `sentinel-ui` — static frontend using TradingView Lightweight Charts

### Docker Compose

* Single `docker-compose.yml`
* One command starts the entire system
* Fully local and reproducible

---

## End-to-End Execution Flow

1. Docker Compose starts all services
2. n8n triggers the agent loop
3. Sentinel API fetches BTC candles
4. Indicators are computed
5. Agent reasons and produces a decision
6. Paper execution updates the portfolio
7. All state is persisted in PostgreSQL
8. Dashboard reflects updated price, position, and PnL

---

## Definition of “Done”

Sentinel Core is complete when:

* The system runs locally via Docker Compose
* The agent makes autonomous BTC decisions on a fixed cadence
* Decisions include confidence and reasoning
* Trades affect a persistent portfolio
* Daily and all-time PnL are immediately visible
* Open BTC positions are unmistakable
* Anyone can tell in seconds whether the agent is profitable

At that point, **Sentinel Core is a real, agentic DeFAI system with accountability**.