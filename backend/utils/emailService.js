const nodemailer = require('nodemailer');
const Database = require('../models/DatabaseAdapter');

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const hasHost = !!process.env.SMTP_HOST;
  const hasServiceOrMail = !!(process.env.SMTP_SERVICE || process.env.SMTP_MAIL);

  if (!hasHost && !hasServiceOrMail) {
    return null;
  }

  try {
    if (hasHost) {
      cachedTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER || process.env.SMTP_MAIL,
          pass: process.env.SMTP_PASS
        }
      });
    } else {
      cachedTransporter = nodemailer.createTransport({
        service: process.env.SMTP_SERVICE || 'gmail',
        auth: {
          user: process.env.SMTP_MAIL,
          pass: process.env.SMTP_PASS
        }
      });
    }
    return cachedTransporter;
  } catch (e) {
    console.error('[EmailService] Failed to create transporter:', e.message);
    return null;
  }
}

async function sendEmail({ to, subject, html, text }) {
  const transporter = getTransporter();
  if (!transporter || !to) {
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[EmailService] Skipped email (no SMTP configured or no recipient): ${subject}`);
    }
    return { skipped: true };
  }

  const from = process.env.EMAIL_FROM || `"AAOMS" <${process.env.SMTP_MAIL || process.env.SMTP_USER || 'orders@aaoms.com'}>`;

  try {
    const info = await transporter.sendMail({
      from,
      to: String(to).trim(),
      subject: String(subject || 'AAOMS Update'),
      text: text || '',
      html: html || ''
    });
    console.log(`[EmailService] ✓ Sent "${subject}" to ${to} (id: ${info.messageId || 'n/a'})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[EmailService] ✗ Failed to send "${subject}" to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

function getOrderStatusLabel(status) {
  const labels = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    processing: 'Processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
  };
  return labels[String(status || '').toLowerCase()] || (status ? String(status).charAt(0).toUpperCase() + String(status).slice(1) : 'Updated');
}

function getStatusMessage(status, orderNum) {
  const s = String(status || '').toLowerCase();
  switch (s) {
    case 'pending':
      return 'We have received your order and it is currently awaiting confirmation and payment processing.';
    case 'confirmed':
      return 'Your payment has been successfully confirmed. We are now preparing your order for shipment.';
    case 'processing':
      return 'Your order is being processed and packed with care. It will soon be handed over to our shipping partner.';
    case 'shipped':
      return 'Exciting news — your order has been shipped! It is now in transit and on its way to you.';
    case 'delivered':
      return 'Your order has been delivered. Thank you for shopping with AAOMS! We hope you enjoy your purchase.';
    case 'cancelled':
      return 'Your order has been cancelled. Any payment made will be processed for refund according to our policy. Please contact support if you need assistance.';
    default:
      return `The status of your order #${orderNum} has been updated to "${getOrderStatusLabel(status)}".`;
  }
}

function formatOrderDate(dateValue) {
  if (!dateValue) return new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  try {
    return new Date(dateValue).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return String(dateValue);
  }
}

function getOrderCustomerDetails(order) {
  const ship = order?.shippingAddress || {};
  const name =
    ship.name ||
    [ship.firstName, ship.lastName].filter(Boolean).join(' ').trim() ||
    'Customer';
  const email = ship.email || order?.email || '';
  const phone = ship.phone || '';
  return { name, email, phone };
}

async function getAdminNotificationEmails() {
  const configured = (process.env.ADMIN_EMAIL || process.env.SMTP_MAIL || process.env.SMTP_USER || '')
    .split(',')
    .map((email) => email.trim())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

  if (configured.length > 0) {
    return [...new Set(configured)];
  }

  try {
    const users = await Database.readAll('users');
    const adminEmails = (users || [])
      .filter((user) =>
        (user.role === 'admin' || user.role === 'super_admin') &&
        user.isActive !== false &&
        user.email
      )
      .map((user) => String(user.email).trim().toLowerCase());

    let dedicatedAdmins = [];
    try {
      dedicatedAdmins = await Database.readAll('admins') || [];
    } catch (_) {}

    dedicatedAdmins.forEach((admin) => {
      if (admin?.email && admin.isActive !== false && admin.is_active !== false) {
        adminEmails.push(String(admin.email).trim().toLowerCase());
      }
    });

    return [...new Set(adminEmails.filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
  } catch (e) {
    console.warn('[EmailService] Admin email lookup failed:', e.message);
    return [];
  }
}

async function getRecipientEmail(order) {
  if (!order) return null;

  // 1. Preferred: shipping address email captured at checkout
  const shipEmail = order.shippingAddress && order.shippingAddress.email;
  if (shipEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(shipEmail).trim())) {
    return String(shipEmail).trim().toLowerCase();
  }

  // 2. Direct on order (rare)
  if (order.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(order.email).trim())) {
    return String(order.email).trim().toLowerCase();
  }

  // 3. Lookup registered user email via userId
  const userId = order.userId || order.user_id;
  if (userId) {
    try {
      let user = await Database.findBy('users', 'id', userId);
      if (!user) user = await Database.findBy('users', 'id', String(userId));
      if (user && user.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) {
        return String(user.email).trim().toLowerCase();
      }
    } catch (e) {
      console.warn('[EmailService] User lookup for email failed:', e.message);
    }
  }
  return null;
}

async function sendOrderStatusEmail(order, explicitStatus = null) {
  if (!order) return { skipped: true, reason: 'no-order' };

  const status = explicitStatus || order.status || order.Status || 'updated';
  const orderNum = order.orderId || order.id || order._id || 'N/A';
  const to = await getRecipientEmail(order);

  if (!to) {
    console.warn(`[EmailService] No valid recipient email found for order #${orderNum} (userId=${order.userId || 'n/a'})`);
    return { skipped: true, reason: 'no-recipient' };
  }

  const customerName = (order.shippingAddress && order.shippingAddress.name) || 'Valued Customer';
  const statusLabel = getOrderStatusLabel(status);
  const message = getStatusMessage(status, orderNum);
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const orderLink = `${frontendUrl}/orders`;
  const trackLink = order.trackingNumber 
    ? `${frontendUrl}/track-order?tracking=${encodeURIComponent(order.trackingNumber)}` 
    : `${frontendUrl}/orders`;

  const total = Number(order.total || order.amount || order.subtotal || 0).toFixed(2);

  // Compact items list (max 4)
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsList = items.slice(0, 4).map(i => {
    const qty = i.quantity || 1;
    const price = (i.price || 0) * qty;
    const nm = i.name || i.productName || 'Item';
    return `<li style="margin:4px 0;">${nm} × ${qty} — <strong>Rs. ${price.toFixed(2)}</strong></li>`;
  }).join('');
  const extra = items.length > 4 ? `<li style="color:#666;font-size:12px;">+ ${items.length - 4} more item(s)</li>` : '';

  const subject = `AAOMS Order #${orderNum} Status: ${statusLabel}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background:#f5f5f5; margin:0; padding:20px; color:#222; }
    .container { max-width: 620px; margin: 0 auto; background:#ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
    .header { background: #1a1a1a; color: #fff; padding: 24px 20px; text-align: center; }
    .logo { font-size: 22px; letter-spacing: 3px; font-weight: 700; }
    .content { padding: 28px 26px; line-height: 1.6; }
    .greeting { font-size: 15px; margin-bottom: 12px; }
    .status { display: inline-block; background: #c9a227; color: #000; font-weight: 700; font-size: 13px; padding: 5px 14px; border-radius: 999px; letter-spacing: .5px; margin: 8px 0 14px; }
    .message { font-size: 14.5px; color: #333; }
    .order-summary { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 16px 18px; margin: 18px 0; }
    .order-summary h4 { margin: 0 0 8px; font-size: 13px; color: #555; letter-spacing: .5px; }
    .items { margin: 8px 0 4px; padding-left: 18px; font-size: 13.5px; }
    .items li { margin-bottom: 3px; }
    .total { font-weight: 700; margin-top: 10px; font-size: 14px; }
    .actions { text-align: center; margin: 22px 0 6px; }
    .btn { display: inline-block; background: #111; color: #fff; text-decoration: none; padding: 11px 22px; border-radius: 6px; font-weight: 600; font-size: 13px; margin: 0 4px 6px; }
    .btn.secondary { background: #c9a227; color: #000; }
    .meta { font-size: 12px; color: #666; margin-top: 16px; }
    .footer { background: #f8f8f8; padding: 16px 20px; font-size: 11px; color: #777; text-align: center; line-height: 1.5; }
    .footer a { color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">AAOMS</div>
      <div style="font-size:10px;opacity:0.7;margin-top:3px;letter-spacing:1.5px;">ORDER UPDATE</div>
    </div>
    <div class="content">
      <p class="greeting">Hello ${customerName},</p>
      
      <p class="message">The status of your order <strong>#${orderNum}</strong> has changed.</p>
      
      <div>
        <strong>Current Status:</strong><br>
        <span class="status">${statusLabel}</span>
      </div>

      <p class="message">${message}</p>

      <div class="order-summary">
        <h4>ORDER SUMMARY</h4>
        <ul class="items">
          ${itemsList || '<li>Item details available in your account.</li>'}
          ${extra}
        </ul>
        <div class="total">Total: Rs. ${total}</div>
        ${order.trackingNumber ? `<div style="margin-top:6px;font-size:13px;"><strong>Tracking Number:</strong> ${order.trackingNumber}</div>` : ''}
      </div>

      <div class="actions">
        <a href="${orderLink}" class="btn">VIEW MY ORDERS</a>
        ${order.trackingNumber ? `<a href="${trackLink}" class="btn secondary">TRACK PACKAGE</a>` : ''}
      </div>

      <p class="meta">If this update seems unexpected, or you need help, please reply to this email or reach out via our support channels.</p>
    </div>
    <div class="footer">
      Thank you for choosing AAOMS.<br>
      © ${new Date().getFullYear()} AAOMS — Worldwide travel-inspired fashion &amp; accessories since 2019.<br>
      <a href="${frontendUrl}">aaoms.com</a>
    </div>
  </div>
</body>
</html>`;

  const text = `Hello ${customerName},

Your AAOMS order #${orderNum} status is now: ${statusLabel}.

${message}

Order Total: Rs. ${total}
${order.trackingNumber ? `Tracking: ${order.trackingNumber}\n` : ''}
View order: ${orderLink}
Track: ${trackLink}

Thank you for shopping with AAOMS!`;

  return sendEmail({ to, subject, html, text });
}

async function sendAdminNewOrderEmail(order) {
  if (!order) return { skipped: true, reason: 'no-order' };

  const recipients = await getAdminNotificationEmails();
  if (!recipients.length) {
    console.warn('[EmailService] No admin notification email configured for new order alert');
    return { skipped: true, reason: 'no-admin-recipient' };
  }

  let customer = getOrderCustomerDetails(order);
  if (!customer.email) {
    const resolvedEmail = await getRecipientEmail(order);
    if (resolvedEmail) {
      customer = { ...customer, email: resolvedEmail };
    }
  }

  const orderId = order.orderId || order.id || order._id || 'N/A';
  const orderTotal = Number(order.total || order.amount || order.subtotal || 0).toFixed(2);
  const orderDate = formatOrderDate(order.createdAt || order.created_at);
  const customerName = customer.name || 'Customer';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const adminOrderLink = `${frontendUrl}/admin/orders`;

  const subject = `New Order Received from ${customerName}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background:#f5f5f5; margin:0; padding:20px; color:#222; }
    .container { max-width: 620px; margin: 0 auto; background:#ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
    .header { background: #1a1a1a; color: #fff; padding: 24px 20px; text-align: center; }
    .logo { font-size: 22px; letter-spacing: 3px; font-weight: 700; }
    .content { padding: 28px 26px; line-height: 1.6; }
    .alert { display: inline-block; background: #c9a227; color: #000; font-weight: 700; font-size: 13px; padding: 5px 14px; border-radius: 999px; letter-spacing: .5px; margin: 8px 0 16px; }
    .details { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 18px 20px; margin: 18px 0; }
    .details-row { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; }
    .details-row:last-child { border-bottom: none; }
    .details-label { color: #666; font-weight: 600; min-width: 130px; }
    .details-value { color: #222; text-align: right; word-break: break-word; }
    .actions { text-align: center; margin: 22px 0 6px; }
    .btn { display: inline-block; background: #111; color: #fff; text-decoration: none; padding: 11px 22px; border-radius: 6px; font-weight: 600; font-size: 13px; }
    .footer { background: #f8f8f8; padding: 16px 20px; font-size: 11px; color: #777; text-align: center; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">AAOMS</div>
      <div style="font-size:10px;opacity:0.7;margin-top:3px;letter-spacing:1.5px;">ADMIN ALERT</div>
    </div>
    <div class="content">
      <p style="font-size:15px;margin:0 0 8px;">A new order has been placed on AAOMS.</p>
      <span class="alert">NEW ORDER</span>

      <div class="details">
        <div class="details-row">
          <span class="details-label">Order ID</span>
          <span class="details-value"><strong>#${orderId}</strong></span>
        </div>
        <div class="details-row">
          <span class="details-label">Customer Name</span>
          <span class="details-value">${customerName}</span>
        </div>
        <div class="details-row">
          <span class="details-label">Email</span>
          <span class="details-value">${customer.email || 'Not provided'}</span>
        </div>
        <div class="details-row">
          <span class="details-label">Phone Number</span>
          <span class="details-value">${customer.phone || 'Not provided'}</span>
        </div>
        <div class="details-row">
          <span class="details-label">Order Total</span>
          <span class="details-value"><strong>Rs. ${orderTotal}</strong></span>
        </div>
        <div class="details-row">
          <span class="details-label">Order Date</span>
          <span class="details-value">${orderDate}</span>
        </div>
      </div>

      <div class="actions">
        <a href="${adminOrderLink}" class="btn">VIEW ORDERS IN ADMIN PANEL</a>
      </div>
    </div>
    <div class="footer">
      This is an automated admin notification from AAOMS.<br>
      © ${new Date().getFullYear()} AAOMS — All Rights Reserved
    </div>
  </div>
</body>
</html>`;

  const text = `New Order Received from ${customerName}

Order ID: #${orderId}
Customer Name: ${customerName}
Email: ${customer.email || 'Not provided'}
Phone Number: ${customer.phone || 'Not provided'}
Order Total: Rs. ${orderTotal}
Order Date: ${orderDate}

View orders: ${adminOrderLink}`;

  return sendEmail({
    to: recipients.join(', '),
    subject,
    html,
    text
  });
}

async function sendSignupOtpEmail(email, code) {
  const subject = 'Your AAOMS Verification Code';
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background:#f5f5f5; margin:0; padding:20px; color:#222; }
    .container { max-width: 520px; margin: 0 auto; background:#ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
    .header { background: #1a1a1a; color: #fff; padding: 24px 20px; text-align: center; }
    .logo { font-size: 22px; letter-spacing: 3px; font-weight: 700; }
    .content { padding: 28px 26px; line-height: 1.6; text-align: center; }
    .code { display: inline-block; font-size: 32px; font-weight: 700; letter-spacing: 8px; background: #fafafa; border: 2px dashed #c9a227; border-radius: 8px; padding: 16px 28px; margin: 16px 0; color: #111; }
    .footer { background: #f8f8f8; padding: 16px 20px; font-size: 11px; color: #777; text-align: center; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">AAOMS</div>
      <div style="font-size:10px;opacity:0.7;margin-top:3px;letter-spacing:1.5px;">EMAIL VERIFICATION</div>
    </div>
    <div class="content">
      <p style="font-size:15px;color:#333;margin:0 0 8px;">Use this code to verify your email and complete signup:</p>
      <div class="code">${code}</div>
      <p style="font-size:13px;color:#666;margin:12px 0 0;">This code expires in <strong>5 minutes</strong>. Do not share it with anyone.</p>
    </div>
    <div class="footer">
      If you didn't request this code, you can safely ignore this email.<br>
      © ${new Date().getFullYear()} AAOMS — All Rights Reserved
    </div>
  </div>
</body>
</html>`;

  const text = `Your AAOMS verification code is ${code}. Valid for 5 minutes. Do not share this code with anyone.`;

  return sendEmail({ to: email, subject, html, text });
}

module.exports = {
  sendEmail,
  sendSignupOtpEmail,
  sendAdminNewOrderEmail,
  sendOrderStatusEmail,
  getTransporter,
  getRecipientEmail,
  getAdminNotificationEmails,
  getOrderStatusLabel
};
