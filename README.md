# Sentinel Core

**Sentinel Core** is a minimal, agentic DeFAI proof of concept that demonstrates how an autonomous trading agent can ingest real market data, reason about it, record decisions, simulate execution, and transparently track performance.

The goal of this project is **not** to build a profitable trading bot.  
The goal is to build a **clear, auditable reference architecture** for what *real agentic finance* looks like in practice.

---

## What Sentinel Core Demonstrates

Sentinel Core implements a full **agentic DeFAI loop**:

**Market Data → Agent Reasoning → Decision + Confidence → Simulated Execution → Memory → Performance Visibility**

Specifically, it shows how to:

- Ingest real market data on a fixed schedule
- Store clean, closed candles (no partial data)
- Allow an agent to reason over historical context
- Persist decisions with explanations and confidence
- Simulate trades safely (paper trading)
- Track P/L transparently over time

Sentinel Core exists to show:

- what agentic finance actually looks like
- how decisions, memory, and performance connect
- why data correctness and accountability matter

If you’re interested in AI agents, trading systems, or DeFAI beyond the hype, this project is meant to be a solid starting point.

---

## n8n Workflow Setup (BTC Candle Ingestion)

Sentinel Core uses **n8n** to ingest **closed 1-minute BTC candles** from Coinbase and persist them to PostgreSQL.

Workflows are committed to this repository and must be **imported and wired to credentials** on first run.

---

### 1. Start the Stack

From the project root:

```bash
docker compose up -d
````

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

In the n8n UI:

1. Go to **Credentials**
2. Click **Add Credential**
3. Select **Postgres**
4. Configure the credential using the Docker Compose values:

| Field    | Value                    |
| -------- | ------------------------ |
| Host     | `sentinel-core-postgres` |
| Port     | `5432`                   |
| Database | `sentinel`               |
| User     | `sentinel`               |
| Password | `sentinel`               |
| SSL      | Disabled                 |

Save the credential.

> Credentials are stored encrypted inside the n8n container and are **never committed to Git**.

---

### 4. Attach Credentials to the Workflow

1. Open the **btc-candle-ingestion** workflow
2. Select the **“Save to DB”** node
3. Choose the Postgres credential you just created
4. Save the workflow

---

### 5. Activate the Workflow

Once credentials are attached:

1. Toggle the workflow **Active**
2. n8n will now run it every minute

The workflow:

* Fetches recent BTC-USD candles from Coinbase
* Drops the currently forming candle
* Inserts only **fully closed candles**
* Uses `ON CONFLICT DO NOTHING` to remain idempotent

---

### 6. Verify Candle Ingestion

Connect to PostgreSQL:

```bash
docker exec -it sentinel-core-postgres \
  psql -U sentinel -d sentinel
```

Run:

```sql
SELECT
  COUNT(*) AS candles,
  MIN(bucket) AS first_bucket,
  MAX(bucket) AS latest_bucket
FROM candles_1m;
```

You should see candle counts increasing over time.

---

### Notes on Persistence & Version Control

* ❌ The `.n8n/` directory is **not** committed
* ✅ Workflows are committed as JSON
* ❌ Credentials are never committed
* ✅ New contributors import workflows and add credentials locally

This keeps the project:

* reproducible
* secure
* contributor-friendly

---

## License

This project is licensed under the MIT License.
See the [LICENSE](LICENSE.md) file for details.
