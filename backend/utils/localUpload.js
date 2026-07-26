/**
 * Local disk upload helpers for HostingRaja / self-hosted deployments.
 * Product images are stored under uploads/products; only relative paths go in PostgreSQL.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const DEFAULT_SUBDIRS = [
  'profile',
  'products',
  'videos',
  'banners',
  'testimonials',
  'gallery',
  'documents',
];

function resolveUploadsRoot() {
  const configured = (process.env.UPLOADS_DIR || 'uploads').trim();
  if (path.isAbsolute(configured)) return configured;
  return path.join(__dirname, '..', configured);
}

const UPLOADS_ROOT = resolveUploadsRoot();

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error('[localUpload] Failed to create directory:', dir, err.message);
  }
}

function ensureUploadTree() {
  ensureDir(UPLOADS_ROOT);
  DEFAULT_SUBDIRS.forEach((subdir) => ensureDir(path.join(UPLOADS_ROOT, subdir)));
}

ensureUploadTree();

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'video/mp4',
  'video/mpeg',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
  'video/ogg',
]);

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/mpeg': '.mpeg',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'video/webm': '.webm',
  'video/ogg': '.ogg',
};

function sanitizeExt(originalname, mimetype) {
  const ext = path.extname(originalname || '').toLowerCase();
  if (ext && /^\.(jpe?g|png|gif|webp|avif|mp4|webm|mov|mpeg|ogg|avi)$/i.test(ext)) {
    return ext === '.jpeg' ? '.jpg' : ext;
  }
  return EXT_BY_MIME[mimetype] || '.bin';
}

function makeFilename(prefix, originalname, mimetype) {
  const id = crypto.randomBytes(12).toString('hex');
  return `${prefix}-${Date.now()}-${id}${sanitizeExt(originalname, mimetype)}`;
}

/**
 * Multer instance that writes files under uploads/<folderKey>/
 * @param {string} folderKey e.g. 'products'
 * @param {{ maxSizeMb?: number }} options
 */
function createUploader(folderKey, options = {}) {
  const maxSizeMb = Number(options.maxSizeMb) || 10;
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dest = path.join(UPLOADS_ROOT, folderKey);
      ensureDir(dest);
      cb(null, dest);
    },
    filename: (req, file, cb) => {
      cb(null, makeFilename(folderKey, file.originalname, file.mimetype));
    },
  });

  return multer({
    storage,
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_MIME.has(file.mimetype)) {
        return cb(new Error(`File type not allowed: ${file.mimetype}`), false);
      }
      cb(null, true);
    },
  });
}

/** Relative web path stored in PostgreSQL, e.g. /uploads/products/xxx.jpg */
function toPublicPath(folderKey, filename) {
  return `/uploads/${folderKey}/${filename}`;
}

/**
 * Normalize any absolute/relative upload URL to a DB-safe relative path when local.
 * Leaves external URLs (e.g. legacy Cloudinary) unchanged.
 */
function toStoredMediaPath(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  // Already relative local path
  if (trimmed.startsWith('/uploads/')) {
    return trimmed.split('?')[0].split('#')[0];
  }

  // Absolute URL that points at our /uploads/
  try {
    const parsed = trimmed.includes('://')
      ? new URL(trimmed)
      : new URL(trimmed, 'http://localhost');
    if (parsed.pathname.startsWith('/uploads/')) {
      return parsed.pathname;
    }
  } catch {
    // fall through
  }

  // Legacy Cloudinary / other CDN — keep full URL
  return trimmed;
}

/**
 * Build a browser-accessible URL for a stored path.
 * Prefer BACKEND_PUBLIC_URL on HostingRaja so clients on another origin can load images.
 */
function toPublicUrl(storedPath, req) {
  if (!storedPath || typeof storedPath !== 'string') return '';
  const value = storedPath.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) {
    return value;
  }

  const relative = value.startsWith('/') ? value : `/${value}`;
  const envBase = (process.env.BACKEND_PUBLIC_URL || '').replace(/\/+$/, '');
  if (envBase) return `${envBase}${relative}`;

  if (req) {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
    if (host) return `${proto}://${host}${relative}`;
  }

  return relative;
}

function isLocalUploadPath(value) {
  if (!value || typeof value !== 'string') return false;
  if (value.startsWith('/uploads/')) return true;
  try {
    const parsed = value.includes('://') ? new URL(value) : null;
    return !!(parsed && parsed.pathname.startsWith('/uploads/'));
  } catch {
    return false;
  }
}

/**
 * Resolve absolute filesystem path for a stored /uploads/... path.
 * Returns null if path is outside the uploads root (path traversal guard).
 */
function resolveLocalAbsolutePath(storedPathOrUrl) {
  if (!isLocalUploadPath(storedPathOrUrl)) return null;

  let pathname = storedPathOrUrl;
  try {
    if (storedPathOrUrl.includes('://')) {
      pathname = new URL(storedPathOrUrl).pathname;
    }
  } catch {
    return null;
  }

  pathname = pathname.split('?')[0].split('#')[0];
  if (!pathname.startsWith('/uploads/')) return null;

  const relativeInside = pathname.replace(/^\/uploads\/?/, '');
  if (!relativeInside || relativeInside.includes('..')) return null;

  const absolute = path.resolve(UPLOADS_ROOT, relativeInside);
  const rootResolved = path.resolve(UPLOADS_ROOT);
  if (absolute !== rootResolved && !absolute.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return absolute;
}

/**
 * Delete a local upload file if it lives under uploads/.
 * No-op for Cloudinary/external URLs. Never throws.
 */
function deleteLocalFile(storedPathOrUrl) {
  try {
    const abs = resolveLocalAbsolutePath(storedPathOrUrl);
    if (!abs) return false;
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
      console.log('[localUpload] Deleted file:', abs);
      return true;
    }
  } catch (err) {
    console.warn('[localUpload] deleteLocalFile failed:', err.message);
  }
  return false;
}

function deleteLocalFiles(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  let count = 0;
  list.forEach((p) => {
    if (deleteLocalFile(p)) count += 1;
  });
  return count;
}

/**
 * Collect product image paths from a product record.
 */
function collectProductImagePaths(product) {
  if (!product) return [];
  const set = new Set();
  if (product.image) set.add(String(product.image));
  if (Array.isArray(product.images)) {
    product.images.forEach((img) => {
      if (img) set.add(String(img));
    });
  }
  return Array.from(set);
}

/**
 * Delete local files that were removed when product images changed.
 */
function cleanupRemovedProductImages(previousProduct, nextImages) {
  const oldPaths = collectProductImagePaths(previousProduct);
  const nextSet = new Set(
    (Array.isArray(nextImages) ? nextImages : [])
      .map((p) => toStoredMediaPath(p))
      .filter(Boolean)
  );

  oldPaths.forEach((oldPath) => {
    const stored = toStoredMediaPath(oldPath);
    if (stored && isLocalUploadPath(stored) && !nextSet.has(stored)) {
      deleteLocalFile(stored);
    }
  });
}

/**
 * Delete all local product image files for a product being removed.
 */
function cleanupAllProductImages(product) {
  collectProductImagePaths(product).forEach((p) => {
    if (isLocalUploadPath(p)) deleteLocalFile(p);
  });
}

function fileToUploadResult(file, folderKey, req) {
  const relativePath = toPublicPath(folderKey, file.filename);
  return {
    url: toPublicUrl(relativePath, req),
    path: relativePath,
    publicId: relativePath,
    fileName: file.originalname,
    size: file.size,
    format: path.extname(file.filename).replace('.', '') || undefined,
    mimetype: file.mimetype,
  };
}

module.exports = {
  UPLOADS_ROOT,
  ensureUploadTree,
  createUploader,
  toPublicPath,
  toStoredMediaPath,
  toPublicUrl,
  isLocalUploadPath,
  deleteLocalFile,
  deleteLocalFiles,
  collectProductImagePaths,
  cleanupRemovedProductImages,
  cleanupAllProductImages,
  fileToUploadResult,
};
