const Database = require('../models/DatabaseAdapter');

const PRODUCTS = 'products';
const CARTS = 'carts';
const WISHLISTS = 'wishlists';
const REVIEWS = 'reviews';
const TESTIMONIALS = 'testimonials';
const PENDING_PAYMENTS = 'pendingPayments';
const BANNERS = 'banners';

const normalizeId = (value) => String(value || '').trim();

const getItemProductRef = (item) => {
  if (!item) return '';
  if (item.productId) return normalizeId(item.productId);

  const lineId = String(item.id || item._id || '');
  if (lineId.includes('_')) {
    return normalizeId(lineId.split('_')[0]);
  }

  return normalizeId(lineId);
};

const itemReferencesProduct = (item, productId) => {
  if (!item) return false;
  return getItemProductRef(item) === normalizeId(productId);
};

const bannerReferencesProduct = (banner, productId, productSlug) => {
  const link = String(banner?.link || '').toLowerCase();
  if (!link) return false;

  const id = normalizeId(productId).toLowerCase();
  const slug = String(productSlug || '').toLowerCase();

  const patterns = [
    `/product/${id}`,
    `/products/${id}`,
    `product/${id}`,
  ];
  if (slug) {
    patterns.push(`/product/${slug}`, `/products/${slug}`, `product/${slug}`);
  }

  return patterns.some((pattern) => link.includes(pattern));
};

const recalculateCartTotal = (items) =>
  (Array.isArray(items) ? items : []).reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1),
    0
  );

async function getValidProductIds() {
  const products = await Database.readAll(PRODUCTS);
  return new Set(
    products
      .map((product) => normalizeId(product.id || product._id))
      .filter(Boolean)
  );
}

/**
 * Remove cart/wishlist line items that reference products that no longer exist.
 * Safe to run on every cart/wishlist read.
 */
async function sanitizeLineItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return { items: [], removed: 0 };

  const validIds = await getValidProductIds();
  const sanitized = items.filter((item) => {
    const ref = getItemProductRef(item);
    return ref && validIds.has(ref);
  });

  return {
    items: sanitized,
    removed: items.length - sanitized.length,
  };
}

async function removeProductFromCarts(productId) {
  const carts = await Database.readAll(CARTS);
  let cartsUpdated = 0;
  let itemsRemoved = 0;

  for (const cart of carts) {
    const items = Array.isArray(cart.items) ? cart.items : [];
    const nextItems = items.filter((item) => !itemReferencesProduct(item, productId));

    if (nextItems.length === items.length) continue;

    itemsRemoved += items.length - nextItems.length;
    await Database.update(CARTS, cart.id || cart._id, {
      items: nextItems,
      total: recalculateCartTotal(nextItems),
      updatedAt: new Date().toISOString(),
    });
    cartsUpdated += 1;
  }

  return { cartsUpdated, itemsRemoved };
}

async function removeProductFromWishlists(productId) {
  const wishlists = await Database.readAll(WISHLISTS);
  let wishlistsUpdated = 0;
  let itemsRemoved = 0;

  for (const wishlist of wishlists) {
    const items = Array.isArray(wishlist.items) ? wishlist.items : [];
    const nextItems = items.filter((item) => !itemReferencesProduct(item, productId));

    if (nextItems.length === items.length) continue;

    itemsRemoved += items.length - nextItems.length;
    await Database.update(WISHLISTS, wishlist.id || wishlist._id, {
      items: nextItems,
      updatedAt: new Date().toISOString(),
    });
    wishlistsUpdated += 1;
  }

  return { wishlistsUpdated, itemsRemoved };
}

async function deleteProductReviews(productId) {
  const reviews = await Database.readAll(REVIEWS);
  const pid = normalizeId(productId);
  const matching = reviews.filter((review) => normalizeId(review.productId) === pid);

  for (const review of matching) {
    await Database.delete(REVIEWS, review.id || review._id);
  }

  return { reviewsDeleted: matching.length };
}

async function unlinkProductFromTestimonials(productId) {
  const testimonials = await Database.readAll(TESTIMONIALS);
  const pid = normalizeId(productId);
  let testimonialsUpdated = 0;

  for (const testimonial of testimonials) {
    if (normalizeId(testimonial.productId) !== pid) continue;

    await Database.update(TESTIMONIALS, testimonial.id || testimonial._id, {
      productId: '',
      updatedAt: new Date().toISOString(),
    });
    testimonialsUpdated += 1;
  }

  return { testimonialsUpdated };
}

async function removeProductFromPendingPayments(productId) {
  const pendingPayments = await Database.readAll(PENDING_PAYMENTS);
  let paymentsUpdated = 0;
  let paymentsDeleted = 0;
  let itemsRemoved = 0;

  for (const payment of pendingPayments) {
    const items = Array.isArray(payment.items) ? payment.items : [];
    const nextItems = items.filter((item) => !itemReferencesProduct(item, productId));

    if (nextItems.length === items.length) continue;

    itemsRemoved += items.length - nextItems.length;

    if (nextItems.length === 0) {
      await Database.delete(PENDING_PAYMENTS, payment.id || payment._id);
      paymentsDeleted += 1;
    } else {
      await Database.update(PENDING_PAYMENTS, payment.id || payment._id, {
        items: nextItems,
        updatedAt: new Date().toISOString(),
      });
      paymentsUpdated += 1;
    }
  }

  return { paymentsUpdated, paymentsDeleted, itemsRemoved };
}

async function removeProductBannerLinks(productId, productSlug) {
  const banners = await Database.readAll(BANNERS);
  let bannersUpdated = 0;

  for (const banner of banners) {
    if (!bannerReferencesProduct(banner, productId, productSlug)) continue;

    await Database.update(BANNERS, banner.id || banner._id, {
      link: '/collection',
      updatedAt: new Date().toISOString(),
    });
    bannersUpdated += 1;
  }

  return { bannersUpdated };
}

/**
 * Cascade cleanup when a product is deleted.
 * Orders are intentionally preserved (historical purchase records).
 */
async function cascadeProductDeletion(product) {
  const productId = normalizeId(product?.id || product?._id);
  const productSlug = product?.slug || '';

  const [
    carts,
    wishlists,
    reviews,
    testimonials,
    pendingPayments,
    banners,
  ] = await Promise.all([
    removeProductFromCarts(productId),
    removeProductFromWishlists(productId),
    deleteProductReviews(productId),
    unlinkProductFromTestimonials(productId),
    removeProductFromPendingPayments(productId),
    removeProductBannerLinks(productId, productSlug),
  ]);

  return {
    productId,
    carts,
    wishlists,
    reviews,
    testimonials,
    pendingPayments,
    banners,
    ordersPreserved: true,
  };
}

module.exports = {
  cascadeProductDeletion,
  sanitizeLineItems,
  itemReferencesProduct,
  getItemProductRef,
};