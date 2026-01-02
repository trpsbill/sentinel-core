const express = require('express');
const router = express.Router();
const pool = require('../db');

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

module.exports = router;
