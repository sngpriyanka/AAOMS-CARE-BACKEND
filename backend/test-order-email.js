const emailSvc = require('./utils/emailService');
console.log('emailService keys:', Object.keys(emailSvc));

const orderCtrl = require('./controllers/orderController');
console.log('orderController loaded (updateOrderStatus + cancel now send emails)');

const payCtrl = require('./controllers/paymentController');
console.log('paymentController loaded (payment success paths now send confirmation emails)');

console.log('✅ All modules and order update email hooks load cleanly.');

// Quick smoke: test getRecipient + status label (no real send)
(async () => {
  const fakeOrder = {
    orderId: 'ORD-TEST-123',
    status: 'shipped',
    shippingAddress: { name: 'Test User', email: 'test@example.com' },
    items: [{ name: 'Test Shirt', quantity: 1, price: 1200 }],
    total: 1200,
    trackingNumber: 'BT123456'
  };
  console.log('Status label for shipped:', emailSvc.getOrderStatusLabel('shipped'));
  const recip = await emailSvc.getRecipientEmail(fakeOrder);
  console.log('Recipient resolved from shippingAddress:', recip);

  // Note: actual sendOrderStatusEmail would attempt SMTP only if configured; we don't call it here to avoid side effects
  console.log('Smoke test complete.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
