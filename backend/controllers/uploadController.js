/**
 * Upload Controller
 * Handles file uploads for products, users, and other resources
 */

const {
  uploadToCloudinary,
  uploadMultipleToCloudinary,
  deleteFromCloudinary
} = require('../utils/cloudinaryConfig');

// ==================== UPLOAD PRODUCT IMAGES ====================
/**
 * Upload single product image
 * POST /api/upload/product-image
 * Requires: file in request
 */
const uploadProductImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }

    const result = await uploadToCloudinary(
      req.file.buffer,
      `product-${Date.now()}`,
      'aaxoms/products',
      'image'
    );

    res.json({
      success: true,
      message: 'Product image uploaded successfully',
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        fileName: req.file.originalname,
        size: result.bytes,
        format: result.format
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

// ==================== UPLOAD MULTIPLE PRODUCT IMAGES ====================
/**
 * Upload multiple product images
 * POST /api/upload/product-images
 * Requires: files in request (multiple)
 */
const uploadProductImages = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files provided'
      });
    }

    const results = await uploadMultipleToCloudinary(req.files, 'aaxoms/products');

    res.json({
      success: true,
      message: 'Product images uploaded successfully',
      data: results.map(result => ({
        url: result.secure_url,
        publicId: result.public_id,
        size: result.bytes,
        format: result.format
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

// ==================== DELETE FILE FROM CLOUDINARY ====================
/**
 * Delete file from Cloudinary
 * DELETE /api/upload/:publicId
 * Requires: publicId in params
 */
const deleteFile = async (req, res) => {
  try {
    const { publicId } = req.params;
    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: 'Public ID required'
      });
    }

    const result = await deleteFromCloudinary(publicId);

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
