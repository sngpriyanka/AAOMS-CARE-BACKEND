const { Resend } = require('resend');
const Database = require('../models/DatabaseAdapter');

let resendClient = null;

function getResendClient() {
  if (resendClient) return resendClient;
  
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[EmailService] RESEND_API_KEY not configured');
    return null;
  }

  resendClient = new Resend(apiKey);
  return resendClient;
}

function isEmailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

async function sendEmail({ to, subject, html, text }) {
  const client = getResendClient();
  if (!client || !to) {
    console.log(`[EmailService] Skipped email (no Resend configured): ${subject}`);
    return { skipped: true };
  }

  const from = process.env.EMAIL_FROM || "AAOMS Club <onboarding@resend.dev>";

  try {
    const { data, error } = await client.emails.send({
      from,
      to: String(to).trim(),
      subject: String(subject || 'AAOMS Update'),
      html: html || '',
      text: text || ''
    });

    if (error) {
      console.error(`[EmailService] ✗ Failed to send "${subject}" to ${to}:`, error);
      return { success: false, error: error.message };
    }

    console.log(`[EmailService] ✓ Sent "${subject}" to ${to} (id: ${data?.id || 'n/a'})`);
    return { success: true, messageId: data?.id };
  } catch (err) {
    console.error(`[EmailService] ✗ Failed to send "${subject}" to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

// Keep all other functions (order emails, OTP, etc.) the same...
// I'll keep them short for now, you can keep your existing ones

async function sendWelcomeEmail(toEmail) {
  const frontendUrl = process.env.FRONTEND_URL || 'https://aaoms-frontend.vercel.app';
  const subject = 'Welcome to the AAOMS Club ✨';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: system-ui, -apple-system, Arial, sans-serif; background:#f8f8f8; padding:20px; }
        .container { max-width:560px; margin:0 auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.06); }
        .header { background:#1a1a1a; color:#fff; padding:28px 24px; text-align:center; }
        .logo { font-size:22px; letter-spacing:3px; font-weight:700; }
        .content { padding:32px 28px; color:#333; line-height:1.6; }
        .btn { display:inline-block; background:#c9a227; color:#000; font-weight:600; padding:12px 28px; border-radius:6px; text-decoration:none; margin:16px 0; }
        .footer { padding:18px 28px; background:#f8f8f8; color:#777; font-size:12px; text-align:center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">AAOMS</div>
          <div style="margin-top:6px;opacity:0.8;font-size:12px;letter-spacing:1.5px;">THE CLUB</div>
        </div>
        <div class="content">
          <h2 style="margin:0 0 12px;font-size:20px;color:#111;">Welcome to the AAOMS Club!</h2>
          <p>Thank you for subscribing. You'll be the first to know about new launches, exclusive drops, and special offers.</p>
          <p style="margin:20px 0 0;">Explore our latest collections:</p>
          <a href="${frontendUrl}/collection" class="btn">SHOP NOW</a>
        </div>
        <div class="footer">
          You can unsubscribe anytime from the link in future emails.<br/>
          © ${new Date().getFullYear()} AAOMS. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `Welcome to the AAOMS Club!\n\nThank you for subscribing...`;

  return sendEmail({ to: toEmail, subject, html, text });
}

function queueWelcomeEmail(toEmail) {
  if (!isEmailConfigured() || !toEmail) return;
  sendWelcomeEmail(toEmail).catch((err) => {
    console.warn('[EmailService] Welcome email failed:', err.message);
  });
}

// Export everything (keep your other functions)
module.exports = {
  sendEmail,
  sendWelcomeEmail,
  queueWelcomeEmail,
  isEmailConfigured,
  // add your other functions here if needed
};