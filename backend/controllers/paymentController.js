const Database = require('../models/DatabaseAdapter');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
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
async function createPendingPayment({ purchaseOrderId, amount, paymentToken, paymentJwt, userId, items, shippingAddress }) {
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
    // Handles both Mongo (11000) and Postgres (23505 unique violation) duplicate key errors.
    const isDuplicate = error && (
      error.code === 11000 || 
      error.codeName === 'DuplicateKey' || 
      error.code === '23505' || 
      (error.detail && error.detail.includes('already exists'))
    );
    if (isDuplicate) {
      try {
        // Try by orderId first (unique field, works cross Mongo/Postgres)
        let existing = await Database.findBy('orders', 'orderId', orderId);
        if (existing) {
          // Re-send confirmation email on recovery path (idempotent but useful)
          sendOrderStatusEmail(existing, 'confirmed').catch(() => {});
          return existing;
        }

        // Then primary key variants (id for Postgres, _id for Mongo)
        existing = await Database.findBy('orders', 'id', orderId);
        if (existing) {
          sendOrderStatusEmail(existing, 'confirmed').catch(() => {});
          return existing;
        }

        existing = await Database.findBy('orders', '_id', orderId);
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

/**
 * Real eSewa v2 Transaction Status Verification
 * This is the proper way to verify after redirect.
 */
async function verifyEsewaTransactionStatus({ oid, amt, refId }) {
  const productCode = process.env.ESEWA_MERCHANT_ID || 'EPAYTEST';

  const totalAmount = Math.round(parseFloat(amt) || 0);
  if (!oid || !totalAmount) {
    return { verified: false, error: 'Missing oid or amount for status check' };
  }

  // Use documented GET query format for transaction status inquiry (examples from eSewa docs use query params; no signature body/header required for status lookup)
  const statusUrl = `https://rc.esewa.com.np/api/epay/transaction/status/?product_code=${encodeURIComponent(productCode)}&total_amount=${totalAmount}&transaction_uuid=${encodeURIComponent(oid)}`;

  try {
    const response = await fetch(statusUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('[eSewa Status Check] HTTP error:', response.status, text);
      return { verified: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    console.log('[eSewa Status Check] Response for tx', oid, ':', JSON.stringify(data));

    // eSewa returns status "COMPLETE" on success
    if (data && (data.status === 'COMPLETE' || String(data.status || '').toUpperCase() === 'COMPLETE')) {
      return { verified: true, data };
    }

    return { verified: false, data };
  } catch (err) {
    console.error('[eSewa Status Check] API call failed:', err.message);
    return { verified: false, error: err.message };
  }
}

// ==================== VERIFY ESEWA PAYMENT (SECURED + FALLBACK) ====================
const verifyEsewaPayment = async (req, res) => {
  try {
    const { refId, oid, amt, ptoken } = req.body;

    // Relaxed guard: allow recovery using ptoken (JWT) which carries purchaseOrderId + amount
    // even if the gateway redirect didn't provide refId/amt (e.g. lost query params, refresh, direct visit after success).
    if (!refId && !oid && !ptoken) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters (refId/oid or ptoken for recovery)'
      });
    }

    const jwtPayload = ptoken ? verifyPaymentJwt(ptoken) : null;

    // Prefer values from the signed JWT (exact values we used when initiating to eSewa)
    let orderId = oid || refId;
    let amountToVerify = parseFloat(amt);

    if (jwtPayload) {
      if (jwtPayload.purchaseOrderId) {
        if (orderId && orderId !== jwtPayload.purchaseOrderId) {
          console.log('[eSewa Verify] oid/refId from callback differs from ptoken JWT, preferring JWT purchaseOrderId');
        }
        orderId = jwtPayload.purchaseOrderId;
      }
      if (jwtPayload.amount != null) {
        if (amountToVerify && Math.abs(amountToVerify - jwtPayload.amount) > 0.1) {
          console.log('[eSewa Verify] amt from callback differs from ptoken JWT, preferring JWT amount for status check');
        }
        amountToVerify = jwtPayload.amount;
      }
    }

    // Fallback recovery (if no/partial JWT)
    if (!amountToVerify && jwtPayload && jwtPayload.amount) {
      amountToVerify = jwtPayload.amount;
      console.log('[eSewa Verify] Recovered amount from ptoken JWT:', amountToVerify);
    }

    if (!amountToVerify) {
      return res.status(400).json({
        success: false,
        message: 'Missing amount (amt) and could not recover from ptoken'
      });
    }

    // Recover orderId from JWT if the redirect didn't provide oid/refId
    if (!orderId && jwtPayload && jwtPayload.purchaseOrderId) {
      orderId = jwtPayload.purchaseOrderId;
      console.log('[eSewa Verify] Recovered orderId from ptoken JWT:', orderId);
    }

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Missing order identifier (oid/refId) and could not recover from ptoken'
      });
    }

    // === First, try to validate as a signed JWT (new preferred model) ===
    // (jwtPayload already decoded above)

    // === Look up DB record (for snapshot data) ===
    const pendingRecord = await findPendingPayment(orderId);
    let usedFallback = false;
    let storedUserId = null;
    let snapshot = {};

    // Strong path: Valid signed JWT
    if (jwtPayload && jwtPayload.purchaseOrderId === orderId) {
      // JWT is cryptographically valid and not expired → we have strong proof of legitimate initiation
      if (Math.abs(jwtPayload.amount - amountToVerify) > 0.5) {
        return res.status(400).json({
          success: false,
          message: 'Amount mismatch with initiated payment'
        });
      }
      storedUserId = jwtPayload.userId || pendingRecord?.userId || null;
      snapshot = pendingRecord || {};
    }
    // Legacy support: random token still stored in DB (during transition)
    else if (pendingRecord && ptoken && pendingRecord.paymentToken === ptoken) {
      if (Math.abs(pendingRecord.amount - amountToVerify) > 0.5) {
        return res.status(400).json({
          success: false,
          message: 'Amount mismatch with initiated payment'
        });
      }
      storedUserId = pendingRecord.userId || null;
      snapshot = pendingRecord;
    } else {
      // === FALLBACK / RECOVERY PATH ===
      usedFallback = true;
      console.warn(`[eSewa Verify] No valid JWT or matching token for ${orderId} — using eSewa status check only (recovery mode)`);
      storedUserId = (jwtPayload?.userId || pendingRecord?.userId) || getUserIdFromRequest(req) || null;
      snapshot = pendingRecord || {};
    }

    // === eSewa Transaction Status Check via official API (always performed for confirmation) ===
    const statusResult = await verifyEsewaTransactionStatus({
      oid: orderId,
      amt: amountToVerify,
      refId
    });

    if (!statusResult.verified) {
      return res.status(400).json({
        success: false,
        message: usedFallback 
          ? 'eSewa has not confirmed this transaction yet. Please wait a moment and try again or contact support.'
          : 'eSewa transaction verification failed',
        details: statusResult.data || statusResult.error,
        fallbackUsed: usedFallback
      });
    }

    // Consume / delete the pending record
    if (pendingRecord) {
      await deletePendingPayment(orderId);
    }

    const esewaResponseData = statusResult.data || {};
    // Prefer eSewa's transaction_code / ref from status response for the stored transactionId (more useful than our internal oid)
    const transactionRef = refId || esewaResponseData.transaction_code || esewaResponseData.ref_id || esewaResponseData.reference_id || orderId;

    // Idempotency: if order already exists (e.g. double callback from strict mode / refresh), return it
    let newOrder = await Database.findBy('orders', 'orderId', orderId);
    let orderCreateWarning = null;
    if (!newOrder) {
      try {
        newOrder = await createOrderAfterPayment({
          userId: storedUserId,
          orderId,
          paymentMethod: 'esewa',
          transactionId: transactionRef,
          amount: amountToVerify,
          paymentGateway: 'esewa',
          items: snapshot.items || [],
          shippingAddress: snapshot.shippingAddress || null
        });
      } catch (orderCreateErr) {
        console.error('[eSewa Verify] Order creation failed (payment was confirmed by eSewa):', orderCreateErr.message);
        orderCreateWarning = 'Order record could not be created due to a temporary issue. Please contact support with your order ID. Your payment has been confirmed.';
        // Return a minimal success order so frontend shows success
        newOrder = {
          id: orderId,
          orderId,
          status: 'confirmed',
          paymentStatus: 'completed',
          paymentMethod: 'esewa',
          amount: amountToVerify,
          createdAt: new Date().toISOString(),
        };
      }
    }

    // Clear the user's cart now that the order is paid
    await clearUserCart(storedUserId);

    return res.json({
      success: true,
      message: orderCreateWarning 
        ? (usedFallback ? 'Payment verified via eSewa (recovery mode)' : 'eSewa payment verified successfully') + ' ' + orderCreateWarning
        : (usedFallback 
            ? 'Payment verified via eSewa (recovery mode)' 
            : 'eSewa payment verified successfully'),
      order: newOrder,
      data: { 
        refId, 
        amount: amountToVerify, 
        status: 'COMPLETE', 
        fallbackUsed: usedFallback,
        warning: orderCreateWarning 
      }
    });

  } catch (error) {
    console.error('[eSewa Verify] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error verifying eSewa payment'
    });
  }
};

// ==================== VERIFY KHALTI PAYMENT (SECURED) ====================
const verifyKhaltiPayment = async (req, res) => {
  try {
    const { pidx, token, amount, ptoken } = req.body;

    // Relaxed: support recovery when we have ptoken (which may carry purchaseOrderId)
    // or when frontend stored the pidx at initiate time (Khalti gives pidx upfront).
    if (!pidx && !token && !ptoken) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters (pidx/token or ptoken for recovery)'
      });
    }

    const secretKey = process.env.KHALTI_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({
        success: false,
        message: 'Khalti secret key not configured'
      });
    }

    const verificationUrl = pidx
      ? 'https://a.khalti.com/api/v2/epayment/lookup/'
      : 'https://khalti.com/api/payment/verify/';

    const bodyData = pidx ? { pidx } : { token, amount: parseInt(amount) };

    const response = await fetch(verificationUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyData)
    });

    const data = await response.json();

    if (response.ok && (data.status === 'Completed' || data.state?.name === 'Completed')) {
      const amountInRupees = parseFloat(data.amount || amount) / 100;

      // === Try JWT validation first (new model) ===
      const jwtPayload = ptoken ? verifyPaymentJwt(ptoken) : null;

      let matchedOrderId = jwtPayload?.purchaseOrderId || pidx || token || req.body.orderId || req.body.purchase_order_id;
      let pendingRecord = null;
      let usedFallback = false;

      if (matchedOrderId) {
        pendingRecord = await findPendingPayment(matchedOrderId);
      }

      // Legacy random token lookup (transition period)
      if (!pendingRecord && ptoken) {
        const allPending = await Database.readAll('pendingPayments').catch(() => []);
        for (const rec of allPending) {
          if (rec.paymentToken === ptoken && new Date(rec.expiresAt) > new Date()) {
            pendingRecord = rec;
            matchedOrderId = rec.purchaseOrderId;
            break;
          }
        }
      }

      // Determine if we have strong proof
      const hasStrongProof = jwtPayload && jwtPayload.purchaseOrderId === matchedOrderId;

      if (!pendingRecord && !hasStrongProof) {
        usedFallback = true;
        console.warn(`[Khalti Verify] No valid JWT and no pending record — accepting based on Khalti response only (fallback)`);
        matchedOrderId = matchedOrderId || `KHALTI-${Date.now()}`;
      }

      const storedUserId = (jwtPayload?.userId || pendingRecord?.userId) || getUserIdFromRequest(req) || null;

      if (pendingRecord) {
        await deletePendingPayment(matchedOrderId);
      }

      // Idempotency guard (same as eSewa)
      let newOrder = await Database.findBy('orders', 'orderId', matchedOrderId);
      let orderCreateWarning = null;
      if (!newOrder) {
        try {
          newOrder = await createOrderAfterPayment({
            userId: storedUserId,
            orderId: matchedOrderId,
            paymentMethod: 'khalti',
            transactionId: pidx || token,
            amount: amountInRupees,
            paymentGateway: 'khalti',
            items: pendingRecord?.items || [],
            shippingAddress: pendingRecord?.shippingAddress || null
          });
        } catch (orderCreateErr) {
          console.error('[Khalti Verify] Order creation failed (payment confirmed by Khalti):', orderCreateErr.message);
          orderCreateWarning = 'Order record could not be created due to a temporary issue. Please contact support. Payment confirmed.';
          newOrder = {
            id: matchedOrderId,
            orderId: matchedOrderId,
            status: 'confirmed',
            paymentStatus: 'completed',
            paymentMethod: 'khalti',
            amount: amountInRupees,
            createdAt: new Date().toISOString(),
          };
        }
      }

      // Clear the user's cart now that the order is paid
      await clearUserCart(storedUserId);

      return res.json({
        success: true,
        message: orderCreateWarning 
          ? (usedFallback ? 'Khalti payment verified (recovery mode)' : 'Khalti payment verified successfully') + ' ' + orderCreateWarning 
          : (usedFallback ? 'Khalti payment verified (recovery mode)' : 'Khalti payment verified successfully'),
        order: newOrder,
        data: {
          pidx: data.pidx || pidx,
          status: 'COMPLETED',
          amount: amountInRupees,
          fallbackUsed: usedFallback,
          warning: orderCreateWarning
        }
      });
    }

    return res.status(400).json({
      success: false,
      message: 'Payment verification failed',
      khalti_response: data
    });

  } catch (error) {
    console.error('[Khalti Verify] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error verifying Khalti payment'
    });
  }
};

// ==================== INITIATE KHALTI EPAYMENT ====================
const initiateKhaltiEpayment = async (req, res) => {
  try {
    const {
      return_url,
      website_url,
      amount,
      purchase_order_id,
      purchase_order_name = 'AAOMS Order',
      customer_info = {}
    } = req.body;

    if (!amount || !purchase_order_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: amount and purchase_order_id'
      });
    }

    const secretKey = process.env.KHALTI_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({
        success: false,
        message: 'Khalti secret key not configured'
      });
    }

    const amountInPaisa = Math.round(amount * 100);

    const response = await fetch('https://a.khalti.com/api/v2/epayment/initiate/', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        return_url: return_url || (process.env.FRONTEND_URL + '/payment/success'),
        website_url: website_url || process.env.FRONTEND_URL || 'http://localhost:3000',
        amount: amountInPaisa,
        purchase_order_id,
        purchase_order_name,
        customer_info: {
          name: customer_info.name || 'Customer',
          email: customer_info.email || '',
          phone: customer_info.phone || ''
        }
      })
    });

    const data = await response.json();

    if (response.ok && data.payment_url) {
      const userIdFromToken = getUserIdFromRequest(req);

      // New preferred security model: signed JWT
      const paymentJwt = generatePaymentJwt({
        purchaseOrderId: purchase_order_id,
        amount: parseFloat(amount),
        userId: userIdFromToken
      });

      // Also keep a random token for legacy clients during transition
      const legacyToken = generatePaymentToken();

      // Persist both in DB (JWT is the real security proof now)
      await createPendingPayment({
        purchaseOrderId: purchase_order_id,
        amount: parseFloat(amount),
        paymentToken: legacyToken,
        paymentJwt,
        userId: userIdFromToken || req.user?.id || null,
        items: req.body.items || [],
        shippingAddress: req.body.shippingAddress || null
      });

      return res.json({
        success: true,
        message: 'Khalti e-Payment initiated successfully',
        data: {
          payment_url: data.payment_url,
          pidx: data.pidx,
          expires_at: data.expires_at,
          paymentToken: paymentJwt,        // Send JWT as the token the client must return (works transparently)
          purchase_order_id: purchase_order_id
        }
      });
    }

    return res.status(400).json({
      success: false,
      message: 'Failed to initiate Khalti payment',
      error: data
    });

  } catch (error) {
    console.error('[Khalti Initiate] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Payment initiation failed'
    });
  }
};

// ==================== INITIATE ESEWA PAYMENT (v2) - SECURED ====================
const initiateEsewaPayment = async (req, res) => {
  try {
    const {
      amount,
      purchase_order_id,
      success_url,
      failure_url
    } = req.body;

    if (!amount || !purchase_order_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: amount and purchase_order_id'
      });
    }

    // Basic sanity for eSewa (helps avoid 428 precondition on their end)
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount for eSewa payment'
      });
    }

    const productCode = process.env.ESEWA_MERCHANT_ID || 'EPAYTEST';
    const secretKey = process.env.ESEWA_SECRET_KEY || '8gBm/:&EnhH.1/q';

    const transactionUuid = purchase_order_id;
    const totalAmount = Math.round(parseFloat(amount));

    const userIdFromToken = getUserIdFromRequest(req);

    // Preferred security model: signed JWT (self-contained proof of initiation)
    const paymentJwt = generatePaymentJwt({
      purchaseOrderId: purchase_order_id,
      amount: totalAmount,
      userId: userIdFromToken
    });

    // Legacy random token (kept during transition)
    const legacyToken = generatePaymentToken();

    // Persist record with JWT as the primary security credential
    // Make this non-fatal: the JWT is self-contained for security; the DB snapshot is best-effort for order reconstruction.
    try {
      await createPendingPayment({
        purchaseOrderId: purchase_order_id,
        amount: totalAmount,
        paymentToken: legacyToken,
        paymentJwt,
        userId: userIdFromToken || req.user?.id || null,
        items: req.body.items || [],
        shippingAddress: req.body.shippingAddress || null
      });
    } catch (persistErr) {
      console.warn('[eSewa Initiate] Warning: Failed to persist pending payment record (proceeding anyway):', persistErr.message);
    }

    // eSewa v2 signature
    const signedFieldNames = 'total_amount,transaction_uuid,product_code';
    const message = `total_amount=${totalAmount},transaction_uuid=${transactionUuid},product_code=${productCode}`;
    const signature = crypto.createHmac('sha256', secretKey).update(message).digest('base64');

    // Debug log for eSewa signature issues (common cause of 428 precondition errors)
    console.log('[eSewa Initiate] Debug signature data:', {
      productCode,
      totalAmount,
      transactionUuid,
      message,
      signature,
      secretKeyLength: secretKey.length
    });

    const formDataForEsewa = {
      amount: totalAmount,
      tax_amount: 0,
      total_amount: totalAmount,
      transaction_uuid: transactionUuid,
      product_code: productCode,
      product_service_charge: 0,
      product_delivery_charge: 0,
      success_url: success_url || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/success`,
      failure_url: failure_url || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/failure`,
      signed_field_names: signedFieldNames,
      signature
    };

    console.log('[eSewa Initiate] Form data being returned to client for submission:', formDataForEsewa);

    const esewaFormUrl = 'https://rc-epay.esewa.com.np/api/epay/main/v2/form';

    // Return the signed JWT as paymentToken (frontend just forwards it as ptoken on callback)
    return res.json({
      success: true,
      message: 'eSewa payment initiated',
      data: {
        esewa_url: esewaFormUrl,
        paymentToken: paymentJwt,        // Now a signed JWT instead of random hex
        purchase_order_id: purchase_order_id,
        form_data: formDataForEsewa
      }
    });

  } catch (error) {
    console.error('[eSewa Initiate] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to initiate eSewa payment',
      error: process.env.NODE_ENV === 'development' ? (error.message || error.toString()) : undefined
    });
  }
};

// ==================== GET PAYMENT METHODS ====================
const getPaymentMethods = (req, res) => {
  const methods = [
    {
      id: 'esewa',
      name: 'eSewa',
      description: 'Pay securely with eSewa',
      enabled: true
    },
    {
      id: 'khalti',
      name: 'Khalti',
      description: 'Pay securely with Khalti',
      enabled: true
    }
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
  verifyEsewaPayment,
  verifyKhaltiPayment,
  initiateEsewaPayment,
  initiateKhaltiEpayment,
  getAdminRevenueSummary,
  getAdminPayments
};
