const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * GET /api/trades
 * 
 * Returns the immutable execution history of trades.
 * 
 * Query parameters:
 * - symbol (optional): Filter by asset (e.g. 'BTC')
 * - side (optional): Filter by side ('BUY' or 'SELL')
 * - status (optional): Filter by status ('FILLED', 'PARTIAL', 'CANCELLED')
 * - limit (optional): Max trades to return (default: 100)
 * - before (optional): Trades before this ISO8601 timestamp
 * - after (optional): Trades after this ISO8601 timestamp
 */
router.get('/', async (req, res) => {
  try {
    const { 
      symbol, 
      side, 
      status, 
      limit = 100, 
      before, 
      after 
    } = req.query;

    // Validate side if provided
    if (side) {
      const validSides = ['BUY', 'SELL'];
      if (!validSides.includes(side.toUpperCase())) {
        return res.status(400).json({ error: 'invalid side filter' });
      }
    }

    // Validate status if provided
    if (status) {
      const validStatuses = ['FILLED', 'PARTIAL', 'CANCELLED'];
      if (!validStatuses.includes(status.toUpperCase())) {
        return res.status(400).json({ error: 'invalid status filter' });
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
        side,
        price,
        btc_amount,
        usd_amount,
        executed_at
      FROM trades
      WHERE 1=1
    `;
    const queryParams = [];
    let paramIndex = 1;

    // Filter by side if provided
    if (side) {
      query += ` AND side = $${paramIndex}`;
      queryParams.push(side.toUpperCase());
      paramIndex++;
    }

    // Note: status filter is not in the current schema, so we'll filter post-query if needed
    // For now, all trades in the system are considered FILLED (paper trading)

    // Filter by timestamp range if provided
    if (after) {
      const afterDate = new Date(after);
      if (isNaN(afterDate.getTime())) {
        return res.status(400).json({ error: 'after must be a valid ISO8601 timestamp' });
      }
      query += ` AND executed_at >= $${paramIndex}`;
      queryParams.push(afterDate.toISOString());
      paramIndex++;
    }

    if (before) {
      const beforeDate = new Date(before);
      if (isNaN(beforeDate.getTime())) {
        return res.status(400).json({ error: 'before must be a valid ISO8601 timestamp' });
      }
      query += ` AND executed_at < $${paramIndex}`;
      queryParams.push(beforeDate.toISOString());
      paramIndex++;
    }

    // Order by newest → oldest
    query += ` ORDER BY executed_at DESC LIMIT $${paramIndex}`;
    queryParams.push(limitNum);

    // Execute query
    const result = await pool.query(query, queryParams);

    // Try to link trades to decisions by finding the decision made at or just before execution time
    // This is a best-effort link since the schema doesn't have a direct foreign key
    let decisionMap = {};

    if (result.rows.length > 0) {
      // Get all decisions ordered by bucket DESC for efficient lookup
      const decisionResult = await pool.query(
        `SELECT bucket 
         FROM agent_decisions
         ORDER BY bucket DESC`
      );

      // For each trade, find the most recent decision with bucket <= executed_at
      result.rows.forEach(trade => {
        const tradeTime = trade.executed_at;
        // Find the first decision (in DESC order) where bucket <= trade execution time
        const matchingDecision = decisionResult.rows.find(dec => 
          new Date(dec.bucket) <= tradeTime
        );

        if (matchingDecision) {
          const bucketDate = new Date(matchingDecision.bucket);
          const year = bucketDate.getUTCFullYear();
          const month = String(bucketDate.getUTCMonth() + 1).padStart(2, '0');
          const day = String(bucketDate.getUTCDate()).padStart(2, '0');
          const hours = String(bucketDate.getUTCHours()).padStart(2, '0');
          const minutes = String(bucketDate.getUTCMinutes()).padStart(2, '0');
          const seconds = String(bucketDate.getUTCSeconds()).padStart(2, '0');
          decisionMap[trade.id] = `dec_${year}${month}${day}_${hours}${minutes}${seconds}_BTC`;
        }
      });
    }

    // Format trades according to contract
    // Track sequence numbers per second for unique IDs
    const sequenceCounters = {};
    
    let trades = result.rows.map(row => {
      // Generate stable ID: trade_YYYYMMDD_HHMMSS_XXX (XXX is sequence number for trades in same second)
      const executedDate = new Date(row.executed_at);
      const year = executedDate.getUTCFullYear();
      const month = String(executedDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(executedDate.getUTCDate()).padStart(2, '0');
      const hours = String(executedDate.getUTCHours()).padStart(2, '0');
      const minutes = String(executedDate.getUTCMinutes()).padStart(2, '0');
      const seconds = String(executedDate.getUTCSeconds()).padStart(2, '0');
      
      // Create a key for this second
      const secondKey = `${year}${month}${day}_${hours}${minutes}${seconds}`;
      
      // Increment sequence counter for this second
      if (!sequenceCounters[secondKey]) {
        sequenceCounters[secondKey] = 0;
      }
      sequenceCounters[secondKey]++;
      
      const sequence = String(sequenceCounters[secondKey]).padStart(3, '0');
      const tradeId = `trade_${secondKey}_${sequence}`;

      const quantity = parseFloat(row.btc_amount);
      const price = parseFloat(row.price);
      const notional = parseFloat(row.usd_amount);

      // Default values for fields not in current schema
      // All trades in Sentinel Core are paper trades and filled
      const tradeStatus = 'FILLED'; // All trades in system are filled (paper trading)
      const fee = 0.00; // No fees in paper trading
      const executionType = 'PAPER';
      const decisionId = decisionMap[row.id] || null;

      return {
        id: tradeId,
        symbol: 'BTC', // This system only trades BTC
        side: row.side,
        quantity: quantity,
        price: price,
        notional: notional,
        fee: fee,
        status: tradeStatus,
        executionType: executionType,
        decisionId: decisionId,
        executedAt: row.executed_at.toISOString()
      };
    });

    // Filter by symbol if provided (though all trades are BTC in this system)
    if (symbol && symbol.toUpperCase() !== 'BTC') {
      trades = [];
    }

    // Filter by status if provided (post-query since it's not in schema)
    if (status) {
      trades = trades.filter(t => t.status.toUpperCase() === status.toUpperCase());
    }

    res.json({
      trades: trades
    });

  } catch (error) {
    console.error('Error fetching trades:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

