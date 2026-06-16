const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const { protect, adminOnly } = require('../middleware/roleMiddleware');

// Public endpoints (footer form + email unsubscribe links)
router.post('/subscribe', subscriptionController.subscribe);
router.post('/unsubscribe', subscriptionController.unsubscribe);
router.get('/unsubscribe', subscriptionController.unsubscribe); // allow GET for email links

// Admin protected
router.get('/', protect, adminOnly, subscriptionController.getAllSubscribers);
router.delete('/:id', protect, adminOnly, subscriptionController.deleteSubscriber);
router.post('/send-newsletter', protect, adminOnly, subscriptionController.sendNewsletter);

module.exports = router;
