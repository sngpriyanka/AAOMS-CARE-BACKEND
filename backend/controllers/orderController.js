const Database = require('../models/DatabaseAdapter');
const { validateOrderData } = require('../utils/validators');
const { ORDER_STATUS, PAYMENT_STATUS } = require('../utils/constants');
const { notify } = require('./notificationController');
const { sendOrderStatusEmail, sendAdminNewOrderEmail } = require('../utils/emailService');
const PDFDocument = require('pdfkit');

// Helper for on-the-fly Postgres column migrations (robustness for payment/order schema evolutions)
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

const ORDERS_COLLECTION = 'orders';
const CARTS_COLLECTION = 'carts';

// Get all user's orders
exports.getUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const orders = await Database.filterBy(ORDERS_COLLECTION, 'userId', userId);

    // Sort by date, most recent first
    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      data: orders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message
    });
  }
};

// Get specific order
exports.getOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Database.read(ORDERS_COLLECTION, orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user is authorized to view this order
    if (order.userId !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this order'
      });
    }

    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching order',
      error: error.message
    });
  }
};

// Create order from cart
exports.createOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { shippingAddress, paymentMethod, notes } = req.body;

    // Get user's cart
    const cart = await Database.findBy(CARTS_COLLECTION, 'userId', userId);
    if (!cart || !cart.items || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty'
      });
    }

    if (!shippingAddress) {
      return res.status(400).json({
        success: false,
        message: 'Shipping address is required'
      });
    }

    // Shipping is now always free
    const subtotal = cart.total || 0;
    const shippingCost = 0;
    const logoCharge = (cart.items || []).reduce((s, item) => {
      const cust = item.customization || {};
      return s + (cust.logoUrl ? 100 * (item.quantity || 1) : 0);
    }, 0);
    const orderTotal = subtotal + logoCharge;

    // Proactively ensure columns (for cases where schema migrations lag)
    try {
      const pool = getPgPool();
      if (pool) {
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0;`).catch(() => {});
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS transaction_id TEXT;`).catch(() => {});
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;`).catch(() => {});
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number TEXT;`).catch(() => {});
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_gateway TEXT;`).catch(() => {});
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS logo_charge NUMERIC DEFAULT 0;`).catch(() => {});
      }
    } catch (_) {}

    // Create order
    const orderId = `ORD-${Date.now()}`;
    let newOrder;
    try {
      newOrder = await Database.create(ORDERS_COLLECTION, {
        id: orderId,
        _id: orderId,
        orderId,
        userId,
        items: cart.items,
        shippingAddress,
        subtotal,
        shippingCost,
        logoCharge,
        amount: orderTotal,
        paymentMethod: paymentMethod || 'esewa',
        notes: notes || '',
        total: orderTotal,
        status: ORDER_STATUS.PENDING,
        paymentStatus: PAYMENT_STATUS.PENDING,
        trackingNumber: `BT${Date.now()}${Math.floor(Math.random() * 1000)}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    } catch (createErr) {
      const isDup = createErr && (createErr.code === 11000 || createErr.code === '23505' || (createErr.detail && createErr.detail.includes('already exists')));
      if (isDup) {
        // Handle duplicate orderId gracefully (e.g. retry)
        const existing = await Database.findBy(ORDERS_COLLECTION, 'orderId', orderId);
        if (existing) {
          return res.json({
            success: true,
            message: 'Order already exists',
            data: existing
          });
        }
      }
      console.error('Direct order create failed:', createErr.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to create order due to temporary issue. Please try again.',
        error: createErr.message
      });
    }

    // Clear cart
    cart.items = [];
    cart.total = 0;
    await Database.update(CARTS_COLLECTION, cart.id || cart._id, {
      items: cart.items,
      total: cart.total,
      updatedAt: new Date().toISOString()
    });

    // Create real admin notification (system-wide) + personal notification for the customer if logged in
    const orderNum = newOrder.orderId || newOrder.id || '';
    const customerName = shippingAddress?.name || 'Customer';
    notify({
      userId: null,
      type: 'order',
      title: 'New Order Received',
      message: `Order ${orderNum} placed by ${customerName} for Rs. ${newOrder.total || 0}`,
      link: `/admin/orders/${newOrder.id || newOrder._id || orderNum}`
    });
    if (userId) {
      notify({
        userId,
        type: 'order',
        title: 'Order Placed Successfully',
        message: `Your order ${orderNum} has been received. Total: Rs. ${newOrder.total || 0}`,
        link: `/orders`
      });
    }

    sendAdminNewOrderEmail(newOrder).catch((err) => {
      console.error('[AdminOrderEmail] Non-fatal new order alert error:', err.message);
    });

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: newOrder
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating order',
      error: error.message
    });
  }
};

// Update order status (admin only)
exports.updateOrderStatus = async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can update order status'
      });
    }

    const { orderId } = req.params;
    const { status } = req.body;

    if (!Object.values(ORDER_STATUS).includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order status'
      });
    }

    const updated = await Database.update(ORDERS_COLLECTION, orderId, {
      ...req.body,
      status,
      updatedAt: new Date().toISOString()
    });

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Notify the customer of the status change (user-specific notification)
    if (updated.userId) {
      notify({
        userId: updated.userId,
        type: 'order',
        title: 'Order Status Updated',
        message: `Your order ${updated.orderId || updated.id} is now ${status}.`,
        link: `/orders`
      });
    }

    // Send real-time email notification to customer's registered / shipping email
    sendOrderStatusEmail(updated, status).catch(err => {
      console.error('[OrderStatusEmail] Non-fatal error:', err.message);
    });

    res.json({
      success: true,
      message: 'Order status updated',
      data: updated
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating order',
      error: error.message
    });
  }
};

// Track order
exports.trackOrder = async (req, res) => {
  try {
    const { trackingNumber } = req.params;
    const orders = await Database.readAll(ORDERS_COLLECTION);
    
    const order = orders.find(o => o.trackingNumber === trackingNumber);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Timeline based on status
    const timeline = {
      [ORDER_STATUS.PENDING]: [{ status: 'Pending', date: order.createdAt }],
      [ORDER_STATUS.CONFIRMED]: [
        { status: 'Pending', date: order.createdAt },
        { status: 'Confirmed', date: order.updatedAt }
      ],
      [ORDER_STATUS.PROCESSING]: [
        { status: 'Pending', date: order.createdAt },
        { status: 'Confirmed', date: order.updatedAt },
        { status: 'Processing', date: order.updatedAt }
      ],
      [ORDER_STATUS.SHIPPED]: [
        { status: 'Pending', date: order.createdAt },
        { status: 'Confirmed', date: order.updatedAt },
        { status: 'Processing', date: order.updatedAt },
        { status: 'Shipped', date: order.updatedAt }
      ],
      [ORDER_STATUS.DELIVERED]: [
        { status: 'Pending', date: order.createdAt },
        { status: 'Confirmed', date: order.updatedAt },
        { status: 'Processing', date: order.updatedAt },
        { status: 'Shipped', date: order.updatedAt },
        { status: 'Delivered', date: order.updatedAt }
      ]
    };

    res.json({
      success: true,
      data: {
        order,
        timeline: timeline[order.status] || []
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error tracking order',
      error: error.message
    });
  }
};

// Get all orders (admin only)
exports.getAllOrders = async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can view all orders'
      });
    }

    const { status, page = 1, limit = 10 } = req.query;
    let orders = await Database.readAll(ORDERS_COLLECTION);

    // Filter by status
    if (status) {
      orders = orders.filter(o => o.status === status);
    }

    // Sort by date, most recent first
    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip = (pageNum - 1) * limitNum;
    const paginatedOrders = orders.slice(skip, skip + limitNum);

    res.json({
      success: true,
      data: paginatedOrders,
      pagination: {
        total: orders.length,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(orders.length / limitNum)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message
    });
  }
};

// Cancel order
exports.cancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Database.read(ORDERS_COLLECTION, orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check authorization
    if (order.userId !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this order'
      });
    }

    // Only allow cancellation of pending or confirmed orders
    if (![ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel order with status: ${order.status}`
      });
    }

    const updated = await Database.update(ORDERS_COLLECTION, orderId, {
      status: ORDER_STATUS.CANCELLED,
      updatedAt: new Date().toISOString()
    });

    // Send cancellation email (real-time)
    sendOrderStatusEmail(updated, ORDER_STATUS.CANCELLED).catch(err => {
      console.error('[OrderCancelEmail] Non-fatal error:', err.message);
    });

    // Also surface in-app notification if possible
    if (updated && updated.userId) {
      notify({
        userId: updated.userId,
        type: 'order',
        title: 'Order Cancelled',
        message: `Your order ${updated.orderId || updated.id} has been cancelled.`,
        link: `/orders`
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: 'Order cancelled successfully',
      data: updated
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error cancelling order',
      error: error.message
    });
  }
};

// Download invoice as PDF for a user's order
exports.downloadInvoice = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Find order (support multiple id fields)
    let order = await Database.findBy(ORDERS_COLLECTION, 'orderId', orderId);
    if (!order) order = await Database.findBy(ORDERS_COLLECTION, 'id', orderId);
    if (!order) order = await Database.findBy(ORDERS_COLLECTION, '_id', orderId);
    if (!order) order = await Database.read(ORDERS_COLLECTION, orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Authorization: owner or admin
    const isOwner = order.userId === userId;
    const isAdmin = userRole === 'admin' || userRole === 'super_admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to download invoice for this order'
      });
    }

    // Generate PDF
    const doc = new PDFDocument({ margin: 50 });
    const filename = `Invoice_${order.orderId || order.id || 'unknown'}.pdf`;

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Pipe PDF directly to response
    doc.pipe(res);

    // Header
    doc.fontSize(24).text('AAOMS', { align: 'center' });
    doc.fontSize(12).text('Invoice', { align: 'center' });
    doc.moveDown();

    // Invoice meta
    const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'N/A';
    doc.fontSize(10)
      .text(`Invoice #: ${order.orderId || order.id}`, { align: 'left' })
      .text(`Date: ${orderDate}`)
      .text(`Status: ${order.status || 'N/A'}`)
      .text(`Payment: ${order.paymentMethod || 'N/A'}`)
      .moveDown();

    // Billing / Shipping
    doc.fontSize(12).text('Bill To / Ship To:', { underline: true });
    const ship = order.shippingAddress || {};
    doc.fontSize(10)
      .text(ship.name || 'N/A')
      .text(ship.address || '')
      .text(`${ship.city || ''}, ${ship.state || ''} ${ship.pincode || ''}`)
      .text(ship.phone || '')
      .moveDown();

    // Items table header
    doc.fontSize(11).text('Items', { underline: true }).moveDown(0.5);
    const tableTop = doc.y;
    const colWidths = [250, 60, 80, 80]; // name, qty, price, total
    let y = tableTop;

    // Header row
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Item', 50, y);
    doc.text('Qty', 300, y);
    doc.text('Price', 360, y);
    doc.text('Total', 440, y);
    y += 15;
    doc.font('Helvetica').fontSize(9);

    // Draw line
    doc.moveTo(50, y).lineTo(550, y).stroke();
    y += 5;

    // Items
    const items = Array.isArray(order.items) ? order.items : [];
    let subtotalCalc = 0;
    items.forEach(item => {
      const name = item.name || 'Product';
      const qty = item.quantity || 1;
      const price = Number(item.price || 0);
      const lineTotal = price * qty;
      subtotalCalc += lineTotal;

      // Truncate long names
      const displayName = name.length > 40 ? name.substring(0, 37) + '...' : name;

      doc.text(displayName, 50, y);
      doc.text(String(qty), 300, y);
      doc.text(`Rs.${price.toFixed(2)}`, 360, y);
      doc.text(`Rs.${lineTotal.toFixed(2)}`, 440, y);
      y += 15;

      // Optional size/color/custom
      if (item.size || item.color || (item.customization && (item.customization.name || item.customization.logoUrl))) {
        const details = [];
        if (item.size) details.push(`Size: ${item.size}`);
        if (item.color) details.push(`Color: ${item.color}`);
        if (item.customization) {
          if (item.customization.name) details.push(`Custom: ${item.customization.name}`);
          if (item.customization.logoUrl) details.push('Logo');
        }
        if (details.length) {
          doc.fontSize(8).fillColor('#555').text(details.join(' | '), 55, y);
          doc.fillColor('#000').fontSize(9);
          y += 12;
        }
      }
    });

    y += 10;
    doc.moveTo(50, y).lineTo(550, y).stroke();
    y += 15;

    // Totals
    const sub = Number(order.subtotal || subtotalCalc || 0);
    const logoC = Number(order.logoCharge || 0);
    const total = Number(order.total || order.amount || (sub + logoC));

    doc.text(`Subtotal: Rs.${sub.toFixed(2)}`, 360, y); y += 15;
    if (logoC > 0) {
      doc.text(`Logo Charge: Rs.${logoC.toFixed(2)}`, 360, y); y += 15;
    }
    doc.font('Helvetica-Bold').text(`Total: Rs.${total.toFixed(2)}`, 360, y);
    doc.font('Helvetica');

    y += 30;

    // Footer note
    doc.fontSize(9).text('Thank you for shopping with AAOMS!', { align: 'center' });
    doc.text('For questions, contact support@aaoms.com or visit /contact', { align: 'center' });

    // Finalize PDF
    doc.end();

    // Note: response is already being streamed; do not send additional json
  } catch (error) {
    console.error('Invoice generation error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to generate invoice',
        error: error.message
      });
    }
  }
};
