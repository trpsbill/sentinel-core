const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * GET /api/candles
 * 
 * Returns clean, fully closed market candles for visualization, indicator calculation, and agent reasoning.
 * 
 * Query parameters:
 * - symbol (required): Trading pair symbol (e.g. 'BTC')
 * - interval (optional): Candle interval (default: '1m')
 * - limit (optional): Max number of candles to return (default: 200)
 * - before (optional): Return candles before this ISO8601 timestamp
 * - after (optional): Return candles after this ISO8601 timestamp
 */
router.get('/', async (req, res) => {
  try {
    // Validate required parameter
    const { symbol, interval = '1m', limit = 200, before, after } = req.query;

    if (!symbol) {
      return res.status(400).json({ error: 'symbol is required' });
    }

    // Validate interval (currently only 1m is supported based on schema)
    const supportedIntervals = ['1m'];
    if (!supportedIntervals.includes(interval)) {
      return res.status(400).json({ error: `unsupported interval: ${interval}` });
    }

    // Validate and parse limit
    const limitNum = parseInt(limit, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
      return res.status(400).json({ error: 'limit must be a number between 1 and 1000' });
    }

    // Build query
    let query = 'SELECT bucket, open, high, low, close, volume FROM candles_1m WHERE 1=1';
    const queryParams = [];
    let paramIndex = 1;

    // Add time filters if provided
    if (after) {
      const afterDate = new Date(after);
      if (isNaN(afterDate.getTime())) {
        return res.status(400).json({ error: 'after must be a valid ISO8601 timestamp' });
      }
      query += ` AND bucket > $${paramIndex}`;
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

    // Order by bucket ascending (oldest → newest) and limit
    query += ` ORDER BY bucket ASC LIMIT $${paramIndex}`;
    queryParams.push(limitNum);

    // Execute query
    const result = await pool.query(query, queryParams);

    // Format response according to contract
    const candles = result.rows.map(row => ({
      bucket: row.bucket.toISOString(),
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      volume: row.volume ? parseFloat(row.volume) : null
    }));

    // Return response in canonical format
    res.json({
      symbol: symbol.toUpperCase(),
      interval,
      candles
    });

  } catch (error) {
    console.error('Error fetching candles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
