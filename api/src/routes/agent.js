const express = require('express');
const router = express.Router();

// TODO: Implement agent routes
router.get('/', (req, res) => {
  res.json({ message: 'Agent endpoint - coming soon' });
});

module.exports = router;
