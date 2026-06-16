
const Database = require('../models/DatabaseAdapter');
const { validateProductData } = require('../utils/validators');
const { v4: uuidv4 } = require('uuid');
const PRODUCTS_COLLECTION = 'products';

const normalizeProductPayload = (body) => {
  const image = body.image || body.images?.[0] || '';
  const description = typeof body.description === 'string'
    ? { tagline: body.description, details: body.description }
    : (body.description || {});

  // Explicitly build clean payload - do NOT spread ...body as it can bring UI-only fields
  // like 'status', 'sales', 'createdAt' (from frontend forms) which don't exist as DB columns
  // and cause Postgres INSERT 500 errors on create/update.
  return {
    name: body.name,
    slug: (body.slug || String(body.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) + '-' + uuidv4().slice(0, 4),
    price: Number(body.price),
    originalPrice: body.originalPrice ? Number(body.originalPrice) : null,
    description,
    subDescription: body.subDescription || '',
    productInformation: body.productInformation || '',
    category: body.category,
    image,
    images: Array.isArray(body.images) && body.images.length ? body.images : (image ? [image] : []),
    sizes: Array.isArray(body.sizes) ? body.sizes : String(body.sizes || '').split(',').map(s => s.trim()).filter(Boolean),
    colors: Array.isArray(body.colors) ? body.colors : String(body.colors || '').split(',').map(c => c.trim()).filter(Boolean),
    sizeChart: body.sizeChart
      ? (typeof body.sizeChart === 'string' ? (() => { try { return JSON.parse(body.sizeChart); } catch { return null; } })() : body.sizeChart)
      : null,
    quickDry: !!body.quickDry,
    isActive: body.isActive !== undefined ? body.isActive : true
  };
};

exports.getAllProducts = async (req, res) => {
  try {
    const { category, minPrice, maxPrice, search, page = 1, limit = 10 } = req.query;
    
    let products = await Database.readAll(PRODUCTS_COLLECTION);
    products = products.filter(p => p.isActive !== false);

    // Filter by category (with alias support for t-shirts/tshirts, scrub/scrubs etc.)
    if (category) {
      const categoryAliases = {
        't-shirts': ['t-shirts', 'tshirts'],
        tshirts: ['t-shirts', 'tshirts'],
        scrubs: ['scrub', 'scrubs'],
        scrub: ['scrub', 'scrubs'],
      };
      const allowed = categoryAliases[category] || [category];
      products = products.filter(p => allowed.includes(p.category));
    }

    // Filter by price range
    if (minPrice || maxPrice) {
      products = products.filter(p => {
        const price = parseFloat(p.price);
        if (minPrice && price < parseFloat(minPrice)) return false;
        if (maxPrice && price > parseFloat(maxPrice)) return false;
        return true;
      });
    }

    // Search by name or description
    if (search) {
      const searchLower = search.toLowerCase();
      products = products.filter(p => 
        p.name.toLowerCase().includes(searchLower) ||
        (p.description && p.description.tagline && p.description.tagline.toLowerCase().includes(searchLower))
      );
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100);
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

exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    let product = await Database.read(PRODUCTS_COLLECTION, id);

    // Fallback: if the "id" param was actually a slug, still resolve the product.
    if (!product) {
      const products = await Database.readAll(PRODUCTS_COLLECTION);
      product = products.find(p => p.slug === id);
    }

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      data: product
    });
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
    const { slug } = req.params;
    const products = await Database.readAll(PRODUCTS_COLLECTION);

    // First try exact slug match
    let product = products.find(p => p.slug === slug);

    // Fallback: if someone passed an ID (UUID or numeric) to the slug route, still resolve it.
    // This makes the frontend more tolerant and prevents 404s when mixing id/slug in links.
    if (!product) {
      product = products.find(p => 
        (p.id && p.id === slug) || 
        (p._id && p._id === slug) ||
        (p.id && String(p.id) === slug)
      );
    }

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      data: product
    });
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
    const updated = await Database.update(PRODUCTS_COLLECTION, id, {
      ...normalizeProductPayload(req.body),
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
    await Database.delete(PRODUCTS_COLLECTION, id);

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
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