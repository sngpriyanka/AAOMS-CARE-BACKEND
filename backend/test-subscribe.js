process.env.DATABASE_TYPE = 'json';
const Database = require('./models/DatabaseAdapter');
const ctrl = require('./controllers/subscriptionController');

(async () => {
  // Cleanup prior test data
  try {
    const all = await Database.readAll('subscribers');
    for (const s of all) {
      if (s.email && /test.*aaoms/i.test(s.email)) {
        await Database.delete('subscribers', s.id || s._id);
      }
    }
  } catch (e) {}

  // 1st subscribe
  const req1 = { body: { email: 'Test.User+Club@Example.COM' } };
  let captured1;
  const res1 = { status: (c) => ({ json: (d) => { captured1 = { code: c, ...d }; } }) };
  await ctrl.subscribe(req1, res1);
  console.log('SUB1:', captured1.code, captured1.message, 'already=', !!captured1.alreadySubscribed);

  // Duplicate (different casing)
  const req2 = { body: { email: 'test.user+club@example.com' } };
  let captured2;
  const res2 = { status: (c) => ({ json: (d) => { captured2 = { code: c, ...d }; } }) };
  await ctrl.subscribe(req2, res2);
  console.log('SUB2 (dup):', captured2.code, captured2.message);

  const list = await Database.readAll('subscribers');
  const testSubs = list.filter(s => s.email && s.email.includes('example.com'));
  console.log('Subscribers matching test:', testSubs.length, testSubs.map(s => s.email));

  if (testSubs.length === 1) {
    console.log('✅ PASS: Deduplication + normalization works');
  } else {
    console.log('⚠️  Unexpected subscriber count');
  }

  // Cleanup
  for (const s of testSubs) {
    await Database.delete('subscribers', s.id);
  }
  console.log('✅ Subscription flow tested cleanly.');
  process.exit(0);
})().catch(err => {
  console.error('Test error:', err.message);
  process.exit(1);
});
