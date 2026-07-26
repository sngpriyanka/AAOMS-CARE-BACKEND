/**
 * Create local upload directories (run on HostingRaja or locally).
 *
 * Usage:
 *   node scripts/ensure-upload-dirs.js
 *   UPLOADS_DIR=~/aaoms-data/uploads node scripts/ensure-upload-dirs.js
 *
 * Reads UPLOADS_DIR from environment or backend/.env
 */

const path = require('path');
const fs = require('fs');

// Load backend/.env if present
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {
  // dotenv may not resolve outside package context; ignore
}

const { ensureUploadTree, DEFAULT_SUBDIRS, getUploadsRoot } = require('../utils/localUpload');

const root = ensureUploadTree();
console.log('✅ Upload root:', root);
console.log('✅ Subdirectories:');
DEFAULT_SUBDIRS.forEach((s) => {
  const p = path.join(root, s);
  const ok = fs.existsSync(p);
  console.log(`   ${ok ? '✓' : '✗'} ${p}`);
});

// Write test
const testFile = path.join(root, 'products', '.write-test');
try {
  fs.writeFileSync(testFile, 'ok');
  fs.unlinkSync(testFile);
  console.log('✅ Write test passed (products/)');
} catch (e) {
  console.error('❌ Write test FAILED:', e.message);
  console.error('   Fix permissions for the Node process user on:', root);
  process.exit(1);
}

console.log('');
console.log('Set in .env:');
console.log(`  UPLOADS_DIR=${process.env.UPLOADS_DIR || root}`);
console.log('  BACKEND_PUBLIC_URL=https://your-domain.com');
console.log('');
console.log('Resolved root (same as runtime):', getUploadsRoot());
