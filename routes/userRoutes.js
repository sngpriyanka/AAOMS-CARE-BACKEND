const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect, adminOnly, superAdminOnly, hasRole } = require('../middleware/roleMiddleware');

// ==================== CUSTOMER ROUTES ====================
// Any authenticated user (customer, admin, super_admin)
router.get('/profile/:userId', protect, userController.getUserById);
router.put('/profile/:userId', protect, userController.updateUserProfile);
router.post('/change-password/:userId', protect, userController.changePassword);
router.post('/:userId/change-password', protect, userController.changePassword);

// ==================== ADMIN ROUTES ====================
// Admin or Super Admin can access
router.get('/admin/users/all', protect, adminOnly, userController.getAllUsers);
router.delete('/admin/users/:userId', protect, adminOnly, userController.deleteUser);
router.put('/admin/users/:userId/toggle-status', protect, adminOnly, userController.toggleUserStatus);

// ==================== SUPER ADMIN ROUTES ====================
// Only Super Admin can access
router.post('/super-admin/promote/:userId', protect, superAdminOnly, userController.promoteToAdmin);
router.post('/super-admin/demote/:userId', protect, superAdminOnly, userController.demoteAdmin);
router.get('/super-admin/all-users', protect, superAdminOnly, userController.getAllUsers);
router.post('/super-admin/logs', protect, superAdminOnly, userController.getActivityLogs);

// Dedicated Admin Management (create/view/update real admins with role/status)
router.get('/super-admin/admins', protect, superAdminOnly, userController.getAllAdmins);
router.post('/super-admin/admins', protect, superAdminOnly, userController.createAdmin);
router.put('/super-admin/admins/:adminId', protect, superAdminOnly, userController.updateAdmin);
router.delete('/super-admin/admins/:adminId', protect, superAdminOnly, userController.deleteAdmin);
router.post('/super-admin/admins/:adminId/reset-password', protect, superAdminOnly, userController.resetAdminPassword);
router.put('/super-admin/admins/:adminId/toggle-status', protect, superAdminOnly, userController.toggleAdminStatus);

module.exports = router;
