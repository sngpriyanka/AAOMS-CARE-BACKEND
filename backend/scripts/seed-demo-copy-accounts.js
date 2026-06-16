#!/usr/bin/env node
/**
 * Seed Demo Accounts Script - Universal Version
 * 
 * Works with ANY database type configured in .env:
 *   - postgres / neon
 *   - mongodb
 *   - json (file-based)
 * 
 * Usage:
 *   cd backend
 *   node scripts/seed-demo-accounts.js
 */

require('dotenv').config();

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const Database = require('../models/DatabaseAdapter');

const USERS_COLLECTION = 'users';
const ADMINS_COLLECTION = 'admins';

async function connectIfNeeded() {
  const dbType = (process.env.DATABASE_TYPE || 'json').toLowerCase();

  if (dbType === 'postgres' || dbType === 'postgresql' || dbType === 'neon' || dbType === 'pg') {
    console.log('🔌 Connecting to PostgreSQL...');
    const { connectPostgres } = require('../models/postgres');
    const pool = await connectPostgres();
    if (!pool) {
      console.error('❌ Failed to connect to Postgres. Check your DATABASE_URL in .env');
      process.exit(1);
    }
    console.log('✅ PostgreSQL connected for seeding\n');
    return 'postgres';
  }

  if (dbType === 'mongodb') {
    // Optional: support old Mongo path if someone wants it
    console.log('🔌 Connecting to MongoDB (legacy mode)...');
    const mongoose = require('mongoose');
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/aaxoms';
    await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('✅ MongoDB connected\n');
    return 'mongodb';
  }

  console.log('📁 Using JSON file-based database for seeding\n');
  return 'json';
}

async function seedDemoAccounts() {
  console.log('\n🌱 Seeding Demo Accounts (Universal Seeder)...\n');

  const dbType = await connectIfNeeded();

  const demoAccounts = [
    {
      email: 'customer@example.com',
      password: 'customer123',
      name: 'John Doe',
      role: 'customer',
      collection: USERS_COLLECTION
    },
    {
      email: 'admin@example.com',
      password: 'admin123',
      name: 'Admin User',
      role: 'admin',
      collection: ADMINS_COLLECTION
    },
    {
      email: 'super@example.com',
      password: 'super123',
      name: 'Super Admin',
      role: 'super_admin',
      collection: ADMINS_COLLECTION
    }
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
        updatedAt: new Date().toISOString()
      };

      // Add some extra fields for customer experience
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

  console.log('📌 Make sure your backend is running with the correct DATABASE_TYPE in .env\n');

  // Clean up connections if needed
  if (dbType === 'mongodb') {
    const mongoose = require('mongoose');
    await mongoose.connection.close().catch(() => {});
  }
  // Postgres pool will be closed by process exit, or we can leave it.
}

seedDemoAccounts().catch((error) => {
  console.error('❌ Seeding error:', error);
  process.exit(1);
});
