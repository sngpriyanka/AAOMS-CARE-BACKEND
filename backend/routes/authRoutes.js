const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/roleMiddleware');

// ==================== PUBLIC AUTH ROUTES ====================
router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/verify-login-otp', authController.verifyLoginOtp);
router.post('/resend-login-otp', authController.resendLoginOtp);
router.post('/google', authController.googleAuth);
router.post('/forgot-password', authController.forgotPassword); 
router.post('/reset-password', authController.resetPassword);

// Signup OTP (email or mobile channel); profile phone OTP
router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);

// ==================== PROTECTED AUTH ROUTES ====================
router.get('/me', protect, authController.getCurrentUser);
router.post('/logout', protect, authController.logout);

module.exports = router;