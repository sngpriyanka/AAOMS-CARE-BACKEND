/**
 * Upload Routes — all media → local HostingRaja disk (UPLOADS_DIR)
 * Cloudinary is not used.
 */

const express = require('express');
const router = express.Router();
const { createUploader, setUploadFolder } = require('../utils/localUpload');
const { protect, adminOnly } = require('../middleware/roleMiddleware');
const uploadController = require('../controllers/uploadController');

const productImages = createUploader('products', { maxSizeMb: 10, imagesOnly: true });
const profileImages = createUploader('profile', { maxSizeMb: 5, imagesOnly: true });
const productVideos = createUploader('videos', { maxSizeMb: 100, videosOnly: true });
const bannerImages = createUploader('banners', { maxSizeMb: 10, imagesOnly: true });
const testimonialImages = createUploader('testimonials', {
  maxSizeMb: 5,
  imagesOnly: true,
});
// Generic: images/videos/pdf → gallery (videos route uses videos folder when dedicated)
const genericFiles = createUploader('gallery', { maxSizeMb: 50 });

/**
 * POST /api/upload/file
 * Generic gallery upload (reviews, misc)
 */
router.post(
  '/file',
  setUploadFolder('gallery'),
  genericFiles.single('file'),
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
