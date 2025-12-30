const express = require('express');
const router = express.Router();

// TODO: Implement performance routes
router.get('/', (req, res) => {
  res.json({ message: 'Performance endpoint - coming soon' });
});

module.exports = router;

