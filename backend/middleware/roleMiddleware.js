// Role-based access control middleware
const jwt = require('jsonwebtoken');

// Check if user is authenticated
const protect = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided. Please login first.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
      error: error.message
    });
  }
};

// Check if user is customer
const customerOnly = (req, res, next) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({
      success: false,
      message: 'This action is only for customers'
    });
  }
  next();
};

// Check if user is admin or super_admin
const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
  next();
};

// Check if user is super_admin
const superAdminOnly = (req, res, next) => {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({
      success: false,
      message: 'Super Admin access required'
    });
  }
  next();
};

// Get user role level (for flexible checking)
const hasRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${allowedRoles.join(', ')}`
      });
    }
    next();
  };
};

module.exports = {
  protect,
  customerOnly,
  adminOnly,
  superAdminOnly,
  hasRole
};
