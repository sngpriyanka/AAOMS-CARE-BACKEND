const initializeTables = async (client) => {
    await client.query('BEGIN');

    // Core tables - using TEXT for id to match existing UUID string pattern everywhere in the app
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT,  -- nullable for Google OAuth users (they don't have a local password)
        name TEXT NOT NULL,
        role TEXT DEFAULT 'customer',
        phone TEXT,
        address TEXT,
        city TEXT,
        state TEXT,
        zipcode TEXT,
        is_active BOOLEAN DEFAULT true,
        google_auth BOOLEAN DEFAULT false,
        reset_token TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Add profile extension columns (idempotent for existing DBs)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday TEXT;`).catch(() => {});
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;`).catch(() => {});
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture TEXT;`).catch(() => {});
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]';`).catch(() => {});
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_auth BOOLEAN DEFAULT false;`).catch(() => {});
    // Make password nullable for Google OAuth users (existing DBs)
    await client.query(`ALTER TABLE users ALTER COLUMN password DROP NOT NULL;`).catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        phone TEXT,
        permissions JSONB DEFAULT '[]',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Ensure role column exists for existing databases (idempotent)
    await client.query(`
      ALTER TABLE admins 
      ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin';
    `);

    // Support for phone (used in admin profiles) and permissions (super-admin assigned)
    await client.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS phone TEXT;`).catch(() => {});
    await client.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]';`).catch(() => {});
    await client.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`).catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE,
        price NUMERIC NOT NULL,
        original_price NUMERIC,
        description JSONB,
        sub_description TEXT,
        product_information TEXT,
        category TEXT NOT NULL,
        image TEXT,
        images JSONB DEFAULT '[]',
        sizes JSONB DEFAULT '[]',
        colors JSONB DEFAULT '[]',
        size_chart JSONB,
        quick_dry BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Idempotent migration for products (created_by was added for audit in createProduct)
    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS created_by TEXT;
    `);
    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS sub_description TEXT;
    `).catch(() => {});
    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS product_information TEXT;
    `).catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        order_id TEXT UNIQUE NOT NULL,
        user_id TEXT,
        items JSONB NOT NULL DEFAULT '[]',
        subtotal NUMERIC NOT NULL,
        shipping_cost NUMERIC DEFAULT 0,
        logo_charge NUMERIC DEFAULT 0,
        total NUMERIC NOT NULL,
        amount NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'pending',
        payment_method TEXT NOT NULL,
        payment_status TEXT DEFAULT 'pending',
        shipping_status TEXT DEFAULT 'not-shipped',
        shipping_address JSONB,
        transaction_id TEXT,
        notes TEXT,
        tracking_number TEXT,
        payment_gateway TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Idempotent migration: added transaction_id for payment gateway refs (eSewa ref_id, Khalti pidx, etc.)
    await client.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS transaction_id TEXT;
    `);

    // Idempotent migrations for additional order columns used in creation
    await client.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;
    `);
    await client.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number TEXT;
    `);
    await client.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_gateway TEXT;
    `);
    await client.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0;
    `);
    await client.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS logo_charge NUMERIC DEFAULT 0;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS carts (
        id TEXT PRIMARY KEY,
        user_id TEXT UNIQUE NOT NULL,
        items JSONB DEFAULT '[]',
        total NUMERIC DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS addresses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        address TEXT NOT NULL,
        city TEXT NOT NULL,
        state TEXT NOT NULL,
        pincode TEXT,
        zipcode TEXT,
        district TEXT,
        landmark TEXT,
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS wishlists (
        id TEXT PRIMARY KEY,
        user_id TEXT UNIQUE NOT NULL,
        items JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        order_id TEXT UNIQUE NOT NULL,
        user_id TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        method TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        transaction_id TEXT,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS pending_payments (
        id TEXT PRIMARY KEY,
        purchase_order_id TEXT UNIQUE NOT NULL,
        payment_token TEXT NOT NULL,
        payment_jwt TEXT,
        amount NUMERIC NOT NULL,
        user_id TEXT,
        items JSONB DEFAULT '[]',
        shipping_address JSONB,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Idempotent migration: added payment_jwt for the new signed-JWT security model used by eSewa/Khalti initiators.
    // The DB stores the JWT (self-contained proof) + snapshot data (items/shipping) for one-time consumption on verify.
    await client.query(`
      ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS payment_jwt TEXT;
    `);

    // Idempotent migration: ensure updated_at column exists (adapter always injects it on create/update for pending payments)
    await client.query(`
      ALTER TABLE pending_payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS instagram_feeds (
        id TEXT PRIMARY KEY,
        image TEXT NOT NULL,
        link TEXT NOT NULL,
        alt TEXT DEFAULT 'Instagram post',
        is_reel BOOLEAN DEFAULT false,
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Add created_by for existing installs (idempotent)
    await client.query(`
      ALTER TABLE instagram_feeds ADD COLUMN IF NOT EXISTS created_by TEXT;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        by TEXT,
        target TEXT,
        details TEXT,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        ip_address TEXT,
        user_id TEXT,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Idempotent migrations for older installs that used only "timestamp" column
    await client.query(`ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();`).catch(() => {});
    await client.query(`ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`).catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS banners (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        public_id TEXT,
        images JSONB DEFAULT '[]',
        pages JSONB DEFAULT '["home"]',
        link TEXT DEFAULT '/collection',
        title TEXT,
        subtitle TEXT,
        is_active BOOLEAN DEFAULT true,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Idempotent migration for existing databases (added created_by for audit)
    await client.query(`
      ALTER TABLE banners ADD COLUMN IF NOT EXISTS created_by TEXT;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS testimonials (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        text TEXT NOT NULL,
        image TEXT,
        public_id TEXT,
        product_id TEXT,
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS created_by TEXT;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        product_name TEXT,
        user_id TEXT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        title TEXT,
        review TEXT NOT NULL,
        date TEXT,
        verified BOOLEAN DEFAULT false,
        helpful INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        images JSONB DEFAULT '[]',
        size TEXT,
        location TEXT,
        created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        updated_at TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        type TEXT DEFAULT 'system',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        link TEXT DEFAULT '',
        read BOOLEAN DEFAULT false,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Contact Us messages (from public form) - admin managed with reply
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        subject TEXT,
        message TEXT NOT NULL,
        order_number TEXT,
        status TEXT DEFAULT 'unread',
        reply TEXT,
        replied_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_contact_messages_email ON contact_messages(email);`);

    // Ensure order_number column exists for older DBs (idempotent)
    await client.query(`ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS order_number TEXT;`).catch(() => {});

    // Helpful indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_carts_user_id ON carts(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_addresses_user_id ON addresses(user_id);`);

    // Add new columns for hierarchical address (Region/City/District + Landmark)
    await client.query(`ALTER TABLE addresses ADD COLUMN IF NOT EXISTS district TEXT;`).catch(() => {});
    await client.query(`ALTER TABLE addresses ADD COLUMN IF NOT EXISTS landmark TEXT;`).catch(() => {});
    await client.query(`ALTER TABLE addresses ADD COLUMN IF NOT EXISTS first_name TEXT;`).catch(() => {});
    await client.query(`ALTER TABLE addresses ADD COLUMN IF NOT EXISTS middle_name TEXT;`).catch(() => {});
    await client.query(`ALTER TABLE addresses ADD COLUMN IF NOT EXISTS last_name TEXT;`).catch(() => {});
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wishlists_user_id ON wishlists(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pending_payments_order ON pending_payments(purchase_order_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pending_payments_expires ON pending_payments(expires_at);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reviews_product_status ON reviews(product_id, status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);`).catch(() => {});
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_by ON activity_logs(by);`).catch(() => {});

    // Subscribers for footer newsletter (email list)
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscribers (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        is_active BOOLEAN DEFAULT true,
        source TEXT DEFAULT 'footer',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subscribers_active ON subscribers(is_active);`);

    // Product categories reference table
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        subtitle TEXT,
        nav_section TEXT,
        display_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_categories_nav_section ON categories(nav_section);`);

    const { ALL_CATEGORIES, SHOP_BY_CATEGORY, MAIN_NAV_CATEGORIES } = require('../../utils/categories');
    const shopSlugs = new Set(SHOP_BY_CATEGORY.map((c) => c.slug));
    const mainNavSlugs = new Set(MAIN_NAV_CATEGORIES.map((c) => c.slug));

    for (let i = 0; i < ALL_CATEGORIES.length; i++) {
      const cat = ALL_CATEGORIES[i];
      const navSection = shopSlugs.has(cat.slug)
        ? 'shop_by_category'
        : mainNavSlugs.has(cat.slug)
          ? 'main_nav'
          : 'legacy';
      await client.query(
        `INSERT INTO categories (id, slug, name, subtitle, nav_section, display_order, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           subtitle = EXCLUDED.subtitle,
           nav_section = EXCLUDED.nav_section,
           display_order = EXCLUDED.display_order,
           updated_at = NOW()`,
        [cat.slug, cat.slug, cat.name, cat.subtitle || '', navSection, i + 1]
      );
    }

    await client.query('COMMIT');
    console.log('✅ PostgreSQL tables initialized (or already existed).');
};

/** Idempotent auth schema patches — safe to run on every server start. */
const ensureAuthSchemaPatches = async (client) => {
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;`).catch(() => {});
  await client.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS reset_token TEXT;`).catch(() => {});
};

/** Idempotent patch for contact_messages — safe to run on every server start. */
const ensureContactMessagesTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      subject TEXT,
      message TEXT NOT NULL,
      order_number TEXT,
      status TEXT DEFAULT 'unread',
      reply TEXT,
      replied_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status);`).catch(() => {});
  await client.query(`CREATE INDEX IF NOT EXISTS idx_contact_messages_email ON contact_messages(email);`).catch(() => {});
  await client.query(`ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS order_number TEXT;`).catch(() => {});
  await client.query(`ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS reply TEXT;`).catch(() => {});
  await client.query(`ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;`).catch(() => {});
};

/** Idempotent patch for testimonials — safe to run on every server start. */
const ensureTestimonialsTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS testimonials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      text TEXT NOT NULL,
      image TEXT,
      public_id TEXT,
      product_id TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await client.query(`ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS created_by TEXT;`).catch(() => {});
  await client.query(`ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS public_id TEXT;`).catch(() => {});
  await client.query(`ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS product_id TEXT;`).catch(() => {});
  await client.query(`ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;`).catch(() => {});
  await client.query(`ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`).catch(() => {});
  await client.query(`ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`).catch(() => {});
  await client.query(`CREATE INDEX IF NOT EXISTS idx_testimonials_sort_order ON testimonials(sort_order);`).catch(() => {});
  await client.query(`CREATE INDEX IF NOT EXISTS idx_testimonials_is_active ON testimonials(is_active);`).catch(() => {});

  // Remove legacy demo seed rows — only admin-submitted testimonials should exist
  const demoIds = ['t1-dila-yadav', 't2-sushan-shakya', 't3-sweta-singh', 't4-dr-prashant'];
  await client.query(
    `DELETE FROM testimonials WHERE id = ANY($1::text[])`,
    [demoIds]
  ).catch(() => {});
};

/** Idempotent patch for subscribers — safe to run on every server start. */
const ensureSubscribersTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      is_active BOOLEAN DEFAULT true,
      source TEXT DEFAULT 'footer',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email);`).catch(() => {});
  await client.query(`CREATE INDEX IF NOT EXISTS idx_subscribers_active ON subscribers(is_active);`).catch(() => {});
};

const ensureSchemaPatches = async (client) => {
  await ensureAuthSchemaPatches(client);
  await ensureContactMessagesTable(client);
  await ensureTestimonialsTable(client);
  await ensureSubscribersTable(client);
};

module.exports = {
  initializeTables,
  ensureAuthSchemaPatches,
  ensureContactMessagesTable,
  ensureTestimonialsTable,
  ensureSubscribersTable,
  ensureSchemaPatches
};
