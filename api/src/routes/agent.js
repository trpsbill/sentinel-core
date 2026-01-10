const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * GET /api/agent
 * Basic agent info endpoint
 */
router.get('/', (req, res) => {
  res.json({ message: 'Agent endpoint - coming soon' });
});

/**
 * POST /api/agent/run
 * 
 * Accepts agent decision output, validates it, and persists it as immutable memory.
 * 
 * This endpoint:
 * 1. Validates the request strictly
 * 2. Persists the decision to agent_decisions table
 * 3. Returns the recorded decision
 * 
 * Request body:
 * {
 *   "symbol": "BTC",
 *   "candleBucket": "2025-12-30T19:45:00.000Z",
 *   "decision": {
 *     "action": "BUY" | "SELL" | "HOLD",
 *     "confidence": 0.0-1.0,
 *     "reason": "string"
 *   }
 * }
 */
router.post('/run', async (req, res) => {
  try {
    const {
      symbol,
      candleBucket,
      final_decision,
      ppo_decision,
      decision_source
    } = req.body;

    // ─────────────────────────────────────────────
    // 1. Validate required fields
    // ─────────────────────────────────────────────
    if (!symbol) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'symbol is required'
      });
    }

    if (!candleBucket) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'candleBucket is required'
      });
    }

    if (!final_decision || !final_decision.action) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'final_decision.action is required'
      });
    }

    if (!('confidence' in final_decision)) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'final_decision.confidence is required (may be null)'
      });
    }

    // ─────────────────────────────────────────────
    // 2. Validate symbol + candle bucket
    // ─────────────────────────────────────────────
    if (symbol !== 'BTC') {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'symbol must be BTC'
      });
    }

    const bucketDate = new Date(candleBucket);
    if (isNaN(bucketDate.getTime())) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'candleBucket must be a valid ISO8601 timestamp'
      });
    }

    // ─────────────────────────────────────────────
    // 3. Validate action + confidence
    // ─────────────────────────────────────────────
    const validActions = ['BUY', 'SELL', 'HOLD'];
    const requestedAction = final_decision.action;

    if (!validActions.includes(requestedAction)) {
      return res.status(400).json({
        error: 'invalid_request',
        message: `final_decision.action must be one of: ${validActions.join(', ')}`
      });
    }

    const confidence =
      final_decision.confidence === null
        ? null
        : parseFloat(final_decision.confidence);

    if (confidence !== null && (isNaN(confidence) || confidence < 0 || confidence > 1)) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'final_decision.confidence must be between 0 and 1 or null'
      });
    }

    // ─────────────────────────────────────────────
    // 4. Idempotency check
    // ─────────────────────────────────────────────
    const existingDecision = await pool.query(
      'SELECT id FROM agent_decisions WHERE bucket = $1 AND symbol = $2',
      [bucketDate.toISOString(), symbol]
    );

    if (existingDecision.rows.length > 0) {
      return res.status(409).json({
        error: 'duplicate_decision',
        message: `Decision already exists for candle ${candleBucket}`
      });
    }

    // ─────────────────────────────────────────────
    // 5. Position legality enforcement (unchanged)
    // ─────────────────────────────────────────────
    const positionResult = await pool.query(
      'SELECT state FROM positions WHERE id = true LIMIT 1'
    );

    if (positionResult.rows.length === 0) {
      return res.status(500).json({
        error: 'internal_error',
        message: 'Position state unavailable'
      });
    }

    const currentPositionState = positionResult.rows[0].state;

    const isLegal = (state, action) => {
      if (action === 'HOLD') return true;
      if (state === 'FLAT' && action === 'BUY') return true;
      if (state === 'LONG' && action === 'SELL') return true;
      return false;
    };

    if (!isLegal(currentPositionState, requestedAction)) {
      return res.status(409).json({
        error: 'ILLEGAL_DECISION',
        message: `Action ${requestedAction} is not allowed when position state is ${currentPositionState}`,
        position_state: currentPositionState,
        action: requestedAction
      });
    }

    // ─────────────────────────────────────────────
    // 6. Persist Phase-2 decision
    // ─────────────────────────────────────────────
    const insertResult = await pool.query(
      `
      INSERT INTO agent_decisions (
        symbol,
        bucket,
        action,
        confidence,
        reason,
        ppo_action,
        ppo_confidence,
        ppo_meta,
        validator_changed,
        decision_source
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
      `,
      [
        symbol,
        bucketDate.toISOString(),

        // final (authoritative) decision
        final_decision.action,
        confidence,
        final_decision.reason || null,

        // PPO (optional)
        ppo_decision?.action || null,
        ppo_decision?.confidence ?? null,
        ppo_decision?.meta || null,

        // provenance
        final_decision.validator_changed === true,
        decision_source || 'validator'
      ]
    );

    const row = insertResult.rows[0];

    // ─────────────────────────────────────────────
    // 7. Response
    // ─────────────────────────────────────────────
    res.status(201).json({
      decision: {
        id: row.id,
        symbol: row.symbol,
        candleBucket: row.bucket.toISOString(),
        action: row.action,
        confidence: row.confidence,
        decision_source: row.decision_source,
        createdAt: row.decided_at.toISOString()
      }
    });

  } catch (error) {
    console.error('Error processing agent decision:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        error: 'duplicate_decision',
        message: `Decision already exists for candle ${req.body.candleBucket}`
      });
    }

    res.status(500).json({
      error: 'internal_error'
    });
  }
});


/**
 * POST /api/agent/loop
 * 
 * Single production entrypoint for agent execution.
 * 
 * This endpoint:
 * 1. Determines the latest fully closed candle bucket for BTC
 * 2. Ensures at most one decision per candle bucket (idempotency)
 * 3. Triggers the agent workflow exactly once per candle via n8n webhook
 * 
 * No request body required (safe to call with empty body).
 */
router.post('/loop', async (req, res) => {
  try {
    console.log(`POST /api/agent/loop called with body ${JSON.stringify(req.body || {}, null, 2)}`);

    // Step 1: Validate scheduler-defined execution target
    const { symbol, candleBucket } = req.body;

    if (!symbol || !candleBucket) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'symbol and candleBucket are required'
      });
    }

    // Validate symbol (v1 constraint)
    if (symbol !== 'BTC') {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'symbol must be BTC'
      });
    }

    const bucketDate = new Date(candleBucket);
    if (isNaN(bucketDate.getTime())) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'candleBucket must be a valid ISO8601 timestamp'
      });
    }

    const result = await pool.query(`
      SELECT bucket
      FROM candles_1m
      ORDER BY bucket DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.status(409).json({
        error: 'no_closed_candles'
      });
    }

    const bucketISO = result.rows[0].bucket.toISOString();

    // Step 2: Enforce idempotency - check if decision already exists
    const existingDecision = await pool.query(
      'SELECT id FROM agent_decisions WHERE bucket = $1 AND symbol = $2',
      [bucketISO, symbol]
    );


    if (existingDecision.rows.length > 0) {
      // Decision already exists for this candle bucket - exit immediately
      console.log(`[agent/loop] Early exit: decision already exists for ${bucketISO}`);
      return res.status(204).send();
    }

    // Step 3: Trigger agent workflow via n8n webhook
    const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || 'http://sentinel-core-n8n:5678/webhook/agent/run';
    
    const webhookPayload = {
      symbol: symbol,
      candleBucket: bucketISO
    };

    try {
      const webhookResponse = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(webhookPayload)
      });

      if (!webhookResponse.ok) {
        console.error(`[agent/loop] n8n webhook failed: ${webhookResponse.status} ${webhookResponse.statusText}`);
        return res.status(500).json({
          error: 'internal_error'
        });
      }

      // Agent workflow successfully triggered
      console.log(`[agent/loop] Triggered agent workflow for ${bucketISO}`);
      
      return res.status(202).json({
        status: 'triggered',
        symbol: symbol,
        candleBucket: bucketISO
      });

    } catch (webhookError) {
      console.error('[agent/loop] Failed to call n8n webhook:', webhookError);
      return res.status(500).json({
        error: 'internal_error'
      });
    }

  } catch (error) {
    console.error('[agent/loop] Internal error:', error);
    return res.status(500).json({
      error: 'internal_error'
    });
  }
});

module.exports = router;
