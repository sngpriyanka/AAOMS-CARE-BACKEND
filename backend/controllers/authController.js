const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Database = require('../models/DatabaseAdapter');
const { validateEmail, validatePassword } = require('../utils/validators');
const { notify } = require('./notificationController');
const { sendSms } = require('../utils/sparrowSms');
const { sendSignupOtpEmail } = require('../utils/emailService');

const USERS_COLLECTION = 'users';
const ADMINS_COLLECTION = 'admins';

function getLoginTokenExpiry(rememberMe) {
  if (rememberMe) {
    return process.env.JWT_REMEMBER_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '7d';
  }
  return process.env.JWT_SESSION_EXPIRES_IN || '1d';
}

function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

async function comparePassword(plain, hash) {
  if (!plain || !isBcryptHash(hash)) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

async function findAccountByEmail(email) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const user = await Database.findBy(USERS_COLLECTION, 'email', normalizedEmail);
  if (user) {
    return { account: user, collection: USERS_COLLECTION };
  }

  const admin = await Database.findBy(ADMINS_COLLECTION, 'email', normalizedEmail);
  if (admin) {
    return { account: admin, collection: ADMINS_COLLECTION };
  }

  return { account: null, collection: null };
}

async function findAccountById(userId) {
  const user = await Database.read(USERS_COLLECTION, userId);
  if (user) {
    return { account: user, collection: USERS_COLLECTION };
  }

  const admin = await Database.read(ADMINS_COLLECTION, userId);
  if (admin) {
    return { account: admin, collection: ADMINS_COLLECTION };
  }

  return { account: null, collection: null };
}

// ==================== SIGNUP ====================
exports.signup = async (req, res) => {
  try {
    const { email, password, name, phone, emailVerificationToken } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and name are required'
      });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be 8-12 characters with at least 1 uppercase, 1 lowercase, 1 number and 1 special character (!@#$%^&*)'
      });
    }

    // Email OTP verification is required before account creation (phone OTP temporarily disabled for signup).
    if (!emailVerificationToken) {
      return res.status(400).json({
        success: false,
        message: 'Email verification via OTP is required before signup. Please verify your email address first.'
      });
    }
    try {
      const decoded = jwt.verify(emailVerificationToken, process.env.JWT_SECRET);
      if (decoded.purpose !== 'email-signup' || decoded.email !== email.toLowerCase()) {
        throw new Error('Email verification token does not match provided email');
      }
    } catch (tokenErr) {
      return res.status(400).json({
        success: false,
        message: 'Email verification token is invalid or expired. Please verify your email address again.'
      });
    }

    const existingUser = await Database.findBy(USERS_COLLECTION, 'email', email.toLowerCase());
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    const newUser = await Database.create(USERS_COLLECTION, {
      id: userId,
      email: email.toLowerCase(),
      password: hashedPassword,
      name: name.trim(),
      phone: phone || '',
      role: 'customer',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Notify admins of new user registration
    notify({
      userId: null,
      type: 'user',
      title: 'New User Registration',
      message: `${name} (${email}) just created an account.`,
      link: '/admin/users'
    });

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        phone: newUser.phone || '',
        profilePicture: newUser.profilePicture || null
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

// ==================== FORGOT PASSWORD (REAL EMAIL) ====================
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !validateEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Valid email is required'
      });
    }

    const normalizedEmail = email.toLowerCase();
    const { account: user, collection: targetCollection } = await findAccountByEmail(normalizedEmail);

    if (!user || !targetCollection) {
      return res.status(404).json({
        success: false,
        message: 'Email not registered'
      });
    }

    const targetId = user.id || user._id;
    if (!targetId) {
      return res.status(500).json({
        success: false,
        message: 'Unable to process password reset for this account.'
      });
    }

    // Generate Reset Token (valid for 1 hour)
    const resetToken = jwt.sign(
      { id: targetId, collection: targetCollection },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const tokenSaved = await Database.update(targetCollection, targetId, {
      resetToken,
      updatedAt: new Date().toISOString()
    });

    if (!tokenSaved) {
      return res.status(500).json({
        success: false,
        message: 'Failed to prepare password reset. Please try again.'
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    // Send Email
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: process.env.SMTP_SERVICE,
      auth: {
        user: process.env.SMTP_MAIL,
        pass: process.env.SMTP_PASS
      }
    });

// Inside forgotPassword function - Replace the transporter.sendMail block
await transporter.sendMail({
  from: `"AAOMS Support" <${process.env.SMTP_MAIL}>`,
  to: email,
  subject: 'Reset Your AAOMS Password',
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
        .header { text-align: center; padding: 20px 0; }
        .logo { font-size: 28px; font-weight: bold; color: #000; }
        .button {
          display: inline-block;
          padding: 14px 30px;
          background: #000;
          color: white;
          text-decoration: none;
          border-radius: 8px;
          font-weight: bold;
          margin: 20px 0;
        }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">AAOMS</div>
        </div>
        
        <h2 style="text-align:center; color:#333;">Reset Your Password</h2>
        
        <p style="text-align:center; color:#555; font-size:16px;">
          You requested to reset your password.<br>
          Click the button below to set a new one:
        </p>

        <div style="text-align:center;">
          <a href="${resetLink}" class="button">RESET PASSWORD</a>
        </div>

        <p style="text-align:center; color:#777; font-size:14px;">
          This link will expire in <strong>1 hour</strong>.
        </p>

        <div class="footer">
          <p>If you didn't request this, please ignore this email.</p>
          <p>© 2026 AAOMS - All Rights Reserved</p>
        </div>
      </div>
    </body>
    </html>
  `
});

    res.json({
      success: true,
      message: 'Password reset link has been sent to your email.'
    });

  } catch (error) {
    console.error('Forgot Password Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send reset link. Please try again.'
    });
  }
};

// ==================== LOGIN ====================
exports.login = async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const normalizedEmail = email.toLowerCase();
    const tokenExpiry = getLoginTokenExpiry(!!rememberMe);

    // === Check Admin Collection (via unified adapter - works for JSON, Mongo, Postgres) ===
    let admin = await Database.findBy(ADMINS_COLLECTION, 'email', normalizedEmail);
    if (admin) {
      const passwordMatch = await comparePassword(password, admin.password);
      if (!passwordMatch) {
        return res.status(401).json({ success: false, message: 'Invalid email or password' });
      }
      if (admin.isActive === false || admin.is_active === false) {
        return res.status(403).json({ success: false, message: 'Account is deactivated.' });
      }

      const adminId = admin.id || admin._id;
      const token = jwt.sign(
        { id: adminId, email: admin.email, role: admin.role || 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: tokenExpiry }
      );

      return res.json({
        success: true,
        message: 'Login successful',
        token,
        expiresIn: tokenExpiry,
        rememberMe: !!rememberMe,
        user: {
          id: adminId,
          email: admin.email,
          name: admin.name,
          role: admin.role || 'admin',
          permissions: Array.isArray(admin.permissions) ? admin.permissions : [],
          phone: admin.phone || '',
          profilePicture: admin.profilePicture || admin.profile_picture || null
        }
      });
    }

    // === Check Users Collection ===
    let user = await Database.findBy(USERS_COLLECTION, 'email', normalizedEmail);
    
    if (!user) {
      // Fallback: Try reading all users
      const allUsers = await Database.readAll(USERS_COLLECTION);
      user = allUsers.find(u => u.email === normalizedEmail);
    }

    if (!user || !user.password) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const passwordMatch = await comparePassword(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    if (user.isActive === false) {
      return res.status(403).json({ success: false, message: 'Account is deactivated.' });
    }

    const userId = user.id || user._id;
    const token = jwt.sign(
      { id: userId, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: tokenExpiry }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      expiresIn: tokenExpiry,
      rememberMe: !!rememberMe,
      user: {
        id: userId,
        email: user.email,
        name: user.name,
        role: user.role,
        phone: user.phone || '',
        birthday: user.birthday || null,
        gender: user.gender || null,
        profilePicture: user.profilePicture || user.profile_picture || null,
        permissions: Array.isArray(user.permissions) ? user.permissions : []
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.'
    });
  }
};

// ==================== RESET PASSWORD - FINAL WORKING VERSION ====================
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: 'Token and new password are required' });
    }

    if (!validatePassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be 8-12 characters with uppercase, lowercase, number and special character'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;
    const hintedCollection = decoded.collection;

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    let targetCollection = hintedCollection;
    let account = null;

    if (targetCollection) {
      account = await Database.read(targetCollection, userId);
    }

    if (!account) {
      const located = await findAccountById(userId);
      account = located.account;
      targetCollection = located.collection;
    }

    if (!account || !targetCollection) {
      return res.status(404).json({
        success: false,
        message: 'User not found or reset link has expired. Please request a new one.'
      });
    }

    const updated = await Database.update(targetCollection, userId, {
      password: hashedPassword,
      resetToken: null,
      updatedAt: new Date().toISOString()
    });

    if (!updated || !updated.password) {
      return res.status(500).json({
        success: false,
        message: 'Failed to save the new password. Please try again.'
      });
    }

    const passwordSavedCorrectly = await comparePassword(newPassword, updated.password);
    if (!passwordSavedCorrectly) {
      console.error(`[ResetPassword] Password verification failed after update for user ${userId}`);
      return res.status(500).json({
        success: false,
        message: 'Password was not saved correctly. Please request a new reset link and try again.'
      });
    }

    return res.json({
      success: true,
      message: 'Password reset successful. You can now login.'
    });

  } catch (error) {
    console.error('Reset Password Error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(400).json({ success: false, message: 'Reset link has expired. Please request a new one.' });
    }

    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
};

// ==================== GOOGLE AUTH (proper OAuth with token verification) ====================
exports.googleAuth = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Google token is required' });

    // Verify the Google id_token properly using Google's tokeninfo endpoint (no extra libs)
    const payload = await verifyGoogleIdToken(token);
    if (!payload?.email) return res.status(401).json({ success: false, message: 'Invalid Google token' });

    let user = await Database.findBy(USERS_COLLECTION, 'email', payload.email.toLowerCase());

    if (!user) {
      const userId = uuidv4();
      user = await Database.create(USERS_COLLECTION, {
        id: userId,
        email: payload.email.toLowerCase(),
        name: payload.name || 'Google User',
        role: 'customer',
        profilePicture: payload.picture || '',
        googleAuth: true,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
        // password is intentionally omitted (NULL) for pure Google OAuth users
      });
    }

    // For both new Google users and returning ones: ensure the google_auth flag is set.
    // This is idempotent and helps with users who signed up via Google before the column existed.
    if (user) {
      try {
        if (!user.googleAuth) {
          await Database.update(USERS_COLLECTION, user.id, {
            googleAuth: true,
            updatedAt: new Date().toISOString()
          });
          user.googleAuth = true;
        }
      } catch (e) {
        // Non-fatal; the auth itself succeeded.
        console.warn('Could not set googleAuth flag on user', user.id, e.message);
      }
    }

    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        phone: user.phone || null,
        profilePicture: user.profilePicture || payload.picture || null,
        permissions: Array.isArray(user.permissions) ? user.permissions : []
      }
    });

  } catch (error) {
    console.error('Google Auth error:', error);
    res.status(500).json({ success: false, message: 'Google authentication failed' });
  }
};

// Helper for proper Google id_token verification (uses Google's public endpoint)
async function verifyGoogleIdToken(token) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const payload = JSON.parse(data);
          if (payload.error) {
            return reject(new Error(payload.error_description || 'Invalid Google token'));
          }
          // Optional: verify aud (client id) if you set GOOGLE_CLIENT_ID env
          const expectedAud = process.env.GOOGLE_CLIENT_ID || process.env.REACT_APP_GOOGLE_CLIENT_ID;
          if (expectedAud && payload.aud !== expectedAud) {
            return reject(new Error('Token audience mismatch'));
          }
          resolve(payload); // contains email, name, picture, sub, etc.
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// ==================== OTP VERIFICATION ====================
// Signup: email OTP via Gmail (SMTP). Profile phone updates: SMS via Sparrow.
// Simple in-memory OTP store (for demo; use Redis/DB in production with TTL)
const otpStore = new Map(); // key -> { code, expiresAt: Date, purpose }

function generateOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
}

function getOtpStoreKey(type, identifier) {
  return `${type}:${identifier}`;
}

exports.sendOtp = async (req, res) => {
  try {
    const { phone, email, purpose = 'signup' } = req.body;
    // reCAPTCHA temporarily disabled
    // const { recaptchaToken } = req.body;
    // if (recaptchaToken) {
    //   console.log('[OTP] reCAPTCHA token received');
    // }

    const code = generateOtpCode();
    const hashedCode = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Signup flow: email OTP (phone OTP temporarily disabled)
    if (purpose === 'signup') {
      if (!email || !validateEmail(email)) {
        return res.status(400).json({ success: false, message: 'Valid email address is required' });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const storeKey = getOtpStoreKey('email', normalizedEmail);

      const existingUser = await Database.findBy(USERS_COLLECTION, 'email', normalizedEmail);
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'Email already registered. Please log in instead.'
        });
      }

      otpStore.set(storeKey, { code: hashedCode, expiresAt, purpose });

      console.log(`\n🔐 [OTP DEBUG - FOR TESTING ONLY] Email: ${normalizedEmail} | Code: ${code} | Purpose: ${purpose} | Expires: ${expiresAt.toISOString()}\n`);

      const emailResult = await sendSignupOtpEmail(normalizedEmail, code);
      if (emailResult.skipped) {
        console.warn('[Email OTP] SMTP not configured — OTP logged to console only (dev mode).');
      } else if (!emailResult.success) {
        otpStore.delete(storeKey);
        return res.status(500).json({
          success: false,
          message: `Failed to send verification email: ${emailResult.error || 'Unknown error'}. Check SMTP settings in backend/.env.`
        });
      }

      return res.json({
        success: true,
        message: 'OTP has been sent to your email address.'
      });
    }

    // Profile flow: phone OTP via SMS (unchanged)
    if (purpose === 'profile') {
      if (!phone || !/^\d{10}$/.test(phone)) {
        return res.status(400).json({ success: false, message: 'Valid 10-digit phone number is required' });
      }

      const storeKey = getOtpStoreKey('phone', phone);
      otpStore.set(storeKey, { code: hashedCode, expiresAt, purpose });

      console.log(`\n🔐 [OTP DEBUG - FOR TESTING ONLY] Phone: ${phone} | Code: ${code} | Purpose: ${purpose} | Expires: ${expiresAt.toISOString()}\n`);

      const message = `Your AAOMS verification code is ${code}. Valid for 5 minutes. Do not share this code with anyone.`;
      await sendSms(phone, message);
      console.log(`[Sparrow SMS] OTP send attempted to ${phone}`);

      return res.json({
        success: true,
        message: 'OTP has been sent to your mobile number via SMS.'
      });
    }

    return res.status(400).json({ success: false, message: 'Invalid OTP purpose' });
  } catch (error) {
    console.error('sendOtp error:', error);
    const errMessage = error.message || 'Failed to send OTP';
    res.status(500).json({
      success: false,
      message: errMessage.includes('Token') || errMessage.includes('Sender') || errMessage.includes('Credit')
        ? `SMS delivery failed: ${errMessage}. Check SPARROW_TOKEN and SPARROW_SENDER in backend/.env.`
        : 'Failed to send OTP. Please try again.',
    });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { phone, email, otp, purpose = 'signup' } = req.body;

    if (!otp) {
      return res.status(400).json({ success: false, message: 'OTP code is required' });
    }

    let storeKey;
    if (purpose === 'signup') {
      if (!email || !validateEmail(email)) {
        return res.status(400).json({ success: false, message: 'Valid email address is required' });
      }
      storeKey = getOtpStoreKey('email', email.toLowerCase().trim());
    } else if (purpose === 'profile') {
      if (!phone) {
        return res.status(400).json({ success: false, message: 'Phone number is required' });
      }
      storeKey = getOtpStoreKey('phone', phone);
    } else {
      return res.status(400).json({ success: false, message: 'Invalid OTP purpose' });
    }

    const record = otpStore.get(storeKey);

    if (!record || record.purpose !== purpose) {
      const entityLabel = purpose === 'signup' ? 'email address' : 'phone number';
      return res.status(400).json({ success: false, message: `No pending OTP request for this ${entityLabel}` });
    }

    if (record.expiresAt < new Date()) {
      otpStore.delete(storeKey);
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    const isMatch = await bcrypt.compare(String(otp), record.code);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid OTP code' });
    }

    otpStore.delete(storeKey);

    let emailVerificationToken = null;
    let phoneVerificationToken = null;

    if (purpose === 'signup') {
      const normalizedEmail = email.toLowerCase().trim();
      emailVerificationToken = jwt.sign(
        {
          email: normalizedEmail,
          purpose: 'email-signup',
          verifiedAt: Date.now()
        },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );

      return res.json({
        success: true,
        message: 'Email address verified successfully via OTP.',
        email: normalizedEmail,
        emailVerificationToken
      });
    }

    if (purpose === 'profile') {
      phoneVerificationToken = jwt.sign(
        {
          phone,
          purpose: 'phone-profile',
          verifiedAt: Date.now()
        },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );

      return res.json({
        success: true,
        message: 'Phone number verified successfully via OTP.',
        phone,
        phoneVerificationToken
      });
    }

    return res.status(400).json({ success: false, message: 'Invalid OTP purpose' });
  } catch (error) {
    console.error('verifyOtp error:', error);
    res.status(500).json({ success: false, message: 'OTP verification failed' });
  }
};

// ==================== OTHER ROUTES ====================
exports.logout = (req, res) => res.json({ success: true, message: 'Logged out successfully' });

exports.getCurrentUser = async (req, res) => {
  try {
    const userId = req.user.id;
    let found = null;

    // Check admins collection first if the token indicates an admin role (from login logic)
    if (req.user.role === 'admin' || req.user.role === 'super_admin') {
      found = await Database.read('admins', userId);
    }

    // Fallback to users collection (or if role was not admin)
    if (!found) {
      found = await Database.read(USERS_COLLECTION, userId);
    }

    // Last-resort search in both (handles edge cases like role not present in old tokens)
    if (!found) {
      found = await Database.findBy('admins', 'id', userId) || await Database.read('admins', userId);
    }
    if (!found) {
      found = await Database.findBy(USERS_COLLECTION, 'id', userId);
    }

    if (!found) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Strip sensitive fields before returning
    const { password, resetToken, ...safeUser } = found;

    res.json({ success: true, user: safeUser });
  } catch (error) {
    console.error('getCurrentUser error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
};