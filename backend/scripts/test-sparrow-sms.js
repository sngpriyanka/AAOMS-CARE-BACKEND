require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { sendSms, sanitizeToken, normalizeNepalPhone } = require('../utils/sparrowSms');

(async () => {
  console.log('Token:', sanitizeToken(process.env.SPARROW_TOKEN));
  console.log('Sender:', process.env.SPARROW_SENDER);
  console.log('Normalized phone:', normalizeNepalPhone('9779807797080'));

  try {
    const result = await sendSms('9807797080', 'AAOMS OTP integration test');
    console.log('Success:', result);
  } catch (error) {
    console.error('Failed:', error.message);
    process.exit(1);
  }
})();