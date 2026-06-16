const pc = require('./backend/controllers/paymentController.js');
console.log('Controller keys:', Object.keys(pc));
const needed = ['getPaymentMethods','verifyEsewaPayment','verifyKhaltiPayment','initiateEsewaPayment','initiateKhaltiEpayment','getAdminRevenueSummary','getAdminPayments'];
needed.forEach(k => {
  if (typeof pc[k] !== 'function') {
    console.error('MISSING or not function:', k);
    process.exit(1);
  }
});
console.log('✅ All 7 payment handlers exported as functions');

let called = false;
const fakeRes = { 
  json: (d) => { called = true; console.log('getPaymentMethods OK, data count:', (d.data||[]).length); }
};
pc.getPaymentMethods({}, fakeRes);
if (!called) { console.error('getPaymentMethods did not respond'); process.exit(1); }

console.log('✅ getPaymentMethods works');
console.log('SUCCESS: payment controller fixed');
