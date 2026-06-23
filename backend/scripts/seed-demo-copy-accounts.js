#!/usr/bin/env node
/**
 * Seed Demo Accounts Script
 *
 * Usage:
 *   cd backend
 *   node scripts/seed-demo-copy-accounts.js
 */

require('dotenv').config();

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const Database = require('../models/DatabaseAdapter');

const USERS_COLLECTION = 'users';
const ADMINS_COLLECTION = 'admins';

async function connectPostgres() {
  console.log('🔌 Connecting to PostgreSQL...');
  const { connectPostgres: connect, closePostgres } = require('../models/postgres');
  const pool = await connect();
  if (!pool) {
    console.error('❌ Failed to connect to Postgres. Check your DATABASE_URL in .env');
    process.exit(1);
  }
  console.log('✅ PostgreSQL connected for seeding\n');
  return closePostgres;
}

async function seedDemoAccounts() {
  console.log('\n🌱 Seeding Demo Accounts...\n');

  const closePostgres = await connectPostgres();

  const demoAccounts = [
    {
      email: 'customer@example.com',
      password: 'customer123',
      name: 'John Doe',
      role: 'customer',
      collection: USERS_COLLECTION,
    },
    {
      email: 'admin@example.com',
      password: 'admin123',
      name: 'Admin User',
      role: 'admin',
      collection: ADMINS_COLLECTION,
    },
    {
      email: 'super@example.com',
      password: 'super123',
      name: 'Super Admin',
      role: 'super_admin',
      collection: ADMINS_COLLECTION,
    },
  ];

  for (const account of demoAccounts) {
    try {
      const existing = await Database.findBy(account.collection, 'email', account.email);

      if (existing) {
        console.log(`⏭️  Skipped ${account.email} (already exists in ${account.collection})`);
        continue;
      }

      const hashedPassword = await bcrypt.hash(account.password, 12);
      const id = uuidv4();

      const record = {
        id,
        _id: id,
        email: account.email.toLowerCase(),
        password: hashedPassword,
        name: account.name,
        role: account.role,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (account.collection === USERS_COLLECTION) {
        record.phone = '9876543210';
        record.address = '123 Demo Street';
        record.city = 'Demo City';
        record.state = 'DS';
        record.zipcode = '12345';
      }

      await Database.create(account.collection, record);

      const displayRole = account.role === 'super_admin' ? 'SUPER ADMIN' : account.role.toUpperCase();
      console.log(`✅ Created ${displayRole}: ${account.email} → ${account.collection}`);
      console.log(`   📧 Email: ${account.email}`);
      console.log(`   🔐 Password: ${account.password}`);
      console.log(`   👤 Role: ${account.role}\n`);
    } catch (error) {
      console.error(`❌ Failed to create ${account.email}:`, error.message);
    }
  }

  console.log('\n🎉 Demo account seeding completed!\n');
  console.log('🧪 Test Accounts (use these to login):\n');
  console.log('  👤 Customer     → customer@example.com / customer123');
  console.log('  👨‍💼 Admin        → admin@example.com / admin123');
  console.log('  👑 Super Admin  → super@example.com / super123\n');

  await closePostgres().catch(() => {});
}

seedDemoAccounts().catch((error) => {
  console.error('❌ Seeding error:', error);
  process.exit(1);
});