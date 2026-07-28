const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const compression = require('compression');

dotenv.config();

let pgPool = null;

const app = express();

// Keep Render + Neon alive
const keepAlive = async () => {
  try {
    if (pgPool) {
      await pgPool.query('SELECT 1');
      console.log('✅ Keep-alive ping successful');
    }
  } catch (e) {
    console.error('Keep-alive failed:', e.message);
  }
};

// Ping every 4 minutes
setInterval(keepAlive, 4 * 60 * 1000);

// Also create a simple ping endpoint for Render/UptimeRobot
app.get('/ping', (req, res) => {
  res.status(200).send('OK');
});

// ==================== Environment Variable Validation ====================
const requiredEnvVars = ['JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingEnvVars.join(', '));
  console.error('   Please check your .env file');
  process.exit(1);
}

// Warn about payment configuration (reject empty / placeholder keys)
(() => {
  const id = (process.env.RAZORPAY_KEY_ID || '').trim();
  const secret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
  const bad =
    !id ||
    !secret ||
    /x{4,}|your_razorpay|placeholder|changeme/i.test(id + secret);
  if (bad) {
    console.warn(
      '⚠️  Razorpay credentials not configured (or still placeholders).\n' +
        '   Set real RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env\n' +
        '   from https://dashboard.razorpay.com/app/keys — payments will fail until then.'
    );
  } else {
    console.log(`✅ Razorpay configured (key: ${id.slice(0, 12)}…)`);
  }
})();


// ==================== Import Database ====================
const Database = require('./models/DatabaseAdapter');

// ==================== Database Connection (PostgreSQL / Neon) ====================
let dbConnected = false;

const connectDatabase = async () => {
  const { connectPostgres } = require('./models/postgres');
  pgPool = await connectPostgres();

  if (!pgPool) {
    console.error('❌ PostgreSQL connection required. Set DATABASE_URL in .env');
    process.exit(1);
  }

  dbConnected = 'postgres';
  Database.dbType = 'postgres';
  console.log('✅ PostgreSQL (Neon) ready via unified Database adapter\n');
};

// TEMPORARY DEBUG
app.get('/api/debug-upload', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const testFile = path.join(uploadsRoot, 'products', 'products-1785247705756-a5a42e409fa9fa41149624bf.jpg');
  res.json({
    uploadsRoot,
    testFile,
    exists: fs.existsSync(testFile),
    files: fs.readdirSync(path.join(uploadsRoot, 'products')).slice(0, 5)
  });
});

// ==================== Middleware ====================
// Compression (gzip) — dramatically reduces JSON, HTML, text response sizes (often 60-80% smaller)
app.use(compression({
  level: 6,
  threshold: 1024, // only compress responses >1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// CORS Configuration
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5000',
      'http://localhost:5173',
      'https://aaoms.co.in',
      'https://www.aaoms.co.in',
      'http://aaoms.co.in',
      'http://www.aaoms.co.in',
      'https://aaoms-care-frontend.vercel.app',
      'https://aaoms-care-backend.onrender.com',
      'https://aaoms.online',
      'https://www.aaoms.online',
      process.env.FRONTEND_URL,
    ].filter(Boolean);

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ==================== Local uploads (Multer disk → local / VPS) ====================
// Cloudinary was previously used for media; its code is COMMENTED (not deleted)
// in utils/cloudinaryConfig.js so it can be re-enabled later.
//
// UPLOADS_DIR env:
//   Local:  uploads  (→ backend/uploads)
//   VPS:    /var/www/.../aaoms-data/uploads  or  ~/aaoms-data/uploads
// Folders auto-created: profile, products, categories, videos, banners,
//   testimonials, gallery, documents
// Served at GET /uploads/... BEFORE React SPA catch-all
const path = require('path');
const { UPLOADS_ROOT, ensureUploadTree, DEFAULT_SUBDIRS } = require('./utils/localUpload');
const uploadsRoot = ensureUploadTree();
app.use(
  '/uploads',
  express.static(uploadsRoot, {
    maxAge: '7d',
    etag: true,
    index: false,
    fallthrough: true,
  })
);
console.log(`📁 Local uploads root: ${uploadsRoot}`);
console.log(`   Subfolders: ${DEFAULT_SUBDIRS.join(', ')}`);
console.log(`   Public URL prefix: /uploads  (BACKEND_PUBLIC_URL=${process.env.BACKEND_PUBLIC_URL || '(request host)'})`);
if (!process.env.UPLOADS_DIR) {
  console.warn(
    '⚠️  UPLOADS_DIR not set — using backend/uploads. On VPS set UPLOADS_DIR to absolute path (e.g. $HOME/aaoms-data/uploads)'
  );
}

// Performance: cache headers for mostly-static public GET endpoints (products, banners, instagram, reviews, etc.)
// Short-ish TTLs for freshness while reducing load. Private user data (orders, cart, wishlist) are not cached here.
const publicCacheablePaths = [
  '/api/products',
  '/api/banners',
  '/api/testimonials',
  '/api/instagram-feed',
  '/api/reviews',
  '/api/health',
  '/api/database-status'
];

app.use((req, res, next) => {
  if (req.method === 'GET' && publicCacheablePaths.some(p => req.path.startsWith(p))) {
    // Individual product lookups must not be cached — they must reflect deletes immediately
    if (/^\/api\/products\/(id|slug|resolve)\//.test(req.path)) {
      res.set('Cache-Control', 'private, no-store, max-age=0');
    } else {
      // Public data: cache 60s in CDN/browser, allow stale for 5min while revalidate
      res.set({
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=300',
        'Vary': 'Accept-Encoding, Authorization' // vary because auth header may affect some but here mostly public
      });
    }
  } else if (req.method === 'GET' && req.path.startsWith('/api/')) {
    // Other GET APIs (user-specific): short private cache or no-store for dynamic
    // For carts/orders/wishlist use no-store to avoid stale private data
    if (['/api/cart', '/api/orders', '/api/wishlist', '/api/addresses', '/api/users', '/api/notifications'].some(p => req.path.startsWith(p))) {
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
    message: 'Bombay Trooper Backend is Running!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: dbConnected
  });
});

app.get('/api/database-status', (req, res) => {
  res.json({
    success: dbConnected === 'postgres',
    status: dbConnected === 'postgres' ? 'connected' : 'disconnected',
    database: 'PostgreSQL (Neon)',
    message: 'Connected via pg Pool + unified Database adapter',
  });
});

// ==================== Import Routes ====================
const productRoutes = require('./routes/productRoutes');
const userRoutes = require('./routes/userRoutes');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');
const authRoutes = require('./routes/authRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');
const addressRoutes = require('./routes/addressRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const instagramFeedRoutes = require('./routes/instagramFeedRoutes');
const bannerRoutes = require('./routes/bannerRoutes');
const testimonialRoutes = require('./routes/testimonialRoutes');
const reviewsRoutes = require('./routes/reviewsRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const contactRoutes = require('./routes/contactRoutes');
const categoryRoutes = require('./routes/categoryRoutes');

// Periodic email scheduler (node-cron)
let cron;
try {
  cron = require('node-cron');
} catch (e) {
  console.warn('node-cron not available, periodic newsletters disabled');
}

// ==================== Use Routes ====================
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
app.use('/api/testimonials', testimonialRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/categories', categoryRoutes);

// ==================== Serve React Frontend ====================
app.use(express.static(path.join(__dirname, 'build')));

// This must be AFTER all API routes and /uploads static
app.get('*', (req, res) => {
  // Do not hijack missing upload assets with index.html
  if (req.path.startsWith('/uploads/')) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// ==================== Error Handling ====================
app.use((err, req, res, next) => {
  console.error('Server Error:', err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  // Multer file size / type errors
  if (err && err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      message: err.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large. Max 10MB per product image.'
        : err.message || 'Upload error',
    });
  }
  if (err && /File type not allowed/i.test(err.message || '')) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
  if (!err.status || err.status >= 500) {
    console.error('  →', req.method, req.originalUrl, 'body:', JSON.stringify(req.body).slice(0, 300));
  }
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ==================== Start Server ====================
const PORT = process.env.PORT || 5000;

// Connect to database first, then start server
connectDatabase().then(() => {
  const server = app.listen(PORT, '0.0.0.0', () => {
    const dbLabel = 'PostgreSQL (Neon)';

    console.log(`\n╔════════════════════════════════════════════╗`);
    console.log(`║  AAOMS CARE Backend Server          ║`);
    console.log(`║  Running on: http://localhost:${PORT}          ║`);
    console.log(`║  Environment: ${process.env.NODE_ENV || 'development'}               ║`);
    console.log(`║  Database: ${dbLabel.padEnd(20)} ║`);
    console.log(`╚════════════════════════════════════════════╝\n`);

    console.log('🔍 Useful Endpoints:');
    console.log('   GET  /api/health');
    console.log('   GET  /api/database-status');
    console.log('   POST /api/payment/razorpay/create-order');
    console.log('   POST /api/payment/razorpay/verify');
    console.log('   GET  /api/payment/methods');
    console.log('   POST /api/subscriptions/subscribe  (public)');
    console.log('   POST /api/subscriptions/send-newsletter  (admin)\n');

    // ==================== Periodic Auto Newsletter (Weekly Club Update) ====================
    // Enabled only when ENABLE_AUTO_NEWSLETTER=true and SMTP is configured.
    // Runs every Sunday at 10:00 (server local time). Sends a tasteful, low-volume promo to ACTIVE subscribers.
    // For production you can tune the cron expression or move to an external scheduler (e.g. Render cron jobs).
    if (cron && process.env.ENABLE_AUTO_NEWSLETTER === 'true') {
      const hasSmtp = !!(process.env.SMTP_HOST || process.env.SMTP_SERVICE || process.env.SMTP_MAIL);
      if (hasSmtp) {
        // '0 10 * * 0' = 10:00 AM every Sunday
        cron.schedule('0 10 * * 0', async () => {
          try {
            console.log('🗓️  [CRON] Running weekly AAOMS CARE Club auto-newsletter...');
            const Database = require('./models/DatabaseAdapter');
            const subs = (await Database.readAll('subscribers')).filter(s => s.isActive !== false);
            if (!subs.length) {
              console.log('🗓️  [CRON] No active subscribers. Skipping.');
              return;
            }

            const nodemailer = require('nodemailer');
            let transporter;
            if (process.env.SMTP_HOST) {
              transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: process.env.SMTP_SECURE === 'true',
                auth: { user: process.env.SMTP_USER || process.env.SMTP_MAIL, pass: process.env.SMTP_PASS }
              });
            } else {
              transporter = nodemailer.createTransport({
                service: process.env.SMTP_SERVICE || 'gmail',
                auth: { user: process.env.SMTP_MAIL, pass: process.env.SMTP_PASS }
              });
            }

            const from = process.env.EMAIL_FROM || `"AAOMS CARE Club" <${process.env.SMTP_MAIL || process.env.SMTP_USER}>`;
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            const subject = 'Your Weekly AAOMS CARE Club Update ✨ New Arrivals & Offers Inside';

            let sent = 0;
            for (const sub of subs) {
              const email = sub.email;
              if (!email) continue;
              const unsubscribeLink = `${frontendUrl}/unsubscribe?email=${encodeURIComponent(email)}`;
              try {
                await transporter.sendMail({
                  from,
                  to: email,
                  subject,
                  html: `
                    <div style="font-family:system-ui,Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
                      <div style="background:#1a1a1a;color:#fff;padding:24px 20px;text-align:center">
                        <div style="font-size:20px;letter-spacing:2px;font-weight:700">AAOMS CARE CLUB</div>
                      </div>
                      <div style="padding:28px 24px;color:#222;line-height:1.65">
                        <p>Hi Club Member,</p>
                        <p>This week we dropped new pieces inspired by our latest travels — including the signature lightweight travel shirts and the restocked brass accessories.</p>
                        <p style="margin:18px 0"><strong>Current highlight:</strong> 15% off sitewide for Club members this week only. Use code <strong>CLUB15</strong> at checkout.</p>
                        <a href="${frontendUrl}/collection" style="display:inline-block;background:#c9a227;color:#000;padding:11px 22px;border-radius:6px;text-decoration:none;font-weight:600">Browse New Arrivals →</a>
                        <p style="margin-top:24px;font-size:13px">See you on the next adventure,<br/>Team AAOMS CARE</p>
                      </div>
                      <div style="background:#f8f8f8;padding:14px 24px;font-size:11px;color:#777;text-align:center">
                        You are receiving this because you joined the AAOMS CARE Club.<br/>
                        <a href="${unsubscribeLink}" style="color:#999">Unsubscribe</a>
                      </div>
                    </div>
                  `
                });
                sent++;
              } catch (e) {
                console.warn('Cron email failed for one recipient:', e.message);
              }
            }
            console.log(`🗓️  [CRON] Weekly newsletter complete. Sent to ${sent}/${subs.length} active subscribers.`);
          } catch (cronErr) {
            console.error('🗓️  [CRON] Weekly newsletter error:', cronErr.message);
          }
        }, { timezone: process.env.CRON_TZ || 'Asia/Kathmandu' });

        console.log('✅ Periodic auto-newsletter scheduler enabled (Sundays 10:00). Set ENABLE_AUTO_NEWSLETTER=false to disable.');
      } else {
        console.log('⚠️  Periodic newsletter skipped: no SMTP credentials detected in env.');
      }
    } else if (process.env.ENABLE_AUTO_NEWSLETTER === 'true') {
      console.log('ℹ️  ENABLE_AUTO_NEWSLETTER=true but node-cron not loaded — periodic emails disabled.');
    }
  });

  // Allow port reuse for quick restarts
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${PORT} is already in use!`);
      console.error('   Retrying in 2 seconds...\n');
      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 2000);
      return;
    }
    throw err;
  });

  // Enable socket reuse
  try {
    server.on('connection', (socket) => {
      socket.setKeepAlive(true);
    });
  } catch (e) {
    // Ignore if not available
  }

  // Graceful shutdown
  const gracefulShutdown = () => {
    console.log('\n📛 Shutting down gracefully...');
    server.close(async () => {
      try {
        const { closePostgres } = require('./models/postgres');
        await closePostgres();
      } catch (_) {}
      console.log('✅ Server closed');
      process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      console.error('❌ Forced shutdown after 10 seconds');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

}).catch((error) => {
  console.error('Failed to start server:', error.message);
  process.exit(1);
});

module.exports = app;
