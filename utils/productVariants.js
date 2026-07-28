/**
 * Color / product variant helpers.
 * Product.variants: [{ id, colorName, colorHex, images[], stock, sku, price, active, sizeStock? }]
 */

const { v4: uuidv4 } = require('uuid');
const { toStoredMediaPath } = require('./localUpload');

const isHex = (value) =>
  typeof value === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());

const normalizeHex = (value) => {
  if (!value || typeof value !== 'string') return '';
  const t = value.trim();
  if (isHex(t)) return t.length === 4
    ? `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`.toUpperCase()
    : t.toUpperCase();
  return '';
};

const storeImageList = (list) => {
  if (!Array.isArray(list)) return [];
  return list
    .map((img) => {
      if (img && typeof img === 'object') {
        return toStoredMediaPath(img.path || img.url || '');
      }
      return toStoredMediaPath(img);
    })
    .filter(Boolean);
};

/**
 * Normalize one variant from admin / API body.
 */
function normalizeVariant(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;

  const colorName = String(raw.colorName || raw.name || '').trim();
  if (!colorName) return null;

  const colorHex =
    normalizeHex(raw.colorHex || raw.hex || raw.code || raw.color || '') || '#CCCCCC';

  const images = storeImageList(raw.images || []);

  let stock = raw.stock;
  if (stock === '' || stock === undefined || stock === null) {
    stock = null; // unlimited / not tracked
  } else {
    stock = Math.max(0, parseInt(stock, 10) || 0);
  }

  let price = raw.price;
  if (price === '' || price === undefined || price === null) {
    price = null; // inherit product base price
  } else {
    const n = Number(price);
    price = Number.isFinite(n) && n >= 0 ? n : null;
  }

  let sizeStock = null;
  if (raw.sizeStock && typeof raw.sizeStock === 'object' && !Array.isArray(raw.sizeStock)) {
    sizeStock = {};
    Object.entries(raw.sizeStock).forEach(([size, qty]) => {
      const key = String(size || '').trim();
      if (!key) return;
      if (qty === '' || qty === null || qty === undefined) return;
      sizeStock[key] = Math.max(0, parseInt(qty, 10) || 0);
    });
    if (!Object.keys(sizeStock).length) sizeStock = null;
  }

  return {
    id: String(raw.id || uuidv4()),
    colorName,
    colorHex,
    images,
    stock,
    sku: raw.sku != null ? String(raw.sku).trim() : '',
    price,
    active: raw.active !== false && raw.active !== 'false',
    sizeStock,
  };
}

/**
 * Normalize variants array. If empty and legacy colors exist, backfill simple variants.
 */
function normalizeVariants(body, existingProduct = null, productImages = []) {
  let rawList = body?.variants;
  if (typeof rawList === 'string') {
    try {
      rawList = JSON.parse(rawList);
    } catch {
      rawList = null;
    }
  }

  if (Array.isArray(rawList) && rawList.length > 0) {
    return rawList.map((v, i) => normalizeVariant(v, i)).filter(Boolean);
  }

  // Keep existing variants on partial update if body omitted variants
  if (rawList === undefined && existingProduct && Array.isArray(existingProduct.variants)) {
    return existingProduct.variants.map((v, i) => normalizeVariant(v, i)).filter(Boolean);
  }

  // Backfill from legacy colors[] (strings or {name, code})
  const legacyColors = Array.isArray(body?.colors)
    ? body.colors
    : Array.isArray(existingProduct?.colors)
      ? existingProduct.colors
      : [];

  if (legacyColors.length > 0) {
    const fallbackImages = productImages.length
      ? productImages
      : storeImageList(existingProduct?.images || []);

    return legacyColors
      .map((c, i) => {
        if (typeof c === 'string') {
          return normalizeVariant({
            colorName: c,
            colorHex: '#CCCCCC',
            images: fallbackImages,
            stock: null,
            active: true,
          }, i);
        }
        if (c && typeof c === 'object') {
          return normalizeVariant({
            colorName: c.name || c.colorName || '',
            colorHex: c.code || c.colorHex || c.hex || '#CCCCCC',
            images: Array.isArray(c.images) && c.images.length ? c.images : fallbackImages,
            stock: c.stock != null ? c.stock : null,
            sku: c.sku || '',
            price: c.price != null ? c.price : null,
            active: c.active !== false,
          }, i);
        }
        return null;
      })
      .filter(Boolean);
  }

  return [];
}

/** Derive legacy colors[] for search / older clients */
function variantsToLegacyColors(variants = []) {
  return (Array.isArray(variants) ? variants : [])
    .filter((v) => v && v.active !== false)
    .map((v) => ({
      name: v.colorName,
      code: v.colorHex,
      hex: v.colorHex,
    }));
}

function findVariant(product, { variantId, color, colorName } = {}) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (!variants.length) return null;

  if (variantId) {
    const byId = variants.find((v) => String(v.id) === String(variantId));
    if (byId) return byId;
  }

  let name = colorName || '';
  if (!name && typeof color === 'string') name = color;
  if (!name && color && typeof color === 'object') {
    name = color.name || color.colorName || '';
  }
  name = String(name || '').trim().toLowerCase();
  if (!name || name === 'default') {
    return variants.find((v) => v.active !== false) || variants[0] || null;
  }

  return (
    variants.find(
      (v) => String(v.colorName || '').trim().toLowerCase() === name
    ) || null
  );
}

function resolveVariantPrice(product, variant) {
  const base = Number(product?.price) || 0;
  if (!variant) return base;
  if (variant.price != null && variant.price !== '' && Number.isFinite(Number(variant.price))) {
    return Number(variant.price);
  }
  return base;
}

function isVariantInStock(variant, size = null, qty = 1) {
  if (!variant) return true; // no variants = unlimited (legacy)
  if (variant.active === false) return false;

  const need = Math.max(1, parseInt(qty, 10) || 1);

  if (size && variant.sizeStock && typeof variant.sizeStock === 'object') {
    const key = String(size).trim();
    if (Object.prototype.hasOwnProperty.call(variant.sizeStock, key)) {
      const available = Number(variant.sizeStock[key]);
      if (!Number.isFinite(available)) return true;
      return available >= need;
    }
  }

  if (variant.stock == null) return true; // not tracked
  return Number(variant.stock) >= need;
}

function isSizeAvailable(variant, size, productSizes = []) {
  if (!size) return true;
  if (!variant) {
    return !productSizes.length || productSizes.includes(size);
  }
  if (variant.active === false) return false;

  if (variant.sizeStock && typeof variant.sizeStock === 'object') {
    const key = String(size).trim();
    if (Object.prototype.hasOwnProperty.call(variant.sizeStock, key)) {
      return Number(variant.sizeStock[key]) > 0;
    }
  }

  if (variant.stock != null && Number(variant.stock) <= 0) return false;
  return !productSizes.length || productSizes.includes(size);
}

function collectVariantImagePaths(product) {
  const paths = [];
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  variants.forEach((v) => {
    if (Array.isArray(v.images)) {
      v.images.forEach((img) => {
        if (typeof img === 'string' && img) paths.push(img);
      });
    }
  });
  return paths;
}

function productHasColor(product, colorFilter) {
  if (!colorFilter || colorFilter === 'all') return true;
  const want = String(colorFilter).trim().toLowerCase();
  if (!want) return true;

  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (variants.length) {
    return variants.some(
      (v) =>
        v.active !== false &&
        String(v.colorName || '').trim().toLowerCase() === want
    );
  }

  const colors = Array.isArray(product?.colors) ? product.colors : [];
  return colors.some((c) => {
    const name = typeof c === 'string' ? c : c?.name || c?.colorName || '';
    return String(name).trim().toLowerCase() === want;
  });
}

module.exports = {
  normalizeVariant,
  normalizeVariants,
  variantsToLegacyColors,
  findVariant,
  resolveVariantPrice,
  isVariantInStock,
  isSizeAvailable,
  collectVariantImagePaths,
  productHasColor,
  storeImageList,
};
