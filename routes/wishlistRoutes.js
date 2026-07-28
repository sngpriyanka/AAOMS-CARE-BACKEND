const express = require('express');
const router = express.Router();
const wishlistController = require('../controllers/wishlistController');
const { protect } = require('../middleware/roleMiddleware');

// Get user's wishlist
router.get('/', protect, wishlistController.getWishlist);

// Add item to wishlist
router.post('/add', protect, wishlistController.addToWishlist);

// Remove specific item from wishlist (more specific route first)
router.delete('/:itemId', protect, wishlistController.removeFromWishlist);

// Check if product is in wishlist
router.get('/check/:productId', protect, wishlistController.isInWishlist);

// Clear entire wishlist (least specific route last)
router.post('/clear', protect, wishlistController.clearWishlist);

module.exports = router;

