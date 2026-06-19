/**
 * Upload Routes
 * Handles file upload endpoints for images and videos
 */

const express = require('express');
const router = express.Router();
const { upload } = require('../utils/cloudinaryConfig');
const { protect, adminOnly } = require('../middleware/roleMiddleware');
const uploadController = require('../controllers/uploadController');

// ==================== PUBLIC UPLOAD ROUTES ====================

/**
 * POST /api/upload/file
 * Upload generic file (image or video)
 * Middleware: Single file upload
 */
router.post('/file', upload.single('file'), uploadController.uploadFile);

/**
 * POST /api/upload/product-image
 * Upload single product image
 * Middleware: Authentication + Admin only, single file upload
 */
router.post('/product-image', protect, adminOnly, upload.single('file'), uploadController.uploadProductImage);

/**
 * POST /api/upload/product-images
 * Upload multiple product images
 * Middleware: Authentication + Admin only, multiple files upload
 */
router.post('/product-images', protect, adminOnly, upload.array('files', 10), uploadController.uploadProductImages);

/**
 * POST /api/upload/product-video
 * Upload product video
 * Middleware: Authentication + Admin only, single file upload
 */
router.post('/product-video', protect, adminOnly, upload.single('file'), uploadController.uploadProductVideo);

/**
 * POST /api/upload/banner
 * Upload banner image
 * Middleware: Authentication + Admin only, single file upload
 */
router.post('/banner', protect, adminOnly, upload.single('file'), uploadController.uploadBanner);

/**
 * POST /api/upload/banners
 * Upload multiple banner images
 * Middleware: Authentication + Admin only, multiple files upload
 */
router.post('/banners', protect, adminOnly, upload.array('files', 10), uploadController.uploadBanners);

/**
 * POST /api/upload/profile-picture
 * Upload user profile picture
 * Middleware: Authenticated user, single file upload
 */
router.post('/profile-picture', protect, upload.single('file'), uploadController.uploadProfilePicture);

/**
 * DELETE /api/upload/:publicId
 * Delete file from Cloudinary
 * Middleware: Authentication + Admin only
 */
router.delete('/:publicId', protect, adminOnly, uploadController.deleteFile);

module.exports = router;
