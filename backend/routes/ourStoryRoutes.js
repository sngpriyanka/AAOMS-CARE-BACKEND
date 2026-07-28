const express = require('express');
const router = express.Router();
const ourStoryController = require('../controllers/ourStoryController');
const { protect, adminOnly } = require('../middleware/roleMiddleware');

// Public — home + /our-story page
router.get('/', ourStoryController.getOurStory);

// Admin — update all text + image paths
router.put('/', protect, adminOnly, ourStoryController.updateOurStory);

module.exports = router;
