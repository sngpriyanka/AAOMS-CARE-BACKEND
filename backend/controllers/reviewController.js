const Database = require('../models/DatabaseAdapter');
const { v4: uuidv4 } = require('uuid');
const { notify } = require('./notificationController');

const COLLECTION = 'reviews';

// Public: get approved reviews for a product
exports.getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;
    let reviews = await Database.readAll(COLLECTION);
    
    reviews = reviews.filter(r => 
      r.productId === productId && 
      (r.status === 'approved' || !r.status) // treat missing as approved for legacy
    );
    
    reviews.sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
    
    res.json({
      success: true,
      data: reviews
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching reviews',
      error: error.message
    });
  }
};

// Public or customer: create a review (defaults to pending)
exports.createReview = async (req, res) => {
  try {
    const { productId, productName, name, email, rating, title, review, size, images, location } = req.body;
    
    if (!productId || !name || !email || !rating || !review) {
      return res.status(400).json({
        success: false,
        message: 'productId, name, email, rating and review are required'
      });
    }
    
    const id = uuidv4();
    const reviewData = {
      id,
      _id: id,
      productId,
      productName: productName || '',
      name,
      email,
      userId: req.user?.id || null,  // associate if logged in
      rating: Number(rating),
      title: title || '',
      review,
      size: size || '',
      images: Array.isArray(images) ? images : [],
      location: location || '',
      verified: false, // verified purchase can be set later or by order check
      helpful: 0,
      status: 'pending',
      date: new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
    };
    
    const saved = await Database.create(COLLECTION, reviewData);

    // Notify admins of the new review (system-wide for admins)
    notify({
      userId: null,
      type: 'review',
      title: 'New Review Submitted',
      message: `${name} left a ${rating}-star review for ${productName || 'a product'}`,
      link: '/admin/reviews'
    });
    
    res.status(201).json({
      success: true,
      message: 'Review submitted for approval',
      data: saved
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating review',
      error: error.message
    });
  }
};

// Public: increment helpful count
exports.markHelpful = async (req, res) => {
  try {
    const { id } = req.params;
    const review = await Database.read(COLLECTION, id);
    
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }
    
    const updated = await Database.update(COLLECTION, id, {
      helpful: (review.helpful || 0) + 1
    });
    
    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating helpful count',
      error: error.message
    });
  }
};

// Admin: get all reviews
exports.getAllReviews = async (req, res) => {
  try {
    // Note: route should be protected by adminOnly
    let reviews = await Database.readAll(COLLECTION);
    reviews.sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
    
    res.json({
      success: true,
      data: reviews
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching all reviews',
      error: error.message
    });
  }
};

// Admin: update review status (approve/reject)
exports.updateReviewStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    
    const updated = await Database.update(COLLECTION, id, {
      status,
      updatedAt: new Date().toISOString()
    });
    
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }
    
    res.json({
      success: true,
      message: `Review ${status}`,
      data: updated
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating review status',
      error: error.message
    });
  }
};

// Admin: delete review
exports.deleteReview = async (req, res) => {
  try {
    const { id } = req.params;
    const success = await Database.delete(COLLECTION, id);
    
    if (!success) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }
    
    res.json({
      success: true,
      message: 'Review deleted'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting review',
      error: error.message
    });
  }
};

// Authenticated user: get my reviews (by userId or email)
exports.getMyReviews = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userEmail = req.user?.email?.toLowerCase();
    let reviews = await Database.readAll(COLLECTION) || [];

    reviews = reviews.filter(r => {
      if (userId && r.userId === userId) return true;
      if (userEmail && r.email && r.email.toLowerCase() === userEmail) return true;
      return false;
    });

    reviews.sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));

    res.json({
      success: true,
      data: reviews
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching your reviews',
      error: error.message
    });
  }
};

// Authenticated user: delete their own review (by matching userId or email)
exports.deleteMyReview = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userEmail = req.user?.email?.toLowerCase();

    const review = await Database.read(COLLECTION, id);
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    const isOwner = (review.userId && review.userId === userId) ||
                    (review.email && review.email.toLowerCase() === userEmail);

    if (!isOwner && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this review' });
    }

    const success = await Database.delete(COLLECTION, id);
    if (!success) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    res.json({
      success: true,
      message: 'Review deleted'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting review',
      error: error.message
    });
  }
};
