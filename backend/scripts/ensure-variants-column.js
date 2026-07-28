/**
 * Ensure products.variants JSONB column exists (local + production).
 * Usage: node scripts/ensure-variants-column.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL missing in .env');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost')
      ? false
      : { rejectUnauthorized: false },
  });

  try {
    const cols = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'products'
      ORDER BY ordinal_position
    `);
    console.log(
      'products columns:',
      cols.rows.map((r) => r.column_name).join(', ')
    );

    const has = cols.rows.some((r) => r.column_name === 'variants');
    if (!has) {
      await pool.query(`
        ALTER TABLE products
        ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT '[]'
      `);
      console.log('✅ Added products.variants column');
    } else {
      console.log('✅ products.variants already exists');
    }

    const test = await pool.query(
      `SELECT id, name, variants FROM products ORDER BY created_at DESC NULLS LAST LIMIT 3`
    );
    console.log(`✅ Query OK (${test.rows.length} sample product(s))`);
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
