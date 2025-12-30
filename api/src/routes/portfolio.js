const express = require('express');
const router = express.Router();

// TODO: Implement portfolio routes
router.get('/', (req, res) => {
  res.json({ message: 'Portfolio endpoint - coming soon' });
});

module.exports = router;

