const Database = require('../models/DatabaseAdapter');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../utils/emailService');
const { notify } = require('./notificationController');
const { validatePhoneOrEmpty, INDIAN_MOBILE_ERROR } = require('../utils/validators');
const { toPhone10 } = require('../utils/phoneUtils');

const COLLECTION = 'contactMessages';

// Public: submit contact message from Contact Us form
exports.submitContactMessage = async (req, res) => {
  try {
    const { name, email, phone, subject, message, orderNumber } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: 'Name, email and message are required'
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(email).trim())) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    if (phone) {
      const phoneCheck = validatePhoneOrEmpty(phone);
      if (!phoneCheck.valid) {
        return res.status(400).json({ success: false, message: phoneCheck.message || INDIAN_MOBILE_ERROR });
      }
    }

    const id = uuidv4();
    const contactData = {
      id,
      _id: id,
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      phone: phone ? toPhone10(phone) : '',
      subject: subject ? String(subject).trim() : 'General',
      message: String(message).trim(),
      orderNumber: orderNumber ? String(orderNumber).trim() : '',
      status: 'unread',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const saved = await Database.create(COLLECTION, contactData);
    if (!saved || !saved.id) {
      throw new Error('Failed to persist contact message');
    }

    // Notify all admins (system notification)
    notify({
      userId: null,
      type: 'system',
      title: 'New Contact Message',
      message: `${name} sent a message: ${subject || 'General Inquiry'}`,
      link: '/admin/contact-messages'
    });

    res.status(201).json({
      success: true,
      message: 'Thank you! Your message has been received. We will get back to you within 24 hours.',
      data: { id: saved.id }
    });
  } catch (error) {
    console.error('Contact submit error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting your message. Please try again later.',
      error: error.message
    });
  }
};

// Admin: get all contact messages
exports.getAllContactMessages = async (req, res) => {
  try {
    let messages = await Database.readAll(COLLECTION);
    // Sort newest first
    messages.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    res.json({
      success: true,
      data: messages
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching contact messages',
      error: error.message
    });
  }
};

// Admin: get single message (and optionally mark read)
exports.getContactMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const msg = await Database.read(COLLECTION, id);
    if (!msg) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    res.json({ success: true, data: msg });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching message', error: error.message });
  }
};

// Admin: update status (unread / read / replied)
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowed = ['unread', 'read', 'replied'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Use unread, read or replied.' });
    }

    const existing = await Database.read(COLLECTION, id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    const updates = {
      status,
      updatedAt: new Date().toISOString()
    };

    const updated = await Database.update(COLLECTION, id, updates);
    res.json({
      success: true,
      message: `Message marked as ${status}`,
      data: updated
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating status', error: error.message });
  }
};

// Admin: reply to message (sends email to customer + sets status to replied)
exports.replyToMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { reply } = req.body;

    if (!reply || !String(reply).trim()) {
      return res.status(400).json({ success: false, message: 'Reply text is required' });
    }

    const msg = await Database.read(COLLECTION, id);
    if (!msg) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    const replyText = String(reply).trim();
    const now = new Date().toISOString();

    // Update DB first
    const updated = await Database.update(COLLECTION, id, {
      reply: replyText,
      status: 'replied',
      repliedAt: now,
      updatedAt: now
    });

    if (!updated) {
      return res.status(500).json({
        success: false,
        message: 'Failed to save reply. Please try again.'
      });
    }

    // Send email to the customer
    const customerEmail = msg.email;
    const customerName = msg.name || 'Customer';
    const originalSubject = msg.subject || 'Your inquiry';
    const originalMessage = msg.message || '';

    const emailSubject = `Re: ${originalSubject} - AAOMS CARE Support`;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background:#f5f5f5; margin:0; padding:20px; color:#222; }
    .container { max-width: 620px; margin: 0 auto; background:#ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
    .header { background: #1a1a1a; color: #fff; padding: 24px 20px; text-align: center; }
    .logo { font-size: 22px; letter-spacing: 3px; font-weight: 700; }
    .content { padding: 28px 26px; line-height: 1.65; }
    .greeting { font-size: 15px; margin-bottom: 16px; }
    .original { background:#f8f8f8; border-left:4px solid #c9a227; padding:14px 16px; margin:18px 0; font-size:14px; color:#444; }
    .reply { background:#fff; border:1px solid #eee; border-radius:8px; padding:18px 20px; margin:18px 0; font-size:15px; }
    .footer { background:#f8f8f8; padding:16px 20px; font-size:11px; color:#777; text-align:center; line-height:1.5; }
    .footer a { color:#999; }
    .meta { font-size:12px; color:#666; margin-top:16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">AAOMS CARE</div>
      <div style="font-size:10px;opacity:0.7;margin-top:3px;letter-spacing:1.5px;">CUSTOMER SUPPORT</div>
    </div>
    <div class="content">
      <p class="greeting">Hi ${customerName},</p>
      <p>Thank you for reaching out to AAOMS CARE. Here is our response to your message:</p>

      <div class="original">
        <strong>Your message (${originalSubject}):</strong><br>
        ${originalMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}
      </div>

      <div class="reply">
        <strong>Our reply:</strong><br>
        ${replyText.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}
      </div>

      <p>If you have any further questions, simply reply to this email or visit our <a href="${frontendUrl}/contact">Contact page</a>.</p>

      <div class="meta">This reply was sent on ${new Date(now).toLocaleString()}.</div>
    </div>
    <div class="footer">
      Thank you for choosing AAOMS CARE.<br>
      © ${new Date().getFullYear()} AAOMS CARE — Trusted Healthcare Solutions Dedicated to Better Living.<br>
      <a href="${frontendUrl}">aaoms.com</a>
    </div>
  </div>
</body>
</html>`;

    const text = `Hi ${customerName},

Thank you for contacting AAOMS CARE.

Your original message (${originalSubject}):
${originalMessage}

Our reply:
${replyText}

If you need more help, reply to this email or visit ${frontendUrl}/contact

Best regards,
AAOMS CARE Support Team`;

    const emailResult = await sendEmail({
      to: customerEmail,
      subject: emailSubject,
      html,
      text
    });

    if (emailResult.skipped) {
      return res.status(503).json({
        success: false,
        message: 'Reply saved, but email was not sent because SMTP is not configured. Set SMTP_MAIL and SMTP_PASS (or EMAIL_USER and EMAIL_PASSWORD) in backend/.env.',
        data: updated,
        emailSent: false
      });
    }

    if (!emailResult.success) {
      return res.status(502).json({
        success: false,
        message: `Reply saved, but the email failed to send: ${emailResult.error || 'Unknown SMTP error'}`,
        data: updated,
        emailSent: false
      });
    }

    res.json({
      success: true,
      message: 'Reply sent successfully to customer email',
      data: updated,
      emailSent: true,
      messageId: emailResult.messageId || null
    });
  } catch (error) {
    console.error('Reply error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending reply',
      error: error.message
    });
  }
};

// Optional: admin delete
exports.deleteContactMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const success = await Database.delete(COLLECTION, id);
    if (!success) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    res.json({ success: true, message: 'Contact message deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting message', error: error.message });
  }
};
