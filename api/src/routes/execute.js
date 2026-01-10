const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * POST /api/execute
 *
 * Phase 2: The ONLY execution endpoint in Sentinel Core.
 *
 * Executes paper trades with:
 * - Position legality re-validation
 * - Fixed 25% USDC sizing for BUY
 * - Full position close for SELL
 * - Atomic transaction semantics
 * - Idempotency via decision_id
 * - Complete audit trail
 *
 * Execution price is resolved internally from CLOSED candle data.
 * NO price accepted from request.
 */
router.post('/', async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      symbol,
      bucket,
      action,
      confidence,
      decision_id,
      decision_source
    } = req.body;

    // ═══════════════════════════════════════════════════════════════
    // KILL-SWITCH
    // ═══════════════════════════════════════════════════════════════
    if (process.env.EXECUTION_ENABLED !== 'true') {
      console.log('[EXECUTE] Execution disabled by environment flag', {
        decision_id,
        action,
        timestamp: new Date().toISOString()
      });

      return res.status(503).json({
        error: 'execution_disabled',
        message: 'Execution is currently disabled. Set EXECUTION_ENABLED=true to enable.'
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // STRICT REQUEST VALIDATION
    // ═══════════════════════════════════════════════════════════════
    if (!symbol) {
      return res.status(400).json({ error: 'invalid_request', message: 'symbol is required' });
    }

    if (!bucket) {
      return res.status(400).json({ error: 'invalid_request', message: 'bucket is required' });
    }

    if (!action) {
      return res.status(400).json({ error: 'invalid_request', message: 'action is required' });
    }

    if (confidence === undefined || confidence === null) {
      return res.status(400).json({ error: 'invalid_request', message: 'confidence is required' });
    }

    if (!decision_id) {
      return res.status(400).json({ error: 'invalid_request', message: 'decision_id is required' });
    }

    if (!decision_source || !decision_source.agent || !decision_source.validator) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'decision_source must include agent and validator'
      });
    }

    if (symbol !== 'BTC') {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'symbol must be BTC'
      });
    }

    const bucketDate = new Date(bucket);
    if (isNaN(bucketDate.getTime())) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'bucket must be a valid ISO8601 timestamp'
      });
    }

    if (action !== 'BUY' && action !== 'SELL') {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'action must be BUY or SELL (HOLD forbidden)'
      });
    }

    const confidenceFloat = parseFloat(confidence);
    if (isNaN(confidenceFloat) || confidenceFloat < 0 || confidenceFloat > 1) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'confidence must be between 0 and 1'
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // RESOLVE EXECUTION PRICE (AUTHORITATIVE)
    // ═══════════════════════════════════════════════════════════════
    const priceResult = await client.query(
      `
      SELECT close
      FROM candles_1m
      WHERE bucket = $1
      LIMIT 1
      `,
      [bucketDate.toISOString()]
    );

    if (priceResult.rows.length === 0) {
      return res.status(400).json({
        error: 'execution_failed',
        message: 'No closed candle found for execution bucket'
      });
    }

    const executionPrice = parseFloat(priceResult.rows[0].close);
    if (isNaN(executionPrice) || executionPrice <= 0) {
      return res.status(500).json({
        error: 'execution_failed',
        message: 'Invalid execution price from candle data'
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // IDEMPOTENCY CHECK
    // ═══════════════════════════════════════════════════════════════
    const existingTrade = await client.query(
      `SELECT id, side, price, btc_amount, executed_at
       FROM trades
       WHERE execution_decision_id = $1`,
      [decision_id]
    );

    if (existingTrade.rows.length > 0) {
      const trade = existingTrade.rows[0];
      return res.status(200).json({
        status: 'ALREADY_EXECUTED',
        decision_id,
        trade_id: trade.id,
        action: trade.side,
        price: parseFloat(trade.price),
        btc_amount: parseFloat(trade.btc_amount),
        executed_at: trade.executed_at.toISOString()
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // ATOMIC EXECUTION
    // ═══════════════════════════════════════════════════════════════
    await client.query('BEGIN');

    const positionResult = await client.query(
      `SELECT state, entry_price, entry_bucket, size_btc
       FROM positions
       WHERE id = true
       FOR UPDATE`
    );

    const portfolioResult = await client.query(
      `SELECT usd_balance, btc_balance
       FROM portfolio_state
       WHERE id = true
       FOR UPDATE`
    );

    if (positionResult.rows.length === 0 || portfolioResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({
        error: 'execution_failed',
        message: 'Position or portfolio state unavailable'
      });
    }

    const position = positionResult.rows[0];
    const portfolio = portfolioResult.rows[0];
    const positionBefore = position.state;
    const executedAt = new Date();

    // ═══════════════════════════════════════════════════════════════
    // POSITION LEGALITY
    // ═══════════════════════════════════════════════════════════════
    if (position.state === 'FLAT' && action === 'SELL') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'illegal_action',
        message: 'SELL not allowed when position is FLAT'
      });
    }

    if (position.state === 'LONG' && action === 'BUY') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'illegal_action',
        message: 'BUY not allowed when position is LONG'
      });
    }

    let btcAmount;
    let usdAmount;
    let realizedPnL = 0;
    let positionAfter;

    // ═══════════════════════════════════════════════════════════════
    // BUY
    // ═══════════════════════════════════════════════════════════════
    if (action === 'BUY') {
      const availableUsd = parseFloat(portfolio.usd_balance);
      if (availableUsd <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'insufficient_balance',
          message: 'USD balance is zero'
        });
      }

      usdAmount = availableUsd * 0.25;
      btcAmount = usdAmount / executionPrice;

      const tradeResult = await client.query(
        `
        INSERT INTO trades (
          side, price, btc_amount, usd_amount,
          execution_decision_id, decision_bucket, executed_bucket,
          confidence, decision_source, bucket
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id
        `,
        [
          'BUY',
          executionPrice,
          btcAmount,
          usdAmount,
          decision_id,
          bucketDate.toISOString(),
          executedAt.toISOString(),
          confidenceFloat,
          JSON.stringify(decision_source),
          bucketDate.toISOString()
        ]
      );

      const tradeId = tradeResult.rows[0].id;

      await client.query(
        `
        UPDATE positions SET
          state = 'LONG',
          entry_bucket = $1,
          entry_price = $2,
          size_btc = $3,
          updated_at = now()
        WHERE id = true
        `,
        [executedAt.toISOString(), executionPrice, btcAmount]
      );

      await client.query(
        `
        UPDATE portfolio_state SET
          usd_balance = usd_balance - $1,
          btc_balance = btc_balance + $2,
          avg_entry_price = $3,
          updated_at = now()
        WHERE id = true
        `,
        [usdAmount, btcAmount, executionPrice]
      );

      await client.query('COMMIT');

      positionAfter = 'LONG';

      console.log('[EXECUTE]', {
        decision_id,
        action: 'BUY',
        price: executionPrice,
        btc_amount: btcAmount,
        usd_amount: usdAmount,
        trade_id: tradeId,
        position_before: positionBefore,
        position_after: positionAfter
      });

      return res.status(200).json({
        status: 'EXECUTED',
        execution_mode: 'PAPER',
        decision_id,
        symbol,
        action: 'BUY',
        price: executionPrice,
        btc_amount: btcAmount,
        position_before: positionBefore,
        position_after: positionAfter,
        executed_at: executedAt.toISOString(),
        trade_id: tradeId,
        pnl_realized: 0.0
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // SELL
    // ═══════════════════════════════════════════════════════════════
    btcAmount = parseFloat(position.size_btc);
    usdAmount = btcAmount * executionPrice;
    realizedPnL = (executionPrice - parseFloat(position.entry_price)) * btcAmount;

    const tradeResult = await client.query(
      `
      INSERT INTO trades (
        side, price, btc_amount, usd_amount,
        execution_decision_id, decision_bucket, executed_bucket,
        confidence, decision_source, bucket
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
      `,
      [
        'SELL',
        executionPrice,
        btcAmount,
        usdAmount,
        decision_id,
        bucketDate.toISOString(),
        executedAt.toISOString(),
        confidenceFloat,
        JSON.stringify(decision_source),
        bucketDate.toISOString()
      ]
    );

    const tradeId = tradeResult.rows[0].id;

    await client.query(
      `
      UPDATE positions SET
        state = 'FLAT',
        entry_bucket = NULL,
        entry_price = NULL,
        size_btc = NULL,
        updated_at = now()
      WHERE id = true
      `
    );

    await client.query(
      `
      UPDATE portfolio_state SET
        usd_balance = usd_balance + $1,
        btc_balance = 0,
        avg_entry_price = NULL,
        updated_at = now()
      WHERE id = true
      `,
      [usdAmount]
    );

    await client.query('COMMIT');

    positionAfter = 'FLAT';

    console.log('[EXECUTE]', {
      decision_id,
      action: 'SELL',
      price: executionPrice,
      btc_amount: btcAmount,
      usd_amount: usdAmount,
      pnl_realized: realizedPnL,
      trade_id: tradeId,
      position_before: positionBefore,
      position_after: positionAfter
    });

    return res.status(200).json({
      status: 'EXECUTED',
      execution_mode: 'PAPER',
      decision_id,
      symbol,
      action: 'SELL',
      price: executionPrice,
      btc_amount: btcAmount,
      position_before: positionBefore,
      position_after: positionAfter,
      executed_at: executedAt.toISOString(),
      trade_id: tradeId,
      pnl_realized: realizedPnL
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[EXECUTION] Error:', error);

    return res.status(500).json({
      error: 'execution_failed',
      message: 'Database transaction failed'
    });
  } finally {
    client.release();
  }
});

module.exports = router;
