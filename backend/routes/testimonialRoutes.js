const express = require('express');
const router = express.Router();
const testimonialController = require('../controllers/testimonialController');
const { protect, adminOnly } = require('../middleware/roleMiddleware');

router.get('/', testimonialController.getTestimonials);
router.get('/admin/all', protect, adminOnly, testimonialController.getAllTestimonials);
router.get('/:id', protect, adminOnly, testimonialController.getTestimonialById);
router.post('/', protect, adminOnly, testimonialController.createTestimonial);
router.put('/:id', protect, adminOnly, testimonialController.updateTestimonial);
router.delete('/:id', protect, adminOnly, testimonialController.deleteTestimonial);

module.exports = router;