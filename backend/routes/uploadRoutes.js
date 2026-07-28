/**
 * Upload Routes — ACTIVE: Multer diskStorage → local folders under UPLOADS_DIR
 *
 * Folders: profile, products, categories, videos, banners, testimonials, gallery, documents
 * DB stores relative paths: /uploads/<folder>/<filename>
 *
 * Cloudinary middleware was previously:
 *   // const { upload } = require('../utils/cloudinaryConfig');
 *   // router.post('/product-image', protect, adminOnly, upload.single('file'), ...)
 * Full Cloudinary implementation is commented in utils/cloudinaryConfig.js (do not delete).
 */

const express = require('express');
const router = express.Router();
// ACTIVE: per-folder Multer disk uploaders (local storage under UPLOADS_DIR)
const { createUploader, setUploadFolder } = require('../utils/localUpload');
// COMMENTED: Cloudinary multer (memoryStorage) — DO NOT use for product images
// const { upload } = require('../utils/cloudinaryConfig');
// // router.post('/product-images', protect, adminOnly, upload.array('files', 10), ...)
const { protect, adminOnly } = require('../middleware/roleMiddleware');
const uploadController = require('../controllers/uploadController');

// Product images → UPLOADS_DIR/products (diskStorage). Never Cloudinary.
const productImages = createUploader('products', { maxSizeMb: 10, imagesOnly: true });
const categoryImages = createUploader('categories', { maxSizeMb: 5, imagesOnly: true });
const profileImages = createUploader('profile', { maxSizeMb: 5, imagesOnly: true });
const productVideos = createUploader('videos', { maxSizeMb: 100, videosOnly: true });
const bannerImages = createUploader('banners', { maxSizeMb: 10, imagesOnly: true });
const testimonialImages = createUploader('testimonials', {
  maxSizeMb: 5,
  imagesOnly: true,
});
// Generic: images/videos/pdf → gallery (or documents for PDF via controller logic)
const genericFiles = createUploader('gallery', { maxSizeMb: 50 });
const documentFiles = createUploader('documents', { maxSizeMb: 50 });

/**
 * GET /api/upload/status
 * Diagnostics for HostingRaja (which folder Node uses, writable?, counts)
 */
router.get('/status', uploadController.getUploadStatus);

/**
 * POST /api/upload/file
 * Generic gallery upload (reviews, misc)
 * // CLOUDINARY (commented): upload.single('file') from memoryStorage
 */
router.post(
  '/file',
  setUploadFolder('gallery'),
  genericFiles.single('file'),
  uploadController.uploadFile
);

/**
 * POST /api/upload/document
 * PDF / document uploads → uploads/documents
 */
router.post(
  '/document',
  protect,
  adminOnly,
  setUploadFolder('documents'),
  documentFiles.single('file'),
  uploadController.uploadFile
);

/**
 * POST /api/upload/product-image
 */
router.post(
  '/product-image',
  protect,
  adminOnly,
  setUploadFolder('products'),
  productImages.single('file'),
  uploadController.uploadProductImage
);

/**
 * POST /api/upload/product-images
 */
router.post(
  '/product-images',
  protect,
  adminOnly,
  setUploadFolder('products'),
  productImages.array('files', 10),
  uploadController.uploadProductImages
);

/**
 * POST /api/upload/product-video
 */
router.post(
  '/product-video',
  protect,
  adminOnly,
  setUploadFolder('videos'),
  productVideos.single('file'),
  uploadController.uploadProductVideo
);

/**
 * POST /api/upload/category-image
 * Single category image → /uploads/categories/<filename>
 */
router.post(
  '/category-image',
  protect,
  adminOnly,
  setUploadFolder('categories'),
  categoryImages.single('file'),
  uploadController.uploadCategoryImage
);

/**
 * POST /api/upload/banner
 */
router.post(
  '/banner',
  protect,
  adminOnly,
  setUploadFolder('banners'),
  bannerImages.single('file'),
  uploadController.uploadBanner
);

/**
 * POST /api/upload/banners
 */
router.post(
  '/banners',
  protect,
  adminOnly,
  setUploadFolder('banners'),
  bannerImages.array('files', 10),
  uploadController.uploadBanners
);

/**
 * POST /api/upload/testimonial
 */
router.post(
  '/testimonial',
  protect,
  adminOnly,
  setUploadFolder('testimonials'),
  testimonialImages.single('file'),
  uploadController.uploadTestimonialImage
);

/**
 * POST /api/upload/profile-picture
 */
router.post(
  '/profile-picture',
  protect,
  setUploadFolder('profile'),
  profileImages.single('file'),
  uploadController.uploadProfilePicture
);

/**
 * DELETE /api/upload/file-by-path
 * body: { path: "/uploads/products/..." }
 */
router.delete(
  '/file-by-path',
  protect,
  adminOnly,
  uploadController.deleteFile
);

/**
 * DELETE /api/upload/:publicId
 * URL-encoded local path
 */
router.delete('/:publicId', protect, adminOnly, uploadController.deleteFile);

module.exports = router;
