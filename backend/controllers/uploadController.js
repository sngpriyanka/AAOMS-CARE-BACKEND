/**
 * Upload Controller
 * Handles file uploads for products, users, and other resources
 *
 * Product images: local disk under uploads/products (HostingRaja / self-host).
 * Other media may still use Cloudinary until migrated.
 */

const {
  uploadToCloudinary,
  uploadMultipleToCloudinary,
  deleteFromCloudinary
} = require('../utils/cloudinaryConfig');
const {
  fileToUploadResult,
  deleteLocalFile,
  isLocalUploadPath,
} = require('../utils/localUpload');

const PRODUCT_FOLDER = 'products';

// ==================== UPLOAD PRODUCT IMAGES (LOCAL DISK) ====================
/**
 * Upload single product image to server uploads/products
 * POST /api/upload/product-image
 * Requires: file in request (multer disk storage)
 * Stores relative path in DB later: /uploads/products/<filename>
 */
const uploadProductImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }

    if (!String(req.file.mimetype || '').startsWith('image/')) {
      // Remove accidental non-image if multer allowed it
      deleteLocalFile(`/uploads/${PRODUCT_FOLDER}/${req.file.filename}`);
      return res.status(400).json({
        success: false,
        message: 'Only image files are allowed for product images'
      });
    }

    const data = fileToUploadResult(req.file, PRODUCT_FOLDER, req);

    res.json({
      success: true,
      message: 'Product image uploaded successfully',
      data: {
        url: data.url,
        path: data.path,
        publicId: data.publicId,
        fileName: data.fileName,
        size: data.size,
        format: data.format,
      }
    });
  } catch (error) {
    console.error('Error uploading product image:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading image',
      error: error.message
    });
  }
};

// ==================== UPLOAD MULTIPLE PRODUCT IMAGES (LOCAL DISK) ====================
/**
 * Upload multiple product images to server uploads/products
 * POST /api/upload/product-images
 * Requires: files in request (field name: files)
 */
const uploadProductImages = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files provided'
      });
    }

    const accepted = [];
    for (const file of req.files) {
      if (!String(file.mimetype || '').startsWith('image/')) {
        deleteLocalFile(`/uploads/${PRODUCT_FOLDER}/${file.filename}`);
        continue;
      }
      accepted.push(fileToUploadResult(file, PRODUCT_FOLDER, req));
    }

    if (accepted.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid image files provided'
      });
    }

    res.json({
      success: true,
      message: 'Product images uploaded successfully',
      data: accepted.map((result) => ({
        url: result.url,
        path: result.path,
        publicId: result.publicId,
        size: result.size,
        format: result.format,
        fileName: result.fileName,
      }))
    });
  } catch (error) {
    console.error('Error uploading product images:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading images',
      error: error.message
    });
  }
};

// ==================== UPLOAD USER PROFILE PICTURE ====================
/**
 * Upload user profile picture
 * POST /api/upload/profile-picture
 * Requires: file in request, user authentication
 */
const uploadProfilePicture = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }

    const userId = req.user?.id || req.body.userId;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID required'
      });
    }

    const result = await uploadToCloudinary(
      req.file.buffer,
      `profile-${userId}`,
      'aaxoms/profiles',
      'image'
    );

    res.json({
      success: true,
      message: 'Profile picture uploaded successfully',
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        fileName: req.file.originalname,
        size: result.bytes
      }
    });
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading profile picture',
      error: error.message
    });
  }
};

// ==================== UPLOAD PRODUCT VIDEO ====================
/**
 * Upload product video
 * POST /api/upload/product-video
 * Requires: file in request (video)
 */
const uploadProductVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }

    // Check if file is video
    if (!req.file.mimetype.startsWith('video/')) {
      return res.status(400).json({
        success: false,
        message: 'Only video files are allowed'
      });
    }

    const result = await uploadToCloudinary(
      req.file.buffer,
      `video-${Date.now()}`,
      'aaxoms/videos',
      'video'
    );

    res.json({
      success: true,
      message: 'Product video uploaded successfully',
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        fileName: req.file.originalname,
        duration: result.duration,
        size: result.bytes,
        format: result.format
      }
    });
  } catch (error) {
    console.error('Error uploading product video:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading video',
      error: error.message
    });
  }
};

// ==================== UPLOAD BANNER IMAGE ====================
/**
 * Upload banner image (for home page, categories, etc.)
 * POST /api/upload/banner
 * Requires: file in request
 */
const uploadBanner = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }

    const result = await uploadToCloudinary(
      req.file.buffer,
      `banner-${Date.now()}`,
      'aaxoms/banners',
      'image'
    );

    res.json({
      success: true,
      message: 'Banner uploaded successfully',
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        fileName: req.file.originalname,
        size: result.bytes
      }
    });
  } catch (error) {
    console.error('Error uploading banner:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading banner',
      error: error.message
    });
  }
};

// ==================== UPLOAD MULTIPLE BANNER IMAGES ====================
/**
 * Upload multiple banner images
 * POST /api/upload/banners
 * Requires: files in request (multiple)
 */
const uploadBanners = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files provided'
      });
    }

    const results = await uploadMultipleToCloudinary(req.files, 'aaxoms/banners');

    res.json({
      success: true,
      message: 'Banner images uploaded successfully',
      data: results.map(result => ({
        url: result.secure_url,
        publicId: result.public_id,
        size: result.bytes,
        format: result.format
      }))
    });
  } catch (error) {
    console.error('Error uploading banner images:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading banner images',
      error: error.message
    });
  }
};

// ==================== UPLOAD TESTIMONIAL IMAGE ====================
/**
 * Upload testimonial image
 * POST /api/upload/testimonial
 * Requires: file in request
 */
const uploadTestimonialImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }

    const result = await uploadToCloudinary(
      req.file.buffer,
      `testimonial-${Date.now()}`,
      'aaxoms/testimonials',
      'image'
    );

    res.json({
      success: true,
      message: 'Testimonial image uploaded successfully',
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        fileName: req.file.originalname,
        size: result.bytes
      }
    });
  } catch (error) {
    console.error('Error uploading testimonial image:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading testimonial image',
      error: error.message
    });
  }
};

// ==================== UPLOAD GENERIC FILE ====================
/**
 * Upload any image or video (generic endpoint)
 * POST /api/upload/file
 * Requires: file in request
 * Optional: folder (default: aaxoms)
 */
const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }

    const folder = req.body.folder || 'aaxoms/files';
    const resourceType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';

    const result = await uploadToCloudinary(
      req.file.buffer,
      `file-${Date.now()}`,
      folder,
      resourceType
    );

    res.json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        fileName: req.file.originalname,
        resourceType: resourceType,
        size: result.bytes,
        format: result.format
      }
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading file',
      error: error.message
    });
  }
};

// ==================== DELETE FILE ====================
/**
 * Delete file from local uploads (product images) or Cloudinary (legacy)
 * DELETE /api/upload/:publicId
 * publicId may be URL-encoded local path e.g. %2Fuploads%2Fproducts%2Fxxx.jpg
 * Body alternative: { path: "/uploads/products/xxx.jpg" }
 */
const deleteFile = async (req, res) => {
  try {
    const raw =
      req.body?.path ||
      req.query?.path ||
      (req.params.publicId ? decodeURIComponent(req.params.publicId) : '');

    if (!raw) {
      return res.status(400).json({
        success: false,
        message: 'File path or public ID required'
      });
    }

    // Local product (or other) uploads
    if (isLocalUploadPath(raw) || raw.startsWith('uploads/')) {
      const pathValue = raw.startsWith('uploads/') ? `/${raw}` : raw;
      const deleted = deleteLocalFile(pathValue);
      return res.json({
        success: true,
        message: deleted ? 'Local file deleted successfully' : 'File not found (already removed)',
        data: { path: pathValue, deleted }
      });
    }

    // Legacy Cloudinary
    const result = await deleteFromCloudinary(raw);

    res.json({
      success: true,
      message: 'File deleted successfully',
      data: result
    });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting file',
      error: error.message
    });
  }
};

module.exports = {
  uploadProductImage,
  uploadProductImages,
  uploadProfilePicture,
  uploadProductVideo,
  uploadBanner,
  uploadBanners,
  uploadTestimonialImage,
  uploadFile,
  deleteFile
};
