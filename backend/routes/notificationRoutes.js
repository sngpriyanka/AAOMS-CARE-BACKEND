const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { protect, adminOnly } = require('../middleware/roleMiddleware');

// Any authenticated user can get their own notifications (personal + system for admins)
router.get('/', protect, notificationController.getMyNotifications);

// Fast unread count for Navbar bell (no full list)
router.get('/unread-count', protect, notificationController.getUnreadCount);

// Admin-only: view everything
router.get('/all', protect, adminOnly, notificationController.getAllNotifications);

// Create notification (admins or internal use; protected here)
router.post('/', protect, notificationController.createNotification);

// Mark as read (any authenticated)
router.patch('/:id/read', protect, notificationController.markAsRead);

// Mark all visible as read
router.post('/mark-all-read', protect, notificationController.markAllAsRead);

// Delete (owner or admin)
router.delete('/:id', protect, notificationController.deleteNotification);

module.exports = router;
