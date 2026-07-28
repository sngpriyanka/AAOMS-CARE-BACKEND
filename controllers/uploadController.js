/**
 * Upload Controller — ACTIVE: local Multer disk (req.file / req.files).
 * PostgreSQL stores data.path (relative /uploads/<folder>/<filename>).
 *
 * Cloudinary upload/delete helpers are COMMENTED OUT (not deleted).
 * Original pattern (for re-enable):
 *   // const { uploadToCloudinary, uploadMultipleToCloudinary, deleteFromCloudinary } =
 *   //   require('../utils/cloudinaryConfig');
 *   // const result = await uploadToCloudinary(req.file.buffer, name, 'aaxoms/products', 'image');
 *   // data: { url: result.secure_url, publicId: result.public_id }
 * Full Cloudinary source remains in utils/cloudinaryConfig.js as comments.
 */

const fs = require('fs');
const path = require('path');
// ACTIVE local helpers
const {
  fileToUploadResult,
  deleteLocalFile,
  isLocalUploadPath,
  normalizeFolderKey,
  ensureUploadTree,
  DEFAULT_SUBDIRS,
  getUploadsRoot,
} = require('../utils/localUpload');
// COMMENTED: Cloudinary helpers (do not delete — re-enable in cloudinaryConfig.js)
// const {
//   uploadToCloudinary,
//   uploadMultipleToCloudinary,
//   deleteFromCloudinary,
// } = require('../utils/cloudinaryConfig');

/**
 * GET /api/upload/status
 * Diagnostics: which disk folder Node is using, writable?, file counts.
 * Helps HostingRaja debug empty ~/aaoms-data/uploads folders.
 */
const getUploadStatus = async (req, res) => {
  try {
    const root = ensureUploadTree();
    const subdirs = {};
    let writable = false;
    let writeError = null;

    DEFAULT_SUBDIRS.forEach((name) => {
      const dir = path.join(root, name);
      let count = 0;
      try {
        count = fs
          .readdirSync(dir)
          .filter((f) => f !== '.gitkeep' && f !== '.write-test').length;
      } catch (_) {
        count = -1;
      }
      subdirs[name] = { path: dir, fileCount: count };
    });

    try {
      const test = path.join(root, 'products', `.write-test-${Date.now()}`);
      fs.writeFileSync(test, 'ok');
      fs.unlinkSync(test);
      writable = true;
    } catch (e) {
      writeError = e.message;
    }

    return res.json({
      success: true,
      cloudinary: false,
      message:
        'Local disk uploads only. Product images must appear under uploads/products.',
      env: {
        UPLOADS_DIR: process.env.UPLOADS_DIR || null,
        BACKEND_PUBLIC_URL: process.env.BACKEND_PUBLIC_URL || null,
        NODE_ENV: process.env.NODE_ENV || null,
        HOME: process.env.HOME || null,
      },
      uploadsRoot: root,
      resolvedVia: getUploadsRoot(),
      writable,
      writeError,
      subdirs,
      hint:
        !process.env.UPLOADS_DIR
          ? 'UPLOADS_DIR is NOT set — files go to backend/uploads (not ~/aaoms-data/uploads). Set UPLOADS_DIR to the absolute path and restart PM2 with --update-env.'
          : writable
            ? 'Config looks OK. Upload a product image, then re-check subdirs.products.fileCount.'
            : 'Cannot write to uploads root — fix permissions or free disk space.',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Upload status check failed',
      error: error.message,
    });
  }
};

function singleFileResponse(req, res, folder, message) {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file provided',
    });
  }

  const data = fileToUploadResult(req.file, folder, req);
  return res.json({
    success: true,
    message,
    data: {
      url: data.url,
      path: data.path,
      publicId: data.publicId,
      fileName: data.fileName,
      size: data.size,
      format: data.format,
      folder: data.folder,
      mimetype: data.mimetype,
    },
  });
}

function multiFileResponse(req, res, folder, message, imagesOnly = false) {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No files provided',
    });
  }

  const accepted = [];
  for (const file of req.files) {
    if (imagesOnly && !String(file.mimetype || '').startsWith('image/')) {
      deleteLocalFile(
        `/uploads/${normalizeFolderKey(folder)}/${file.filename}`
      );
      continue;
    }
    accepted.push(fileToUploadResult(file, folder, req));
  }

  if (accepted.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No valid files provided',
    });
  }

  return res.json({
    success: true,
    message,
    data: accepted.map((result) => ({
      url: result.url,
      path: result.path,
      publicId: result.publicId,
      size: result.size,
      format: result.format,
      fileName: result.fileName,
      folder: result.folder,
    })),
  });
}

// ==================== PRODUCT IMAGES (local HostingRaja disk) ====================
// Files: UPLOADS_DIR/products/<filename>
// API returns path=/uploads/products/...  → store path in PostgreSQL only
/**
 * POST /api/upload/product-image
 * Multer diskStorage already wrote req.file to UPLOADS_DIR/products/
 * NEVER calls Cloudinary (uploadToCloudinary / upload_stream commented out).
 *
 * // CLOUDINARY (commented — do not delete):
 * // const result = await uploadToCloudinary(req.file.buffer, name, 'aaxoms/products', 'image');
 * // return { url: result.secure_url, publicId: result.public_id };
 */
const uploadProductImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided',
      });
    }
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      deleteLocalFile(`/uploads/products/${req.file.filename}`);
      return res.status(400).json({
        success: false,
        message: 'Only image files are allowed for product images',
      });
    }

    // req.file.path is absolute disk path from Multer; store relative web path only
    const data = fileToUploadResult(req.file, 'products', req);
    const relativeUrl = data.path; // /uploads/products/<filename>
    console.log(
      `[upload] Product image LOCAL only → disk: ${data.diskPath} | DB path: ${relativeUrl}`
    );

    const imageEntry = {
      url: relativeUrl,
      filename: req.file.filename,
      path: relativeUrl,
      publicId: relativeUrl,
      fileName: data.fileName,
      size: data.size,
      format: data.format,
      folder: 'products',
    };

    return res.json({
      success: true,
      message: 'Product image uploaded successfully',
      // Spec shape
      images: [imageEntry],
      // Frontend / ManageProducts expects data.path || data.url (single or array)
      data: imageEntry,
    });
  } catch (error) {
    console.error('Error uploading product image:', error);
    return res.status(500).json({
      success: false,
      message: 'Error uploading image',
      error: error.message,
    });
  }
};

/**
 * POST /api/upload/product-images  (field: files[])
 * Local Multer only — no Cloudinary API keys required.
 */
const uploadProductImages = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files provided',
      });
    }

    const accepted = [];
    for (const file of req.files) {
      if (!String(file.mimetype || '').startsWith('image/')) {
        deleteLocalFile(`/uploads/products/${file.filename}`);
        continue;
      }
      const data = fileToUploadResult(file, 'products', req);
      const relativeUrl = data.path; // /uploads/products/<filename>
      console.log(
        `[upload] Product image LOCAL only → disk: ${data.diskPath} | DB path: ${relativeUrl}`
      );
      accepted.push({
        url: relativeUrl,
        filename: file.filename,
        path: relativeUrl,
        publicId: relativeUrl,
        size: data.size,
        format: data.format,
        fileName: data.fileName,
        folder: 'products',
      });
    }

    if (accepted.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid image files provided',
      });
    }

    return res.json({
      success: true,
      message: 'Product images uploaded successfully',
      // Spec: { success, images: [{ url, filename }] }
      images: accepted.map((a) => ({
        url: a.url,
        filename: a.filename,
      })),
      // Frontend ManageProducts: (response.data.data || []).map(item => item.path || item.url)
      data: accepted,
    });
  } catch (error) {
    console.error('Error uploading product images:', error);
    return res.status(500).json({
      success: false,
      message: 'Error uploading images',
      error: error.message,
    });
  }
};

// ==================== CATEGORY IMAGES ====================
// Files: UPLOADS_DIR/categories/<filename>
// API returns path=/uploads/categories/... → store path in PostgreSQL
const uploadCategoryImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided',
      });
    }
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      deleteLocalFile(`/uploads/categories/${req.file.filename}`);
      return res.status(400).json({
        success: false,
        message: 'Only image files are allowed for category images',
      });
    }

    const data = fileToUploadResult(req.file, 'categories', req);
    console.log(
      `[upload] Category image saved → disk: ${data.diskPath} | path(for DB): ${data.path}`
    );

    return res.json({
      success: true,
      message: 'Category image uploaded successfully',
      data: {
        path: data.path,
        url: data.url,
        publicId: data.path,
        fileName: data.fileName,
        size: data.size,
        format: data.format,
        folder: 'categories',
      },
    });
  } catch (error) {
    console.error('Error uploading category image:', error);
    return res.status(500).json({
      success: false,
      message: 'Error uploading category image',
      error: error.message,
    });
  }
};

// ==================== PROFILE PICTURE ====================
const uploadProfilePicture = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;
    if (!userId) {
      if (req.file) {
        deleteLocalFile(`/uploads/profile/${req.file.filename}`);
      }
      return res.status(400).json({
        success: false,
        message: 'User ID required',
      });
    }
    if (req.file && !String(req.file.mimetype || '').startsWith('image/')) {
      deleteLocalFile(`/uploads/profile/${req.file.filename}`);
      return res.status(400).json({
        success: false,
        message: 'Only image files are allowed for profile pictures',
      });
    }
    return singleFileResponse(
      req,
      res,
      'profile',
      'Profile picture uploaded successfully'
    );
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    return res.status(500).json({
      success: false,
      message: 'Error uploading profile picture',
      error: error.message,
    });
  }
};

// ==================== PRODUCT VIDEO ====================
const uploadProductVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided',
      });
    }
    if (!String(req.file.mimetype || '').startsWith('video/')) {
      deleteLocalFile(`/uploads/videos/${req.file.filename}`);
      return res.status(400).json({
        success: false,
        message: 'Only video files are allowed',
      });
    }
    const data = fileToUploadResult(req.file, 'videos', req);
    return res.json({
      success: true,
      message: 'Product video uploaded successfully',
      data: {
        url: data.url,
        path: data.path,
        publicId: data.publicId,
        fileName: data.fileName,
        size: data.size,
        format: data.format,
        folder: data.folder,
      },
    });
  } catch (error) {
    console.error('Error uploading product video:', error);
    return res.status(500).json({
      success: false,
      message: 'Error uploading video',
      error: error.message,
    });
  }
};

// ==================== BANNER ====================
const uploadBanner = async (req, res) => {
  try {
    if (req.file && !String(req.file.mimetype || '').startsWith('image/')) {
      deleteLocalFile(`/uploads/banners/${req.file.filename}`);
      return res.status(400).json({
        success: false,
        message: 'Only image files are allowed for banners',
      });
    }
    return singleFileResponse(req, res, 'banners', 'Banner uploaded successfully');
  } catch (error) {
    console.error('Error uploading banner:', error);
    return res.status(500).json({
      success: false,
      message: 'Error uploading banner',
      error: error.message,
    });
  }
};

const uploadBanners = async (req, res) => {
  try {
    return multiFileResponse(
      req,
      res,
      'banners',
      'Banner images uploaded successfully',
      true
    );
  } catch (error) {
    console.error('Error uploading banner images:', error);
    return res.status(500).json({
      success: false,
      message: 'Error uploading banner images',
      error: error.message,
    });
  }
};

// ==================== TESTIMONIAL ====================
const uploadTestimonialImage = async (req, res) => {
  try {
    if (req.file && !String(req.file.mimetype || '').startsWith('image/')) {
      deleteLocalFile(`/uploads/testimonials/${req.file.filename}`);
      return res.status(400).json({
        success: false,
        message: 'Only image files are allowed for testimonials',
      });
    }
    return singleFileResponse(
      req,
      res,
      'testimonials',
      'Testimonial image uploaded successfully'
    );
  } catch (error) {
    console.error('Error uploading testimonial image:', error);
    return res.status(500).json({
      success: false,
      message: 'Error uploading testimonial image',
      error: error.message,
    });
  }
};

// ==================== GENERIC FILE (gallery / documents) ====================
/**
 * POST /api/upload/file
 * Images → gallery, videos → videos, pdf → documents
 * Optional body.folder ignored for destination reliability with multipart;
 * use dedicated endpoints when possible.
 */
const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided',
      });
    }

    let folder = 'gallery';
    if (String(req.file.mimetype || '').startsWith('video/')) {
      folder = 'videos';
    } else if (req.file.mimetype === 'application/pdf') {
      folder = 'documents';
    } else if (String(req.file.mimetype || '').startsWith('image/')) {
      folder = 'gallery';
    }

    // File was already written by multer into the route's configured folder
    // (gallery by default). Report the folder that was actually used.
    const usedFolder =
      req.localUploadFolder || req.uploadFolder || folder;

    const data = fileToUploadResult(req.file, usedFolder, req);
    return res.json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        url: data.url,
        path: data.path,
        publicId: data.publicId,
        fileName: data.fileName,
        resourceType: String(req.file.mimetype || '').startsWith('video/')
          ? 'video'
          : 'image',
        size: data.size,
        format: data.format,
        folder: data.folder,
      },
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    return res.status(500).json({
      success: false,
      message: 'Error uploading file',
      error: error.message,
    });
  }
};

// ==================== DELETE FILE (local only) ====================
const deleteFile = async (req, res) => {
  try {
    const raw =
      req.body?.path ||
      req.query?.path ||
      (req.params.publicId ? decodeURIComponent(req.params.publicId) : '');

    if (!raw) {
      return res.status(400).json({
        success: false,
        message: 'File path required',
      });
    }

    const pathValue = raw.startsWith('uploads/') ? `/${raw}` : raw;

    // --- Cloudinary delete (COMMENTED OUT — do not remove) ---
    // const result = await deleteFromCloudinary(publicId);
    // return res.json({ success: true, message: 'File deleted successfully', data: result });

    // --- Local disk delete (ACTIVE) ---
    if (!isLocalUploadPath(pathValue) && !pathValue.startsWith('/uploads/')) {
      // Legacy Cloudinary public_id or external URL — nothing on disk
      return res.json({
        success: true,
        message:
          'Not a local upload path; nothing deleted on server (legacy/external URL). Cloudinary delete is commented out.',
        data: { path: pathValue, deleted: false, skipped: true },
      });
    }

    // fs.unlinkSync under the hood (path-safe) via deleteLocalFile
    const deleted = deleteLocalFile(pathValue);
    return res.json({
      success: true,
      message: deleted
        ? 'Local file deleted successfully'
        : 'File not found (already removed)',
      data: { path: pathValue, deleted },
    });
  } catch (error) {
    console.error('Error deleting file:', error);
    return res.status(500).json({
      success: false,
      message: 'Error deleting file',
      error: error.message,
    });
  }
};

module.exports = {
  getUploadStatus,
  uploadProductImage,
  uploadProductImages,
  uploadCategoryImage,
  uploadProfilePicture,
  uploadProductVideo,
  uploadBanner,
  uploadBanners,
  uploadTestimonialImage,
  uploadFile,
  deleteFile,
};
