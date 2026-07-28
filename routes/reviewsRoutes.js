const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { protect, adminOnly } = require('../middleware/roleMiddleware');

// Public routes
router.get('/product/:productId', reviewController.getProductReviews);
router.post('/create', reviewController.createReview);
router.put('/:id/helpful', reviewController.markHelpful);

// Authenticated user routes
router.get('/my', protect, reviewController.getMyReviews);
router.delete('/my/:id', protect, reviewController.deleteMyReview);

// Admin routes (protected)
router.get('/', protect, adminOnly, reviewController.getAllReviews);
router.patch('/:id/status', protect, adminOnly, reviewController.updateReviewStatus);
router.delete('/:id', protect, adminOnly, reviewController.deleteReview);

module.exports = router;
