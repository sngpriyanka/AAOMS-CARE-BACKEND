const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { protect, adminOnly } = require('../middleware/roleMiddleware');

// ==================== PUBLIC ROUTES ====================
router.get('/', productController.getAllProducts);
router.get('/id/:id', productController.getProductById);
router.get('/slug/:slug', productController.getProductBySlug);
router.get('/customization/options', productController.getCustomizationOptions);

// ==================== ADMIN ONLY ROUTES ====================
router.post('/', protect, adminOnly, productController.createProduct);
router.put('/:id', protect, adminOnly, productController.updateProduct);
router.delete('/:id', protect, adminOnly, productController.deleteProduct);

module.exports = router;
