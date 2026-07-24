const Database = require('../models/DatabaseAdapter');
const { validateCartItem } = require('../utils/validators');
const { sanitizeLineItems } = require('../utils/productCascade');

const CARTS_COLLECTION = 'carts';

const recalculateTotal = (items = []) =>
  items.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1),
    0
  );

const normalizeColor = (color) => {
  if (color == null || color === '') return 'Default';
  if (typeof color === 'string') return color;
  if (typeof color === 'object' && color.name) return String(color.name);
  return String(color);
};

/** Prefer a short URL/path; avoid embedding multi‑MB base64 blobs in cart rows. */
const resolveCartImage = (product, clientImage) => {
  const candidates = [
    clientImage,
    Array.isArray(product?.images) ? product.images[0] : null,
    product?.image,
  ];

  for (const img of candidates) {
    if (!img || typeof img !== 'string') continue;
    const trimmed = img.trim();
    if (!trimmed) continue;
    // Skip placeholders and accidental non-image strings
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) continue;
    // Cap base64 data-URLs stored on cart lines (keep small thumbnails only)
    if (trimmed.startsWith('data:') && trimmed.length > 12000) continue;
    return trimmed;
  }

  return '';
};

/**
 * Get or create the user's cart. Handles concurrent creates against the
 * unique user_id constraint (two tabs adding at once) by re-reading.
 */
const getOrCreateCart = async (userId) => {
  let cart = await Database.findBy(CARTS_COLLECTION, 'userId', userId);
  if (cart) {
    if (!Array.isArray(cart.items)) cart.items = [];
    return cart;
  }

  const cartId = require('uuid').v4();
  try {
    cart = await Database.create(CARTS_COLLECTION, {
      id: cartId,
      userId,
      items: [],
      total: 0,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    // Concurrent create: unique violation on user_id — re-fetch
    const msg = String(error?.message || '');
    if (
      error?.code === '23505' ||
      msg.includes('duplicate key') ||
      msg.includes('unique')
    ) {
      cart = await Database.findBy(CARTS_COLLECTION, 'userId', userId);
    } else {
      throw error;
    }
  }

  if (!cart) {
    throw new Error('Unable to create or load cart');
  }
  if (!Array.isArray(cart.items)) cart.items = [];
  return cart;
};

// Get user's cart
exports.getCart = async (req, res) => {
  try {
    const userId = req.user.id;
    let cart = await getOrCreateCart(userId);

    const { items: sanitizedItems, removed } = await sanitizeLineItems(cart.items);
    if (removed > 0) {
      cart.items = sanitizedItems;
      cart.total = recalculateTotal(sanitizedItems);
      await Database.update(CARTS_COLLECTION, cart.id || cart._id, {
        items: cart.items,
        total: cart.total,
        updatedAt: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      data: cart
    });
  } catch (error) {
    console.error('[Cart Get] Error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Error fetching cart',
      error: error.message
    });
  }
};

// Add item to cart
exports.addToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity, customization, size, color } = req.body;

    const validation = validateCartItem({ productId, quantity });
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.message
      });
    }

    const product = await Database.read('products', productId);
    if (!product || product.isActive === false) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or no longer available',
      });
    }

    const cart = await getOrCreateCart(userId);

    // Robust duplicate check: normalize IDs (string) and sizes (trim) to prevent duplicates from type or whitespace differences
    const pid = String(productId || '');
    const sizeNorm = (size || '').toString().trim();
    const colorNorm = normalizeColor(color);
    const custNorm = JSON.stringify(customization || null);

    const existingItem = cart.items.find(item => {
      const itemPid = String(item.productId || item.id || '');
      const itemSize = (item.size || '').toString().trim();
      const itemColor = normalizeColor(item.color);
      const itemCust = JSON.stringify(item.customization || null);
      return itemPid === pid &&
             itemSize === sizeNorm &&
             itemColor === colorNorm &&
             itemCust === custNorm;
    });

    if (existingItem) {
      return res.json({
        success: false,
        message: 'This item with the selected size is already in your cart.',
        isDuplicate: true,
        data: cart
      });
    }

    // Prefer server product data over client payload (avoids bad prices / huge base64 images)
    const unitPrice = Number(product.price ?? req.body.price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product price',
      });
    }

    const qty = Number(quantity) || 1;

    cart.items.push({
      id: `${productId}_${Date.now()}`,
      productId: pid,
      name: product.name || req.body.name || 'Product',
      image: resolveCartImage(product, req.body.image),
      quantity: qty,
      size: sizeNorm,
      color: colorNorm,
      price: unitPrice,
      customization: customization || null,
      addedAt: new Date().toISOString()
    });

    cart.total = recalculateTotal(cart.items);

    // Pass a minimal payload (avoid sending the full document which may contain mixed camel/snake keys
    // from Postgres _normalize, which used to produce "multiple assignments to same column" errors).
    const updated = await Database.update(CARTS_COLLECTION, cart.id || cart._id, {
      items: cart.items,
      total: cart.total,
      updatedAt: new Date().toISOString()
    });

    if (!updated) {
      throw new Error('Failed to save cart changes');
    }

    res.status(201).json({
      success: true,
      message: 'Item added to cart',
      isDuplicate: false,
      data: updated
    });
  } catch (error) {
    console.error('[Cart Add] Error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Error adding to cart',
      error: error.message
    });
  }
};

// Update cart item
exports.updateCartItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { itemId } = req.params;
    const { quantity } = req.body;

    if (quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be greater than 0'
      });
    }

    let cart = await Database.findBy(CARTS_COLLECTION, 'userId', userId);
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    if (!Array.isArray(cart.items)) cart.items = [];

    const item = cart.items.find(i => i.id === itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in cart'
      });
    }

    item.quantity = Number(quantity);
    cart.total = recalculateTotal(cart.items);

    const updated = await Database.update(CARTS_COLLECTION, cart.id || cart._id, {
      items: cart.items,
      total: cart.total,
      updatedAt: new Date().toISOString()
    });

    if (!updated) {
      throw new Error('Failed to save cart changes');
    }

    res.json({
      success: true,
      message: 'Cart item updated',
      data: updated
    });
  } catch (error) {
    console.error('[Cart Update] Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error updating cart item',
      error: error.message
    });
  }
};

// Remove item from cart
exports.removeFromCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { itemId } = req.params;

    let cart = await Database.findBy(CARTS_COLLECTION, 'userId', userId);
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    if (!Array.isArray(cart.items)) cart.items = [];

    cart.items = cart.items.filter(i => i.id !== itemId);
    cart.total = recalculateTotal(cart.items);

    const updated = await Database.update(CARTS_COLLECTION, cart.id || cart._id, {
      items: cart.items,
      total: cart.total,
      updatedAt: new Date().toISOString()
    });

    if (!updated) {
      throw new Error('Failed to save cart changes');
    }

    res.json({
      success: true,
      message: 'Item removed from cart',
      data: updated
    });
  } catch (error) {
    console.error('[Cart Remove] Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error removing from cart',
      error: error.message
    });
  }
};

// Clear entire cart
exports.clearCart = async (req, res) => {
  try {
    const userId = req.user.id;

    let cart = await Database.findBy(CARTS_COLLECTION, 'userId', userId);
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    if (!Array.isArray(cart.items)) cart.items = [];

    cart.items = [];
    cart.total = 0;

    await Database.update(CARTS_COLLECTION, cart.id || cart._id, {
      items: cart.items,
      total: cart.total,
      updatedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Cart cleared',
      data: cart
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error clearing cart',
      error: error.message
    });
  }
};
