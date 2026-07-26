/**
 * Local disk upload helpers (Multer) for HostingRaja / self-hosted deployments.
 *
 * HostingRaja production:
 *   UPLOADS_DIR=~/aaoms-data/uploads
 *   → ~/aaoms-data/uploads/{profile,products,videos,banners,testimonials,gallery,documents}
 *
 * Local development:
 *   UPLOADS_DIR=uploads  (relative to backend/)
 *
 * PostgreSQL stores ONLY relative web paths: /uploads/<folder>/<filename>
 * Express serves them at GET /uploads/...
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
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

const ALLOWED_FOLDERS = new Set(DEFAULT_SUBDIRS);

/** Expand ~ and $HOME for HostingRaja paths like ~/aaoms-data/uploads */
function expandHome(input) {
  const value = String(input || '').trim();
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  if (value.startsWith('$HOME/') || value.startsWith('$HOME\\')) {
    return path.join(os.homedir(), value.slice(6));
  }
  return value;
}

/**
 * Resolve uploads root from env (read each time so dotenv can load first).
 * Default: backend/uploads (local dev).
 */
function resolveUploadsRoot() {
  const raw = (process.env.UPLOADS_DIR || 'uploads').trim();
  const configured = expandHome(raw);
  if (!configured) {
    return path.join(__dirname, '..', 'uploads');
  }
  if (path.isAbsolute(configured)) {
    return path.normalize(configured);
  }
  return path.normalize(path.join(__dirname, '..', configured));
}

function getUploadsRoot() {
  return resolveUploadsRoot();
}

// Cached after first successful ensure (recomputed if env changes mid-process)
let _uploadsRootCached = null;

function UPLOADS_ROOT_GET() {
  if (!_uploadsRootCached) {
    _uploadsRootCached = resolveUploadsRoot();
  }
  return _uploadsRootCached;
}

// For backward-compatible export (getter-like via defineProperty below)
function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error('[localUpload] Failed to create directory:', dir, err.message);
    throw err;
  }
}

/**
 * Create the full upload tree (profile, products, videos, …).
 * Safe to call multiple times.
 */
function ensureUploadTree() {
  const root = resolveUploadsRoot();
  _uploadsRootCached = root;
  ensureDir(root);
  DEFAULT_SUBDIRS.forEach((subdir) => {
    ensureDir(path.join(root, subdir));
  });
  return root;
}

// Create dirs as soon as this module loads (after dotenv in server.js)
try {
  ensureUploadTree();
} catch (e) {
  console.warn('[localUpload] Initial ensureUploadTree warning:', e.message);
}

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
  'application/pdf',
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
  'application/pdf': '.pdf',
};

function sanitizeExt(originalname, mimetype) {
  const ext = path.extname(originalname || '').toLowerCase();
  if (ext && /^\.(jpe?g|png|gif|webp|avif|mp4|webm|mov|mpeg|ogg|avi|pdf)$/i.test(ext)) {
    return ext === '.jpeg' ? '.jpg' : ext;
  }
  return EXT_BY_MIME[mimetype] || '.bin';
}

function makeFilename(prefix, originalname, mimetype) {
  const id = crypto.randomBytes(12).toString('hex');
  return `${prefix}-${Date.now()}-${id}${sanitizeExt(originalname, mimetype)}`;
}

function normalizeFolderKey(folderKey) {
  const key = String(folderKey || 'gallery')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  if (ALLOWED_FOLDERS.has(key)) return key;
  if (key === 'profiles' || key === 'avatar') return 'profile';
  if (key === 'product' || key === 'product-images') return 'products';
  if (key === 'video') return 'videos';
  if (key === 'banner') return 'banners';
  if (key === 'testimonial') return 'testimonials';
  if (key === 'document' || key === 'docs' || key === 'files') return 'documents';
  return 'gallery';
}

/**
 * Multer disk storage → UPLOADS_DIR/<folderKey>/
 * @param {string} folderKey e.g. 'products'
 * @param {{ maxSizeMb?: number, imagesOnly?: boolean, videosOnly?: boolean }} options
 */
function createUploader(folderKey, options = {}) {
  const maxSizeMb = Number(options.maxSizeMb) || 10;
  const defaultFolder = normalizeFolderKey(folderKey);

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const destKey = normalizeFolderKey(req.uploadFolder || defaultFolder);
        const root = ensureUploadTree();
        const dest = path.join(root, destKey);
        ensureDir(dest);
        req.localUploadFolder = destKey;
        cb(null, dest);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const destKey = normalizeFolderKey(req.uploadFolder || defaultFolder);
      cb(null, makeFilename(destKey, file.originalname, file.mimetype));
    },
  });

  return multer({
    storage,
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_MIME.has(file.mimetype)) {
        return cb(new Error(`File type not allowed: ${file.mimetype}`), false);
      }
      if (options.imagesOnly && !String(file.mimetype).startsWith('image/')) {
        return cb(new Error('Only image files are allowed'), false);
      }
      if (options.videosOnly && !String(file.mimetype).startsWith('video/')) {
        return cb(new Error('Only video files are allowed'), false);
      }
      cb(null, true);
    },
  });
}

/** Middleware: force upload subfolder for next multer handler */
function setUploadFolder(folderKey) {
  return (req, res, next) => {
    req.uploadFolder = normalizeFolderKey(folderKey);
    next();
  };
}

/** Relative web path for PostgreSQL, e.g. /uploads/products/xxx.jpg */
function toPublicPath(folderKey, filename) {
  return `/uploads/${normalizeFolderKey(folderKey)}/${filename}`;
}

/**
 * Normalize upload URL/path to a DB-safe relative path for local files.
 * Leaves external/legacy Cloudinary URLs unchanged (display only).
 */
function toStoredMediaPath(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    value = value.path || value.url || '';
  }
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('/uploads/')) {
    return trimmed.split('?')[0].split('#')[0];
  }

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

  return trimmed;
}

/**
 * Browser-accessible URL for a stored path.
 * Uses BACKEND_PUBLIC_URL on HostingRaja when set.
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
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http')
      .split(',')[0]
      .trim();
    const host = (req.headers['x-forwarded-host'] || req.get('host') || '')
      .split(',')[0]
      .trim();
    if (host) return `${proto}://${host}${relative}`;
  }

  return relative;
}

function expandMediaValue(value, req) {
  if (!value) return value;
  return toPublicUrl(toStoredMediaPath(value) || value, req);
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

  const root = UPLOADS_ROOT_GET();
  const absolute = path.resolve(root, relativeInside);
  const rootResolved = path.resolve(root);
  if (absolute !== rootResolved && !absolute.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return absolute;
}

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

function collectPathsFromFields(record, fields = []) {
  if (!record) return [];
  const set = new Set();
  fields.forEach((field) => {
    const val = record[field];
    if (!val) return;
    if (Array.isArray(val)) {
      val.forEach((item) => {
        if (!item) return;
        if (typeof item === 'string') set.add(item);
        else if (item.url || item.path) set.add(String(item.path || item.url));
      });
    } else if (typeof val === 'string') {
      set.add(val);
    }
  });
  return Array.from(set);
}

function collectProductImagePaths(product) {
  return collectPathsFromFields(product, ['image', 'images']);
}

function cleanupRemovedMedia(previousPaths, nextPaths) {
  const nextSet = new Set(
    (Array.isArray(nextPaths) ? nextPaths : [])
      .map((p) => toStoredMediaPath(p))
      .filter(Boolean)
  );

  (Array.isArray(previousPaths) ? previousPaths : []).forEach((oldPath) => {
    const stored = toStoredMediaPath(oldPath);
    if (stored && isLocalUploadPath(stored) && !nextSet.has(stored)) {
      deleteLocalFile(stored);
    }
  });
}

function cleanupRemovedProductImages(previousProduct, nextImages) {
  cleanupRemovedMedia(collectProductImagePaths(previousProduct), nextImages);
}

function cleanupAllProductImages(product) {
  collectProductImagePaths(product).forEach((p) => {
    if (isLocalUploadPath(p)) deleteLocalFile(p);
  });
}

function fileToUploadResult(file, folderKey, req) {
  const key = normalizeFolderKey(
    folderKey || req.localUploadFolder || req.uploadFolder || 'gallery'
  );
  const relativePath = toPublicPath(key, file.filename);
  return {
    // Absolute (when BACKEND_PUBLIC_URL / host known) for immediate <img src>
    url: toPublicUrl(relativePath, req),
    // Relative path — store THIS in PostgreSQL
    path: relativePath,
    publicId: relativePath,
    fileName: file.originalname,
    size: file.size,
    format: path.extname(file.filename).replace('.', '') || undefined,
    mimetype: file.mimetype,
    folder: key,
    // Absolute disk path (debug / ops only — never store in DB)
    diskPath: file.path || path.join(UPLOADS_ROOT_GET(), key, file.filename),
  };
}

// Export UPLOADS_ROOT as live getter so server.js logs the real path
const api = {
  get UPLOADS_ROOT() {
    return UPLOADS_ROOT_GET();
  },
  DEFAULT_SUBDIRS,
  ensureUploadTree,
  getUploadsRoot,
  createUploader,
  setUploadFolder,
  normalizeFolderKey,
  toPublicPath,
  toStoredMediaPath,
  toPublicUrl,
  expandMediaValue,
  isLocalUploadPath,
  deleteLocalFile,
  deleteLocalFiles,
  collectPathsFromFields,
  collectProductImagePaths,
  cleanupRemovedMedia,
  cleanupRemovedProductImages,
  cleanupAllProductImages,
  fileToUploadResult,
};

module.exports = api;
