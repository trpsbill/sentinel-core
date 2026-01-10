# Sentinel Core

**Sentinel Core** is a minimal, agentic DeFAI proof of concept that demonstrates how an autonomous trading agent can ingest real market data, reason about it, record decisions, simulate execution, and transparently track performance.

The goal of this project is **not** to build a profitable trading bot.
The goal is to build a **clear, auditable reference architecture** for what *real agentic finance* looks like in practice.

---

## What Sentinel Core Demonstrates

Sentinel Core implements a full **agentic DeFAI loop**:

**Market Data → Agent Reasoning → Decision + Confidence → Simulated Execution → Memory → Performance Visibility**

In addition to a basic LLM-driven agent loop, Sentinel Core now demonstrates a **multi-stage decision and execution architecture** that cleanly separates reasoning, validation, and execution.

Specifically, it shows how to:

* Ingest real market data on a fixed schedule
* Store clean, closed candles (no partial data)
* Allow an agent to reason over historical context
* Persist decisions with explanations and confidence
* Validate decisions against portfolio state
* Simulate trades safely via a paper trading engine
* Track P/L transparently over time

Sentinel Core exists to show:

* what agentic finance actually looks like
* how decisions, memory, and performance connect
* why data correctness and accountability matter

If you’re interested in AI agents, trading systems, or DeFAI beyond the hype, this project is meant to be a solid starting point.

---

## Agent Decision & Execution Architecture

Sentinel Core uses a **two-stage decision process**.

### Primary Decision Policy (PPO)

A trained **Proximal Policy Optimization (PPO)** model acts as the first-class decision maker.

* Produces BUY / SELL / HOLD actions
* Includes confidence and probability metadata
* Contains **no execution logic**
* Does not directly enforce position legality

This keeps the policy focused purely on market-driven decision making.

---

### LLM Validator (Safety Gate)

A lightweight LLM validator acts as a secondary gate.

Its responsibilities are intentionally limited:

* Enforce position legality (e.g. no BUY while already LONG)
* Handle missing or inconsistent inputs safely
* Downgrade low-confidence or invalid actions to HOLD
* Preserve PPO intent whenever the action is legal

The LLM does **not** originate trades — it only validates them.

All decisions are persisted **before** any execution is attempted.

---

## Explicit Execution Model

Execution in Sentinel Core is **always explicit**.

A trade only occurs when the workflow deliberately calls the execution API after a validated decision. There are:

* No database triggers
* No implicit side effects
* No automatic executions

This guarantees:

* Clear auditability from decision → execution
* No duplicate or accidental trades
* A clean upgrade path from paper trading to live execution

The same execution interface is designed to support both simulated and real trades.

---

## Paper Trading Engine

The current executor simulates trades locally:

* Maintains a persistent portfolio state (FLAT / LONG)
* Executes trades at documented market prices
* Records every trade with an associated decision
* Tracks realized and unrealized PnL

This allows the agent to experience consequences without real financial risk while keeping the system fully auditable.

---

## n8n Workflow Setup (BTC Candle Ingestion)

Sentinel Core uses **n8n** to ingest **closed 1-minute BTC candles** from Coinbase and persist them to PostgreSQL.

Workflows are committed to this repository and must be **imported and wired to credentials** on first run.

---

### 1. Start the Stack

From the project root:

```bash
docker compose up -d
```

This starts:

* PostgreSQL
* Sentinel Core API
* n8n

n8n will be available at:

```
http://localhost:5678
```

---

### 2. Import the Workflow

Workflows are stored in this repository under:

```
n8n/workflows/
```

Import the BTC candle ingestion workflow into n8n:

```bash
docker exec -i sentinel-core-n8n \
  n8n import:workflow \
  --input=/workflows/btc-candle-ingestion.json
```

After import:

* The workflow will appear in the n8n UI
* It will be **inactive by default** (this is intentional)

---

### 3. Create PostgreSQL Credentials in n8n

The workflow requires a PostgreSQL credential, which **is not committed** to the repository.

Configure it using the Docker Compose values.

---

## License

This project is licensed under the MIT License.
See the [LICENSE](LICENSE.md) file for details.

---

## ⚠️ Disclaimer

**Sentinel Core is an educational proof of concept only.**

This project is **not** a trading bot, **not** an investment product, and **not** intended to generate real profits.

All trading activity is simulated, experimental, and provided solely for learning and architectural exploration.
