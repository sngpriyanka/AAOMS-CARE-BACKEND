const {
  validateIndianPhone,
  normalizeIndianPhone,
  INDIAN_MOBILE_ERROR,
} = require('./phoneUtils');

const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validatePassword = (password) => {
  if (!password || password.length < 8 || password.length > 12) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[!@#$%^&*]/.test(password)) return false;
  return true;
};

const validatePhone = (phone) => validateIndianPhone(phone);

const validatePhoneOrEmpty = (phone) => {
  if (!phone || !String(phone).trim()) return { valid: true, normalized: '' };
  const normalized = normalizeIndianPhone(phone);
  if (!validateIndianPhone(normalized)) {
    return { valid: false, message: INDIAN_MOBILE_ERROR, normalized: '' };
  }
  return { valid: true, normalized };
};

const validateProductData = (product) => {
  if (!product?.name || !String(product.name).trim()) {
    return { valid: false, message: 'Product name and price are required' };
  }

  const price = Number(product.price);
  if (!Number.isFinite(price)) {
    return { valid: false, message: 'Product name and price are required' };
  }

  if (price <= 0) {
    return { valid: false, message: 'Price must be greater than 0' };
  }

  const category = typeof product.category === 'string' ? product.category.trim() : '';
  if (!category) {
    return { valid: false, message: 'Category is required' };
  }

  return { valid: true };
};

const validateOrderData = (order) => {
  if (!order.userId || !order.items || !Array.isArray(order.items) || order.items.length === 0) {
    return { valid: false, message: 'Order items and user ID are required' };
  }

  if (!order.shippingAddress) {
    return { valid: false, message: 'Shipping address is required' };
  }

  return { valid: true };
};

const validateCartItem = (item) => {
  if (!item.productId) {
    return { valid: false, message: 'Product ID is required' };
  }

  if (!item.quantity || item.quantity <= 0) {
    return { valid: false, message: 'Quantity must be greater than 0' };
  }

  return { valid: true };
};

module.exports = {
  validateEmail,
  validatePassword,
  validatePhone,
  validatePhoneOrEmpty,
  validateIndianPhone,
  INDIAN_MOBILE_ERROR,
  validateProductData,
  validateOrderData,
  validateCartItem,
};