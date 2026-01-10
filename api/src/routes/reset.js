const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * POST /api/reset
 *
 * Resets the simulation to a clean baseline state.
 *
 * This endpoint:
 * - Deletes all agent decisions
 * - Deletes all simulated trades
 * - Resets position to FLAT
 * - Resets portfolio to initial balance (USD=1000, BTC=0)
 * - Leaves market data (candles, indicators) intact
 *
 * Required request body:
 * {
 *   "confirm": "RESET_SIMULATION"
 * }
 *
 * Safety:
 * - Requires explicit confirmation string
 * - Executes in a single atomic transaction
 * - Logs all reset operations
 * - Cannot be called accidentally
 *
 * Use case:
 * - Development and testing only
 * - Clears simulation artifacts
 * - Provides clean baseline for agent testing
 */
router.post('/', async (req, res) => {
  const startTime = Date.now();
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';

  try {
    // 1. Validate confirmation string
    const { confirm } = req.body;

    if (!confirm) {
      console.warn(`[RESET] Missing confirmation - IP: ${clientIp}`);
      return res.status(400).json({
        error: 'missing_confirmation',
        message: 'Request body must include "confirm" field'
      });
    }

    if (confirm !== 'RESET_SIMULATION') {
      console.warn(`[RESET] Invalid confirmation: "${confirm}" - IP: ${clientIp}`);
      return res.status(403).json({
        error: 'invalid_confirmation',
        message: 'Confirmation string must be exactly "RESET_SIMULATION"'
      });
    }

    // 2. Optional safety check: Only allow in development
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SIM_RESET !== 'true') {
      console.error(`[RESET] Blocked in production - IP: ${clientIp}`);
      return res.status(403).json({
        error: 'forbidden',
        message: 'Reset endpoint is disabled in production'
      });
    }

    console.log(`[RESET] Starting simulation reset - IP: ${clientIp}, Time: ${new Date().toISOString()}`);

    // 3. Execute reset in a single transaction
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Clear simulated trades first (due to foreign key constraint)
      const tradesResult = await client.query('DELETE FROM trades');
      const tradesCleared = tradesResult.rowCount;

      // Clear agent decisions
      const decisionsResult = await client.query('DELETE FROM agent_decisions');
      const decisionsCleared = decisionsResult.rowCount;

      // Reset position to FLAT
      await client.query(`
        UPDATE positions
        SET
          state = 'FLAT',
          entry_price = NULL,
          entry_bucket = NULL,
          size_btc = NULL,
          updated_at = NOW()
        WHERE id = true
      `);

      // Reset portfolio state to initial balance
      await client.query(`
        UPDATE portfolio_state
        SET
          usd_balance = 10000.0,
          btc_balance = 0.0,
          avg_entry_price = NULL,
          updated_at = NOW()
        WHERE id = true
      `);

      // Reset daily performance
      await client.query('DELETE FROM daily_performance');

      // Commit transaction
      await client.query('COMMIT');

      const duration = Date.now() - startTime;

      console.log(`[RESET] Simulation reset complete - Duration: ${duration}ms`);
      console.log(`[RESET] - Decisions cleared: ${decisionsCleared}`);
      console.log(`[RESET] - Trades cleared: ${tradesCleared}`);
      console.log(`[RESET] - Position reset to: FLAT`);
      console.log(`[RESET] - Portfolio reset to: USD=10000, BTC=0`);

      // 4. Return success response
      res.status(200).json({
        status: 'ok',
        message: 'Simulation reset complete',
        reset: {
          decisions_cleared: decisionsCleared,
          trades_cleared: tradesCleared,
          position: 'FLAT',
          usd_balance: 10000.0,
          btc_balance: 0.0
        },
        duration_ms: duration
      });

    } catch (error) {
      // Rollback on error
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('[RESET] Error during simulation reset:', error);

    res.status(500).json({
      error: 'internal_error',
      message: 'Failed to reset simulation. No changes were made.'
    });
  }
});

module.exports = router;
