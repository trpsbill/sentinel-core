# Sentinel Core

**Sentinel Core** is a minimal, agentic DeFAI proof of concept that demonstrates how an autonomous AI agent can analyze Bitcoin (BTC) market data, make trading decisions, simulate execution, and transparently track performance.

The goal of this project is **not** to build a profitable trading bot, but to provide a clean, reproducible framework that shows what *real agentic finance* looks like in practice.

---

## What Sentinel Core Demonstrates

Sentinel Core implements a full **agentic DeFAI loop**:

**Market Data → Agent Reasoning → Decision + Confidence → Simulated Execution → Memory → Performance Visibility**

Specifically, it shows how to:

* Ingest real BTC market data
* Reason autonomously using an AI agent (LLM-based)
* Produce explainable trading decisions
* Simulate trade execution safely (paper trading)
* Persist decisions, trades, and portfolio state
* Make profit/loss visible daily and all time

---

## Key Characteristics

* **Agentic by design**
  All trading decisions are produced by an AI agent. There is no rule-based fallback logic.

* **Closed-data reasoning**
  The agent only reasons on fully closed candles to avoid lookahead bias and indicator repainting.

* **Explainability first**
  Every decision includes a confidence score and a human-readable reason.

* **Performance is first-class**
  Daily and all-time PnL are always visible. Open positions are unmistakable.

* **Reproducible**
  Everything runs locally using Docker Compose.

---

## Asset Scope

Sentinel Core operates on **Bitcoin (BTC) only**.

* Trading pair: `BTC-USD`
* Base asset: BTC
* Quote currency: USD (paper balance)
* Exposure model: LONG or FLAT (no shorting in v1)

This tight scope keeps the focus on agent behavior rather than asset complexity.

---

## Tech Stack

* **Backend:** Node.js + Express
* **Agent:** LLM-based reasoning (JSON schema enforced)
* **Database:** PostgreSQL
* **Orchestration:** n8n
* **Frontend:** TradingView Lightweight Charts
* **Infrastructure:** Docker + Docker Compose

---

## System Overview

At a high level, Sentinel Core consists of:

* A Node.js API that:

  * fetches BTC candles
  * computes indicators
  * invokes the AI agent
  * simulates trade execution
  * persists state to PostgreSQL

* An n8n workflow that:

  * triggers the agent loop on a fixed schedule (e.g. every minute)

* A read-only web dashboard that:

  * displays BTC price action
  * shows agent buy/sell decisions
  * clearly reports open positions and PnL

---

## Dashboard Behavior

The dashboard is designed so that **any viewer can immediately answer**:

* Is the agent currently holding BTC?
* How much has it made or lost today?
* How much has it made or lost overall?

The UI displays:

* Current BTC position (or flat)
* Entry price and position size
* Unrealized PnL
* Realized PnL (today and all time)
* Total portfolio equity
* Buy/Sell markers aligned with decisions

---

## Project Status

Sentinel Core is an **early-stage proof of concept**.

It is intended as:

* a learning tool
* a reference architecture
* a foundation for future work

It is **not** intended for live trading or real funds.

---

## Running the Project (High Level)

Detailed setup instructions will live in a separate document. At a high level:

1. Clone the repository
2. Configure environment variables
3. Start services with Docker Compose
4. Access the API, n8n UI, and web dashboard

---

## Important Disclaimer

This project is for **educational and experimental purposes only**.

* No financial advice is provided
* No real trading is performed
* Past simulated performance does not indicate real-world results
* Use at your own risk

---

## Why This Exists

Many “DeFAI” projects focus on tokens, marketing, or opaque performance claims.

Sentinel Core exists to show:

* what agentic finance actually looks like
* how decisions, memory, and performance connect
* why data correctness and accountability matter

If you’re interested in AI agents, trading systems, or DeFAI beyond the hype, this project is meant to be a solid starting point.

---

## License

This project is licensed under the MIT License.
See the [LICENSE](LICENSE.md) file for details.
