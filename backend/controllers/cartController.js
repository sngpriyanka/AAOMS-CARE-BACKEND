const Database = require('../models/DatabaseAdapter');
const { validateCartItem } = require('../utils/validators');
const { sanitizeLineItems } = require('../utils/productCascade');

const CARTS_COLLECTION = 'carts';
const USERS_COLLECTION = 'users';

// Get user's cart
exports.getCart = async (req, res) => {
  try {
    const userId = req.user.id;
    let cart = await Database.findBy(CARTS_COLLECTION, 'userId', userId);

    if (!cart) {
      // Create new cart if doesn't exist
      const cartId = require('uuid').v4();
      cart = await Database.create(CARTS_COLLECTION, {
        id: cartId,
        _id: cartId,
        userId,
        items: [],
        total: 0,
        createdAt: new Date().toISOString()
      });
    }

    // Ensure items is always an array (defensive for different DB backends)
    if (!Array.isArray(cart.items)) cart.items = [];

    const { items: sanitizedItems, removed } = await sanitizeLineItems(cart.items);
    if (removed > 0) {
      cart.items = sanitizedItems;
      cart.total = sanitizedItems.reduce(
        (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1),
        0
      );
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
    const { productId, quantity, customization, size, color, price } = req.body;

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

    let cart = await Database.findBy(CARTS_COLLECTION, 'userId', userId);
    if (!cart) {
      const cartId = require('uuid').v4();
      cart = await Database.create(CARTS_COLLECTION, {
        id: cartId,
        _id: cartId,
        userId,
        items: [],
        total: 0
      });
    }

    if (!Array.isArray(cart.items)) cart.items = [];

    // Robust duplicate check: normalize IDs (string) and sizes (trim) to prevent duplicates from type or whitespace differences
    const pid = String(productId || '');
    const sizeNorm = (size || '').toString().trim();
    const colorNorm = color || 'Default';
    const custNorm = JSON.stringify(customization || null);

    const existingItem = cart.items.find(item => {
      const itemPid = String(item.productId || item.id || '');
      const itemSize = (item.size || '').toString().trim();
      const itemColor = item.color || 'Default';
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
    } else {
      cart.items.push({
        id: `${productId}_${Date.now()}`,
        productId,
        name: req.body.name || 'Product',
        image: req.body.image || '',
        quantity,
        size,
        color,
        price,
        customization,
        addedAt: new Date().toISOString()
      });
    }

    // Calculate total
    cart.total = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // Pass a minimal payload (avoid sending the full document which may contain mixed camel/snake keys
    // from Postgres _normalize, which used to produce "multiple assignments to same column" errors).
    await Database.update(CARTS_COLLECTION, cart.id || cart._id, {
      items: cart.items,
      total: cart.total,
      updatedAt: new Date().toISOString()
    });

    res.status(201).json({
      success: true,
      message: 'Item added to cart',
      isDuplicate: false,
      data: cart
    });
  } catch (error) {
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

    item.quantity = quantity;
    cart.total = cart.items.reduce((sum, i) => sum + (i.price * i.quantity), 0);

    await Database.update(CARTS_COLLECTION, cart.id || cart._id, {
      items: cart.items,
      total: cart.total,
      updatedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Cart item updated',
      data: cart
    });
  } catch (error) {
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
    cart.total = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    await Database.update(CARTS_COLLECTION, cart.id || cart._id, {
      items: cart.items,
      total: cart.total,
      updatedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Item removed from cart',
      data: cart
    });
  } catch (error) {
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
