const Database = require('../models/DatabaseAdapter');
const { v4: uuidv4 } = require('uuid');

const COLLECTION = 'notifications';

// Helper to normalize id
const normalize = (n) => {
  if (!n) return n;
  return { ...n, id: n.id || n._id };
};

// Get notifications for current user
// - Regular users: only their own (userId matches)
// - Admins: their own + system-wide (userId null/undefined)
exports.getMyNotifications = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    const role = req.user && req.user.role;

    let notifications = await Database.readAll(COLLECTION);

    if (role === 'admin' || role === 'super_admin') {
      // Admins see system notifications + personal ones addressed to them
      notifications = notifications.filter(n =>
        !n.userId || n.userId === userId
      );
    } else {
      // Regular users see only their own
      notifications = notifications.filter(n => n.userId === userId);
    }

    // Sort newest first
    notifications.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    res.json({
      success: true,
      data: notifications.map(normalize)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching notifications',
      error: error.message
    });
  }
};

// Lightweight unread count for bell icon (respects same visibility rules)
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    const role = req.user && req.user.role;

    let notifications = await Database.readAll(COLLECTION);

    if (role === 'admin' || role === 'super_admin') {
      notifications = notifications.filter(n => !n.read && (!n.userId || n.userId === userId));
    } else {
      notifications = notifications.filter(n => !n.read && n.userId === userId);
    }

    res.json({
      success: true,
      count: notifications.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching unread count',
      error: error.message
    });
  }
};

// Admin only: get ALL notifications
exports.getAllNotifications = async (req, res) => {
  try {
    let notifications = await Database.readAll(COLLECTION);
    notifications.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    res.json({
      success: true,
      data: notifications.map(normalize)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching all notifications',
      error: error.message
    });
  }
};

// Create a notification (can be called internally or by admins)
exports.createNotification = async (req, res) => {
  try {
    const { userId, type, title, message, link } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: 'title and message are required'
      });
    }

    const id = uuidv4();
    const notificationData = {
      id,
      _id: id,
      userId: userId || null,
      type: type || 'system',
      title,
      message,
      link: link || '',
      read: false,
      createdBy: (req.user && req.user.id) || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const saved = await Database.create(COLLECTION, notificationData);

    res.status(201).json({
      success: true,
      message: 'Notification created',
      data: normalize(saved)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating notification',
      error: error.message
    });
  }
};

// Mark single notification as read
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user && req.user.id;

    const notif = await Database.read(COLLECTION, id);
    if (!notif) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    // Authorization: owner or admin
    const isOwner = notif.userId === userId || !notif.userId; // system notifs readable by admins
    const isAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'super_admin');

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const updated = await Database.update(COLLECTION, id, {
      read: true,
      updatedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      data: normalize(updated)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error marking notification as read',
      error: error.message
    });
  }
};

// Mark all (visible to me) as read
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    const role = req.user && req.user.role;

    let notifications = await Database.readAll(COLLECTION);

    let toUpdate = [];
    if (role === 'admin' || role === 'super_admin') {
      toUpdate = notifications.filter(n => !n.read && (!n.userId || n.userId === userId));
    } else {
      toUpdate = notifications.filter(n => !n.read && n.userId === userId);
    }

    for (const n of toUpdate) {
      await Database.update(COLLECTION, n.id || n._id, {
        read: true,
        updatedAt: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: `${toUpdate.length} notifications marked as read`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error marking all as read',
      error: error.message
    });
  }
};

// Delete a notification
exports.deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user && req.user.id;
    const role = req.user && req.user.role;

    const notif = await Database.read(COLLECTION, id);
    if (!notif) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    const isOwner = notif.userId === userId;
    const isAdmin = role === 'admin' || role === 'super_admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await Database.delete(COLLECTION, id);

    res.json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting notification',
      error: error.message
    });
  }
};

// Internal helper for other controllers (import and call notify(...) )
exports.notify = async ({ userId = null, type = 'system', title, message, link = '' }) => {
  try {
    if (!title || !message) return null;

    const id = uuidv4();
    const data = {
      id,
      _id: id,
      userId: userId || null,
      type,
      title,
      message,
      link,
      read: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const saved = await Database.create(COLLECTION, data);

    // Optional: fire email for high-value admin notifications (new order, new user, etc.)
    // Only attempts if SMTP env is configured (reuses pattern from authController)
    // Order alerts use sendAdminNewOrderEmail() with full order details.
    if (!userId && ['user', 'alert'].includes(type)) {
      try {
        const nodemailer = require('nodemailer');
        if (process.env.SMTP_HOST && process.env.SMTP_USER) {
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS
            }
          });

          const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
          await transporter.sendMail({
            from: process.env.EMAIL_FROM || `"AAOMS CARE" <${process.env.SMTP_USER}>`,
            to: adminEmail,
            subject: `[AAOMS CARE] ${title}`,
            text: message + (link ? `\n\nLink: ${process.env.FRONTEND_URL || ''}${link}` : ''),
            html: `<p>${message}</p>${link ? `<p><a href="${process.env.FRONTEND_URL || ''}${link}">View in panel</a></p>` : ''}`
          }).catch(() => {}); // never break main flow
        }
      } catch (_) {
        // Email is best-effort only
      }
    }

    return saved;
  } catch (e) {
    console.error('Failed to create notification:', e.message);
    return null;
  }
};
