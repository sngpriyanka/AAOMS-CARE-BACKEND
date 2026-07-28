const express = require('express');
const router = express.Router();
const instagramFeedController = require('../controllers/instagramFeedController');
const { protect, adminOnly } = require('../middleware/roleMiddleware');

router.get('/', instagramFeedController.getInstagramFeed);
router.post('/', protect, adminOnly, instagramFeedController.createInstagramFeedItem);
router.put('/:id', protect, adminOnly, instagramFeedController.updateInstagramFeedItem);
router.delete('/:id', protect, adminOnly, instagramFeedController.deleteInstagramFeedItem);

module.exports = router;
