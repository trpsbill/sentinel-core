const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * GET /api/decisions
 * 
 * Returns a transparent, immutable history of agent decisions with reasoning and confidence.
 * 
 * Query parameters:
 * - symbol (optional): Filter by asset (e.g. 'BTC')
 * - action (optional): Filter by action ('BUY', 'SELL', 'HOLD')
 * - confidenceMin (optional): Minimum confidence (0-1)
 * - limit (optional): Max decisions to return (default: 100)
 * - before (optional): Decisions before this ISO8601 timestamp
 * - after (optional): Decisions after this ISO8601 timestamp
 */
router.get('/', async (req, res) => {
  try {
    const { 
      symbol, 
      action, 
      confidenceMin, 
      limit = 100, 
      before, 
      after 
    } = req.query;

    // Validate action if provided
    if (action) {
      const validActions = ['BUY', 'SELL', 'HOLD'];
      if (!validActions.includes(action.toUpperCase())) {
        return res.status(400).json({ error: 'invalid action filter' });
      }
    }

    // Validate confidenceMin if provided
    if (confidenceMin !== undefined) {
      const confidenceNum = parseFloat(confidenceMin);
      if (isNaN(confidenceNum) || confidenceNum < 0 || confidenceNum > 1) {
        return res.status(400).json({ error: 'confidenceMin must be between 0 and 1' });
      }
    }

    // Validate and parse limit
    const limitNum = parseInt(limit, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
      return res.status(400).json({ error: 'limit must be a number between 1 and 1000' });
    }

    // Build query
    let query = `
      SELECT 
        id,
        bucket,
        action,
        confidence,
        reason,
        decided_at
      FROM agent_decisions
      WHERE 1=1
    `;
    const queryParams = [];
    let paramIndex = 1;

    // Filter by action if provided
    if (action) {
      query += ` AND action = $${paramIndex}`;
      queryParams.push(action.toUpperCase());
      paramIndex++;
    }

    // Filter by confidence minimum if provided
    if (confidenceMin !== undefined) {
      query += ` AND confidence >= $${paramIndex}`;
      queryParams.push(parseFloat(confidenceMin));
      paramIndex++;
    }

    // Filter by timestamp range if provided
    if (after) {
      const afterDate = new Date(after);
      if (isNaN(afterDate.getTime())) {
        return res.status(400).json({ error: 'after must be a valid ISO8601 timestamp' });
      }
      query += ` AND bucket >= $${paramIndex}`;
      queryParams.push(afterDate.toISOString());
      paramIndex++;
    }

    if (before) {
      const beforeDate = new Date(before);
      if (isNaN(beforeDate.getTime())) {
        return res.status(400).json({ error: 'before must be a valid ISO8601 timestamp' });
      }
      query += ` AND bucket < $${paramIndex}`;
      queryParams.push(beforeDate.toISOString());
      paramIndex++;
    }

    // Order by newest → oldest (bucket DESC, then decided_at DESC)
    query += ` ORDER BY bucket DESC, decided_at DESC LIMIT $${paramIndex}`;
    queryParams.push(limitNum);

    // Execute query
    const result = await pool.query(query, queryParams);

    // Get indicator context for decisions (if available)
    const bucketIds = result.rows.map(row => row.bucket);
    let indicatorContextMap = {};
    
    if (bucketIds.length > 0) {
      const indicatorResult = await pool.query(
        `SELECT bucket, ema_9, ema_21 
         FROM indicator_snapshots 
         WHERE bucket = ANY($1::timestamptz[])`,
        [bucketIds]
      );
      
      indicatorResult.rows.forEach(ind => {
        indicatorContextMap[ind.bucket.toISOString()] = {
          ema9: ind.ema_9 ? parseFloat(ind.ema_9) : null,
          ema21: ind.ema_21 ? parseFloat(ind.ema_21) : null
        };
      });
    }

    // Get candle prices for context
    const candleResult = await pool.query(
      `SELECT bucket, close 
       FROM candles_1m 
       WHERE bucket = ANY($1::timestamptz[])`,
      [bucketIds]
    );

    const priceMap = {};
    candleResult.rows.forEach(candle => {
      priceMap[candle.bucket.toISOString()] = parseFloat(candle.close);
    });

    // Format decisions according to contract
    const decisions = result.rows.map(row => {
      // Generate stable ID: dec_YYYYMMDD_HHMMSS_BTC
      const bucketDate = new Date(row.bucket);
      const year = bucketDate.getUTCFullYear();
      const month = String(bucketDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(bucketDate.getUTCDate()).padStart(2, '0');
      const hours = String(bucketDate.getUTCHours()).padStart(2, '0');
      const minutes = String(bucketDate.getUTCMinutes()).padStart(2, '0');
      const seconds = String(bucketDate.getUTCSeconds()).padStart(2, '0');
      const decisionId = `dec_${year}${month}${day}_${hours}${minutes}${seconds}_BTC`;

      const bucketKey = row.bucket.toISOString();
      const indicatorContext = indicatorContextMap[bucketKey] || {};
      const price = priceMap[bucketKey] || null;

      // Build context object
      const context = {};
      if (price !== null) context.price = price;
      if (indicatorContext.ema9 !== null && indicatorContext.ema9 !== undefined) {
        context.ema9 = indicatorContext.ema9;
      }
      if (indicatorContext.ema21 !== null && indicatorContext.ema21 !== undefined) {
        context.ema21 = indicatorContext.ema21;
      }

      return {
        id: decisionId,
        symbol: 'BTC', // This system only trades BTC
        candleBucket: bucketKey,
        action: row.action,
        confidence: parseFloat(row.confidence),
        reason: row.reason,
        context: context,
        createdAt: row.decided_at.toISOString()
      };
    });

    // Filter by symbol if provided (though all decisions are BTC in this system)
    const filteredDecisions = symbol 
      ? decisions.filter(d => d.symbol.toUpperCase() === symbol.toUpperCase())
      : decisions;

    res.json({
      decisions: filteredDecisions
    });

  } catch (error) {
    console.error('Error fetching decisions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

