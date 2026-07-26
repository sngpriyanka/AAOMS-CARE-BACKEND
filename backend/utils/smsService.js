const https = require('https');
const http = require('http');
const { URL } = require('url');
const querystring = require('querystring');
const { toPhone10, isValidIndianMobile } = require('./phoneUtils');

/**
 * .env values sometimes include inline notes — strip anything after whitespace.
 */
function sanitizeToken(raw) {
  if (!raw) return '';
  return String(raw).trim().split(/\s+/)[0];
}

function getSmsConfig() {
  const apiKey = sanitizeToken(
    process.env.SMS_API_KEY ||
      process.env.SMS_OTP_API_KEY ||
      process.env.SPARROW_TOKEN
  );
  const senderId = (
    process.env.SMS_SENDER_ID ||
    process.env.SMS_SENDER ||
    process.env.SPARROW_SENDER ||
    '16025'
  ).trim();

  const apiUrl = (process.env.SMS_API_URL || '').trim();
  const provider = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  const isNinzaKey = /^NINZASMS/i.test(apiKey) || provider === 'ninzasms';

  const methodRaw = process.env.SMS_API_METHOD || (isNinzaKey ? 'GET' : 'POST');
  const method = String(methodRaw).toUpperCase() === 'GET' ? 'GET' : 'POST';
  const useSparrow =
    !apiUrl && !!sanitizeToken(process.env.SPARROW_TOKEN) && !isNinzaKey;

  return { apiKey, senderId, apiUrl, method, useSparrow, isNinzaKey };
}

/**
 * Send SMS via configured Indian OTP SMS API (NinzaSMS).
 *
 * Request parameters:
 *   api_key     — SMS_API_KEY
 *   sender_id   — SMS_SENDER_ID (default: 16025)
 *   mobile / to — Indian mobile (10-digit or with 91)
 *   message     — OTP message text
 *
 * Env:
 *   SMS_API_KEY, SMS_SENDER_ID, SMS_API_URL, SMS_API_METHOD, SMS_PROVIDER
 *   SPARROW_TOKEN / SPARROW_SENDER — legacy optional fallback
 */
async function sendSms(phone, message) {
  const { apiKey, senderId, apiUrl, method, useSparrow, isNinzaKey } = getSmsConfig();
  const to10 = toPhone10(phone);

  if (!isValidIndianMobile(to10)) {
    throw new Error(
      `Invalid Indian mobile number for SMS. Expected 10 digits starting with 6-9, got: ${phone}`
    );
  }

  if (!apiKey) {
    console.warn(
      '[SMS OTP] SMS_API_KEY not set in env. SMS will not be sent (dev mode).'
    );
    console.log(`[SMS OTP DEV] to=+91${to10} | message=${message}`);
    return { success: true, dev: true };
  }

  if (!senderId) {
    throw new Error('SMS_SENDER_ID is not configured');
  }

  if (apiUrl) {
    return sendViaHttpApi({
      apiUrl,
      method,
      apiKey,
      senderId,
      to10,
      message,
      compactParams: isNinzaKey,
    });
  }

  if (useSparrow || sanitizeToken(process.env.SPARROW_TOKEN)) {
    return sendViaSparrow({ apiKey, senderId, to10, message });
  }

  // API key present but no SMS_API_URL yet — log OTP for local/dev; set SMS_API_URL for live SMS.
  console.warn(
    '[SMS OTP] SMS_API_URL not set. OTP logged below (dev). Set SMS_API_URL from your NinzaSMS dashboard API docs for live delivery.'
  );
  console.log(
    `[SMS OTP DEV] api_key=*** sender_id=${senderId} mobile=${to10} message=${message}`
  );
  return { success: true, dev: true, senderId, to: to10 };
}

/**
 * Build request params for the SMS provider.
 * NinzaSMS / user-specified shape: api_key, sender_id, mobile, message
 * (also sends "sender" and "to" aliases for broader gateway compatibility)
 */
function buildSmsParams({ apiKey, senderId, to10, message, compactParams }) {
  // Prefer 10-digit for some gateways; include 91-prefixed form as mobile/to
  const mobileWithCountry = `91${to10}`;

  if (compactParams) {
    return {
      api_key: apiKey,
      sender_id: senderId,
      sender: senderId,
      mobile: to10,
      to: mobileWithCountry,
      message,
    };
  }

  return {
    api_key: apiKey,
    apiKey: apiKey,
    sender: senderId,
    sender_id: senderId,
    senderid: senderId,
    mobile: mobileWithCountry,
    to: mobileWithCountry,
    number: mobileWithCountry,
    message,
    text: message,
  };
}

function sendViaHttpApi({
  apiUrl,
  method,
  apiKey,
  senderId,
  to10,
  message,
  compactParams,
}) {
  const params = buildSmsParams({
    apiKey,
    senderId,
    to10,
    message,
    compactParams,
  });

  return httpRequest(apiUrl, method, params, 'SMS OTP').then((result) => {
    // Detect soft failures some gateways return with HTTP 200
    const body = result && (result.raw || result);
    const text =
      typeof body === 'string'
        ? body
        : body && typeof body === 'object'
          ? JSON.stringify(body)
          : '';

    if (text && /invalid\s*(api)?\s*key|unauthorized|authentication failed|errorcode["']?\s*[:=]\s*["']?[1-9]/i.test(text)) {
      console.error('[SMS OTP] Provider rejected request:', text.slice(0, 400));
      throw new Error('SMS provider rejected the request (check API key / credits / sender id)');
    }

    console.log(
      `[SMS OTP] Sent via ${method} ${apiUrl} → mobile=${to10} sender_id=${senderId}`
    );
    return result;
  });
}

function sendViaSparrow({ apiKey, senderId, to10, message }) {
  const params = {
    token: apiKey,
    from: senderId,
    to: to10,
    text: message,
  };

  return new Promise((resolve, reject) => {
    const postData = querystring.stringify(params);
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
              console.log(`[Sparrow SMS] Queued message to ${to10} (sender: ${senderId})`);
              resolve(json);
              return;
            }
            const apiMessage = json.response || json.response_message || 'SMS send failed';
            console.error('[Sparrow SMS] API error:', apiMessage);
            reject(new Error(apiMessage));
          } catch (e) {
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
}

function httpRequest(apiUrl, method, params, logLabel = 'SMS') {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(apiUrl);
    } catch {
      return reject(new Error('SMS_API_URL is not a valid URL'));
    }

    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    // Only send real param values (skip empty)
    const cleanParams = {};
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== '') cleanParams[k] = String(v);
    });

    const body = querystring.stringify(cleanParams);

    if (method === 'GET') {
      Object.entries(cleanParams).forEach(([k, v]) => {
        url.searchParams.set(k, v);
      });
    }

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: method === 'GET' ? `${url.pathname}${url.search}` : url.pathname + url.search,
      method,
      headers:
        method === 'POST'
          ? {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Content-Length': Buffer.byteLength(body),
              Accept: 'application/json, text/plain, */*',
            }
          : {
              Accept: 'application/json, text/plain, */*',
            },
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        const looksLikeHtml = /^\s*<(!DOCTYPE|html)/i.test(data);

        if (res.statusCode >= 200 && res.statusCode < 300 && !looksLikeHtml) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ success: true, raw: data });
          }
          return;
        }

        // HTML homepage / 404 page is not a successful SMS send
        if (looksLikeHtml || res.statusCode === 404) {
          console.error(
            `[${logLabel}] Provider returned HTML/404. Check SMS_API_URL from your NinzaSMS dashboard API docs.`,
            { statusCode: res.statusCode, url: apiUrl }
          );
          reject(
            new Error(
              'SMS API endpoint not found or returned a web page. Update SMS_API_URL in backend/.env to the exact send URL from your NinzaSMS dashboard (API Documentation).'
            )
          );
          return;
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ success: true, raw: data });
          }
          return;
        }

        console.error(`[${logLabel}] Provider error:`, {
          statusCode: res.statusCode,
          body: data?.slice?.(0, 500) || data,
        });
        reject(new Error(`SMS provider returned status ${res.statusCode}`));
      });
    });

    req.on('error', (err) => {
      console.error(`[${logLabel}] Network error:`, err.message);
      reject(new Error('SMS sending failed'));
    });

    if (method === 'POST') {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Build a standard OTP SMS body.
 * Example: Your OTP is 482916
 */
function buildOtpMessage(code) {
  const template =
    process.env.SMS_OTP_MESSAGE_TEMPLATE || 'Your OTP is {otp}';
  return template.replace(/\{otp\}/gi, String(code));
}

module.exports = {
  sendSms,
  sanitizeToken,
  buildOtpMessage,
  getSmsConfig,
};
