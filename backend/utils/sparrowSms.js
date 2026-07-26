/**
 * Backward-compatible re-export.
 * SMS delivery lives in smsService.js (Indian OTP API + optional Sparrow fallback).
 */
const { sendSms, sanitizeToken, buildOtpMessage } = require('./smsService');

module.exports = { sendSms, sanitizeToken, buildOtpMessage };
