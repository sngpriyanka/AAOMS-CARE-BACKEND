const https = require('https');
const querystring = require('querystring');

/**
 * Sparrow .env values sometimes include inline notes, e.g.
 * SPARROW_TOKEN=abc123 (AAOMS) — strip anything after whitespace.
 */
function sanitizeToken(raw) {
  if (!raw) return '';
  return String(raw).trim().split(/\s+/)[0];
}

/**
 * Sparrow SMS expects comma-separated 10-digit Nepal mobile numbers.
 * Do NOT prefix with 977.
 */
function normalizeNepalPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 13 && digits.startsWith('977')) return digits.slice(3);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

const sendSms = async (phone, message) => {
  const token = sanitizeToken(process.env.SPARROW_TOKEN);
  const sender = (process.env.SPARROW_SENDER || 'Demo').trim();
  const to = normalizeNepalPhone(phone);

  if (!token) {
    console.warn('[Sparrow SMS] SPARROW_TOKEN not set in env. SMS will not be sent (dev mode).');
    return { success: true, dev: true };
  }

  if (!/^\d{10}$/.test(to)) {
    throw new Error(`Invalid phone number for SMS. Expected 10 digits, got: ${phone}`);
  }

  if (!sender) {
    throw new Error('SPARROW_SENDER is not configured');
  }

  const params = {
    token,
    from: sender,
    to,
    text: message,
  };

  const postData = querystring.stringify(params);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.sparrowsms.com',
        path: '/v2/sms/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.response_code === 200) {
              console.log(`[Sparrow SMS] Queued message to ${to} (sender: ${sender})`);
              resolve(json);
              return;
            }

            const apiMessage = json.response || json.response_message || 'SMS send failed';
            console.error('[Sparrow SMS] API error:', {
              statusCode: res.statusCode,
              responseCode: json.response_code,
              message: apiMessage,
              to,
              sender,
            });
            reject(new Error(apiMessage));
          } catch (e) {
            console.error('[Sparrow SMS] Non-JSON response:', data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ raw: data });
              return;
            }
            reject(new Error('Unexpected SMS provider response'));
          }
        });
      }
    );

    req.on('error', (err) => {
      console.error('[Sparrow SMS] Network error:', err.message);
      reject(new Error('SMS sending failed'));
    });

    req.write(postData);
    req.end();
  });
};

module.exports = { sendSms, sanitizeToken, normalizeNepalPhone };