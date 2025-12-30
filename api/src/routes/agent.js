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
    const { symbol, candleBucket, decision } = req.body;

    // Validate required fields
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

    if (!decision) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'decision is required'
      });
    }

    // Validate symbol (v1: must be BTC)
    if (symbol !== 'BTC') {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'symbol must be BTC'
      });
    }

    // Validate candleBucket is a valid timestamp
    const bucketDate = new Date(candleBucket);
    if (isNaN(bucketDate.getTime())) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'candleBucket must be a valid ISO8601 timestamp'
      });
    }

    // Validate decision object
    if (!decision.action) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'decision.action is required'
      });
    }

    if (decision.confidence === undefined || decision.confidence === null) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'decision.confidence is required'
      });
    }

    if (!decision.reason) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'decision.reason is required'
      });
    }

    // Validate action enum
    const validActions = ['BUY', 'SELL', 'HOLD'];
    if (!validActions.includes(decision.action)) {
      return res.status(400).json({
        error: 'invalid_request',
        message: `decision.action must be one of: ${validActions.join(', ')}`
      });
    }

    // Validate confidence range (strict, no clamping)
    const confidence = parseFloat(decision.confidence);
    if (isNaN(confidence) || confidence < 0 || confidence > 1) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'decision.confidence must be a number between 0 and 1'
      });
    }

    // Validate reason is not empty
    if (typeof decision.reason !== 'string' || decision.reason.trim().length === 0) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'decision.reason must be a non-empty string'
      });
    }

    // Check for duplicate decision (idempotency)
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

    // Insert decision into database
    const insertResult = await pool.query(
      `INSERT INTO agent_decisions (symbol, bucket, action, confidence, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, bucket, action, confidence, reason, decided_at`,
      [
        symbol,
        bucketDate.toISOString(),
        decision.action,
        confidence,
        decision.reason.trim()
      ]
    );

    const savedDecision = insertResult.rows[0];

    // Generate stable decision ID
    const decisionDate = new Date(savedDecision.bucket);
    const year = decisionDate.getUTCFullYear();
    const month = String(decisionDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(decisionDate.getUTCDate()).padStart(2, '0');
    const hours = String(decisionDate.getUTCHours()).padStart(2, '0');
    const minutes = String(decisionDate.getUTCMinutes()).padStart(2, '0');
    const seconds = String(decisionDate.getUTCSeconds()).padStart(2, '0');
    const decisionId = `dec_${year}${month}${day}_${hours}${minutes}${seconds}_BTC`;

    // Return response (201 Created)
    res.status(201).json({
      decision: {
        id: decisionId,
        symbol: symbol,
        candleBucket: savedDecision.bucket.toISOString(),
        action: savedDecision.action,
        confidence: parseFloat(savedDecision.confidence),
        reason: savedDecision.reason,
        createdAt: savedDecision.decided_at.toISOString()
      }
    });

  } catch (error) {
    console.error('Error processing agent decision:', error);

    // Handle unique constraint violation (duplicate bucket)
    if (error.code === '23505') { // PostgreSQL unique violation
      return res.status(409).json({
        error: 'duplicate_decision',
        message: `Decision already exists for candle ${req.body.candleBucket}`
      });
    }

    // Generic internal error
    res.status(500).json({
      error: 'internal_error'
    });
  }
});

module.exports = router;
