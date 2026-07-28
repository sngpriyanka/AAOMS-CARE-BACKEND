

const Database = require('../models/DatabaseAdapter');
const { validateProductData } = require('../utils/validators');
const { cascadeProductDeletion } = require('../utils/productCascade');
const { getMatchingCategories } = require('../utils/categories');
const { v4: uuidv4 } = require('uuid');
const PRODUCTS_COLLECTION = 'products';
const { normalizeVariants, variantsToLegacyColors } = require('../utils/productVariants');

const isProductActive = (product) => product && product.isActive !== false;

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
  const image = body.image || body.images?.[0] || '';
  const description = typeof body.description === 'string'
    ? { tagline: body.description, details: body.description }
    : (body.description || {});

  const images = Array.isArray(body.images) && body.images.length
    ? body.images
    : (image ? [image] : []);

  // Normalize color variants (main feature)
  const variants = normalizeVariants(body, existingProduct, images);

  // Keep legacy colors[] for backward compatibility / search
  const colors = variants.length
    ? variantsToLegacyColors(variants)
    : (Array.isArray(body.colors)
        ? body.colors
        : String(body.colors || '').split(',').map(c => c.trim()).filter(Boolean));

  return {
    name: body.name,
    slug: buildProductSlug(body, existingProduct),
    price: Number(body.price),
    originalPrice: body.originalPrice ? Number(body.originalPrice) : null,
    description,
    subDescription: body.subDescription || '',
    productInformation: body.productInformation || '',
    category: typeof body.category === 'string' ? body.category.trim() : '',
    image: images[0] || image || '',
    images,
    sizes: Array.isArray(body.sizes)
      ? body.sizes
      : String(body.sizes || '').split(',').map(s => s.trim()).filter(Boolean),
    colors,               // legacy
    variants,             // ← new proper color variants
    sizeChart: body.sizeChart
      ? (typeof body.sizeChart === 'string'
          ? (() => { try { return JSON.parse(body.sizeChart); } catch { return null; } })()
          : body.sizeChart)
      : null,
    quickDry: !!body.quickDry,
    isActive: body.isActive !== undefined ? body.isActive : true
  };
};
const filterProductsInMemory = (products, { category, minPrice, maxPrice, search, excludeId, view }) => {
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
      (p.description && p.description.tagline && p.description.tagline.toLowerCase().includes(searchLower))
    );
  }

  if (excludeId) {
    next = next.filter(p => (p.id || p._id) !== excludeId);
  }

  return next;
};

exports.getAllProducts = async (req, res) => {
  try {
    const { category, minPrice, maxPrice, search, page = 1, limit = 10, excludeId, view } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

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
        data: pgResult.items,
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
      data: paginatedProducts,
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

const sendResolvedProduct = async (res, identifier) => {
  const product = await resolveProduct(identifier);

  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found'
    });
  }

  return res.json({
    success: true,
    data: product
  });
};

exports.getProductByIdentifier = async (req, res) => {
  try {
    await sendResolvedProduct(res, req.params.identifier);
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
    await sendResolvedProduct(res, req.params.id);
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
    await sendResolvedProduct(res, req.params.slug);
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

    const id = uuidv4();
    const newProduct = await Database.create(PRODUCTS_COLLECTION, {
      ...payload,
      id,
      _id: id,
      createdBy: req.user.id,
      createdAt: new Date().toISOString()
    });

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: newProduct
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating product',
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

    const updated = await Database.update(PRODUCTS_COLLECTION, id, {
      ...normalizeProductPayload(req.body, existingProduct),
      updatedAt: new Date().toISOString()
    });

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      message: 'Product updated successfully',
      data: updated
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
