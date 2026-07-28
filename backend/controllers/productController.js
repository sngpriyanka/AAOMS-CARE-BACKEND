
const Database = require('../models/DatabaseAdapter');
const { validateProductData } = require('../utils/validators');
const { cascadeProductDeletion } = require('../utils/productCascade');
const { getMatchingCategories } = require('../utils/categories');
const {
  toStoredMediaPath,
  toPublicUrl,
  cleanupAllProductImages,
  cleanupRemovedMedia,
  collectProductImagePaths,
} = require('../utils/localUpload');
const {
  normalizeVariants,
  variantsToLegacyColors,
  collectVariantImagePaths,
  productHasColor,
} = require('../utils/productVariants');
const { v4: uuidv4 } = require('uuid');
const PRODUCTS_COLLECTION = 'products';

const isProductActive = (product) => product && product.isActive !== false;

/** Expand relative /uploads paths to full URLs for API clients (HostingRaja + local). */
const expandProductMedia = (product, req) => {
  if (!product) return product;
  const expand = (value) => {
    if (!value) return value;
    return toPublicUrl(toStoredMediaPath(value) || value, req);
  };
  const images = Array.isArray(product.images)
    ? product.images.map(expand).filter(Boolean)
    : [];
  const image = expand(product.image) || images[0] || '';

  const variants = Array.isArray(product.variants)
    ? product.variants.map((v) => {
        if (!v || typeof v !== 'object') return v;
        const vImages = Array.isArray(v.images)
          ? v.images.map(expand).filter(Boolean)
          : [];
        return { ...v, images: vImages };
      })
    : [];

  // Ensure colors mirror active variants for older clients
  const colors =
    variants.length > 0
      ? variantsToLegacyColors(variants)
      : Array.isArray(product.colors)
        ? product.colors
        : [];

  return {
    ...product,
    image,
    images: images.length ? images : (image ? [image] : []),
    variants,
    colors,
  };
};

const expandProductsMedia = (products, req) =>
  (Array.isArray(products) ? products : []).map((p) => expandProductMedia(p, req));


const resolveProduct = async (identifier) => {
  const key = String(identifier || '').trim();
  if (!key) return null;

  let product = await Database.read(PRODUCTS_COLLECTION, key);
  if (!product) {
    product = await Database.findBy(PRODUCTS_COLLECTION, 'slug', key);
  }

  return isProductActive(product) ? product : null;
};

const buildProductSlug = (body, existingProduct = null) => {
  if (typeof body.slug === 'string' && body.slug.trim()) {
    return body.slug.trim();
  }
  if (existingProduct?.slug) {
    return existingProduct.slug;
  }
  const base = String(body.name || existingProduct?.name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${base}-${uuidv4().slice(0, 4)}`;
};

const normalizeProductPayload = (body, existingProduct = null) => {
  const rawImages = Array.isArray(body.images) && body.images.length
    ? body.images
    : (body.image ? [body.image] : []);

  // Store only relative /uploads/... paths in PostgreSQL (never Cloudinary, never binary)
  const images = rawImages
    .map((img) => {
      if (img && typeof img === 'object') {
        return toStoredMediaPath(img.path || img.url || '');
      }
      return toStoredMediaPath(img);
    })
    .filter(Boolean);
  const primaryRaw =
    (body.image && typeof body.image === 'object'
      ? body.image.path || body.image.url
      : body.image) || images[0] || '';
  const image = toStoredMediaPath(primaryRaw) || images[0] || '';

  const description = typeof body.description === 'string'
    ? { tagline: body.description, details: body.description }
    : (body.description || {});

  const finalImages = images.length ? images : (image ? [image] : []);
  const variants = normalizeVariants(body, existingProduct, finalImages);

  // Prefer first active variant images as product gallery when product-level images empty
  const firstActiveWithImages = variants.find(
    (v) => v.active !== false && Array.isArray(v.images) && v.images.length
  );
  const primaryImages =
    finalImages.length > 0
      ? finalImages
      : firstActiveWithImages
        ? firstActiveWithImages.images
        : [];
  const primaryImage = image || primaryImages[0] || '';

  // Explicitly build clean payload - do NOT spread ...body as it can bring UI-only fields
  // like 'status', 'sales', 'createdAt' (from frontend forms) which don't exist as DB columns
  // and cause Postgres INSERT 500 errors on create/update.
  return {
    name: body.name,
    slug: buildProductSlug(body, existingProduct),
    price: Number(body.price),
    originalPrice:
      body.originalPrice !== undefined
        ? body.originalPrice
          ? Number(body.originalPrice)
          : null
        : existingProduct?.originalPrice != null
          ? Number(existingProduct.originalPrice)
          : null,
    description,
    subDescription: body.subDescription || '',
    productInformation: body.productInformation || '',
    category: typeof body.category === 'string' ? body.category.trim() : '',
    image: primaryImage,
    images: primaryImages.length ? primaryImages : (primaryImage ? [primaryImage] : []),
    sizes: Array.isArray(body.sizes) ? body.sizes : String(body.sizes || '').split(',').map(s => s.trim()).filter(Boolean),
    colors: variants.length
      ? variantsToLegacyColors(variants)
      : (Array.isArray(body.colors)
          ? body.colors
          : String(body.colors || '').split(',').map(c => c.trim()).filter(Boolean)),
    variants,
    sizeChart: body.sizeChart
      ? (typeof body.sizeChart === 'string' ? (() => { try { return JSON.parse(body.sizeChart); } catch { return null; } })() : body.sizeChart)
      : null,
    quickDry:
      body.quickDry !== undefined
        ? !!body.quickDry
        : !!existingProduct?.quickDry,
    isActive:
      body.isActive !== undefined
        ? body.isActive
        : existingProduct
          ? existingProduct.isActive !== false
          : true,
  };
};

const filterProductsInMemory = (products, { category, minPrice, maxPrice, search, excludeId, view, color }) => {
  let next = view === 'admin' ? products : products.filter(p => p.isActive !== false);

  if (category) {
    const allowed = getMatchingCategories(category);
    next = next.filter(p => allowed.includes(p.category));
  }

  if (minPrice || maxPrice) {
    next = next.filter(p => {
      const price = parseFloat(p.price);
      if (minPrice && price < parseFloat(minPrice)) return false;
      if (maxPrice && price > parseFloat(maxPrice)) return false;
      return true;
    });
  }

  if (search) {
    const searchLower = search.toLowerCase();
    next = next.filter(p =>
      p.name.toLowerCase().includes(searchLower) ||
      (p.description && p.description.tagline && p.description.tagline.toLowerCase().includes(searchLower)) ||
      (Array.isArray(p.variants) && p.variants.some(v => String(v.colorName || '').toLowerCase().includes(searchLower)))
    );
  }

  if (color && color !== 'all') {
    next = next.filter((p) => productHasColor(p, color));
  }

  if (excludeId) {
    next = next.filter(p => (p.id || p._id) !== excludeId);
  }

  return next;
};

exports.getAllProducts = async (req, res) => {
  try {
    const { category, minPrice, maxPrice, search, page = 1, limit = 10, excludeId, view, color } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const colorFilter = color && color !== 'all' ? String(color).trim() : '';

    // When filtering by color, load a wider page then filter in memory (variants JSONB)
    if (colorFilter) {
      let products = await Database.readAll(PRODUCTS_COLLECTION);
      products = filterProductsInMemory(products, {
        category, minPrice, maxPrice, search, excludeId, view, color: colorFilter,
      });
      const skip = (pageNum - 1) * limitNum;
      const paginatedProducts = products.slice(skip, skip + limitNum);
      return res.json({
        success: true,
        data: expandProductsMedia(paginatedProducts, req),
        pagination: {
          total: products.length,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(products.length / limitNum) || 1,
        },
      });
    }

    const pgResult = await Database.readProductsFiltered({
      categories: category ? getMatchingCategories(category) : undefined,
      minPrice,
      maxPrice,
      search,
      excludeId,
      view,
      page: pageNum,
      limit: limitNum,
    });

    if (pgResult) {
      return res.json({
        success: true,
        data: expandProductsMedia(pgResult.items, req),
        pagination: {
          total: pgResult.total,
          page: pgResult.page,
          limit: pgResult.limit,
          pages: Math.ceil(pgResult.total / pgResult.limit) || 1,
        },
      });
    }

    let products = await Database.readAll(PRODUCTS_COLLECTION);
    products = filterProductsInMemory(products, { category, minPrice, maxPrice, search, excludeId, view });

    const skip = (pageNum - 1) * limitNum;
    const paginatedProducts = products.slice(skip, skip + limitNum);

    res.json({
      success: true,
      data: expandProductsMedia(paginatedProducts, req),
      pagination: {
        total: products.length,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(products.length / limitNum)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching products',
      error: error.message
    });
  }
};

const sendResolvedProduct = async (req, res, identifier) => {
  const product = await resolveProduct(identifier);

  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found'
    });
  }

  return res.json({
    success: true,
    data: expandProductMedia(product, req)
  });
};

exports.getProductByIdentifier = async (req, res) => {
  try {
    await sendResolvedProduct(req, res, req.params.identifier);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching product',
      error: error.message
    });
  }
};

exports.getProductById = async (req, res) => {
  try {
    await sendResolvedProduct(req, res, req.params.id);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching product',
      error: error.message
    });
  }
};

exports.getProductBySlug = async (req, res) => {
  try {
    await sendResolvedProduct(req, res, req.params.slug);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching product',
      error: error.message
    });
  }
};

exports.createProduct = async (req, res) => {
  try {
    // Only admin or super admin can create products
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can create products'
      });
    }

    const payload = normalizeProductPayload(req.body);
    const validation = validateProductData(payload);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.message
      });
    }

    // Ensure variants column exists (older DBs / first deploy)
    try {
      const { getPool } = require('../models/postgres');
      const pool = getPool && getPool();
      if (pool) {
        await pool.query(
          `ALTER TABLE products ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT '[]'`
        );
      }
    } catch (migErr) {
      console.warn('variants column ensure warning:', migErr.message);
    }

    const id = uuidv4();
    const newProduct = await Database.create(PRODUCTS_COLLECTION, {
      name: payload.name,
      slug: payload.slug,
      price: payload.price,
      originalPrice: payload.originalPrice,
      description: payload.description,
      subDescription: payload.subDescription,
      productInformation: payload.productInformation,
      category: payload.category,
      image: payload.image,
      images: payload.images,
      sizes: payload.sizes,
      colors: payload.colors,
      variants: Array.isArray(payload.variants) ? payload.variants : [],
      sizeChart: payload.sizeChart,
      quickDry: !!payload.quickDry,
      isActive: payload.isActive !== false,
      id,
      _id: id,
      createdBy: req.user?.id || req.user?._id || null,
      createdAt: new Date().toISOString(),
    });

    if (!newProduct) {
      return res.status(500).json({
        success: false,
        message: 'Error creating product',
        error: 'Database returned empty result',
      });
    }

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: expandProductMedia(newProduct, req)
    });
  } catch (error) {
    console.error('createProduct error:', error.message);
    if (error.stack) console.error(error.stack);
    // Friendlier messages for common Postgres failures
    let message = 'Error creating product';
    if (/variants/i.test(error.message || '')) {
      message =
        'Database missing variants column. Run: node scripts/ensure-variants-column.js then restart the server.';
    } else if (/duplicate key|unique/i.test(error.message || '')) {
      message = 'A product with this slug already exists. Try a different name.';
    } else if (/column .* does not exist/i.test(error.message || '')) {
      message = `Database schema mismatch: ${error.message}`;
    }
    res.status(500).json({
      success: false,
      message,
      error: error.message
    });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can update products'
      });
    }

    const { id } = req.params;
    const existingProduct = await Database.read(PRODUCTS_COLLECTION, id);

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const payload = normalizeProductPayload(req.body, existingProduct);

    // Ensure variants column exists before update
    try {
      const { getPool } = require('../models/postgres');
      const pool = getPool && getPool();
      if (pool) {
        await pool.query(
          `ALTER TABLE products ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT '[]'`
        );
      }
    } catch (migErr) {
      console.warn('variants column ensure warning:', migErr.message);
    }

    const updated = await Database.update(PRODUCTS_COLLECTION, id, {
      name: payload.name,
      slug: payload.slug,
      price: payload.price,
      originalPrice: payload.originalPrice,
      description: payload.description,
      subDescription: payload.subDescription,
      productInformation: payload.productInformation,
      category: payload.category,
      image: payload.image,
      images: payload.images,
      sizes: payload.sizes,
      colors: payload.colors,
      variants: Array.isArray(payload.variants) ? payload.variants : [],
      sizeChart: payload.sizeChart,
      quickDry: !!payload.quickDry,
      isActive: payload.isActive !== false,
      updatedAt: new Date().toISOString(),
    });

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // After successful DB update, remove replaced/dropped local files once (product + variant images)
    try {
      // Unified keep-set so shared paths between product.images and variants are not unlinked
      const nextKeep = [
        ...(Array.isArray(payload.images) ? payload.images : []),
        ...collectVariantImagePaths(payload),
      ]
        .map((p) => toStoredMediaPath(p))
        .filter(Boolean);
      const prevAll = collectProductImagePaths(existingProduct);
      cleanupRemovedMedia(prevAll, nextKeep);
    } catch (cleanupErr) {
      console.warn('Product image cleanup warning:', cleanupErr.message);
    }

    res.json({
      success: true,
      message: 'Product updated successfully',
      data: expandProductMedia(updated, req)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating product',
      error: error.message
    });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can delete products'
      });
    }

    const { id } = req.params;
    const product = await Database.read(PRODUCTS_COLLECTION, id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const deleted = await Database.delete(PRODUCTS_COLLECTION, id);
    if (!deleted) {
      return res.status(500).json({
        success: false,
        message: 'Failed to delete product from database'
      });
    }

    // Delete local product image files from disk (non-blocking failure)
    try {
      // --- Cloudinary delete (COMMENTED OUT — do not remove) ---
      // const { deleteFromCloudinary } = require('../utils/cloudinaryConfig');
      // for (const publicId of product.cloudinaryPublicIds || []) {
      //   await deleteFromCloudinary(publicId);
      // }

      // --- Local disk delete (ACTIVE) — fs.unlink for /uploads/products/... (+ variant images)
      cleanupAllProductImages(product);
    } catch (cleanupErr) {
      console.warn('Product image file cleanup warning:', cleanupErr.message);
    }

    res.json({
      success: true,
      message: 'Product deleted successfully',
      data: { id },
    });

    cascadeProductDeletion(product).catch((err) => {
      console.error('Background cascade cleanup failed:', err);
    });
  } catch (error) {
    console.error('deleteProduct error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting product',
      error: error.message
    });
  }
};

// Get customization options for aprons and scrubs
exports.getCustomizationOptions = (req, res) => {
  try {
    const { category } = req.query;

    if (category === 'apron' || category === 'scrub') {
      const options = {
        success: true,
        data: {
          types: [
            {
              id: 'embroidery_name',
              name: 'Embroidery with Name',
              price: 200,
              description: 'Add your name with embroidery'
            },
            {
              id: 'embroidery_logo',
              name: 'Embroidery with Logo',
              price: 300,
              description: 'Add your company logo with embroidery'
            },
            {
              id: 'both',
              name: 'Name + Logo Embroidery',
              price: 400,
              description: 'Add both name and logo'
            }
          ]
        }
      };
      return res.json(options);
    }

    res.json({
      success: true,
      data: {
        types: []
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching customization options',
      error: error.message
    });
  }
};