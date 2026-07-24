// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect, adminOnly } = require('../middleware/roleMiddleware'); 

// ==================== PUBLIC ROUTES ====================

router.get('/methods', paymentController.getPaymentMethods);
// Public config (Key ID only — Key Secret never leaves the server)
router.get('/razorpay/config', paymentController.getRazorpayConfig);
router.post('/razorpay/verify', paymentController.verifyRazorpayPayment);
router.post('/razorpay/create-order', paymentController.initiateRazorpayPayment);

// ==================== ADMIN ROUTES ====================

router.get('/admin/revenue-summary', protect, adminOnly, paymentController.getAdminRevenueSummary);
router.get('/admin/payments', protect, adminOnly, paymentController.getAdminPayments);

module.exports = router;