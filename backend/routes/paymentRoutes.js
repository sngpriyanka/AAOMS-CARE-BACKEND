// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect, adminOnly } = require('../middleware/roleMiddleware'); 

// ==================== PUBLIC ROUTES ====================

// Get available payment methods (can be public)
router.get('/methods', paymentController.getPaymentMethods);

// === PAYMENT VERIFICATION (Protected by one-time paymentToken) ===
// These endpoints are intentionally public because payment gateways redirect the browser back.
// Security is enforced via a short-lived `ptoken` generated during initiation.
router.post('/esewa/verify', paymentController.verifyEsewaPayment);
router.post('/khalti/verify', paymentController.verifyKhaltiPayment);

// Initiate payments (public so guest checkout works)
router.post('/esewa/initiate', paymentController.initiateEsewaPayment);

// ==================== PROTECTED ROUTES (Require Authentication) ====================

// Initiate Khalti (requires login - you can change this if you want guest Khalti too)
router.post('/khalti/initiate', protect, paymentController.initiateKhaltiEpayment);

// ==================== ADMIN ROUTES ====================

router.get('/admin/revenue-summary', protect, adminOnly, paymentController.getAdminRevenueSummary);
router.get('/admin/payments', protect, adminOnly, paymentController.getAdminPayments);

module.exports = router;
