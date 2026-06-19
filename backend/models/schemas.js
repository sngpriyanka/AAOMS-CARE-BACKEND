const mongoose = require('mongoose');

// ==================== ADMIN SCHEMA ====================
const adminSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});


// ==================== USER SCHEMA ====================
const userSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['customer', 'admin', 'super_admin'],
    default: 'customer',
  },
  permissions: {
    type: [String],
    default: [],
  },
  phone: {
    type: String,
    default: null,
  },
  address: {
    type: String,
    default: null,
  },
  city: {
    type: String,
    default: null,
  },
  state: {
    type: String,
    default: null,
  },
  zipcode: {
    type: String,
    default: null,
  },
  birthday: {
    type: String,
    default: null,
  },
  gender: {
    type: String,
    default: null,
  },
  profilePicture: {
    type: String,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// ==================== PRODUCT SCHEMA ====================
const productSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  slug: {
    type: String,
    unique: true,
  },
  price: {
    type: Number,
    required: true,
  },
  originalPrice: {
    type: Number,
    default: null,
  },
  description: {
    tagline: String,
    details: String,
  },
  subDescription: {
    type: String,
    default: '',
  },
  productInformation: {
    type: String,
    default: '',
  },
  category: {
    type: String,
    required: true,
  },
  image: {
    type: String,
    default: null,
  },
  images: {
    type: [String],
    default: [],
  },
  sizes: {
    type: [String],
    default: [],
  },
  colors: {
    type: mongoose.Schema.Types.Mixed,
    default: [],
  },
  sizeChart: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  quickDry: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// ==================== ORDER SCHEMA ====================
const orderSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  orderId: {
    type: String,
    required: true,
    unique: true,
  },
  userId: {
    type: String,
    ref: 'User',
    // not strictly required to support guest eSewa/Khalti flows (userId resolved from token or null)
  },
  items: [new mongoose.Schema({
    id: String,
    productId: String,
    name: String,
    image: String,
    price: Number,
    quantity: Number,
    size: String,
    color: String,
    customization: mongoose.Schema.Types.Mixed,
  }, { _id: false })],
  subtotal: {
    type: Number,
    required: true,
  },
  shippingCost: {
    type: Number,
    default: 0,
  },
  logoCharge: {
    type: Number,
    default: 0,
  },
  total: {
    type: Number,
    required: true,
  },
  amount: {
    type: Number,
    default: 0,
  },
  transactionId: String,
  notes: String,
  trackingNumber: String,
  paymentGateway: String,
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending',
  },
  paymentMethod: {
    type: String,
    enum: ['esewa', 'khalti', 'card', 'bank'],
    required: true,
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'paid', 'refunded'],
    default: 'pending',
  },
  shippingStatus: {
    type: String,
    default: 'not-shipped',
  },
  shippingAddress: {
    name: String,
    email: String,
    phone: String,
    address: String,
    city: String,
    state: String,
    zipcode: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// ==================== CART SCHEMA ====================
const cartSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  userId: {
    type: String,
    ref: 'User',
    required: true,
    unique: true,
  },
  items: [{
    type: new mongoose.Schema({
      id: { type: String, required: true },           // cart line item id (e.g. "prodId_timestamp")
      productId: String,
      name: String,
      image: String,
      price: Number,
      quantity: { type: Number, default: 1 },
      size: String,
      color: String,
      customization: mongoose.Schema.Types.Mixed,
      addedAt: Date,
    }, { _id: false })                                 // ← critical: do not auto-generate ObjectId _id on items
  }],
  total: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// ==================== ADDRESS SCHEMA ====================
const addressSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  userId: {
    type: String,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  phone: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    default: '',
  },
  address: {
    type: String,
    required: true,
  },
  city: {
    type: String,
    required: true,
  },
  state: {
    type: String,
    required: true,
  },
  district: {
    type: String,
    default: '',
  },
  landmark: {
    type: String,
    default: '',
  },
  pincode: {
    type: String,
    default: '',
  },
  zipcode: {
    type: String,
    default: '',
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// ==================== WISHLIST SCHEMA ====================
const wishlistSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  userId: {
    type: String,
    ref: 'User',
    required: true,
    unique: true,
  },
  items: [{
    type: new mongoose.Schema({
      id: { type: String, required: true },
      productId: String,
      name: String,
      price: Number,
      image: String,
      size: String,
      color: String,
      addedAt: Date,
    }, { _id: false })
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// ==================== PAYMENT SCHEMA ====================
const paymentSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  orderId: {
    type: String,
    required: true,
    unique: true,
  },
  userId: {
    type: String,
    ref: 'User',
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  method: {
    type: String,
    enum: ['esewa', 'khalti'],
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending',
  },
  transactionId: String,
  metadata: mongoose.Schema.Types.Mixed,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// ==================== INSTAGRAM FEED SCHEMA ====================
const instagramFeedSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  image: {
    type: String,
    required: true,
  },
  link: {
    type: String,
    required: true,
  },
  alt: {
    type: String,
    default: 'Instagram post',
  },
  isReel: {
    type: Boolean,
    default: false,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// ==================== BANNER SCHEMA ====================
const bannerSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  url: {
    type: String,
    required: true,
  },
  publicId: String,
  images: {
    type: [String],
    default: [],
  },
  pages: {
    type: [String],
    default: ['home'],
  },
  link: {
    type: String,
    default: '/collection',
  },
  title: String,
  subtitle: String,
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// ==================== TESTIMONIAL SCHEMA ====================
const testimonialSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  text: {
    type: String,
    required: true,
  },
  image: {
    type: String,
    default: '',
  },
  publicId: String,
  productId: {
    type: String,
    default: '',
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// ==================== PENDING PAYMENT SCHEMA (for secure payment verification) ====================
// This replaces the previous in-memory pendingPayments Map.
// Records have short expiry and are deleted after successful verification or expiry.
const pendingPaymentSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  purchaseOrderId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  paymentToken: {
    type: String,
    required: true,
  },
  paymentJwt: {
    type: String,
    default: null,
  },
  amount: {
    type: Number,
    required: true,
  },
  userId: {
    type: String,
    ref: 'User',
    default: null,
  },
  items: {
    type: mongoose.Schema.Types.Mixed,
    default: [],
  },
  shippingAddress: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true, // for efficient expiry cleanup queries
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const reviewSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  productId: {
    type: String,
    required: true,
    index: true,
  },
  productName: String,
  userId: String,
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  title: String,
  review: {
    type: String,
    required: true,
  },
  date: String,
  verified: {
    type: Boolean,
    default: false,
  },
  helpful: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  images: {
    type: [String],
    default: [],
  },
  size: String,
  location: String,
  createdAt: {
    type: String,
    default: () => new Date().toISOString(),
  },
  updatedAt: String,
});

// ==================== NOTIFICATION SCHEMA ====================
const notificationSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  // If null/undefined, visible to all admins (system notification). If set, personal notification for that user.
  userId: {
    type: String,
    default: null,
    index: true,
  },
  type: {
    type: String,
    enum: ['order', 'review', 'user', 'payment', 'system', 'alert', 'success'],
    default: 'system',
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  // Optional link to navigate to (e.g. /admin/orders/abc123)
  link: {
    type: String,
    default: '',
  },
  read: {
    type: Boolean,
    default: false,
  },
  // For admins to broadcast to specific users or all
  createdBy: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Create models
const User = mongoose.model('User', userSchema);
const Admin = mongoose.model('Admin', adminSchema, 'admins');
const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const Cart = mongoose.model('Cart', cartSchema);
const Address = mongoose.model('Address', addressSchema);
const Wishlist = mongoose.model('Wishlist', wishlistSchema);
const Payment = mongoose.model('Payment', paymentSchema);
const InstagramFeed = mongoose.model('InstagramFeed', instagramFeedSchema);
const Banner = mongoose.model('Banner', bannerSchema);
const Testimonial = mongoose.model('Testimonial', testimonialSchema);
const PendingPayment = mongoose.model('PendingPayment', pendingPaymentSchema);
const Review = mongoose.model('Review', reviewSchema);
const Notification = mongoose.model('Notification', notificationSchema);

// ==================== SUBSCRIBER SCHEMA (for newsletter footer) ====================
const subscriberSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  source: {
    type: String,
    default: 'footer',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

const Subscriber = mongoose.model('Subscriber', subscriberSchema);

module.exports = { 
  User, Admin, Product, Order, Cart, Address, Wishlist, Payment, 
  InstagramFeed, Banner, Testimonial, PendingPayment, Review, Notification, Subscriber 
};
