const Database = require('../models/DatabaseAdapter');
const { sanitizeLineItems } = require('../utils/productCascade');

const WISHLISTS_COLLECTION = 'wishlists';
const { v4: uuidv4 } = require('uuid');

// Get user's wishlist
exports.getWishlist = async (req, res) => {
  try {
    const userId = req.user.id;

    let wishlist = await Database.findBy('wishlists', 'userId', userId);

    if (!wishlist) {
      wishlist = await Database.create('wishlists', {
        _id: uuidv4(),
        userId,
        items: []
      });
    }

    if (!Array.isArray(wishlist.items)) wishlist.items = [];

    const { items: sanitizedItems, removed } = await sanitizeLineItems(wishlist.items);
    if (removed > 0) {
      wishlist.items = sanitizedItems;
      await Database.update(WISHLISTS_COLLECTION, wishlist.id || wishlist._id, {
        items: wishlist.items,
        updatedAt: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      data: wishlist
    });
  } catch (error) {
    console.error('Get Wishlist Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wishlist'
    });
  }
};

// Add item to wishlist
exports.addToWishlist = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { productId, name, price, image, size, color = 'Default' } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Please login to add to wishlist' });
    }

    if (!productId) {
      return res.status(400).json({ success: false, message: 'Product ID is required' });
    }

    const product = await Database.read('products', productId);
    if (!product || product.isActive === false) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or no longer available',
      });
    }

    // Find or create wishlist
    let wishlist = await Database.findBy('wishlists', 'userId', userId);

    if (!wishlist) {
      wishlist = await Database.create('wishlists', {
        _id: uuidv4(),
        userId,
        items: []
      });
    }

    // Duplicate: product + size + color (variant-aware)
    const pid = String(productId || '');
    const sizeNorm = (size || '').toString().trim();
    const colorNorm = (color == null || color === '')
      ? 'Default'
      : (typeof color === 'object'
          ? String(color.name || color.colorName || 'Default')
          : String(color).trim() || 'Default');
    const variantId = req.body.variantId ? String(req.body.variantId) : '';
    const colorHex = req.body.colorHex || (typeof color === 'object' ? (color.hex || color.colorHex || '') : '') || '';

    const existing = wishlist.items.find(item => {
      const itemPid = String(item.productId || item.id || '');
      const itemSize = (item.size || '').toString().trim();
      const itemColor = (item.color || 'Default').toString().trim();
      const itemVariant = item.variantId ? String(item.variantId) : '';
      if (variantId && itemVariant) {
        return itemPid === pid && itemSize === sizeNorm && itemVariant === variantId;
      }
      return itemPid === pid && itemSize === sizeNorm && itemColor === colorNorm;
    });
    
    if (existing) {
      return res.json({
        success: false,
        message: 'This item with the selected size and color is already in your wishlist.',
        isDuplicate: true,
        data: wishlist
      });
    }

    // Add item
    wishlist.items.push({
      id: uuidv4(),
      productId,
      name: name || 'Product',
      price: price || 0,
      image: image || '',
      size: sizeNorm,
      color: colorNorm,
      colorHex: colorHex || undefined,
      variantId: variantId || undefined,
      addedAt: new Date().toISOString()
    });

    wishlist.updatedAt = new Date().toISOString();

    // Update with minimal payload (prevents duplicate column assignments in Postgres when the
    // hydrated wishlist object from findBy contains both userId + user_id etc.)
    await Database.update('wishlists', wishlist._id || wishlist.id, {
      items: wishlist.items,
      updatedAt: wishlist.updatedAt
    });

    res.json({
      success: true,
      message: 'Added to wishlist',
      isDuplicate: false,
      data: wishlist
    });

  } catch (error) {
    console.error('Wishlist Add Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add to wishlist. Please try again.'
    });
  }
};

// Remove item from wishlist
exports.removeFromWishlist = async (req, res) => {
  try {
    const userId = req.user.id;
    const { itemId } = req.params;

    let wishlist = await Database.findBy('wishlists', 'userId', userId);

    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    // Find and remove item
    const initialLength = wishlist.items.length;
    wishlist.items = wishlist.items.filter(item => item.id !== itemId);

    if (wishlist.items.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in wishlist'
      });
    }

    wishlist.updatedAt = new Date().toISOString();
    await Database.update('wishlists', wishlist._id || wishlist.id, {
      items: wishlist.items,
      updatedAt: wishlist.updatedAt
    });

    res.json({
      success: true,
      message: 'Item removed from wishlist',
      data: wishlist
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error removing from wishlist',
      error: error.message
    });
  }
};

// Check if product is in wishlist
exports.isInWishlist = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;

    const wishlist = await Database.findBy('wishlists', 'userId', userId);

    if (!wishlist) {
      return res.json({
        success: true,
        inWishlist: false
      });
    }

    const inWishlist = wishlist.items.some(item => item.productId === productId);

    res.json({
      success: true,
      inWishlist
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking wishlist',
      error: error.message
    });
  }
};

// Clear wishlist
exports.clearWishlist = async (req, res) => {
  try {
    const userId = req.user.id;

    let wishlist = await Database.findBy('wishlists', 'userId', userId);

    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    wishlist.items = [];
    wishlist.updatedAt = new Date().toISOString();

    await Database.update('wishlists', wishlist._id || wishlist.id, {
      items: wishlist.items,
      updatedAt: wishlist.updatedAt
    });

    res.json({
      success: true,
      message: 'Wishlist cleared',
      data: wishlist
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error clearing wishlist',
      error: error.message
    });
  }
};
