/**
 * Indian mobile number utilities.
 * Accepts 10-digit numbers with optional +91 / 91 prefix or leading 0.
 */

const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

const INDIAN_MOBILE_ERROR =
  'Please enter a valid Indian mobile number (10 digits, starting with 6, 7, 8, or 9)';

function normalizeIndianPhone(phone) {
  if (!phone) return '';

  let digits = String(phone).replace(/\D/g, '');

  if (digits.length >= 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length >= 12 && digits.startsWith('977')) {
    digits = digits.slice(3);
  }

  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  if (digits.length > 10) {
    const last10 = digits.slice(-10);
    if (INDIAN_MOBILE_REGEX.test(last10)) return last10;
    digits = digits.slice(-10);
  }

  return digits;
}

function isValidIndianMobile(phone10) {
  return INDIAN_MOBILE_REGEX.test(normalizeIndianPhone(phone10));
}

function validateIndianPhone(phone) {
  const normalized = normalizeIndianPhone(phone);
  if (!normalized) return false;
  return isValidIndianMobile(normalized);
}

function formatIndianPhone(phone) {
  const normalized = normalizeIndianPhone(phone);
  if (!normalized) return '';
  if (String(phone).trim().startsWith('+')) {
    return `+91${normalized}`;
  }
  return `+91${normalized}`;
}

function toPhone10(phone) {
  return normalizeIndianPhone(phone);
}

function sanitizePhoneInput(value, maxLength = 10) {
  return String(value || '').replace(/\D/g, '').slice(0, maxLength);
}

module.exports = {
  INDIAN_MOBILE_REGEX,
  INDIAN_MOBILE_ERROR,
  normalizeIndianPhone,
  isValidIndianMobile,
  validateIndianPhone,
  formatIndianPhone,
  toPhone10,
  sanitizePhoneInput,
};