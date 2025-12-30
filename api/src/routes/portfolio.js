const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * GET /api/portfolio
 * 
 * Returns a read-only snapshot of current portfolio positions and performance.
 * 
 * Query parameters:
 * - symbol (optional): Filter to a specific asset (e.g. 'BTC')
 */
router.get('/', async (req, res) => {
  try {
    const { symbol } = req.query;
    const asOf = new Date().toISOString();

    // Get current portfolio state (single row)
    const portfolioStateResult = await pool.query(
      'SELECT usd_balance, btc_balance, avg_entry_price, updated_at FROM portfolio_state LIMIT 1'
    );

    if (portfolioStateResult.rows.length === 0) {
      // Empty portfolio state - return empty portfolio
      return res.json({
        asOf,
        currency: 'USD',
        summary: {
          equity: 0,
          cash: 0,
          unrealizedPnL: 0,
          realizedPnL: 0,
          totalPnL: 0,
          dayPnL: 0
        },
        positions: []
      });
    }

    const portfolioState = portfolioStateResult.rows[0];
    const cash = parseFloat(portfolioState.usd_balance || 0);
    const btcQuantity = parseFloat(portfolioState.btc_balance || 0);
    const avgEntryPrice = portfolioState.avg_entry_price ? parseFloat(portfolioState.avg_entry_price) : null;

    // Get latest closed candle for current price
    const latestCandleResult = await pool.query(
      'SELECT close, bucket FROM candles_1m ORDER BY bucket DESC LIMIT 1'
    );

    let currentPrice = null;
    let lastPriceUpdate = null;

    if (latestCandleResult.rows.length > 0) {
      currentPrice = parseFloat(latestCandleResult.rows[0].close);
      lastPriceUpdate = latestCandleResult.rows[0].bucket;
    }

    // Get total realized PnL (sum of all daily performance)
    const totalRealizedResult = await pool.query(
      'SELECT COALESCE(SUM(realized_pnl_usd), 0) as total_realized FROM daily_performance'
    );
    const totalRealizedPnL = parseFloat(totalRealizedResult.rows[0].total_realized || 0);

    // Get today's realized PnL
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const todayRealizedResult = await pool.query(
      'SELECT COALESCE(realized_pnl_usd, 0) as day_realized FROM daily_performance WHERE trade_date = $1',
      [today]
    );
    const dayPnL = todayRealizedResult.rows.length > 0 
      ? parseFloat(todayRealizedResult.rows[0].day_realized || 0)
      : 0;

    // Build positions array
    const positions = [];

    // BTC position (if any)
    if (btcQuantity > 0 && currentPrice !== null && avgEntryPrice !== null) {
      const marketValue = btcQuantity * currentPrice;
      const unrealizedPnL = (currentPrice - avgEntryPrice) * btcQuantity;

      // Count open trades (BUY trades since last SELL)
      // Simplified: count BUY trades after the most recent SELL, or all BUYs if no SELLs
      const openTradesResult = await pool.query(
        `WITH last_sell AS (
           SELECT COALESCE(MAX(executed_at), '1970-01-01'::timestamp) as last_sell_time
           FROM trades 
           WHERE side = 'SELL'
         )
         SELECT COUNT(*) as count 
         FROM trades, last_sell
         WHERE side = 'BUY' AND executed_at >= last_sell.last_sell_time`
      );
      const openTrades = parseInt(openTradesResult.rows[0].count || 1, 10);
      // Ensure at least 1 if position exists
      const finalOpenTrades = openTrades > 0 ? openTrades : 1;

      // Filter by symbol if provided
      if (!symbol || symbol.toUpperCase() === 'BTC') {
        positions.push({
          symbol: 'BTC',
          quantity: btcQuantity,
          avgEntryPrice: avgEntryPrice,
          currentPrice: currentPrice,
          marketValue: marketValue,
          unrealizedPnL: unrealizedPnL,
          realizedPnL: totalRealizedPnL, // Total realized for BTC (since we only trade BTC)
          openTrades: finalOpenTrades,
          lastUpdated: lastPriceUpdate ? lastPriceUpdate.toISOString() : portfolioState.updated_at.toISOString()
        });
      }
    }

    // Calculate summary
    const positionsUnrealizedPnL = positions.reduce((sum, pos) => sum + pos.unrealizedPnL, 0);
    const positionsMarketValue = positions.reduce((sum, pos) => sum + pos.marketValue, 0);
    const equity = cash + positionsMarketValue;

    // Build response
    const response = {
      asOf,
      currency: 'USD',
      summary: {
        equity: equity,
        cash: cash,
        unrealizedPnL: positionsUnrealizedPnL,
        realizedPnL: totalRealizedPnL,
        totalPnL: totalRealizedPnL + positionsUnrealizedPnL,
        dayPnL: dayPnL
      },
      positions: positions.sort((a, b) => b.marketValue - a.marketValue) // Sort by market value descending
    };

    res.json(response);

  } catch (error) {
    console.error('Error fetching portfolio:', error);
    res.status(500).json({ error: 'failed to compute portfolio snapshot' });
  }
});

module.exports = router;
