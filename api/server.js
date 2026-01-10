const express = require('express');
const cors = require('cors');
const path = require('path');

// Import routes
const candlesRoutes = require('./src/routes/candles');
const portfolioRoutes = require('./src/routes/portfolio');
const decisionsRoutes = require('./src/routes/decisions');
const tradesRoutes = require('./src/routes/trades');
const agentRoutes = require('./src/routes/agent');
const performanceRoutes = require('./src/routes/performance');
const indicatorsRoutes = require('./src/routes/indicators');
const positionRoutes = require('./src/routes/position');
const resetRoutes = require('./src/routes/reset');
// Phase 2: Single execution endpoint only
const executeRoutes = require('./src/routes/execute');

// Initialize Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware (development)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'sentinel-core-api'
  });
});

// API Routes
app.use('/api/candles', candlesRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/decisions', decisionsRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/indicators', indicatorsRoutes);
app.use('/api/position', positionRoutes);
app.use('/api/reset', resetRoutes);
// Phase 2: Single canonical execution endpoint
app.use('/api/execute', executeRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Sentinel Core API',
    version: '2.0.0',
    endpoints: {
      health: '/health',
      candles: '/api/candles',
      portfolio: '/api/portfolio',
      decisions: '/api/decisions',
      trades: '/api/trades',
      agent: '/api/agent',
      performance: '/api/performance',
      position: '/api/position',
      reset: '/api/reset (POST only - requires confirmation)',
      execute: '/api/execute (POST only - canonical execution endpoint)'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Get port from environment or default to 3000
const PORT = process.env.PORT || 3000;

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sentinel Core API server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

module.exports = app;

