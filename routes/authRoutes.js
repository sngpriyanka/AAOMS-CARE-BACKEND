const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/roleMiddleware');

// ==================== PUBLIC AUTH ROUTES ====================
router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/google', authController.googleAuth);
router.post('/forgot-password', authController.forgotPassword); 
router.post('/reset-password', authController.resetPassword);

// Email OTP for signup; phone OTP for profile phone updates
router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);

// ==================== PROTECTED AUTH ROUTES ====================
router.get('/me', protect, authController.getCurrentUser);
router.post('/logout', protect, authController.logout);

module.exports = router;