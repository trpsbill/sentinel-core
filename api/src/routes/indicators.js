const express = require('express');
const router = express.Router();
const pool = require('../db');

const DEFAULT_HISTORY_LIMIT = 20; // 20 candles = EMA crossover context

/**
 * GET /api/indicators
 *
 * Returns closed indicator snapshots (EMA values).
 *
 * Query parameters:
 * - symbol (required): Trading symbol (BTC only for this PoC)
 * - limit (optional): Number of rows to return (default: 20)
 * - to (optional): ISO timestamp (inclusive upper bound)
 */
router.get('/', async (req, res) => {
  try {
    const { symbol, limit = DEFAULT_HISTORY_LIMIT, to } = req.query;

    // Validate required params
    if (!symbol) {
      return res.status(400).json({ error: 'symbol is required' });
    }

    const limitNum = parseInt(limit, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 500) {
      return res.status(400).json({ error: 'limit must be between 1 and 500' });
    }

    let toDate = null;
    if (to) {
      const parsed = new Date(to);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'to must be a valid ISO timestamp' });
      }
      toDate = parsed;
    }

    // IMPORTANT:
    // We fetch newest → oldest in SQL for efficiency,
    // then reverse so indicators are returned oldest → newest.
    // This guarantees index alignment with candles history.
    const query = `
      SELECT
        bucket,
        ema_9,
        ema_21
      FROM indicator_snapshots
      WHERE ($2::timestamptz IS NULL OR bucket <= $2)
      ORDER BY bucket DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [limitNum, toDate]);

    // Reverse to oldest → newest before returning
    const indicators = result.rows
      .reverse()
      .map(row => ({
        bucket: row.bucket.toISOString(),
        ema_9: row.ema_9 !== null ? parseFloat(row.ema_9) : null,
        ema_21: row.ema_21 !== null ? parseFloat(row.ema_21) : null
      }));

    res.json({
      symbol: symbol.toUpperCase(),
      window: {
        limit: limitNum,
        to: toDate ? toDate.toISOString() : null,
        count: indicators.length
      },
      indicators
    });

  } catch (error) {
    console.error('Error fetching indicators:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
