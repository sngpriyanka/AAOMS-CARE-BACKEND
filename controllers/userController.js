const Database = require('../models/DatabaseAdapter');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { toPhone10, formatIndianPhone } = require('../utils/phoneUtils');
const { validatePhoneOrEmpty, INDIAN_MOBILE_ERROR } = require('../utils/validators');

const USERS_COLLECTION = 'users';
const ADMINS_COLLECTION = 'admins';

// Profile phone OTP temporarily disabled — users can add/update phone without SMS verification.
const PROFILE_PHONE_OTP_ENABLED = false;

// Get all users (admin only)
exports.getAllUsers = async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can view all users'
      });
    }

    const { search, role, page = 1, limit = 10 } = req.query;
    let users = await Database.readAll(USERS_COLLECTION);

    // Filter by role
    if (role) {
      users = users.filter(u => u.role === role);
    }

    // Search by name or email
    if (search) {
      const searchLower = search.toLowerCase();
      users = users.filter(u => 
        u.name.toLowerCase().includes(searchLower) ||
        u.email.toLowerCase().includes(searchLower)
      );
    }

    // Remove passwords from response
    users = users.map(({ password, ...user }) => user);

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip = (pageNum - 1) * limitNum;
    const paginatedUsers = users.slice(skip, skip + limitNum);

    res.json({
      success: true,
      data: paginatedUsers,
      pagination: {
        total: users.length,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(users.length / limitNum)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching users',
      error: error.message
    });
  }
};

// Get user by ID
exports.getUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    // Check authorization
    if (userId !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this user'
      });
    }

    const user = await Database.read(USERS_COLLECTION, userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const { password, ...userWithoutPassword } = user;
    res.json({
      success: true,
      data: userWithoutPassword
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: error.message
    });
  }
};

// Update user profile
exports.updateUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, phone, address, city, state, zipcode, birthday, gender, profilePicture, profile_picture, phoneVerificationToken } = req.body;

    // Check authorization
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    if (userId !== req.user.id && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this user'
      });
    }

    // For non-admins, always target the authenticated user's id (from token) to avoid any stale/mismatched id from frontend state
    const targetUserId = isAdmin ? userId : req.user.id;

    const existingUser = await Database.read(USERS_COLLECTION, targetUserId);
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const updates = {};
    if (name) updates.name = name;

    if (phone !== undefined) {
      const phoneCheck = validatePhoneOrEmpty(phone);
      if (!phoneCheck.valid) {
        return res.status(400).json({ success: false, message: phoneCheck.message || INDIAN_MOBILE_ERROR });
      }

      const newPhone10 = phoneCheck.normalized;
      const currentPhone10 = toPhone10(existingUser.phone || '');
      const phoneIsChanging = newPhone10 !== currentPhone10;

      if (PROFILE_PHONE_OTP_ENABLED && phoneIsChanging && newPhone10) {
        if (!phoneVerificationToken) {
          return res.status(400).json({
            success: false,
            message: 'Phone verification via OTP is required before saving a new mobile number.'
          });
        }

        try {
          const decoded = jwt.verify(phoneVerificationToken, process.env.JWT_SECRET);
          if (decoded.purpose !== 'phone-profile' || decoded.phone !== newPhone10) {
            throw new Error('Phone verification token does not match provided phone');
          }
        } catch (tokenErr) {
          return res.status(400).json({
            success: false,
            message: 'Phone verification token is invalid or expired. Please verify your mobile number again.'
          });
        }
      }

      updates.phone = newPhone10 ? formatIndianPhone(newPhone10) : '';
    }
    if (address !== undefined) updates.address = address;
    if (city !== undefined) updates.city = city;
    if (state !== undefined) updates.state = state;
    if (zipcode !== undefined) updates.zipcode = zipcode;
    if (birthday !== undefined) updates.birthday = birthday;
    if (gender !== undefined) updates.gender = gender;
    // Support both camel and snake for profile pic
    const pic = profilePicture || profile_picture;
    if (pic !== undefined) updates.profilePicture = pic;

    const updated = await Database.update(USERS_COLLECTION, targetUserId, updates);
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const { password, ...userWithoutPassword } = updated;
    res.json({
      success: true,
      message: 'User profile updated successfully',
      data: userWithoutPassword
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating user',
      error: error.message
    });
  }
};

// Change password
exports.changePassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // Check authorization
    if (userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to change this user password'
      });
    }

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    // Determine the correct collection based on role from token
    const collection = (req.user.role === 'admin' || req.user.role === 'super_admin')
      ? ADMINS_COLLECTION
      : USERS_COLLECTION;

    const user = await Database.read(collection, userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const passwordMatch = bcrypt.compareSync(currentPassword, user.password);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedPassword = bcrypt.hashSync(newPassword, 10);

    await Database.update(collection, userId, { password: hashedPassword });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error changing password',
      error: error.message
    });
  }
};

// Delete user (admin only)
exports.deleteUser = async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can delete users'
      });
    }

    const { userId } = req.params;

    // Prevent self-deletion
    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    await Database.delete(USERS_COLLECTION, userId);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting user',
      error: error.message
    });
  }
};

// Promote user to admin (super admin only)
exports.promoteToAdmin = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admins can promote users'
      });
    }

    const { userId } = req.params;
    const user = await Database.read(USERS_COLLECTION, userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const updated = await Database.update(USERS_COLLECTION, userId, { role: 'admin' });

    recordActivity('User promoted to admin', req.user.id, userId);

    const { password, ...userWithoutPassword } = updated;
    res.json({
      success: true,
      message: 'User promoted to admin',
      data: userWithoutPassword
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error promoting user',
      error: error.message
    });
  }
};

// Demote admin to user (super admin only)
exports.demoteAdmin = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admins can demote admins'
      });
    }

    const { userId } = req.params;
    const user = await Database.read(USERS_COLLECTION, userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent self-demotion
    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot demote yourself'
      });
    }

    const updated = await Database.update(USERS_COLLECTION, userId, { role: 'customer' });

    recordActivity('Admin demoted to customer', req.user.id, userId);

    const { password, ...userWithoutPassword } = updated;
    res.json({
      success: true,
      message: 'User demoted to customer',
      data: userWithoutPassword
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error demoting admin',
      error: error.message
    });
  }
};

// Toggle user active status (admin only)
exports.toggleUserStatus = async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can toggle user status'
      });
    }

    const { userId } = req.params;
    const user = await Database.read(USERS_COLLECTION, userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent self-deactivation
    if (userId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate your own account'
      });
    }

    const newStatus = !user.isActive;
    const updated = await Database.update(USERS_COLLECTION, userId, { isActive: newStatus });

    const { password, ...userWithoutPassword } = updated;
    res.json({
      success: true,
      message: `User ${newStatus ? 'activated' : 'deactivated'} successfully`,
      data: userWithoutPassword
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error toggling user status',
      error: error.message
    });
  }
};

// Get activity logs (super admin only)
exports.getActivityLogs = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admins can view activity logs'
      });
    }

    const { startDate, endDate, action, page = 1, limit = 50 } = req.query;
    const LOGS_COLLECTION = 'activity_logs';
    
    let logs = await Database.readAll(LOGS_COLLECTION) || [];

    // Filter by date range
    if (startDate || endDate) {
      logs = logs.filter(log => {
        const logDate = new Date(log.created_at || log.timestamp || log.createdAt || 0);
        if (startDate && logDate < new Date(startDate)) return false;
        if (endDate && logDate > new Date(endDate)) return false;
        return true;
      });
    }

    // Filter by action
    if (action) {
      logs = logs.filter(log => log.action.includes(action));
    }

    // Sort by created_at / timestamp descending (support both column names)
    logs.sort((a, b) => new Date(b.created_at || b.timestamp || b.createdAt || 0) - new Date(a.created_at || a.timestamp || a.createdAt || 0));

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip = (pageNum - 1) * limitNum;
    const paginatedLogs = logs.slice(skip, skip + limitNum);

    res.json({
      success: true,
      data: paginatedLogs,
      pagination: {
        total: logs.length,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(logs.length / limitNum)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching activity logs',
      error: error.message
    });
  }
};

// ==================== SUPER ADMIN: ADMIN MANAGEMENT ====================

async function recordActivity(action, byUserId, target = null, details = null) {
  try {
    const LOGS = 'activity_logs';
    const now = new Date().toISOString();
    const entry = {
      id: (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)),
      action: String(action || 'action'),
      by: byUserId || null,
      target: target || null,
      details: details || null,
      timestamp: now,
      created_at: now,
      updated_at: now
    };
    await Database.create(LOGS, entry);
  } catch (e) {
    // non-fatal
    console.warn('Activity log write skipped:', e.message);
  }
}

const ADMIN_ROLES = ['admin', 'super_admin'];

// Generate a reasonably strong temporary password (10 chars)
function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let pw = '';
  for (let i = 0; i < 10; i++) {
    pw += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pw;
}

exports.getAllAdmins = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admins can access admin management'
      });
    }

    const { search, role, page = 1, limit = 50 } = req.query;

    // Pull from users collection (source of truth for role-based admins)
    let users = await Database.readAll(USERS_COLLECTION);
    let adminUsers = users.filter(u => ADMIN_ROLES.includes(u.role));

    // Also pull dedicated admins collection entries (for any that were created there) and merge
    let dedicatedAdmins = [];
    try {
      dedicatedAdmins = await Database.readAll('admins') || [];
      dedicatedAdmins = dedicatedAdmins.filter(a => a); // safety
    } catch (e) {
      dedicatedAdmins = [];
    }

    // Merge: start with adminUsers, add dedicated ones not already present by email
    const byEmail = new Map();
    adminUsers.forEach(u => {
      const key = (u.email || '').toLowerCase();
      byEmail.set(key, { ...u, _source: 'users' });
    });
    dedicatedAdmins.forEach(a => {
      const key = (a.email || '').toLowerCase();
      if (!byEmail.has(key)) {
        byEmail.set(key, { ...a, _source: 'admins' });
      }
    });

    let admins = Array.from(byEmail.values());

    // Apply role filter if provided
    if (role && ADMIN_ROLES.includes(role)) {
      admins = admins.filter(a => a.role === role);
    }

    // Search
    if (search) {
      const s = search.toLowerCase();
      admins = admins.filter(a =>
        (a.name || '').toLowerCase().includes(s) ||
        (a.email || '').toLowerCase().includes(s) ||
        (a.phone || '').toLowerCase().includes(s)
      );
    }

    // Remove sensitive + normalize shape expected by frontend
    admins = admins.map((a) => {
      const { password, resetToken, ...rest } = a;
      const id = a.id || a._id;
      return {
        ...rest,
        id,
        status: (a.isActive === false || a.is_active === false) ? 'inactive' : 'active',
        isActive: !(a.isActive === false || a.is_active === false),
        permissions: Array.isArray(a.permissions) ? a.permissions : [],
        phone: a.phone || '',
        createdAt: a.createdAt || a.created_at || new Date().toISOString(),
      };
    });

    // Sort by created desc (best effort)
    admins.sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));

    // Pagination (client can pass limit high for "all")
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit) || 50), 200);
    const skip = (pageNum - 1) * limitNum;
    const paginated = admins.slice(skip, skip + limitNum);

    res.json({
      success: true,
      data: paginated,
      pagination: {
        total: admins.length,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(admins.length / limitNum)
      }
    });
  } catch (error) {
    console.error('getAllAdmins error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching admins',
      error: error.message
    });
  }
};

exports.createAdmin = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admins can create admins'
      });
    }

    let { name, email, password, phone, role, permissions } = req.body;

    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Name and email are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    role = (role === 'super_admin') ? 'super_admin' : 'admin';
    permissions = Array.isArray(permissions) ? permissions : [];

    // Check for existing email in users or admins
    let existing = await Database.findBy(USERS_COLLECTION, 'email', normalizedEmail);
    if (!existing) {
      try {
        existing = await Database.findBy('admins', 'email', normalizedEmail);
      } catch (_) {}
    }
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' });
    }

    // Password: use provided or generate temp
    let plainPassword = password && password.length >= 6 ? password : generateTempPassword();
    const wasGenerated = !password || password.length < 6;

    const hashed = await bcrypt.hash(plainPassword, 12);
    const newId = (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)));

    let normalizedPhone = '';
    if (phone) {
      const phoneCheck = validatePhoneOrEmpty(phone);
      if (!phoneCheck.valid) {
        return res.status(400).json({ success: false, message: phoneCheck.message || INDIAN_MOBILE_ERROR });
      }
      normalizedPhone = phoneCheck.normalized ? formatIndianPhone(phoneCheck.normalized) : '';
    }

    const adminRecord = {
      id: newId,
      email: normalizedEmail,
      password: hashed,
      name: name.trim(),
      phone: normalizedPhone,
      role,
      permissions,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Always store dedicated admin accounts in users collection (consistent with role system + existing data)
    const created = await Database.create(USERS_COLLECTION, adminRecord);

    // Record activity
    recordActivity(`Created admin account (${role})`, req.user.id, created.id || created._id, { email: normalizedEmail, name: name.trim() });

    const { password: _p, ...safe } = created;

    res.status(201).json({
      success: true,
      message: 'Admin created successfully',
      data: {
        ...safe,
        id: safe.id || safe._id,
        status: 'active',
        isActive: true,
        permissions: Array.isArray(safe.permissions) ? safe.permissions : [],
      },
      // Return temp password ONLY when we generated it (one-time display to SA)
      ...(wasGenerated && { tempPassword: plainPassword })
    });
  } catch (error) {
    console.error('createAdmin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create admin',
      error: error.message
    });
  }
};

exports.updateAdmin = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admins can update admins'
      });
    }

    const { adminId } = req.params;
    const { name, phone, role, permissions, email } = req.body;

    // Find target in users (primary)
    let target = await Database.read(USERS_COLLECTION, adminId);
    let collection = USERS_COLLECTION;
    if (!target) {
      // Try admins col
      target = await Database.read('admins', adminId);
      collection = 'admins';
    }
    if (!target) {
      // Try find by email fallback? rare
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    // Prevent changing own role away from super_admin if you are the only one? (soft: allow but log)
    const updates = {};
    if (name) updates.name = name.trim();
    if (phone !== undefined) {
      const phoneCheck = validatePhoneOrEmpty(phone);
      if (!phoneCheck.valid) {
        return res.status(400).json({ success: false, message: phoneCheck.message || INDIAN_MOBILE_ERROR });
      }
      updates.phone = phoneCheck.normalized ? formatIndianPhone(phoneCheck.normalized) : '';
    }
    if (permissions) updates.permissions = Array.isArray(permissions) ? permissions : [];
    if (role && ADMIN_ROLES.includes(role)) {
      // Safety: do not let last super_admin demote self via update
      if (adminId === req.user.id && target.role === 'super_admin' && role !== 'super_admin') {
        const all = await Database.readAll(USERS_COLLECTION);
        const superCount = all.filter(u => u.role === 'super_admin' && (u.id || u._id) !== adminId).length +
                           (await (async () => { try { return (await Database.readAll('admins')).filter(a => a.role==='super_admin' && (a.id||a._id)!==adminId).length; } catch {return 0;} })());
        if (superCount === 0) {
          return res.status(400).json({ success: false, message: 'Cannot remove the last super admin' });
        }
      }
      updates.role = role;
    }
    if (email && email.toLowerCase() !== (target.email || '').toLowerCase()) {
      const newEmail = email.toLowerCase().trim();
      // uniqueness check
      let dup = await Database.findBy(USERS_COLLECTION, 'email', newEmail);
      if (!dup) { try { dup = await Database.findBy('admins', 'email', newEmail); } catch(_) {} }
      if (dup) return res.status(409).json({ success: false, message: 'Email already in use' });
      updates.email = newEmail;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }

    // Try update on the collection where we found the record.
    // If that fails (e.g. legacy row in the other table or transient issue), try the alternate collection.
    let updated = null;
    try {
      updated = await Database.update(collection, adminId, updates);
    } catch (updateErr) {
      console.warn(`updateAdmin: primary update on ${collection} failed (will try fallback):`, updateErr.message);
    }

    if (!updated) {
      const other = collection === USERS_COLLECTION ? 'admins' : USERS_COLLECTION;
      try {
        updated = await Database.update(other, adminId, updates);
        if (updated) {
          // We successfully updated the alternate collection; switch our collection for the final read
          collection = other;
        }
      } catch (fallbackErr) {
        console.warn(`updateAdmin: fallback update on ${other} also failed:`, fallbackErr.message);
      }
    }

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Admin not found during update' });
    }

    const fresh = await Database.read(collection, adminId) || 
                  await Database.read( collection === USERS_COLLECTION ? 'admins' : USERS_COLLECTION , adminId) || 
                  updated;
    const { password, ...safe } = fresh || {};

    res.json({
      success: true,
      message: 'Admin updated successfully',
      data: {
        ...safe,
        id: safe.id || safe._id || adminId,
        status: (safe.isActive === false || safe.is_active === false) ? 'inactive' : 'active',
        isActive: !(safe.isActive === false || safe.is_active === false),
        permissions: Array.isArray(safe.permissions) ? safe.permissions : [],
      }
    });

    recordActivity('Updated admin account', req.user.id, adminId, { fields: Object.keys(updates) });
  } catch (error) {
    console.error('updateAdmin error:', error);
    res.status(500).json({ success: false, message: 'Failed to update admin', error: error.message });
  }
};

exports.resetAdminPassword = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can reset admin passwords' });
    }

    const { adminId } = req.params;

    // Locate admin (support both collections)
    let target = await Database.read(USERS_COLLECTION, adminId);
    let collection = USERS_COLLECTION;
    if (!target) {
      target = await Database.read('admins', adminId);
      collection = 'admins';
    }
    if (!target) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    const tempPw = generateTempPassword();
    const hashed = await bcrypt.hash(tempPw, 12);

    await Database.update(collection, adminId, { password: hashed, updatedAt: new Date().toISOString() });

    recordActivity('Reset admin password', req.user.id, adminId);

    res.json({
      success: true,
      message: 'Password reset successfully. Share the temporary password with the admin.',
      tempPassword: tempPw,
      admin: { id: adminId, email: target.email, name: target.name }
    });
  } catch (error) {
    console.error('resetAdminPassword error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password', error: error.message });
  }
};

// Dedicated delete for admins (re-uses safeguards)
exports.deleteAdmin = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can delete admins' });
    }

    const { adminId } = req.params;

    if (adminId === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own admin account' });
    }

    // Try users first
    let deleted = await Database.delete(USERS_COLLECTION, adminId);
    if (!deleted) {
      deleted = await Database.delete('admins', adminId);
    }

    recordActivity('Deleted admin account', req.user.id, adminId);

    res.json({ success: true, message: 'Admin deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting admin', error: error.message });
  }
};

// Toggle for admin specifically (re-uses logic, super only here)
exports.toggleAdminStatus = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Super admin access required' });
    }

    const { adminId } = req.params;

    if (adminId === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot change your own status' });
    }

    // Find
    let target = await Database.read(USERS_COLLECTION, adminId);
    let collection = USERS_COLLECTION;
    if (!target) {
      target = await Database.read('admins', adminId);
      collection = 'admins';
    }
    if (!target) return res.status(404).json({ success: false, message: 'Admin not found' });

    const currentActive = !(target.isActive === false || target.is_active === false);
    const newActive = !currentActive;

    const updated = await Database.update(collection, adminId, { isActive: newActive, is_active: newActive });

    recordActivity(`Admin ${newActive ? 'activated' : 'deactivated'}`, req.user.id, adminId);

    res.json({
      success: true,
      message: `Admin ${newActive ? 'activated' : 'deactivated'} successfully`,
      data: { id: adminId, isActive: newActive, status: newActive ? 'active' : 'inactive' }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error toggling admin status', error: error.message });
  }
};
