const Database = require('../models/DatabaseAdapter');
const { v4: uuidv4 } = require('uuid');
const { queueWelcomeEmail, isSmtpConfigured } = require('../utils/emailService');

const COLLECTION = 'subscribers';

// Public: Subscribe to newsletter (footer form)
exports.subscribe = async (req, res) => {
  try {
    const { email, source = 'footer' } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Backend validation (reuse + strict)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
    }

    // Prevent duplicates (case-insensitive unique enforced at DB level too)
    const existing = await Database.findBy(COLLECTION, 'email', normalizedEmail);
    if (existing && existing.isActive !== false) {
      return res.status(200).json({
        success: true,
        message: 'You are already subscribed to the AAOMS CARE Club!',
        alreadySubscribed: true
      });
    }

    // If previously unsubscribed, re-activate
    if (existing && existing.isActive === false) {
      const reactivated = await Database.update(COLLECTION, existing.id || existing._id, {
        isActive: true,
        source,
        updatedAt: new Date().toISOString()
      });
      queueWelcomeEmail(normalizedEmail);
      const welcomeNote = isSmtpConfigured()
        ? ' Check your email for a welcome note.'
        : '';
      return res.status(200).json({
        success: true,
        message: `Welcome back! You have been resubscribed to the AAOMS CARE Club.${welcomeNote}`,
        data: reactivated
      });
    }

    const id = uuidv4();
    const subscriber = await Database.create(COLLECTION, {
      id,
      _id: id,
      email: normalizedEmail,
      isActive: true,
      source,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // Respond immediately — welcome email is sent in the background
    const welcomeNote = isSmtpConfigured()
      ? ' Check your email for a welcome note.'
      : '';
    res.status(201).json({
      success: true,
      message: `Thank you for joining the AAOMS CARE Club!${welcomeNote}`,
      data: { id: subscriber.id, email: subscriber.email }
    });

    queueWelcomeEmail(normalizedEmail);
    return;
  } catch (error) {
    console.error('Subscribe error:', error);
    // Handle unique violation gracefully
    if (error.message && /unique|duplicate|already exists/i.test(error.message)) {
      return res.status(200).json({
        success: true,
        message: 'You are already subscribed to the AAOMS CARE Club!',
        alreadySubscribed: true
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to subscribe. Please try again later.'
    });
  }
};

// Admin: Get all subscribers (active + inactive)
exports.getAllSubscribers = async (req, res) => {
  try {
    let subs = await Database.readAll(COLLECTION);
    // Sort newest first
    subs = subs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    res.json({ success: true, data: subs, count: subs.length });
  } catch (error) {
    console.error('Get subscribers error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subscribers' });
  }
};

// Admin: Delete / unsubscribe a subscriber (hard delete or set inactive)
exports.deleteSubscriber = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: 'Subscriber id required' });

    const existing = await Database.read(COLLECTION, id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Subscriber not found' });
    }

    // Soft delete by deactivating (keeps history)
    await Database.update(COLLECTION, id, { isActive: false, updatedAt: new Date().toISOString() });
    // Or hard: await Database.delete(COLLECTION, id);

    res.json({ success: true, message: 'Subscriber removed' });
  } catch (error) {
    console.error('Delete subscriber error:', error);
    res.status(500).json({ success: false, message: 'Failed to remove subscriber' });
  }
};

// Admin: Send a newsletter / promotion to all (or all active) subscribers
exports.sendNewsletter = async (req, res) => {
  try {
    const { subject, message, html, sendToAll = false } = req.body;

    if (!subject || (!message && !html)) {
      return res.status(400).json({
        success: false,
        message: 'Subject and message (or html) are required'
      });
    }

    let subscribers = await Database.readAll(COLLECTION);
    if (!sendToAll) {
      subscribers = subscribers.filter(s => s.isActive !== false);
    }
    const recipients = subscribers.map(s => s.email).filter(Boolean);

    if (recipients.length === 0) {
      return res.status(400).json({ success: false, message: 'No active subscribers to send to' });
    }

    const nodemailer = require('nodemailer');
    let transporter;
    if (process.env.SMTP_HOST) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER || process.env.SMTP_MAIL, pass: process.env.SMTP_PASS }
      });
    } else {
      transporter = nodemailer.createTransport({
        service: process.env.SMTP_SERVICE || 'gmail',
        auth: { user: process.env.SMTP_MAIL, pass: process.env.SMTP_PASS }
      });
    }

    const from = process.env.EMAIL_FROM || `"AAOMS CARE Club" <${process.env.SMTP_MAIL || process.env.SMTP_USER}>`;
    const frontendUrl = [
            'http://localhost:3000',
      'http://localhost:5000',
      'http://localhost:5173',
      'https://aaoms-frontend.vercel.app',     // ← Your Vercel Frontend
      'https://aaoms.onrender.com',            // Backend itself (if needed)
      'https://aaoms.online',
    'https://www.aaoms.online',   
    ];

    // Build unsubscribe link (simple tokenless: link that could be extended with /unsubscribe?email=)
    const batchId = uuidv4();
    const results = [];

    // Send in small batches to be nice to SMTP (avoid rate limits)
    const BATCH_SIZE = 40;
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (email) => {
        const unsubscribeLink = `${frontendUrl}/unsubscribe?email=${encodeURIComponent(email)}`;
        const textBody = message || '';
        const htmlBody = html || `
          <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#222;line-height:1.6">
            <h2 style="color:#111;margin-bottom:16px">${subject}</h2>
            <div>${(message || '').replace(/\n/g, '<br/>')}</div>
            <p style="margin-top:28px;font-size:13px;color:#666">Thank you for being part of the AAOMS CARE Club.</p>
            <p style="font-size:12px;margin-top:24px"><a href="${unsubscribeLink}" style="color:#999">Unsubscribe</a></p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
            <p style="font-size:11px;color:#888">© AAOMS CARE — Trusted Healthcare Solutions Dedicated to Better Living</p>
          </div>
        `;

        try {
          await transporter.sendMail({
            from,
            to: email,
            subject,
            text: textBody + `\n\nUnsubscribe: ${unsubscribeLink}`,
            html: htmlBody
          });
          results.push({ email, ok: true });
        } catch (sendErr) {
          console.error('Newsletter send failed for', email, sendErr.message);
          results.push({ email, ok: false, error: sendErr.message });
        }
      }));
    }

    const successCount = results.filter(r => r.ok).length;
    const failCount = results.length - successCount;

    res.json({
      success: true,
      message: `Newsletter sent to ${successCount} subscriber(s). ${failCount ? failCount + ' failed.' : ''}`,
      stats: { total: recipients.length, sent: successCount, failed: failCount },
      batchId
    });
  } catch (error) {
    console.error('Send newsletter error:', error);
    res.status(500).json({ success: false, message: 'Failed to send newsletter' });
  }
};

// Simple unsubscribe endpoint (public, useful for email links)
exports.unsubscribe = async (req, res) => {
  try {
    const { email } = req.body || req.query;
    if (!email) return res.status(400).json({ success: false, message: 'Email required' });

    const normalized = String(email).toLowerCase().trim();
    const existing = await Database.findBy(COLLECTION, 'email', normalized);

    if (!existing) {
      return res.json({ success: true, message: 'Email not found in our list (already unsubscribed or never subscribed).' });
    }

    await Database.update(COLLECTION, existing.id || existing._id, { isActive: false, updatedAt: new Date().toISOString() });
    res.json({ success: true, message: 'You have been unsubscribed from AAOMS CARE Club emails.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unsubscribe failed' });
  }
};
