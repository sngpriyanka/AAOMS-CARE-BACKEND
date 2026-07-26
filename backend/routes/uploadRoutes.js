/**
 * Upload Routes
 * Product images → local disk (uploads/products)
 * Other media may still use Cloudinary memory upload until migrated
 */

const express = require('express');
const router = express.Router();
const { upload } = require('../utils/cloudinaryConfig');
const { createUploader } = require('../utils/localUpload');
const { protect, adminOnly } = require('../middleware/roleMiddleware');
const uploadController = require('../controllers/uploadController');

// Local disk multer for product images (HostingRaja / self-hosted)
const productImageUpload = createUploader('products', { maxSizeMb: 10 });

// ==================== PUBLIC UPLOAD ROUTES ====================

/**
 * POST /api/upload/file
 * Upload generic file (image or video) — Cloudinary (legacy)
 */
router.post('/file', upload.single('file'), uploadController.uploadFile);

/**
 * POST /api/upload/product-image
 * Single product image → local uploads/products
 */
router.post(
  '/product-image',
  protect,
  adminOnly,
  productImageUpload.single('file'),
  uploadController.uploadProductImage
);

/**
 * POST /api/upload/product-images
 * Multiple product images → local uploads/products
 * Field name: files (matches ManageProducts FormData)
 */
router.post(
  '/product-images',
  protect,
  adminOnly,
  productImageUpload.array('files', 10),
  uploadController.uploadProductImages
);

/**
 * POST /api/upload/product-video
 * Product video (Cloudinary until video migration)
 */
router.post(
  '/product-video',
  protect,
  adminOnly,
  upload.single('file'),
  uploadController.uploadProductVideo
);

/**
 * POST /api/upload/banner
 */
router.post(
  '/banner',
  protect,
  adminOnly,
  upload.single('file'),
  uploadController.uploadBanner
);

/**
 * POST /api/upload/banners
 */
router.post(
  '/banners',
  protect,
  adminOnly,
  upload.array('files', 10),
  uploadController.uploadBanners
);

/**
 * POST /api/upload/testimonial
 */
router.post(
  '/testimonial',
  protect,
  adminOnly,
  upload.single('file'),
  uploadController.uploadTestimonialImage
);

/**
 * POST /api/upload/profile-picture
 */
router.post(
  '/profile-picture',
  protect,
  upload.single('file'),
  uploadController.uploadProfilePicture
);

/**
 * DELETE /api/upload/file-by-path
 * Prefer body { path: "/uploads/products/..." } for local files
 */
router.delete(
  '/file-by-path',
  protect,
  adminOnly,
  uploadController.deleteFile
);

/**
 * DELETE /api/upload/:publicId
 * Local path (URL-encoded) or Cloudinary public id
 */
router.delete('/:publicId', protect, adminOnly, uploadController.deleteFile);

module.exports = router;
