const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const compression = require('compression');

dotenv.config();

const app = express();

// ==================== Environment Variable Validation ====================
const requiredEnvVars = ['JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingEnvVars.join(', '));
  console.error('   Please check your .env file');
  process.exit(1);
}

// Warn about payment configuration
if (!process.env.ESEWA_MERCHANT_ID || !process.env.ESEWA_SECRET_KEY) {
  console.warn('⚠️  eSewa credentials not fully configured. Using test mode.');
}
if (!process.env.KHALTI_SECRET_KEY) {
  console.warn('⚠️  Khalti secret key not configured. Khalti payments will be disabled.');
}

// ==================== Import Database & Models ====================
const Database = require('./models/DatabaseAdapter');
let mongoModels = null;

// ==================== Database Connection ====================
let dbConnected = false;

const connectDatabase = async () => {
  const dbType = (process.env.DATABASE_TYPE || 'json').toLowerCase();

  if (dbType === 'json' || !dbType) {
    console.log('📁 Using JSON file-based database\n');
    dbConnected = 'json';
    return;
  }

  if (['postgres', 'postgresql', 'neon', 'pg'].includes(dbType)) {
    try {
      const { connectPostgres } = require('./models/postgres');
      const pool = await connectPostgres();

      if (pool) {
        dbConnected = 'postgres';
        console.log('✅ PostgreSQL (Neon) ready via unified Database adapter\n');
      } else {
        console.log('📁 Falling back to JSON file-based database\n');
        dbConnected = 'json';
      }
    } catch (error) {
      console.error('❌ PostgreSQL connection error:', error.message);
      console.log('📁 Falling back to JSON file-based database\n');
      dbConnected = 'json';
    }
    return;
  }

  // MongoDB or unknown → fallback to JSON
  console.log('📁 Using JSON file-based database (MongoDB not configured or fallback triggered)\n');
  dbConnected = 'json';
};

// ==================== Middleware ====================

// Compression
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// CORS
app.use(cors({
  origin: function (origin, callback) {
    const allowed = [
      'http://localhost:3000',
      process.env.FRONTEND_URL,
      'https://aaoms.onrender.com'
    ].filter(Boolean);

    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsers (only once!)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Cache headers middleware
const publicCacheablePaths = [
  '/api/products', '/api/banners', '/api/instagram-feed',
  '/api/reviews', '/api/health', '/api/database-status'
];

app.use((req, res, next) => {
  if (req.method === 'GET' && publicCacheablePaths.some(p => req.path.startsWith(p))) {
    res.set({
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=300',
      'Vary': 'Accept-Encoding, Authorization'
    });
  } else if (req.method === 'GET' && req.path.startsWith('/api/')) {
    if (['/api/cart', '/api/orders', '/api/wishlist', '/api/addresses', '/api/users', '/api/notifications']
        .some(p => req.path.startsWith(p))) {
      res.set('Cache-Control', 'private, no-store, max-age=0');
    } else {
      res.set('Cache-Control', 'private, max-age=30');
    }
  }
  next();
});

// ==================== Health & Status Routes ====================
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true,
    message: 'AAOMS Backend is Running!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: dbConnected
  });
});

app.get('/api/database-status', (req, res) => {
  // ... (keep your existing database-status route)
  if (dbConnected === 'mongodb') {
    const mongoose = require('mongoose');
    res.json({
      success: true,
      status: 'connected',
      database: 'MongoDB',
      host: mongoose.connection.host,
      name: mongoose.connection.name,
      readyState: mongoose.connection.readyState
    });
  } else if (dbConnected === 'postgres') {
    res.json({
      success: true,
      status: 'connected',
      database: 'PostgreSQL (Neon)',
      message: 'Connected via pg Pool + unified Database adapter'
    });
  } else {
    res.json({
      success: true,
      status: 'connected',
      database: 'JSON File-Based',
      message: 'Using local JSON files for data persistence'
    });
  }
});

// ==================== Import & Use Routes ====================
const productRoutes = require('./routes/productRoutes');
// ... (keep all your route requires as they are)

app.use('/api/products', productRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/instagram-feed', instagramFeedRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/contact', contactRoutes);

// ==================== 404 & Error Handling ====================
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('Server Error:', err.message);
  if (err.stack) console.error(err.stack);
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ==================== Start Server ====================
const PORT = process.env.PORT || 5000;

connectDatabase().then(() => {
  const server = app.listen(PORT, '0.0.0.0', () => {
    const dbLabel = dbConnected === 'mongodb' ? 'MongoDB' 
                  : dbConnected === 'postgres' ? 'PostgreSQL (Neon)' 
                  : 'JSON Files';

    console.log(`\n╔════════════════════════════════════════════╗`);
    console.log(`║  AAOMS Backend Server          ║`);
    console.log(`║  Running on: http://localhost:${PORT}          ║`);
    console.log(`║  Environment: ${process.env.NODE_ENV || 'development'}               ║`);
    console.log(`║  Database: ${dbLabel.padEnd(20)} ║`);
    console.log(`╚════════════════════════════════════════════╝\n`);

    // ... (keep your useful endpoints log)
  });

  // ... (keep the rest of your server error handling, graceful shutdown, etc.)

}).catch((error) => {
  console.error('Failed to start server:', error.message);
  process.exit(1);
});

module.exports = app;