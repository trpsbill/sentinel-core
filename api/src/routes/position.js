const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * GET /api/position
 *
 * Returns the current authoritative position state for BTC.
 *
 * This endpoint is read-only and has no business logic.
 *
 * Response:
 * {
 *   "position": {
 *     "state": "FLAT" | "LONG",
 *     "entry_price": number | null,
 *     "entry_bucket": "ISO-8601 timestamp" | null,
 *     "size_btc": number | null,
 *     "updated_at": "ISO-8601 timestamp"
 *   }
 * }
 *
 * Semantic Rules:
 * - Exactly one position exists at all times
 * - state is authoritative — do not infer from balances
 * - If state = FLAT: entry_price, entry_bucket, size_btc must be null
 * - If state = LONG: all entry fields must be non-null
 * - No aggregation, no calculations, no inference
 *
 * Error Handling:
 * - If position row is missing: HTTP 500 with error code "position_state_missing"
 */
router.get('/', async (req, res) => {
  try {
    // Query the single position row
    const result = await pool.query(
      'SELECT state, entry_price, entry_bucket, size_btc, updated_at FROM positions WHERE id = true LIMIT 1'
    );

    // Check if position row exists
    if (result.rows.length === 0) {
      return res.status(500).json({
        error: 'position_state_missing',
        message: 'Position row does not exist in the database'
      });
    }

    const row = result.rows[0];

    // Build response with proper null handling
    const position = {
      state: row.state,
      entry_price: row.entry_price !== null ? parseFloat(row.entry_price) : null,
      entry_bucket: row.entry_bucket !== null ? row.entry_bucket.toISOString() : null,
      size_btc: row.size_btc !== null ? parseFloat(row.size_btc) : null,
      updated_at: row.updated_at.toISOString()
    };

    res.json({ position });

  } catch (error) {
    console.error('Error fetching position:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
