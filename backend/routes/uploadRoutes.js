/**
 * Upload Routes
 * ACTIVE: local Multer diskStorage → UPLOADS_DIR/{products,profile,banners,...}
 * Cloudinary is NOT used for any of these endpoints.
 *
 * API paths (unchanged for frontend):
 *   POST /api/upload/product-image
 *   POST /api/upload/product-images
 *   POST /api/upload/product-video
 *   POST /api/upload/banner
 *   POST /api/upload/banners
 *   POST /api/upload/profile-picture
 *   POST /api/upload/testimonial
 *   POST /api/upload/category-image
 *   POST /api/upload/file
 *   POST /api/upload/document
 *   DELETE /api/upload/:publicId
 *   DELETE /api/upload/file-by-path
 */

const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/roleMiddleware');
const uploadController = require('../controllers/uploadController');

// ---------------------------------------------------------------------------
// CLOUDINARY (OLD — COMMENTED OUT, DO NOT DELETE)
// ---------------------------------------------------------------------------
// const { upload } = require('../utils/cloudinaryConfig');
// // Previously: memoryStorage multer → uploadToCloudinary(req.file.buffer, ...)
// // router.post('/product-image', protect, adminOnly, upload.single('file'), uploadController.uploadProductImage);
// // router.post('/product-images', protect, adminOnly, upload.array('files', 10), uploadController.uploadProductImages);
// // router.post('/banner', protect, adminOnly, upload.single('file'), uploadController.uploadBanner);
// // router.post('/profile-picture', protect, upload.single('file'), uploadController.uploadProfilePicture);
// // Full Cloudinary source remains in utils/cloudinaryConfig.js (commented block).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LOCAL MULTER (ACTIVE) — diskStorage via utils/localUpload.js
// Saves under UPLOADS_DIR (e.g. .../aaoms-data/uploads or backend/uploads)
// Subfolders: products, profile, banners, videos, gallery, testimonials, documents, categories
// ---------------------------------------------------------------------------
const { createUploader, setUploadFolder } = require('../utils/localUpload');

const productImages = createUploader('products', { maxSizeMb: 10, imagesOnly: true });
const categoryImages = createUploader('categories', { maxSizeMb: 5, imagesOnly: true });
const profileImages = createUploader('profile', { maxSizeMb: 5, imagesOnly: true });
const productVideos = createUploader('videos', { maxSizeMb: 100, videosOnly: true });
const bannerImages = createUploader('banners', { maxSizeMb: 10, imagesOnly: true });
const testimonialImages = createUploader('testimonials', {
  maxSizeMb: 5,
  imagesOnly: true,
});
const genericFiles = createUploader('gallery', { maxSizeMb: 50 });
const documentFiles = createUploader('documents', { maxSizeMb: 50 });

// Diagnostics
router.get('/status', uploadController.getUploadStatus);

// Generic / gallery
router.post(
  '/file',
  setUploadFolder('gallery'),
  genericFiles.single('file'),
  uploadController.uploadFile
);

// Documents
router.post(
  '/document',
  protect,
  adminOnly,
  setUploadFolder('documents'),
  documentFiles.single('file'),
  uploadController.uploadFile
);

// Product images (single)
router.post(
  '/product-image',
  protect,
  adminOnly,
  setUploadFolder('products'),
  productImages.single('file'),
  uploadController.uploadProductImage
);

// Product images (multiple) — field name: files
router.post(
  '/product-images',
  protect,
  adminOnly,
  setUploadFolder('products'),
  productImages.array('files', 10),
  uploadController.uploadProductImages
);

// Product video
router.post(
  '/product-video',
  protect,
  adminOnly,
  setUploadFolder('videos'),
  productVideos.single('file'),
  uploadController.uploadProductVideo
);

// Category image
router.post(
  '/category-image',
  protect,
  adminOnly,
  setUploadFolder('categories'),
  categoryImages.single('file'),
  uploadController.uploadCategoryImage
);

// Banner (single)
router.post(
  '/banner',
  protect,
  adminOnly,
  setUploadFolder('banners'),
  bannerImages.single('file'),
  uploadController.uploadBanner
);

// Banners (multiple)
router.post(
  '/banners',
  protect,
  adminOnly,
  setUploadFolder('banners'),
  bannerImages.array('files', 10),
  uploadController.uploadBanners
);

// Testimonial
router.post(
  '/testimonial',
  protect,
  adminOnly,
  setUploadFolder('testimonials'),
  testimonialImages.single('file'),
  uploadController.uploadTestimonialImage
);

// Profile picture
router.post(
  '/profile-picture',
  protect,
  setUploadFolder('profile'),
  profileImages.single('file'),
  uploadController.uploadProfilePicture
);

// Delete local file by path
router.delete(
  '/file-by-path',
  protect,
  adminOnly,
  uploadController.deleteFile
);

// Delete by publicId / path param (legacy route name; deletes local file)
router.delete('/:publicId', protect, adminOnly, uploadController.deleteFile);

module.exports = router;
