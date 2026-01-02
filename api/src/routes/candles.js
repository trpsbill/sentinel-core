const express = require('express');
const router = express.Router();
const pool = require('../db');

const DEFAULT_HISTORY_LIMIT = 20; // agent context window

/**
 * GET /api/candles
 *
 * Returns historical candles for the UI dashboard.
 *
 * Query parameters:
 * - limit (optional): Number of candles to return (default: 300)
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 300 } = req.query;

    const limitNum = parseInt(limit, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
      return res.status(400).json({ error: 'limit must be between 1 and 1000' });
    }

    const query = `
      SELECT bucket, open, high, low, close, volume
      FROM candles_1m
      ORDER BY bucket DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [limitNum]);

    // Reverse to return oldest → newest
    const candles = result.rows
      .reverse()
      .map(row => ({
        bucket: row.bucket.toISOString(),
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close),
        volume: row.volume ? parseFloat(row.volume) : null
      }));

    res.json(candles);

  } catch (error) {
    console.error('Error fetching candles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/candles
 *
 * Returns the latest candle.
 *
 * Request body:
 * - symbol (optional): Trading pair symbol (e.g. 'BTC')
 */
router.post('/', async (req, res) => {
  try {
    const { symbol } = req.body;

    // Log incoming request
    console.log('[POST /api/candles] Request received:', {
      symbol,
      body: req.body
    });

    // Query for the latest candle
    const query = `
      SELECT bucket, open, high, low, close, volume
      FROM candles_1m
      ORDER BY bucket DESC
      LIMIT 1
    `;

    // Execute query
    const result = await pool.query(query);

    // Check if candle was found
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'No candles found'
      });
    }

    const row = result.rows[0];

    // Return response
    res.json({
      symbol: symbol ? symbol.toUpperCase() : 'BTC',
      bucket: row.bucket.toISOString(),
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      volume: row.volume ? parseFloat(row.volume) : null
    });

  } catch (error) {
    console.error('Error fetching candles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/candles/history
 *
 * Returns the last N closed candles ending at (or before) a bucket.
 *
 * Request body:
 * - symbol (required)
 * - to (required): ISO8601 timestamp (upper bound bucket)
 * - limit (optional): number of candles (default: 20)
 */
router.post('/history', async (req, res) => {
  try {
    const { symbol, to, limit = DEFAULT_HISTORY_LIMIT } = req.body;

    // Validate required params
    if (!symbol) {
      return res.status(400).json({ error: 'symbol is required' });
    }

    if (!to) {
      return res.status(400).json({ error: 'to is required' });
    }

    const limitNum = parseInt(limit, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 500) {
      return res.status(400).json({ error: 'limit must be between 1 and 500' });
    }

    const toDate = new Date(to);
    if (isNaN(toDate.getTime())) {
      return res.status(400).json({ error: 'to must be a valid ISO8601 timestamp' });
    }

    // IMPORTANT:
    // Fetch newest → oldest for efficiency,
    // then reverse to oldest → newest for agent alignment
    const query = `
      SELECT bucket, open, high, low, close, volume
      FROM candles_1m
      WHERE bucket <= $1
      ORDER BY bucket DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [
      toDate.toISOString(),
      limitNum,
    ]);

    const candles = result.rows
      .reverse()
      .map(row => ({
        bucket: row.bucket.toISOString(),
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close),
        volume: row.volume ? parseFloat(row.volume) : null,
      }));

    res.json({
      symbol: symbol.toUpperCase(),
      window: {
        limit: limitNum,
        to: toDate.toISOString(),
        count: candles.length,
      },
      candles,
    });

  } catch (error) {
    console.error('Error fetching candle history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
