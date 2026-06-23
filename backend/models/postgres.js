const { Pool } = require('pg');
const { initializeTables, ensureSchemaPatches } = require('./migrations/initTables');

// PostgreSQL / Neon Connection
let pool = null;

const connectPostgres = async () => {
  try {
    const connectionString = process.env.DATABASE_URL 
      || process.env.POSTGRES_URI 
      || process.env.NEON_DATABASE_URL 
      || process.env.POSTGRES_URL;

    if (!connectionString) {
      console.error('❌ DATABASE_URL not set in .env');
      return null;
    }

    const isNeon = connectionString.includes('neon.tech');

    pool = new Pool({
      connectionString,
      ssl: isNeon ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Test connection
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as now, current_database() as db');
    client.release();

    console.log('✅ Connected to PostgreSQL (Neon) Successfully!');
    console.log(`📊 Database: ${result.rows[0].db}`);
    console.log(`🕒 Server time: ${result.rows[0].now}`);

    // Optimized table initialization
    await initializeTablesOptimized();

    pool.on('error', (err) => {
      console.error('❌ Unexpected pool error:', err.message);
    });

    return pool;
  } catch (error) {
    console.error('❌ PostgreSQL Connection Failed:', error.message);
    if (pool) await pool.end().catch(() => {});
    pool = null;
    return null;
  }
};

// Optimized initialization
const initializeTablesOptimized = async () => {
  if (!pool || global.postgresTablesInitialized) {
    if (global.postgresTablesInitialized) console.log('✅ Tables already initialized in this process.');
    return;
  }

  global.postgresTablesInitialized = true;

  const client = await pool.connect();
  try {
    // Quick existence check
    const { rows } = await client.query(`
      SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users') as exists;
    `);

    if (rows[0].exists) {
      console.log('✅ Database tables already exist. Skipping full initialization.');
      await ensureSchemaPatches(client);
      console.log('✅ Database schema patches verified.');
      return;
    }

    // Run full migration only once
    console.log('🔧 Initializing database tables for the first time...');
    await initializeTables(client);
    console.log('✅ Database fully initialized.');

  } catch (error) {
    console.error('⚠️ Table initialization error:', error.message);
  } finally {
    client.release();
  }
};

const getPool = () => pool;

const closePostgres = async () => {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('✅ PostgreSQL pool closed');
  }
};

module.exports = {
  connectPostgres,
  getPool,
  closePostgres
};