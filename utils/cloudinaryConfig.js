/**
 * Cloudinary Configuration & Upload Handler
 * Handles image and video uploads to Cloudinary
 */

const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const path = require('path');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ==================== MULTER CONFIGURATION ====================
// Configure storage (memory storage for direct Cloudinary upload)
const storage = multer.memoryStorage();

// File filter for images and videos
const fileFilter = (req, file, cb) => {
  // Allowed MIME types
  const allowedMimes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/avif',
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm',
    'video/ogg'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${file.mimetype}`), false);
  }
};

// File size limits
const limits = {
  fileSize: 100 * 1024 * 1024 // 100MB max
};

// Create multer instance
const upload = multer({
  storage,
  fileFilter,
  limits
});

// ==================== CLOUDINARY UPLOAD FUNCTION ====================
/**
 * Upload file to Cloudinary
 * @param {Buffer} fileBuffer - File buffer from multer
 * @param {String} fileName - Name of the file
 * @param {String} folder - Cloudinary folder path
 * @param {String} resourceType - Type of resource (auto, image, video)
 * @returns {Promise} Upload result with URL
 */
const uploadToCloudinary = (fileBuffer, fileName, folder = 'aaxoms', resourceType = 'auto') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        public_id: `${Date.now()}-${fileName}`,
        resource_type: resourceType,
        overwrite: true,
        quality: 'auto',
        fetch_format: 'auto',
        transformation: resourceType === 'image' ? [{ quality: 'auto', fetch_format: 'auto' }] : []
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

// ==================== BATCH UPLOAD FUNCTION ====================
/**
 * Upload multiple files to Cloudinary
 * @param {Array} files - Array of files from multer
 * @param {String} folder - Cloudinary folder path
 * @returns {Promise} Array of upload results
 */
const uploadMultipleToCloudinary = async (files, folder = 'aaxoms') => {
  const uploadPromises = files.map(file =>
    uploadToCloudinary(file.buffer, file.originalname, folder, 'auto')
  );

  return Promise.all(uploadPromises);
};

// ==================== DELETE FROM CLOUDINARY ====================
/**
 * Delete file from Cloudinary by public ID
 * @param {String} publicId - Public ID of the file to delete
 * @param {String} resourceType - Type of resource (image, video, raw)
 * @returns {Promise}
 */
const deleteFromCloudinary = (publicId, resourceType = 'image') => {
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
};

// ==================== GET CLOUDINARY DETAILS ====================
/**
 * Get Cloudinary resource details
 * @param {String} publicId - Public ID of the resource
 * @returns {Promise}
 */
const getCloudinaryDetails = (publicId) => {
  return cloudinary.api.resource(publicId);
};

module.exports = {
  cloudinary,
  upload,
  uploadToCloudinary,
  uploadMultipleToCloudinary,
  deleteFromCloudinary,
  getCloudinaryDetails
};
