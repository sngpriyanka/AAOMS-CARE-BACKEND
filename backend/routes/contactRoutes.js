const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');
const { protect, adminOnly } = require('../middleware/roleMiddleware');

// Public: customer submits the Contact Us form
router.post('/submit', contactController.submitContactMessage);

// Admin protected routes
router.get('/', protect, adminOnly, contactController.getAllContactMessages);
router.get('/:id', protect, adminOnly, contactController.getContactMessage);
router.patch('/:id/status', protect, adminOnly, contactController.updateStatus);
router.post('/:id/reply', protect, adminOnly, contactController.replyToMessage);
router.delete('/:id', protect, adminOnly, contactController.deleteContactMessage);

module.exports = router;
