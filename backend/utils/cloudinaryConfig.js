/**
 * Upload configuration — ACTIVE path: local Multer disk (utils/localUpload.js).
 *
 * Cloudinary code is PRESERVED BELOW as comments so it can be re-enabled later.
 * DO NOT delete the commented Cloudinary block.
 *
 * To re-enable Cloudinary:
 *   1. Uncomment the Cloudinary block
 *   2. Comment out the ACTIVE LOCAL MULTER section
 *   3. Point routes back to memory-storage `upload` if needed
 *   4. Set CLOUDINARY_* env vars
 */

// =============================================================================
// ==================== CLOUDINARY (COMMENTED OUT — DO NOT DELETE) =============
// =============================================================================
//
// const cloudinary = require('cloudinary').v2;
// const multer = require('multer');
//
// // Configure Cloudinary
// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET,
// });
//
// // Multer memory storage for direct Cloudinary upload
// const storage = multer.memoryStorage();
//
// const fileFilter = (req, file, cb) => {
//   const allowedMimes = [
//     'image/jpeg',
//     'image/png',
//     'image/gif',
//     'image/webp',
//     'image/avif',
//     'video/mp4',
//     'video/mpeg',
//     'video/quicktime',
//     'video/x-msvideo',
//     'video/webm',
//     'video/ogg',
//   ];
//   if (allowedMimes.includes(file.mimetype)) {
//     cb(null, true);
//   } else {
//     cb(new Error(`File type not allowed: ${file.mimetype}`), false);
//   }
// };
//
// const limits = {
//   fileSize: 100 * 1024 * 1024, // 100MB max
// };
//
// const upload = multer({
//   storage,
//   fileFilter,
//   limits,
// });
//
// /**
//  * Upload file to Cloudinary
//  * @param {Buffer} fileBuffer - File buffer from multer
//  * @param {String} fileName - Name of the file
//  * @param {String} folder - Cloudinary folder path
//  * @param {String} resourceType - Type of resource (auto, image, video)
//  */
// const uploadToCloudinary = (fileBuffer, fileName, folder = 'aaxoms', resourceType = 'auto') => {
//   return new Promise((resolve, reject) => {
//     const uploadStream = cloudinary.uploader.upload_stream(
//       {
//         folder: folder,
//         public_id: `${Date.now()}-${fileName}`,
//         resource_type: resourceType,
//         overwrite: true,
//         quality: 'auto',
//         fetch_format: 'auto',
//         transformation:
//           resourceType === 'image'
//             ? [{ quality: 'auto', fetch_format: 'auto' }]
//             : [],
//       },
//       (error, result) => {
//         if (error) reject(error);
//         else resolve(result);
//       }
//     );
//     uploadStream.end(fileBuffer);
//   });
// };
//
// /**
//  * Upload multiple files to Cloudinary
//  */
// const uploadMultipleToCloudinary = async (files, folder = 'aaxoms') => {
//   const uploadPromises = files.map((file) =>
//     uploadToCloudinary(file.buffer, file.originalname, folder, 'auto')
//   );
//   return Promise.all(uploadPromises);
// };
//
// /**
//  * Delete file from Cloudinary by public ID
//  */
// const deleteFromCloudinary = (publicId, resourceType = 'image') => {
//   return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
// };
//
// /**
//  * Get Cloudinary resource details
//  */
// const getCloudinaryDetails = (publicId) => {
//   return cloudinary.api.resource(publicId);
// };
//
// module.exports = {
//   cloudinary,
//   upload,
//   uploadToCloudinary,
//   uploadMultipleToCloudinary,
//   deleteFromCloudinary,
//   getCloudinaryDetails,
// };
//
// =============================================================================
// ==================== END COMMENTED CLOUDINARY BLOCK =========================
// =============================================================================

// =============================================================================
// ==================== ACTIVE: LOCAL MULTER (disk storage) ====================
// =============================================================================

const {
  createUploader,
  deleteLocalFile,
  isLocalUploadPath,
  toStoredMediaPath,
} = require('./localUpload');

// Generic multer instance (gallery) — same export name as old `upload` for compatibility
const upload = createUploader('gallery', { maxSizeMb: 50 });

/**
 * Active upload helper (local disk).
 * Signature kept for callers that used uploadToCloudinary(buffer, name, folder, type).
 * Prefer /api/upload/* routes with Multer middleware (req.file already on disk).
 */
const uploadToCloudinary = async (/* fileBuffer, fileName, folder, resourceType */) => {
  // Cloudinary path disabled — see commented block above.
  // const result = await uploadToCloudinaryCloud(...);
  throw new Error(
    'Cloudinary upload is commented out. Use POST /api/upload/* (Multer disk → UPLOADS_DIR).'
  );
};

const uploadMultipleToCloudinary = async (/* files, folder */) => {
  // return Promise.all(files.map(... uploadToCloudinary ...));
  throw new Error(
    'Cloudinary multi-upload is commented out. Use POST /api/upload/product-images etc.'
  );
};

/**
 * Delete media. Local paths → fs.unlink via deleteLocalFile.
 * Cloudinary destroy is commented out (kept above for re-enable).
 */
const deleteFromCloudinary = async (publicIdOrPath /*, resourceType = 'image' */) => {
  // --- Cloudinary delete (commented out — do not remove) ---
  // return cloudinary.uploader.destroy(publicIdOrPath, { resource_type: resourceType });

  // --- Local disk delete ---
  const pathValue =
    typeof publicIdOrPath === 'string' && publicIdOrPath.startsWith('uploads/')
      ? `/${publicIdOrPath}`
      : publicIdOrPath;

  if (isLocalUploadPath(pathValue) || (typeof pathValue === 'string' && pathValue.startsWith('/uploads/'))) {
    const deleted = deleteLocalFile(toStoredMediaPath(pathValue) || pathValue);
    return {
      result: deleted ? 'ok' : 'not_found',
      message: deleted ? 'Local file deleted' : 'Local file not found',
      path: pathValue,
    };
  }

  // Legacy Cloudinary public_id — nothing to delete on disk
  return {
    result: 'not_found',
    message: 'Not a local /uploads path; Cloudinary delete is commented out',
    skipped: true,
  };
};

const getCloudinaryDetails = async (/* publicId */) => {
  // return cloudinary.api.resource(publicId);
  throw new Error('Cloudinary details API is commented out (using local uploads).');
};

module.exports = {
  // cloudinary, // re-export when Cloudinary is uncommented
  cloudinary: null,
  upload,
  uploadToCloudinary,
  uploadMultipleToCloudinary,
  deleteFromCloudinary,
  getCloudinaryDetails,
  DISABLED: true, // flip to false when re-enabling Cloudinary block
};
