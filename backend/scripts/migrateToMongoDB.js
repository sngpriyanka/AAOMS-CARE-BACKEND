#!/usr/bin/env node

/**
 * Migration Script: JSON to MongoDB
 * 
 * This script migrates data from JSON files to MongoDB Atlas
 * 
 * Usage: node scripts/migrateToMongoDB.js
 * 
 * Prerequisites:
 * 1. Install mongoose: npm install mongoose
 * 2. Update MONGODB_URI in .env file
 * 3. Ensure data exists in backend/data/*.json files
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectDB, mongoose } = require('../models/mongodb');
const { User, Product, Order, Cart } = require('../models/schemas');

const DATA_DIR = path.join(__dirname, '../data');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

const log = {
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
};

// Read JSON data
function readJSON(filename) {
  const filepath = path.join(DATA_DIR, filename);
  try {
    if (!fs.existsSync(filepath)) {
      log.warn(`File not found: ${filename}`);
      return [];
    }
    const data = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    log.error(`Error reading ${filename}: ${error.message}`);
    return [];
  }
}

// Backup JSON files
function backupJSON() {
  const backupDir = path.join(DATA_DIR, 'backup');
  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    fs.readdirSync(DATA_DIR).forEach(file => {
      if (file.endsWith('.json')) {
        const src = path.join(DATA_DIR, file);
        const dst = path.join(backupDir, `${file}.backup`);
        fs.copyFileSync(src, dst);
      }
    });
    
    log.success(`Backup created in ${backupDir}`);
    return true;
  } catch (error) {
    log.error(`Backup failed: ${error.message}`);
    return false;
  }
}

// Migrate data
async function migrateData() {
  try {
    log.info('Starting migration from JSON to MongoDB...\n');

    // Step 1: Backup
    log.info('Step 1: Creating backup of JSON files...');
    backupJSON();

    // Step 2: Connect to MongoDB
    log.info('\nStep 2: Connecting to MongoDB...');
    await connectDB();

    // Step 3: Clear existing data (optional)
    log.warn('Clearing existing MongoDB data...');
    await User.deleteMany({});
    await Product.deleteMany({});
    await Order.deleteMany({});
    await Cart.deleteMany({});

    // Step 4: Migrate Users
    log.info('\nStep 3: Migrating Users...');
    const users = readJSON('users.json');
    if (users.length > 0) {
      const createdUsers = await User.insertMany(users);
      log.success(`Migrated ${createdUsers.length} users`);
    } else {
      log.warn('No users to migrate');
    }

    // Step 5: Migrate Products
    log.info('\nStep 4: Migrating Products...');
    const products = readJSON('products.json');
    if (products.length > 0) {
      const createdProducts = await Product.insertMany(products);
      log.success(`Migrated ${createdProducts.length} products`);
    } else {
      log.warn('No products to migrate');
    }

    // Step 6: Migrate Orders
    log.info('\nStep 5: Migrating Orders...');
    const orders = readJSON('orders.json');
    if (orders.length > 0) {
      const createdOrders = await Order.insertMany(orders);
      log.success(`Migrated ${createdOrders.length} orders`);
    } else {
      log.warn('No orders to migrate');
    }

    // Step 7: Migrate Carts
    log.info('\nStep 6: Migrating Carts...');
    const carts = readJSON('carts.json');
    if (carts.length > 0) {
      const createdCarts = await Cart.insertMany(carts);
      log.success(`Migrated ${createdCarts.length} carts`);
    } else {
      log.warn('No carts to migrate');
    }

    // Verify migration
    log.info('\nStep 7: Verifying migration...');
    const userCount = await User.countDocuments();
    const productCount = await Product.countDocuments();
    const orderCount = await Order.countDocuments();
    const cartCount = await Cart.countDocuments();

    log.success(`Migration Summary:`);
    console.log(`  📊 Users: ${userCount}`);
    console.log(`  📦 Products: ${productCount}`);
    console.log(`  🛒 Orders: ${orderCount}`);
    console.log(`  🛍️  Carts: ${cartCount}`);

    log.success('\n✨ Migration completed successfully!');
    log.info('Your data is now in MongoDB Atlas');
    log.warn('Backup files saved in: backend/data/backup/');

  } catch (error) {
    log.error(`Migration failed: ${error.message}`);
    console.error(error);
  } finally {
    // Close MongoDB connection
    await mongoose.disconnect();
    log.info('MongoDB connection closed');
  }
}

// Run migration
if (process.env.DATABASE_TYPE !== 'mongodb') {
  log.error('DATABASE_TYPE must be set to "mongodb" in .env file');
  process.exit(1);
}

migrateData();
