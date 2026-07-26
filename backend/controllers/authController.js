const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Database = require('../models/DatabaseAdapter');
const { validateEmail, validatePassword, validatePhoneOrEmpty, INDIAN_MOBILE_ERROR } = require('../utils/validators');
const { toPhone10, formatIndianPhone, isValidIndianMobile } = require('../utils/phoneUtils');
const { notify } = require('./notificationController');
const { sendSms, buildOtpMessage } = require('../utils/smsService');
const { sendSignupOtpEmail } = require('../utils/emailService');

const USERS_COLLECTION = 'users';
const ADMINS_COLLECTION = 'admins';

function getLoginTokenExpiry(rememberMe) {
  if (rememberMe) {
    return process.env.JWT_REMEMBER_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '7d';
  }
  return process.env.JWT_SESSION_EXPIRES_IN || '1d';
}

/** When true (default), email/password login requires SMS OTP for accounts with a valid Indian mobile. */
function isLoginOtpEnabled() {
  return String(process.env.LOGIN_OTP_ENABLED ?? 'true').toLowerCase() !== 'false';
}

function maskIndianPhone(phone10) {
  const digits = toPhone10(phone10);
  if (!digits || digits.length < 4) return '******';
  return `+91******${digits.slice(-4)}`;
}

function buildUserPayload(account, collection) {
  const id = account.id || account._id;
  const isAdminCollection = collection === ADMINS_COLLECTION;
  const role = account.role || (isAdminCollection ? 'admin' : 'customer');

  const payload = {
    id,
    email: account.email,
    name: account.name,
    role,
    phone: account.phone || '',
    profilePicture: account.profilePicture || account.profile_picture || null,
    permissions: Array.isArray(account.permissions) ? account.permissions : [],
  };

  if (!isAdminCollection) {
    payload.birthday = account.birthday || null;
    payload.gender = account.gender || null;
  }

  return payload;
}

function issueSessionToken(account, collection, rememberMe) {
  const userPayload = buildUserPayload(account, collection);
  const tokenExpiry = getLoginTokenExpiry(!!rememberMe);
  const token = jwt.sign(
    { id: userPayload.id, email: userPayload.email, role: userPayload.role },
    process.env.JWT_SECRET,
    { expiresIn: tokenExpiry }
  );
  return { token, tokenExpiry, user: userPayload };
}

function createLoginChallengeToken({ accountId, collection, rememberMe, phone10 }) {
  return jwt.sign(
    {
      purpose: 'login-otp',
      id: accountId,
      collection,
      rememberMe: !!rememberMe,
      phone: phone10,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.LOGIN_OTP_CHALLENGE_EXPIRES_IN || '10m' }
  );
}

function verifyLoginChallengeToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.purpose !== 'login-otp' || !decoded.id || !decoded.collection || !decoded.phone) {
    throw new Error('Invalid login challenge');
  }
  return decoded;
}

async function dispatchLoginOtp(phone10, purpose = 'login') {
  const code = generateOtpCode();
  const hashedCode = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const storeKey = getOtpStoreKey('phone', `${purpose}:${phone10}`);

  otpStore.set(storeKey, { code: hashedCode, expiresAt, purpose });

  console.log(
    `\n🔐 [OTP DEBUG - FOR TESTING ONLY] Phone: ${phone10} | Code: ${code} | Purpose: ${purpose} | Expires: ${expiresAt.toISOString()}\n`
  );

  const message = buildOtpMessage(code);
  try {
    await sendSms(phone10, message);
  } catch (smsErr) {
    // In development, keep the OTP usable (printed above) even if the SMS gateway URL is wrong.
    // In production, surface the SMS failure so login does not silently skip verification.
    const isDev = String(process.env.NODE_ENV || 'development').toLowerCase() !== 'production';
    if (!isDev) throw smsErr;
    console.warn(
      `[SMS OTP] Live SMS send failed (${smsErr.message}). Dev mode: use the OTP printed above.`
    );
  }
  return { storeKey, expiresAt };
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
    const {
      email,
      password,
      name,
      phone,
      emailVerificationToken,
      phoneVerificationToken,
    } = req.body;

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

    // Require exactly one successful OTP channel before account creation:
    // - emailVerificationToken (email OTP path), or
    // - phoneVerificationToken (mobile OTP path)
    const hasEmailProof = !!emailVerificationToken;
    const hasPhoneProof = !!phoneVerificationToken;

    if (!hasEmailProof && !hasPhoneProof) {
      return res.status(400).json({
        success: false,
        message: 'OTP verification is required before signup. Please verify via email or mobile number first.'
      });
    }

    if (hasEmailProof && hasPhoneProof) {
      return res.status(400).json({
        success: false,
        message: 'Use only one verification method (email or mobile OTP) for signup.'
      });
    }

    let normalizedPhone = '';
    let verificationChannel = null;

    if (hasEmailProof) {
      try {
        const decoded = jwt.verify(emailVerificationToken, process.env.JWT_SECRET);
        if (decoded.purpose !== 'email-signup' || decoded.email !== email.toLowerCase()) {
          throw new Error('Email verification token does not match provided email');
        }
        verificationChannel = 'email';
      } catch (tokenErr) {
        return res.status(400).json({
          success: false,
          message: 'Email verification token is invalid or expired. Please verify your email address again.'
        });
      }

      // Optional phone on email-OTP path
      if (phone) {
        const phoneCheck = validatePhoneOrEmpty(phone);
        if (!phoneCheck.valid) {
          return res.status(400).json({ success: false, message: phoneCheck.message || INDIAN_MOBILE_ERROR });
        }
        normalizedPhone = phoneCheck.normalized ? formatIndianPhone(phoneCheck.normalized) : '';
      }
    }

    if (hasPhoneProof) {
      if (!phone) {
        return res.status(400).json({
          success: false,
          message: 'Verified mobile number is required for mobile OTP signup.'
        });
      }

      const phoneCheck = validatePhoneOrEmpty(phone);
      if (!phoneCheck.valid || !phoneCheck.normalized) {
        return res.status(400).json({ success: false, message: phoneCheck.message || INDIAN_MOBILE_ERROR });
      }
      const phone10 = phoneCheck.normalized;

      try {
        const decoded = jwt.verify(phoneVerificationToken, process.env.JWT_SECRET);
        if (decoded.purpose !== 'phone-signup' || toPhone10(decoded.phone) !== phone10) {
          throw new Error('Phone verification token does not match provided mobile number');
        }
        verificationChannel = 'mobile';
        normalizedPhone = formatIndianPhone(phone10);
      } catch (tokenErr) {
        return res.status(400).json({
          success: false,
          message: 'Mobile verification token is invalid or expired. Please verify your mobile number again.'
        });
      }
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
      phone: normalizedPhone,
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
      message: `${name} (${email}) just created an account via ${verificationChannel || 'otp'} OTP.`,
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
  from: `"AAOMS CARE Support" <${process.env.SMTP_MAIL}>`,
  to: email,
  subject: 'Reset Your AAOMS CARE Password',
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
          <div class="logo">AAOMS CARE</div>
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
          <p>© 2026 AAOMS CARE - All Rights Reserved</p>
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
    let account = null;
    let collection = null;

    // === Check Admin Collection (via unified Postgres adapter) ===
    const admin = await Database.findBy(ADMINS_COLLECTION, 'email', normalizedEmail);
    if (admin) {
      const passwordMatch = await comparePassword(password, admin.password);
      if (!passwordMatch) {
        return res.status(401).json({ success: false, message: 'Invalid email or password' });
      }
      if (admin.isActive === false || admin.is_active === false) {
        return res.status(403).json({ success: false, message: 'Account is deactivated.' });
      }
      account = admin;
      collection = ADMINS_COLLECTION;
    } else {
      // === Check Users Collection ===
      let user = await Database.findBy(USERS_COLLECTION, 'email', normalizedEmail);

      if (!user) {
        const allUsers = await Database.readAll(USERS_COLLECTION);
        user = allUsers.find((u) => u.email === normalizedEmail);
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

      account = user;
      collection = USERS_COLLECTION;
    }

    const phone10 = toPhone10(account.phone);
    const needsOtp = isLoginOtpEnabled() && isValidIndianMobile(phone10);

    // SMS OTP gate: credentials ok, but session token only after phone OTP verify
    if (needsOtp) {
      try {
        await dispatchLoginOtp(phone10, 'login');
      } catch (smsErr) {
        console.error('Login OTP SMS error:', smsErr);
        return res.status(500).json({
          success: false,
          message:
            smsErr.message &&
            (smsErr.message.includes('Token') ||
              smsErr.message.includes('Sender') ||
              smsErr.message.includes('API') ||
              smsErr.message.includes('SMS'))
              ? `Failed to send login OTP: ${smsErr.message}. Check SMS_API_KEY / SMS_SENDER_ID in backend/.env.`
              : 'Failed to send login OTP. Please try again.',
        });
      }

      const accountId = account.id || account._id;
      const loginChallengeToken = createLoginChallengeToken({
        accountId,
        collection,
        rememberMe: !!rememberMe,
        phone10,
      });

      return res.json({
        success: true,
        requiresOtp: true,
        message: 'OTP has been sent to your registered mobile number. Please verify to complete sign-in.',
        loginChallengeToken,
        maskedPhone: maskIndianPhone(phone10),
        rememberMe: !!rememberMe,
      });
    }

    // No phone / OTP disabled → complete login as before (Google auth & other flows unchanged)
    const { token, tokenExpiry, user: userPayload } = issueSessionToken(
      account,
      collection,
      !!rememberMe
    );

    return res.json({
      success: true,
      requiresOtp: false,
      message: 'Login successful',
      token,
      expiresIn: tokenExpiry,
      rememberMe: !!rememberMe,
      user: userPayload,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.'
    });
  }
};

// ==================== LOGIN OTP VERIFY ====================
exports.verifyLoginOtp = async (req, res) => {
  try {
    const { loginChallengeToken, otp } = req.body;

    if (!loginChallengeToken) {
      return res.status(400).json({
        success: false,
        message: 'Login session expired. Please sign in again.',
      });
    }
    if (!otp) {
      return res.status(400).json({ success: false, message: 'OTP code is required' });
    }

    let challenge;
    try {
      challenge = verifyLoginChallengeToken(loginChallengeToken);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: 'Login session expired or invalid. Please sign in again.',
      });
    }

    const phone10 = toPhone10(challenge.phone);
    const storeKey = getOtpStoreKey('phone', `login:${phone10}`);
    const record = otpStore.get(storeKey);

    if (!record || record.purpose !== 'login') {
      return res.status(400).json({
        success: false,
        message: 'No pending login OTP for this session. Please request a new OTP.',
      });
    }

    if (record.expiresAt < new Date()) {
      otpStore.delete(storeKey);
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.',
      });
    }

    const isMatch = await bcrypt.compare(String(otp), record.code);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid OTP code' });
    }

    otpStore.delete(storeKey);

    const account = await Database.read(challenge.collection, challenge.id);
    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found. Please sign in again.' });
    }

    if (account.isActive === false || account.is_active === false) {
      return res.status(403).json({ success: false, message: 'Account is deactivated.' });
    }

    const { token, tokenExpiry, user: userPayload } = issueSessionToken(
      account,
      challenge.collection,
      !!challenge.rememberMe
    );

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      expiresIn: tokenExpiry,
      rememberMe: !!challenge.rememberMe,
      user: userPayload,
    });
  } catch (error) {
    console.error('verifyLoginOtp error:', error);
    res.status(500).json({ success: false, message: 'OTP verification failed. Please try again.' });
  }
};

// ==================== LOGIN OTP RESEND ====================
exports.resendLoginOtp = async (req, res) => {
  try {
    const { loginChallengeToken } = req.body;

    if (!loginChallengeToken) {
      return res.status(400).json({
        success: false,
        message: 'Login session expired. Please sign in again.',
      });
    }

    let challenge;
    try {
      challenge = verifyLoginChallengeToken(loginChallengeToken);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: 'Login session expired or invalid. Please sign in again.',
      });
    }

    const phone10 = toPhone10(challenge.phone);
    if (!isValidIndianMobile(phone10)) {
      return res.status(400).json({ success: false, message: INDIAN_MOBILE_ERROR });
    }

    // Ensure account still exists / active
    const account = await Database.read(challenge.collection, challenge.id);
    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found. Please sign in again.' });
    }
    if (account.isActive === false || account.is_active === false) {
      return res.status(403).json({ success: false, message: 'Account is deactivated.' });
    }

    try {
      await dispatchLoginOtp(phone10, 'login');
    } catch (smsErr) {
      console.error('Resend login OTP SMS error:', smsErr);
      return res.status(500).json({
        success: false,
        message: 'Failed to resend OTP. Please try again.',
      });
    }

    // Refresh challenge TTL so user has time to enter the new code
    const refreshedToken = createLoginChallengeToken({
      accountId: challenge.id,
      collection: challenge.collection,
      rememberMe: !!challenge.rememberMe,
      phone10,
    });

    return res.json({
      success: true,
      message: 'A new OTP has been sent to your registered mobile number.',
      loginChallengeToken: refreshedToken,
      maskedPhone: maskIndianPhone(phone10),
    });
  } catch (error) {
    console.error('resendLoginOtp error:', error);
    res.status(500).json({ success: false, message: 'Failed to resend OTP. Please try again.' });
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
// Signup: email OTP (SMTP) OR mobile OTP (SMS) — channel selected by client.
// Login / profile phone: SMS OTP via smsService.
// Simple in-memory OTP store (for demo; use Redis/DB in production with TTL)
const otpStore = new Map(); // key -> { code, expiresAt: Date, purpose, channel? }

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SIGNUP_VERIFY_TOKEN_TTL = '15m';

function generateOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
}

function getOtpStoreKey(type, identifier) {
  return `${type}:${identifier}`;
}

function normalizeSignupChannel(raw) {
  const value = String(raw || 'email').toLowerCase().trim();
  if (value === 'mobile' || value === 'phone' || value === 'sms') return 'mobile';
  return 'email';
}

exports.sendOtp = async (req, res) => {
  try {
    const { phone, email, purpose = 'signup', channel: rawChannel } = req.body;

    const code = generateOtpCode();
    const hashedCode = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // -------- Signup: email OR mobile OTP --------
    if (purpose === 'signup') {
      const channel = normalizeSignupChannel(rawChannel);

      if (channel === 'email') {
        if (!email || !validateEmail(email)) {
          return res.status(400).json({ success: false, message: 'Valid email address is required' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const storeKey = getOtpStoreKey('email', `signup:${normalizedEmail}`);

        const existingUser = await Database.findBy(USERS_COLLECTION, 'email', normalizedEmail);
        if (existingUser) {
          return res.status(409).json({
            success: false,
            message: 'Email already registered. Please log in instead.'
          });
        }

        otpStore.set(storeKey, { code: hashedCode, expiresAt, purpose, channel: 'email' });

        console.log(`\n🔐 [OTP DEBUG - FOR TESTING ONLY] Email: ${normalizedEmail} | Code: ${code} | Purpose: signup/email | Expires: ${expiresAt.toISOString()}\n`);

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
          channel: 'email',
          expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
          message: 'OTP has been sent to your email address.'
        });
      }

      // channel === 'mobile'
      const phone10 = toPhone10(phone);
      if (!phone10 || !isValidIndianMobile(phone10)) {
        return res.status(400).json({ success: false, message: INDIAN_MOBILE_ERROR });
      }

      const storeKey = getOtpStoreKey('phone', `signup:${phone10}`);
      otpStore.set(storeKey, { code: hashedCode, expiresAt, purpose, channel: 'mobile' });

      console.log(`\n🔐 [OTP DEBUG - FOR TESTING ONLY] Phone: ${phone10} | Code: ${code} | Purpose: signup/mobile | Expires: ${expiresAt.toISOString()}\n`);

      try {
        const message = buildOtpMessage(code);
        await sendSms(phone10, message);
      } catch (smsErr) {
        const isDev = String(process.env.NODE_ENV || 'development').toLowerCase() !== 'production';
        if (!isDev) {
          otpStore.delete(storeKey);
          throw smsErr;
        }
        console.warn(
          `[SMS OTP] Signup SMS send failed (${smsErr.message}). Dev mode: use the OTP printed above.`
        );
      }

      return res.json({
        success: true,
        channel: 'mobile',
        maskedPhone: `+91******${phone10.slice(-4)}`,
        expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
        message: 'OTP has been sent to your mobile number via SMS.'
      });
    }

    // -------- Profile flow: phone OTP via SMS when adding/changing mobile --------
    if (purpose === 'profile') {
      const phone10 = toPhone10(phone);
      if (!phone10 || !isValidIndianMobile(phone10)) {
        return res.status(400).json({ success: false, message: INDIAN_MOBILE_ERROR });
      }

      // Prefer purpose-scoped key; also clear any legacy unscoped key for this number
      const storeKey = getOtpStoreKey('phone', `profile:${phone10}`);
      const legacyKey = getOtpStoreKey('phone', phone10);
      otpStore.delete(legacyKey);
      otpStore.set(storeKey, {
        code: hashedCode,
        expiresAt,
        purpose: 'profile',
        channel: 'mobile',
      });

      console.log(
        `\n🔐 [OTP DEBUG - FOR TESTING ONLY] Phone: ${phone10} | Code: ${code} | Purpose: profile | Expires: ${expiresAt.toISOString()}\n`
      );

      try {
        const message = buildOtpMessage(code);
        await sendSms(phone10, message);
        console.log(`[SMS OTP] Profile OTP send attempted to ${phone10}`);
      } catch (smsErr) {
        const isDev = String(process.env.NODE_ENV || 'development').toLowerCase() !== 'production';
        if (!isDev) {
          otpStore.delete(storeKey);
          throw smsErr;
        }
        console.warn(
          `[SMS OTP] Profile SMS send failed (${smsErr.message}). Dev mode: use the OTP printed above.`
        );
      }

      return res.json({
        success: true,
        purpose: 'profile',
        maskedPhone: maskIndianPhone(phone10),
        expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
        message: 'OTP has been sent to your mobile number via SMS.',
      });
    }

    return res.status(400).json({ success: false, message: 'Invalid OTP purpose' });
  } catch (error) {
    console.error('sendOtp error:', error);
    const errMessage = error.message || 'Failed to send OTP';
    res.status(500).json({
      success: false,
      message: errMessage.includes('Token') || errMessage.includes('Sender') || errMessage.includes('Credit') || errMessage.includes('API') || errMessage.includes('SMS')
        ? `SMS delivery failed: ${errMessage}. Check SMS_API_KEY and SMS_SENDER_ID in backend/.env.`
        : 'Failed to send OTP. Please try again.',
    });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { phone, email, otp, purpose = 'signup', channel: rawChannel } = req.body;

    if (!otp) {
      return res.status(400).json({ success: false, message: 'OTP code is required' });
    }

    // -------- Signup verify (email or mobile) --------
    if (purpose === 'signup') {
      const channel = normalizeSignupChannel(rawChannel || (phone && !email ? 'mobile' : 'email'));

      let storeKey;
      let entityLabel;

      if (channel === 'email') {
        if (!email || !validateEmail(email)) {
          return res.status(400).json({ success: false, message: 'Valid email address is required' });
        }
        storeKey = getOtpStoreKey('email', `signup:${email.toLowerCase().trim()}`);
        entityLabel = 'email address';
      } else {
        const phone10 = toPhone10(phone);
        if (!phone10 || !isValidIndianMobile(phone10)) {
          return res.status(400).json({ success: false, message: INDIAN_MOBILE_ERROR });
        }
        storeKey = getOtpStoreKey('phone', `signup:${phone10}`);
        entityLabel = 'mobile number';
      }

      const record = otpStore.get(storeKey);

      if (!record || record.purpose !== 'signup') {
        return res.status(400).json({
          success: false,
          message: `No pending OTP request for this ${entityLabel}. Please request a new OTP.`
        });
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

      if (channel === 'email') {
        const normalizedEmail = email.toLowerCase().trim();
        const emailVerificationToken = jwt.sign(
          {
            email: normalizedEmail,
            purpose: 'email-signup',
            verifiedAt: Date.now()
          },
          process.env.JWT_SECRET,
          { expiresIn: SIGNUP_VERIFY_TOKEN_TTL }
        );

        return res.json({
          success: true,
          channel: 'email',
          message: 'Email address verified successfully via OTP.',
          email: normalizedEmail,
          emailVerificationToken
        });
      }

      const phone10 = toPhone10(phone);
      const phoneVerificationToken = jwt.sign(
        {
          phone: phone10,
          purpose: 'phone-signup',
          verifiedAt: Date.now()
        },
        process.env.JWT_SECRET,
        { expiresIn: SIGNUP_VERIFY_TOKEN_TTL }
      );

      return res.json({
        success: true,
        channel: 'mobile',
        message: 'Mobile number verified successfully via OTP.',
        phone: phone10,
        phoneVerificationToken
      });
    }

    // -------- Profile phone verify (must succeed before profile save) --------
    if (purpose === 'profile') {
      const phone10 = toPhone10(phone);
      if (!phone10 || !isValidIndianMobile(phone10)) {
        return res.status(400).json({ success: false, message: INDIAN_MOBILE_ERROR });
      }

      const storeKey = getOtpStoreKey('phone', `profile:${phone10}`);
      const legacyKey = getOtpStoreKey('phone', phone10);
      let record = otpStore.get(storeKey);
      let activeKey = storeKey;
      if (!record) {
        // Backward-compatible with OTPs issued before purpose-scoped keys
        record = otpStore.get(legacyKey);
        activeKey = legacyKey;
      }

      if (!record || record.purpose !== 'profile') {
        return res.status(400).json({
          success: false,
          message: 'No pending OTP request for this phone number. Please request a new OTP.',
        });
      }

      if (record.expiresAt < new Date()) {
        otpStore.delete(activeKey);
        otpStore.delete(storeKey);
        otpStore.delete(legacyKey);
        return res.status(400).json({
          success: false,
          message: 'OTP has expired. Please request a new one.',
        });
      }

      const isMatch = await bcrypt.compare(String(otp).trim(), record.code);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Invalid OTP code' });
      }

      otpStore.delete(activeKey);
      otpStore.delete(storeKey);
      otpStore.delete(legacyKey);

      // Optionally bind token to authenticated user when Authorization is present
      let boundUserId = null;
      try {
        const authHeader = req.headers.authorization || req.headers.Authorization;
        if (authHeader && String(authHeader).startsWith('Bearer ')) {
          const sessionToken = String(authHeader).slice(7).trim();
          const session = jwt.verify(sessionToken, process.env.JWT_SECRET);
          if (session?.id) boundUserId = session.id;
        }
      } catch (_) {
        // Token binding is best-effort; profile update still re-checks phone match
      }

      const phoneVerificationToken = jwt.sign(
        {
          phone: phone10,
          purpose: 'phone-profile',
          verifiedAt: Date.now(),
          ...(boundUserId ? { userId: boundUserId } : {}),
        },
        process.env.JWT_SECRET,
        { expiresIn: SIGNUP_VERIFY_TOKEN_TTL }
      );

      return res.json({
        success: true,
        purpose: 'profile',
        message: 'Phone number verified successfully via OTP.',
        phone: phone10,
        phoneVerificationToken,
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

    // Expand local /uploads profile path for clients
    try {
      const { expandMediaValue } = require('../utils/localUpload');
      if (safeUser.profilePicture) {
        safeUser.profilePicture = expandMediaValue(safeUser.profilePicture, req);
      }
      if (safeUser.profile_picture) {
        safeUser.profile_picture = expandMediaValue(safeUser.profile_picture, req);
      }
    } catch (_) {
      /* optional */
    }

    res.json({ success: true, user: safeUser });
  } catch (error) {
    console.error('getCurrentUser error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
};