const Database = require('../models/DatabaseAdapter');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Razorpay = require('razorpay');
const { sendOrderStatusEmail, sendAdminNewOrderEmail } = require('../utils/emailService');
const { notify } = require('./notificationController');

// Helper to get Postgres pool for on-the-fly migrations (for users who updated code without full restart)
let pgPool = null;
const getPgPool = () => {
  if (!pgPool) {
    try {
      const { getPool } = require('../models/postgres');
      pgPool = getPool();
    } catch (e) {}
  }
  return pgPool;
};

/**
 * Generate a secure one-time payment token (legacy random hex - kept for compatibility)
 */
function generatePaymentToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a signed JWT for payment verification.
 * This is the recommended security model: the JWT itself proves the payment was legitimately initiated.
 * It is self-contained, tamper-proof, and has built-in short expiry.
 */
function generatePaymentJwt({ purchaseOrderId, amount, userId }) {
  const payload = {
    purchaseOrderId,
    amount: parseFloat(amount),
    userId: userId || null,
    type: 'payment_intent'
  };

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '45m'   // Short window matching the pending payment expiry
  });
}

/**
 * Verify a payment JWT (returns decoded payload or null)
 */
function verifyPaymentJwt(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'payment_intent') return null;
    return decoded;
  } catch (err) {
    return null;
  }
}

/**
 * Create a pending payment record in the database.
 * We now primarily rely on a signed JWT for security proof instead of a random shared secret.
 * The DB record mainly holds the data snapshot (items + shipping) and prevents replay after consumption.
 */
async function createPendingPayment({ purchaseOrderId, amount, paymentToken, paymentJwt, userId, items, shippingAddress, razorpayOrderId }) {
  const expiresAt = new Date(Date.now() + 40 * 60 * 1000); // 40 minutes

  // Proactively ensure the payment_jwt column exists (for Postgres users; safe no-op otherwise or if already present)
  try {
    const pool = getPgPool();
    if (pool) {
      await pool.query(`ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS payment_jwt TEXT;`).catch(() => {});
    }
  } catch (_) {
    // ignore, will be caught by the create if truly missing
  }

  const record = {
    _id: purchaseOrderId,
    purchaseOrderId,
    paymentToken: paymentToken || null,   // legacy random token (still supported)
    paymentJwt: paymentJwt || null,       // preferred: signed JWT
    amount: parseFloat(amount),
    userId: userId || null,
    items: items || [],
    shippingAddress: shippingAddress || null,
    razorpayOrderId: razorpayOrderId || null,
    expiresAt,
    createdAt: new Date()
  };

  try {
    return await Database.create('pendingPayments', record);
  } catch (err) {
    const msg = (err && err.message) || '';
    if (msg.toLowerCase().includes('paymentjwt') && msg.includes('does not exist')) {
      // On-the-fly migration for developers who hot-reloaded the code on a running Postgres DB
      const pool = getPgPool();
      if (pool) {
        try {
          await pool.query(`ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS payment_jwt TEXT;`);
          // Retry once
          return await Database.create('pendingPayments', record);
        } catch (migErr) {
          console.error('[PendingPayments] Auto-migration for payment_jwt failed:', migErr.message);
        }
      }
    }
    throw err; // rethrow original so caller sees the real error
  }
}

/**
 * Find a pending payment by purchaseOrderId.
 * Returns null if not found or already expired.
 *
 * Security model: We primarily trust the signed JWT (paymentJwt) presented by the client.
 * The DB record is used for data snapshot (items, shippingAddress) and one-time consumption.
 */
async function findPendingPayment(purchaseOrderId) {
  const record = await Database.findBy('pendingPayments', 'purchaseOrderId', purchaseOrderId);
  if (!record) return null;

  // Check expiry
  if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
    // Lazy cleanup of expired record
    await Database.delete('pendingPayments', record._id || record.id);
    return null;
  }
  return record;
}

/**
 * Delete a pending payment (called after successful verification or explicit consumption).
 */
async function deletePendingPayment(purchaseOrderId) {
  try {
    await Database.delete('pendingPayments', purchaseOrderId);
  } catch (e) {
    console.warn('[Payment] Failed to delete pending payment record:', e.message);
  }
}

/**
 * Periodic cleanup of expired pending payments (runs every 10 minutes).
 * Safe to call even if using JSON fallback.
 */
async function cleanupExpiredPendingPayments() {
  try {
    const all = await Database.readAll('pendingPayments');
    const now = new Date();
    let cleaned = 0;

    for (const record of all) {
      if (record.expiresAt && new Date(record.expiresAt) < now) {
        await Database.delete('pendingPayments', record._id || record.id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[Payment] Cleaned ${cleaned} expired pending payment records`);
    }
  } catch (e) {
    // Silent fail - not critical
  }
}

// Run cleanup periodically
setInterval(cleanupExpiredPendingPayments, 10 * 60 * 1000);

/**
 * Try to extract user ID from Authorization header (for public payment routes)
 */
function getUserIdFromRequest(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.id || decoded._id || null;
  } catch (e) {
    return null;
  }
}

/**
 * Clear a user's cart after successful payment.
 */
async function clearUserCart(userId) {
  if (!userId) return;
  try {
    const cart = await Database.findBy('carts', 'userId', userId);
    if (cart) {
      cart.items = [];
      cart.total = 0;
      await Database.update('carts', cart.id || cart._id, {
        items: cart.items,
        total: cart.total,
        updatedAt: new Date().toISOString()
      });
      console.log(`[Payment] Cleared backend cart for user ${userId}`);
    }
  } catch (e) {
    console.error('[Payment] Failed to clear user cart after payment:', e.message);
  }
}

/**
 * Centralized order creation after successful payment.
 * Now supports optional items + shippingAddress snapshot for richer orders.
 */
async function createOrderAfterPayment({ userId, orderId, paymentMethod, transactionId, amount, paymentGateway, items, shippingAddress, shippingCost = 0 }) {
  // Sanitize items for order schema (preserve customization data from product detail + cart)
  const normalizeCustomization = (customization) => {
    if (!customization || typeof customization !== 'object') return null;

    // Different parts of the app may store the uploaded logo under different keys.
    // Admin UI expects `customization.logoUrl`.
    const logoUrl =
      customization.logoUrl ||
      customization.logoURL ||
      customization.logo ||
      customization.url ||
      customization.image ||
      null;

    const name = customization.name || null;

    return {
      ...customization,
      name,
      logoUrl
    };
  };

  const cleanItems = (items || []).map((item) => ({
    id: item.id || item.cartItemId || undefined,
    productId: item.productId || item.id || '',
    name: item.name || 'Product',
    image: item.image || '',
    price: parseFloat(item.price) || 0,
    quantity: parseInt(item.quantity, 10) || 1,
    size: item.size || '',
    color: item.color || '',
    customization: normalizeCustomization(item.customization)
  }));

  const computedSubtotal = cleanItems.reduce((s, i) => s + (i.price * i.quantity), 0);
  const logoCharge = (cleanItems || []).reduce((s, i) => {
    const cust = i.customization || {};
    return s + (cust.logoUrl ? 100 * (i.quantity || 1) : 0);
  }, 0);
  const totalAmount = parseFloat(amount) || (computedSubtotal + logoCharge);

  // Proactively ensure required columns exist for orders (robust for Postgres after code updates)
  try {
    const pool = getPgPool();
    if (pool) {
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0;`).catch(() => {});
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS transaction_id TEXT;`).catch(() => {});
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_gateway TEXT;`).catch(() => {});
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;`).catch(() => {});
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number TEXT;`).catch(() => {});
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS logo_charge NUMERIC DEFAULT 0;`).catch(() => {});
    }
  } catch (_) {}

  const orderData = {
    _id: orderId,
    id: orderId,
    orderId,
    userId: userId || null,
    paymentMethod,
    paymentStatus: 'completed',
    transactionId,
    amount: totalAmount,
    status: 'confirmed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    paymentGateway: paymentGateway || paymentMethod,
    // Snapshot (cleaned)
    items: cleanItems,
    shippingAddress: shippingAddress || null,
    subtotal: computedSubtotal,
    shippingCost: 0,
    logoCharge,
    total: totalAmount
  };

  try {
    const createdOrder = await Database.create('orders', orderData);

    const orderNum = createdOrder.orderId || createdOrder.id || orderId;
    const customerName = shippingAddress?.name || 'Customer';
    notify({
      userId: null,
      type: 'order',
      title: 'New Order Received',
      message: `Order ${orderNum} placed by ${customerName} for Rs. ${createdOrder.total || totalAmount}`,
      link: `/admin/orders/${createdOrder.id || createdOrder._id || orderNum}`
    });

    sendAdminNewOrderEmail(createdOrder).catch((err) => {
      console.error('[AdminOrderEmail] Non-fatal new order alert error:', err.message);
    });
    sendOrderStatusEmail(createdOrder, 'confirmed').catch(err => {
      console.error('[PaymentOrderEmail] Non-fatal confirmation email error:', err.message);
    });
    return createdOrder;
  } catch (error) {
    const msg = (error && error.message) || '';
    if ((msg.toLowerCase().includes('transaction_id') || msg.toLowerCase().includes('amount')) && msg.includes('does not exist')) {
      const pool = getPgPool();
      if (pool) {
        try {
          if (msg.toLowerCase().includes('transaction_id')) {
            await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS transaction_id TEXT;`).catch(() => {});
          }
          if (msg.toLowerCase().includes('amount')) {
            await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0;`).catch(() => {});
          }
          await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS logo_charge NUMERIC DEFAULT 0;`).catch(() => {});
          const createdOrder = await Database.create('orders', orderData);
          const orderNum = createdOrder.orderId || createdOrder.id || orderId;
          const customerName = shippingAddress?.name || 'Customer';
          notify({
            userId: null,
            type: 'order',
            title: 'New Order Received',
            message: `Order ${orderNum} placed by ${customerName} for Rs. ${createdOrder.total || totalAmount}`,
            link: `/admin/orders/${createdOrder.id || createdOrder._id || orderNum}`
          });
          sendAdminNewOrderEmail(createdOrder).catch((err) => {
            console.error('[AdminOrderEmail] Non-fatal (migration path) error:', err.message);
          });
          sendOrderStatusEmail(createdOrder, 'confirmed').catch(err => {
            console.error('[PaymentOrderEmail] Non-fatal (migration path) error:', err.message);
          });
          return createdOrder;
        } catch (migErr) {
          console.error('[Orders] Auto-migration failed:', migErr.message);
        }
      }
    }
    // Idempotency: if the order already exists (double callback / retry), return the existing order.
    // Handles Postgres unique violation duplicate key errors.
    const isDuplicate = error && (
      error.code === '23505' ||
      (error.detail && error.detail.includes('already exists'))
    );
    if (isDuplicate) {
      try {
        let existing = await Database.findBy('orders', 'orderId', orderId);
        if (existing) {
          sendOrderStatusEmail(existing, 'confirmed').catch(() => {});
          return existing;
        }

        existing = await Database.findBy('orders', 'id', orderId);
        if (existing) {
          sendOrderStatusEmail(existing, 'confirmed').catch(() => {});
          return existing;
        }
      } catch (_) {
        // fallthrough to rethrow
      }
    }
    throw error;
  }
}

const getRazorpayClient = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
};

const verifyRazorpaySignature = ({ orderId, paymentId, signature }) => {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !orderId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return expected === signature;
};

const toRazorpayPaise = (amountInRupees) => {
  return Math.max(1, Math.round((parseFloat(amountInRupees) || 0) * 100));
};

// ==================== VERIFY RAZORPAY PAYMENT ====================
const verifyRazorpayPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
      ptoken,
    } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        success: false,
        message: 'Missing Razorpay payment verification fields',
      });
    }

    if (!verifyRazorpaySignature({
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature,
    })) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Razorpay payment signature',
      });
    }

    const jwtPayload = ptoken ? verifyPaymentJwt(ptoken) : null;
    let orderId = jwtPayload?.purchaseOrderId || null;
    let amountToVerify = jwtPayload?.amount != null ? parseFloat(jwtPayload.amount) : null;

    const pendingRecord = orderId ? await findPendingPayment(orderId) : null;

    if (!orderId && pendingRecord?.purchaseOrderId) {
      orderId = pendingRecord.purchaseOrderId;
    }

    if (!orderId) {
      try {
        const allPending = await Database.readAll('pendingPayments');
        const matched = allPending.find((record) => record.razorpayOrderId === razorpayOrderId);
        if (matched) {
          orderId = matched.purchaseOrderId || matched._id;
          if (!amountToVerify && matched.amount != null) amountToVerify = parseFloat(matched.amount);
        }
      } catch (_) {}
    }

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Could not match Razorpay order to a pending checkout',
      });
    }

    const snapshot = pendingRecord || (await findPendingPayment(orderId)) || {};
    let storedUserId = jwtPayload?.userId || snapshot.userId || getUserIdFromRequest(req) || null;

    if (jwtPayload && jwtPayload.purchaseOrderId !== orderId) {
      return res.status(400).json({
        success: false,
        message: 'Payment token does not match this order',
      });
    }

    const razorpay = getRazorpayClient();
    if (razorpay) {
      try {
        const payment = await razorpay.payments.fetch(razorpayPaymentId);
        const paidPaise = Number(payment.amount) || 0;
        const expectedPaise = toRazorpayPaise(amountToVerify || snapshot.amount || 0);
        if (paidPaise > 0 && Math.abs(paidPaise - expectedPaise) > 1) {
          return res.status(400).json({
            success: false,
            message: 'Paid amount does not match the initiated order total',
          });
        }
        if (!['captured', 'authorized'].includes(String(payment.status || '').toLowerCase())) {
          return res.status(400).json({
            success: false,
            message: `Razorpay payment is not completed (status: ${payment.status})`,
          });
        }
        if (!amountToVerify && paidPaise > 0) {
          amountToVerify = paidPaise / 100;
        }
      } catch (fetchErr) {
        console.warn('[Razorpay Verify] Payment fetch failed, proceeding with signature only:', fetchErr.message);
      }
    }

    if (!amountToVerify) {
      amountToVerify = parseFloat(snapshot.amount) || 0;
    }

    if (pendingRecord || snapshot.purchaseOrderId) {
      await deletePendingPayment(orderId);
    }

    let newOrder = await Database.findBy('orders', 'orderId', orderId);
    let orderCreateWarning = null;

    if (!newOrder) {
      try {
        newOrder = await createOrderAfterPayment({
          userId: storedUserId,
          orderId,
          paymentMethod: 'razorpay',
          transactionId: razorpayPaymentId,
          amount: amountToVerify,
          paymentGateway: 'razorpay',
          items: snapshot.items || [],
          shippingAddress: snapshot.shippingAddress || null,
        });
      } catch (orderCreateErr) {
        console.error('[Razorpay Verify] Order creation failed (payment confirmed):', orderCreateErr.message);
        orderCreateWarning = 'Order record could not be created due to a temporary issue. Please contact support. Payment confirmed.';
        newOrder = {
          id: orderId,
          orderId,
          status: 'confirmed',
          paymentStatus: 'completed',
          paymentMethod: 'razorpay',
          amount: amountToVerify,
          createdAt: new Date().toISOString(),
        };
      }
    }

    await clearUserCart(storedUserId);

    return res.json({
      success: true,
      message: orderCreateWarning
        ? `Razorpay payment verified successfully. ${orderCreateWarning}`
        : 'Razorpay payment verified successfully',
      order: newOrder,
      data: {
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        amount: amountToVerify,
        warning: orderCreateWarning,
      },
    });
  } catch (error) {
    console.error('[Razorpay Verify] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error verifying Razorpay payment',
    });
  }
};

// ==================== INITIATE RAZORPAY PAYMENT ====================
const initiateRazorpayPayment = async (req, res) => {
  try {
    const { amount, purchase_order_id } = req.body;

    if (!amount || !purchase_order_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: amount and purchase_order_id',
      });
    }

    const razorpay = getRazorpayClient();
    if (!razorpay) {
      return res.status(500).json({
        success: false,
        message: 'Razorpay credentials not configured',
      });
    }

    const totalAmount = parseFloat(amount);
    const amountInPaise = toRazorpayPaise(totalAmount);

    if (amountInPaise <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount for Razorpay payment',
      });
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: String(purchase_order_id).slice(0, 40),
      payment_capture: 1,
    });

    const userIdFromToken = getUserIdFromRequest(req);
    const paymentJwt = generatePaymentJwt({
      purchaseOrderId: purchase_order_id,
      amount: totalAmount,
      userId: userIdFromToken,
    });
    const legacyToken = generatePaymentToken();

    try {
      await createPendingPayment({
        purchaseOrderId: purchase_order_id,
        amount: totalAmount,
        paymentToken: legacyToken,
        paymentJwt,
        userId: userIdFromToken || req.user?.id || null,
        items: req.body.items || [],
        shippingAddress: req.body.shippingAddress || null,
        razorpayOrderId: razorpayOrder.id,
      });
    } catch (persistErr) {
      console.warn('[Razorpay Initiate] Failed to persist pending payment (proceeding):', persistErr.message);
    }

    return res.json({
      success: true,
      message: 'Razorpay payment initiated',
      data: {
        key_id: process.env.RAZORPAY_KEY_ID,
        razorpay_order_id: razorpayOrder.id,
        amount: amountInPaise,
        currency: razorpayOrder.currency || 'INR',
        paymentToken: paymentJwt,
        purchase_order_id,
      },
    });
  } catch (error) {
    console.error('[Razorpay Initiate] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to initiate Razorpay payment',
      error: process.env.NODE_ENV === 'development' ? (error.message || error.toString()) : undefined,
    });
  }
};

// ==================== GET PAYMENT METHODS ====================
const getPaymentMethods = (req, res) => {
  const razorpayConfigured = !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

  const methods = [
    {
      id: 'razorpay',
      name: 'Razorpay',
      description: 'Pay securely with UPI, cards, netbanking & wallets',
      enabled: razorpayConfigured,
    },
  ];

  res.json({
    success: true,
    data: methods
  });
};

// ==================== ADMIN: GET ALL PAYMENTS (derived from orders) ====================
const getAdminPayments = async (req, res) => {
  try {
    const allOrders = await Database.readAll('orders');

    const payments = allOrders.map((order) => {
      const created = order.createdAt || order.date || new Date().toISOString();
      const dateStr = typeof created === 'string' ? created : new Date(created).toISOString();

      const customer =
        (order.shippingAddress && (order.shippingAddress.name || order.shippingAddress.fullName)) ||
        order.customerName ||
        (order.userId ? `User ${String(order.userId).slice(0, 8)}` : 'Customer');

      return {
        id: order.id || order._id || order.orderId,
        orderId: order.orderId || order.id || order._id,
        amount: Number(order.total || order.amount || 0),
        method: order.paymentMethod || order.paymentGateway || 'Unknown',
        status: String(order.paymentStatus || order.status || 'pending').toLowerCase(),
        date: dateStr.split('T')[0],
        customer,
        reference: order.transactionId || order.paymentRef || order.orderId || order.id || ''
      };
    });

    // Newest first
    payments.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    res.json({
      success: true,
      data: payments
    });
  } catch (error) {
    console.error('[Admin Payments] Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error fetching payments',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ==================== ADMIN: REVENUE SUMMARY ====================
const getAdminRevenueSummary = async (req, res) => {
  try {
    const allOrders = await Database.readAll('orders');

    const completed = allOrders.filter((o) => {
      const ps = String(o.paymentStatus || '').toLowerCase();
      const st = String(o.status || '').toLowerCase();
      return ps === 'completed' || st === 'confirmed' || st === 'delivered' || st === 'completed';
    });

    const totalRevenue = completed.reduce((sum, o) => sum + (Number(o.total || o.amount) || 0), 0);

    const monthPrefix = new Date().toISOString().slice(0, 7);
    const monthlyRevenue = completed
      .filter((o) => (o.createdAt || o.date || '').startsWith(monthPrefix))
      .reduce((sum, o) => sum + (Number(o.total || o.amount) || 0), 0);

    const byMethod = {};
    completed.forEach((o) => {
      const m = (o.paymentMethod || o.paymentGateway || 'unknown').toLowerCase();
      if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
      byMethod[m].count += 1;
      byMethod[m].total += Number(o.total || o.amount) || 0;
    });

    res.json({
      success: true,
      data: {
        totalRevenue,
        monthlyRevenue,
        transactionCount: completed.length,
        byMethod
      }
    });
  } catch (error) {
    console.error('[Admin Revenue Summary] Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error fetching revenue summary'
    });
  }
};

// ==================== EXPORTS ====================
module.exports = {
  getPaymentMethods,
  verifyRazorpayPayment,
  initiateRazorpayPayment,
  getAdminRevenueSummary,
  getAdminPayments,
};
