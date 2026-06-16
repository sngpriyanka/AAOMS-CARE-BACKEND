module.exports = {
  // Product Categories
  CATEGORIES: ['t-shirts', 'apron', 'scrub', 'pants', 'hoppers', 'accessories'],
  
  // Order Status
  ORDER_STATUS: {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    PROCESSING: 'processing',
    SHIPPED: 'shipped',
    DELIVERED: 'delivered',
    CANCELLED: 'cancelled'
  },
  
  // Payment Status
  PAYMENT_STATUS: {
    PENDING: 'pending',
    COMPLETED: 'completed',
    FAILED: 'failed',
    REFUNDED: 'refunded'
  },
  
  // User Roles
  USER_ROLES: {
    CUSTOMER: 'customer',
    ADMIN: 'admin',
    SUPER_ADMIN: 'super_admin'
  },
  
  // Customization Options
  CUSTOMIZATION_TYPES: {
    EMBROIDERY_NAME: 'embroidery_name',
    EMBROIDERY_LOGO: 'embroidery_logo'
  },
  
  // Sizes
  AVAILABLE_SIZES: {
    'XS': 'Extra Small',
    'S': 'Small',
    'M': 'Medium',
    'L': 'Large',
    'XL': 'Extra Large',
    '2XL': '2X Large',
    '3XL': '3X Large',
    'One Size': 'One Size'
  },
  
  // Price Ranges
  PRICE_RANGE: {
    MIN: 100,
    MAX: 50000
  },
  
  // Pagination
  PAGINATION: {
    DEFAULT_LIMIT: 10,
    DEFAULT_PAGE: 1,
    MAX_LIMIT: 100
  }
};
