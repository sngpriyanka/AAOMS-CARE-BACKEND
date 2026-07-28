/**
 * Upload helpers — ACTIVE: local disk only (Multer / fs).
 *
 * IMPORTANT:
 * - Product images must NEVER call the real Cloudinary SDK.
 * - The full original Cloudinary implementation is preserved as COMMENTS below.
 * - Do not delete the commented Cloudinary block.
 *
 * To re-enable Cloudinary later:
 *   1. Uncomment the CLOUDINARY block
 *   2. Comment out the ACTIVE LOCAL section
 *   3. Set CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET
 */

// =============================================================================
// ==================== CLOUDINARY (COMMENTED OUT — DO NOT DELETE) =============
// =============================================================================
//
// const cloudinary = require('cloudinary').v2;
// const multer = require('multer');
//
// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET,
// });
//
// const storage = multer.memoryStorage();
//
// const fileFilter = (req, file, cb) => {
//   const allowedMimes = [
//     'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
//     'video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo',
//     'video/webm', 'video/ogg',
//   ];
//   if (allowedMimes.includes(file.mimetype)) cb(null, true);
//   else cb(new Error(`File type not allowed: ${file.mimetype}`), false);
// };
//
// const upload = multer({
//   storage,
//   fileFilter,
//   limits: { fileSize: 100 * 1024 * 1024 },
// });
//
// const uploadToCloudinary = (fileBuffer, fileName, folder = 'aaxoms', resourceType = 'auto') => {
//   return new Promise((resolve, reject) => {
//     const uploadStream = cloudinary.uploader.upload_stream(
//       {
//         folder,
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
// const uploadMultipleToCloudinary = async (files, folder = 'aaxoms') => {
//   return Promise.all(
//     files.map((file) =>
//       uploadToCloudinary(file.buffer, file.originalname, folder, 'auto')
//     )
//   );
// };
//
// const deleteFromCloudinary = (publicId, resourceType = 'image') => {
//   return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
// };
//
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
// ==================== ACTIVE: LOCAL FILE STORAGE (NO CLOUDINARY SDK) =========
// =============================================================================
// NEVER call cloudinary.uploader.upload / upload_stream here.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  createUploader,
  deleteLocalFile,
  isLocalUploadPath,
  toStoredMediaPath,
  ensureUploadTree,
  normalizeFolderKey,
  toPublicPath,
  toPublicUrl,
} = require('./localUpload');

/** Generic multer (gallery) — same export name as legacy Cloudinary memory `upload` */
const upload = createUploader('gallery', { maxSizeMb: 50 });

/** Product-image multer (disk → uploads/products) */
const productUpload = createUploader('products', { maxSizeMb: 10, imagesOnly: true });

/**
 * Map legacy Cloudinary-style folder names to local subdirs.
 * e.g. 'aaxoms/products' → 'products'
 */
function mapFolderToLocal(folder) {
  const raw = String(folder || 'gallery').toLowerCase();
  if (raw.includes('product')) return 'products';
  if (raw.includes('profile') || raw.includes('avatar')) return 'profile';
  if (raw.includes('banner')) return 'banners';
  if (raw.includes('testimonial')) return 'testimonials';
  if (raw.includes('video')) return 'videos';
  if (raw.includes('categor')) return 'categories';
  if (raw.includes('document') || raw.includes('pdf')) return 'documents';
  return normalizeFolderKey(raw.split('/').pop() || 'gallery');
}

/**
 * ACTIVE replacement for legacy uploadToCloudinary().
 * Writes buffer/path to LOCAL disk under UPLOADS_DIR/<folder>/.
 * Does NOT call the Cloudinary SDK (no api_key required).
 *
 * Returns a Cloudinary-like shape for old callers:
 *   { secure_url, public_id, bytes, format, path, url }
 * where secure_url/path are relative: /uploads/products/<filename>
 */
const uploadToCloudinary = async (
  fileBufferOrPath,
  fileName = 'file',
  folder = 'aaxoms/products',
  _resourceType = 'auto'
) => {
  // --- Cloudinary path (COMMENTED OUT — do not remove) ---
  // return new Promise((resolve, reject) => {
  //   const uploadStream = cloudinary.uploader.upload_stream({ ... }, callback);
  //   uploadStream.end(fileBuffer);
  // });

  const folderKey = mapFolderToLocal(folder);
  const root = ensureUploadTree();
  const destDir = path.join(root, folderKey);
  fs.mkdirSync(destDir, { recursive: true });

  const ext =
    path.extname(String(fileName || '')).toLowerCase() ||
    (Buffer.isBuffer(fileBufferOrPath) ? '.bin' : '');
  const safeExt = /^\.(jpe?g|png|gif|webp|avif|mp4|webm|mov|pdf)$/i.test(ext)
    ? ext === '.jpeg'
      ? '.jpg'
      : ext
    : '.jpg';
  const filename = `${folderKey}-${Date.now()}-${crypto
    .randomBytes(8)
    .toString('hex')}${safeExt}`;
  const absPath = path.join(destDir, filename);

  if (Buffer.isBuffer(fileBufferOrPath)) {
    fs.writeFileSync(absPath, fileBufferOrPath);
  } else if (typeof fileBufferOrPath === 'string' && fs.existsSync(fileBufferOrPath)) {
    fs.copyFileSync(fileBufferOrPath, absPath);
  } else if (fileBufferOrPath && fileBufferOrPath.buffer) {
    // multer memory file shape { buffer, originalname }
    fs.writeFileSync(absPath, fileBufferOrPath.buffer);
  } else {
    throw new Error(
      'Local upload failed: expected file buffer. Use POST /api/upload/product-images with Multer diskStorage.'
    );
  }

  const relativePath = toPublicPath(folderKey, filename); // /uploads/products/...
  const bytes = fs.statSync(absPath).size;

  console.log(
    `[upload] LOCAL (not Cloudinary) saved → ${absPath} | path(for DB): ${relativePath}`
  );

  // Shape compatible with old Cloudinary result consumers
  return {
    secure_url: relativePath,
    url: relativePath,
    path: relativePath,
    public_id: relativePath,
    publicId: relativePath,
    bytes,
    size: bytes,
    format: safeExt.replace('.', ''),
    filename,
    folder: folderKey,
    resource_type: 'image',
  };
};

/**
 * ACTIVE multi-file local upload (replaces Cloudinary multi-upload).
 * Prefer route-level Multer: POST /api/upload/product-images
 */
const uploadMultipleToCloudinary = async (files, folder = 'aaxoms/products') => {
  // --- Cloudinary multi (COMMENTED OUT) ---
  // return Promise.all(files.map((f) => uploadToCloudinary(f.buffer, f.originalname, folder)));

  const list = Array.isArray(files) ? files : [];
  const results = [];
  for (const file of list) {
    const buffer = file.buffer || null;
    const name = file.originalname || file.filename || 'file.jpg';
    if (buffer) {
      results.push(await uploadToCloudinary(buffer, name, folder));
    } else if (file.path && fs.existsSync(file.path)) {
      // Already on disk from Multer diskStorage — just map path
      const folderKey = mapFolderToLocal(folder);
      const filename = file.filename || path.basename(file.path);
      const relativePath = toPublicPath(folderKey, filename);
      results.push({
        secure_url: relativePath,
        url: relativePath,
        path: relativePath,
        public_id: relativePath,
        publicId: relativePath,
        bytes: file.size || 0,
        size: file.size || 0,
        format: path.extname(filename).replace('.', ''),
        filename,
        folder: folderKey,
      });
    }
  }
  return results;
};

const deleteFromCloudinary = async (publicIdOrPath /*, resourceType = 'image' */) => {
  // --- Cloudinary delete (COMMENTED OUT — do not remove) ---
  // return cloudinary.uploader.destroy(publicIdOrPath, { resource_type: resourceType });

  const pathValue =
    typeof publicIdOrPath === 'string' && publicIdOrPath.startsWith('uploads/')
      ? `/${publicIdOrPath}`
      : publicIdOrPath;

  if (
    isLocalUploadPath(pathValue) ||
    (typeof pathValue === 'string' && pathValue.startsWith('/uploads/'))
  ) {
    const deleted = deleteLocalFile(toStoredMediaPath(pathValue) || pathValue);
    return {
      result: deleted ? 'ok' : 'not_found',
      message: deleted ? 'Local file deleted' : 'Local file not found',
      path: pathValue,
    };
  }

  return {
    result: 'not_found',
    message: 'Not a local /uploads path; Cloudinary delete is commented out',
    skipped: true,
  };
};

const getCloudinaryDetails = async (/* publicId */) => {
  // return cloudinary.api.resource(publicId);
  throw new Error(
    'Cloudinary details API is commented out. Media is stored under UPLOADS_DIR locally.'
  );
};

module.exports = {
  cloudinary: null, // real SDK not loaded — product uploads use local disk
  upload,
  productUpload,
  uploadToCloudinary, // name kept for legacy requires; LOCAL only (no Cloudinary API)
  uploadMultipleToCloudinary,
  deleteFromCloudinary,
  getCloudinaryDetails,
  DISABLED: true,
};
