/**
 * Cloudinary is DISABLED for this deployment.
 * All uploads use local disk via utils/localUpload.js (HostingRaja).
 *
 * This file remains only as a safe stub so any leftover require() does not crash.
 * Do not re-enable Cloudinary without an explicit product decision.
 */

const { createUploader } = require('./localUpload');

console.warn(
  '[cloudinaryConfig] Cloudinary upload is disabled. Using local uploads (UPLOADS_DIR).'
);

// Backward-compatible export: "upload" is a generic local multer (gallery)
const upload = createUploader('gallery', { maxSizeMb: 50 });

const uploadToCloudinary = async () => {
  throw new Error(
    'Cloudinary is disabled. Use local upload endpoints (/api/upload/*). Files are stored under UPLOADS_DIR.'
  );
};

const uploadMultipleToCloudinary = async () => {
  throw new Error(
    'Cloudinary is disabled. Use local upload endpoints (/api/upload/*).'
  );
};

const deleteFromCloudinary = async () => {
  // No-op: legacy callers may still invoke this
  return { result: 'not_found', message: 'Cloudinary disabled; use local file delete' };
};

const getCloudinaryDetails = async () => {
  throw new Error('Cloudinary is disabled');
};

module.exports = {
  cloudinary: null,
  upload,
  uploadToCloudinary,
  uploadMultipleToCloudinary,
  deleteFromCloudinary,
  getCloudinaryDetails,
  DISABLED: true,
};
