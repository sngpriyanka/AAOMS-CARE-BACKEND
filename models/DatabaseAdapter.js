const { v4: uuidv4 } = require('uuid');

let pgPool = null;
const getPgPool = () => {
  if (!pgPool) {
    try {
      const { getPool } = require('./postgres');
      pgPool = getPool();
    } catch (e) {
      console.error('Postgres pool not initialized. Did you call connect?');
    }
  }
  return pgPool;
};

// ==================== POSTGRES / NEON DATABASE CLASS ====================
class PostgresDatabase {
  // Map app collection names to actual Postgres table names (snake_case where needed)
  static getTableName(collection) {
    const map = {
      users: 'users',
      admins: 'admins',
      products: 'products',
      orders: 'orders',
      carts: 'carts',
      addresses: 'addresses',
      wishlists: 'wishlists',
      payments: 'payments',
      pendingPayments: 'pending_payments',
      instagramFeeds: 'instagram_feeds',
      banners: 'banners',
      testimonials: 'testimonials',
      reviews: 'reviews',
      notifications: 'notifications',
      subscribers: 'subscribers',
      contactMessages: 'contact_messages'
    };
    return map[collection] || collection;
  }

  static _normalize(row) {
    if (!row) return row;
    const out = { ...row };

    // Ensure consistent id (string)
    if (out.id) out.id = String(out.id);
    if (!out.id && out._id) out.id = String(out._id);

    // Parse JSONB fields back to objects/arrays for the rest of the app
    const jsonFields = ['items', 'images', 'sizes', 'colors', 'description', 'shipping_address', 'metadata', 'pages', 'size_chart', 'permissions'];
    for (const f of jsonFields) {
      if (out[f] !== undefined && out[f] !== null) {
        if (typeof out[f] === 'string') {
          try {
            out[f] = JSON.parse(out[f]);
          } catch (_) {
            // Malformed JSON in DB (e.g. old bad banner pages data) — try to recover as single-item array for pages-like fields
            if (f === 'pages' && out[f]) {
              out[f] = [out[f]];
            } else {
              out[f] = [];
            }
          }
        }
      }
    }

    // Also expose snake_case as camelCase for a few common ones the app sometimes expects.
    // After aliasing, delete the snake_case originals so that objects returned by the DB layer
    // are "clean" (prevents duplicate column SETs if callers later pass the full object to update()).
    const aliasAndStrip = (snake, camel) => {
      if (out[snake] !== undefined) {
        if (out[camel] === undefined) out[camel] = out[snake];
        delete out[snake];
      }
    };

    aliasAndStrip('shipping_address', 'shippingAddress');
    aliasAndStrip('user_id', 'userId');
    aliasAndStrip('product_id', 'productId');
    aliasAndStrip('order_id', 'orderId');
    aliasAndStrip('order_number', 'orderNumber');
    aliasAndStrip('purchase_order_id', 'purchaseOrderId');
    aliasAndStrip('payment_token', 'paymentToken');
    aliasAndStrip('payment_jwt', 'paymentJwt');
    aliasAndStrip('razorpay_order_id', 'razorpayOrderId');
    aliasAndStrip('payment_gateway', 'paymentGateway');
    aliasAndStrip('tracking_number', 'trackingNumber');
    aliasAndStrip('created_at', 'createdAt');
    aliasAndStrip('updated_at', 'updatedAt');
    aliasAndStrip('is_active', 'isActive');
    aliasAndStrip('is_default', 'isDefault');
    aliasAndStrip('is_reel', 'isReel');
    aliasAndStrip('quick_dry', 'quickDry');
    aliasAndStrip('size_chart', 'sizeChart');
    aliasAndStrip('sort_order', 'sortOrder');
    aliasAndStrip('public_id', 'publicId');
    aliasAndStrip('transaction_id', 'transactionId');
    aliasAndStrip('original_price', 'originalPrice');
    aliasAndStrip('shipping_cost', 'shippingCost');
    aliasAndStrip('payment_method', 'paymentMethod');
    aliasAndStrip('payment_status', 'paymentStatus');
    aliasAndStrip('shipping_status', 'shippingStatus');
    aliasAndStrip('logo_charge', 'logoCharge');
    aliasAndStrip('product_name', 'productName');
    aliasAndStrip('created_by', 'createdBy');
    aliasAndStrip('expires_at', 'expiresAt');
    aliasAndStrip('profile_picture', 'profilePicture');
    aliasAndStrip('google_auth', 'googleAuth');
    aliasAndStrip('sub_description', 'subDescription');
    aliasAndStrip('product_information', 'productInformation');
    aliasAndStrip('replied_at', 'repliedAt');
    aliasAndStrip('reset_token', 'resetToken');
    aliasAndStrip('first_name', 'firstName');
    aliasAndStrip('middle_name', 'middleName');
    aliasAndStrip('last_name', 'lastName');

    // Coerce Postgres NUMERIC/DECIMAL (returned as strings) and other numeric fields to JS Number.
    // This prevents "X.toFixed is not a function" and similar when data comes from Postgres.
    const numericFields = [
      'price', 'total', 'subtotal', 'amount', 'shippingCost', 'originalPrice', 'logoCharge',
      'tax', 'discount', 'unitPrice', 'totalPrice', 'revenue', 'spent', 'value',
      'sales', 'shipping', 'grandTotal', 'finalTotal', 'paidAmount', 'refundAmount'
    ];
    for (const f of numericFields) {
      if (out[f] != null && typeof out[f] !== 'number') {
        const n = parseFloat(out[f]);
        if (!isNaN(n)) out[f] = n;
      }
    }

    // Also normalize numbers inside items array (common for order/cart items stored in JSONB)
    if (Array.isArray(out.items)) {
      out.items = out.items.map(item => {
        if (item && typeof item === 'object') {
          const ni = { ...item };
          ['price', 'quantity', 'subtotal', 'total', 'amount', 'discount'].forEach(k => {
            if (ni[k] != null && typeof ni[k] !== 'number') {
              const n = parseFloat(ni[k]);
              if (!isNaN(n)) ni[k] = n;
            }
          });
          return ni;
        }
        return item;
      });
    }

    // Booleans from DB are fine (pg returns proper booleans)
    return out;
  }

  static _normalizeMany(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(r => this._normalize(r));
  }

  static async create(collection, item) {
    const pool = getPgPool();
    if (!pool) throw new Error('PostgreSQL pool not available');

    const table = this.getTableName(collection);
    const id = item.id || item._id || uuidv4();

    // Build payload - convert complex fields to JSON for storage
    const payload = { ...item, id };

    // Ensure timestamps
    if (!payload.createdAt && !payload.created_at) payload.createdAt = new Date().toISOString();
    if (!payload.updatedAt && !payload.updated_at) payload.updatedAt = new Date().toISOString();

    const columns = [];
    const values = [];
    const placeholders = [];
    let idx = 1;

    // Special handling: convert known complex fields to JSON string (pg driver handles objects for jsonb too)
const complexFields = ['items', 'images', 'sizes', 'colors', 'variants', 'description', 'shippingAddress', 'shipping_address', 'metadata', 'pages', 'sizeChart', 'size_chart', 'permissions'];

    for (const [key, val] of Object.entries(payload)) {
      // Map camelCase to snake_case for known columns
      let col = key;
      if (key === 'userId') col = 'user_id';
      if (key === 'productId') col = 'product_id';
      if (key === 'orderId') col = 'order_id';
      if (key === 'orderNumber') col = 'order_number';
      if (key === 'purchaseOrderId') col = 'purchase_order_id';
      if (key === 'paymentToken') col = 'payment_token';
      if (key === 'paymentJwt') col = 'payment_jwt';
      if (key === 'razorpayOrderId') col = 'razorpay_order_id';
      if (key === 'paymentGateway') col = 'payment_gateway';
      if (key === 'trackingNumber') col = 'tracking_number';
      if (key === 'shippingAddress') col = 'shipping_address';
      if (key === 'createdAt') col = 'created_at';
      if (key === 'updatedAt') col = 'updated_at';
      if (key === 'isActive') col = 'is_active';
      if (key === 'isDefault') col = 'is_default';
      if (key === 'isReel') col = 'is_reel';
      if (key === 'quickDry') col = 'quick_dry';
      if (key === 'sizeChart') col = 'size_chart';
      if (key === 'sortOrder') col = 'sort_order';
      if (key === 'publicId') col = 'public_id';
      if (key === 'transactionId') col = 'transaction_id';
      if (key === 'originalPrice') col = 'original_price';
      if (key === 'shippingCost') col = 'shipping_cost';
      if (key === 'paymentMethod') col = 'payment_method';
      if (key === 'paymentStatus') col = 'payment_status';
      if (key === 'shippingStatus') col = 'shipping_status';
      if (key === 'logoCharge') col = 'logo_charge';
      if (key === 'productName') col = 'product_name';
      if (key === 'createdBy') col = 'created_by';
      if (key === 'expiresAt') col = 'expires_at';
      if (key === 'profilePicture') col = 'profile_picture';
      if (key === 'googleAuth') col = 'google_auth';
      if (key === 'subDescription') col = 'sub_description';
      if (key === 'productInformation') col = 'product_information';
      if (key === 'repliedAt') col = 'replied_at';
      if (key === 'resetToken') col = 'reset_token';
      if (key === 'firstName') col = 'first_name';
      if (key === 'middleName') col = 'middle_name';
      if (key === 'lastName') col = 'last_name';

      // Skip internal _id if we have id
      if (col === '_id' && payload.id) continue;

      // Skip undefined values (e.g. optional fields not provided from frontend)
      let v = val;
      if (v === undefined) continue;

      columns.push(col);

      // For JSON/JSONB columns, explicitly stringify objects/arrays.
      // Relying on the pg driver to auto-stringify for "unnamed portal" parameters
      // can produce invalid JSON syntax errors (e.g. for pages: ["home"]).
      if (complexFields.includes(key) && v != null) {
        if (typeof v === 'object') {
          v = JSON.stringify(v);
        } else if (typeof v === 'string') {
          // If it's already a string, make sure it's valid JSON (normalize)
          try {
            JSON.parse(v); // just validate
          } catch (_) {
            // Bad JSON string coming from somewhere (e.g. old data or form), fall back to empty array for pages-like fields
            v = JSON.stringify([]);
          }
        }
      }

      values.push(v);
      placeholders.push(`$${idx++}`);
    }

    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;

    try {
      const { rows } = await pool.query(sql, values);
      return this._normalize(rows[0]);
    } catch (error) {
      console.error(`Postgres create error [${collection}]:`, error.message);
      throw error;
    }
  }

  static async read(collection, id) {
    const pool = getPgPool();
    if (!pool) return null;

    const table = this.getTableName(collection);
    try {
      const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
      return this._normalize(rows[0] || null);
    } catch (error) {
      console.error(`Postgres read error [${collection}/${id}]:`, error.message);
      return null;
    }
  }

  static async readAll(collection) {
    const pool = getPgPool();
    if (!pool) return [];

    const table = this.getTableName(collection);
    try {
      const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY created_at DESC NULLS LAST`);
      return this._normalizeMany(rows);
    } catch (error) {
      console.error(`Postgres readAll error [${collection}]:`, error.message);
      return [];
    }
  }

  static async readProductsFiltered(options = {}) {
    const pool = getPgPool();
    if (!pool) return null;

    const conditions = [];
    const values = [];
    let idx = 1;

    if (options.view !== 'admin') {
      conditions.push('(is_active IS NULL OR is_active = true)');
    }

    if (Array.isArray(options.categories) && options.categories.length) {
      conditions.push(`category = ANY($${idx++})`);
      values.push(options.categories);
    }

    if (options.search) {
      const term = `%${String(options.search).toLowerCase()}%`;
      conditions.push(`(
        LOWER(name) LIKE $${idx}
        OR LOWER(COALESCE(description::text, '')) LIKE $${idx}
      )`);
      values.push(term);
      idx += 1;
    }

    if (options.minPrice != null && options.minPrice !== '') {
      conditions.push(`price >= $${idx++}`);
      values.push(Number(options.minPrice));
    }

    if (options.maxPrice != null && options.maxPrice !== '') {
      conditions.push(`price <= $${idx++}`);
      values.push(Number(options.maxPrice));
    }

    if (options.excludeId) {
      conditions.push(`id <> $${idx++}`);
      values.push(String(options.excludeId));
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 10, 1), 100);
    const page = Math.max(parseInt(options.page, 10) || 1, 1);
    const offset = (page - 1) * limit;
    const listColumns = 'id, name, slug, price, original_price, category, image, images, colors, quick_dry, is_active, created_at';
    const selectClause = options.view === 'list' ? listColumns : '*';

    try {
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS total FROM products ${where}`,
        values
      );
      const total = countResult.rows[0]?.total || 0;

      const dataResult = await pool.query(
        `SELECT ${selectClause} FROM products ${where} ORDER BY created_at DESC NULLS LAST LIMIT $${idx++} OFFSET $${idx++}`,
        [...values, limit, offset]
      );

      return {
        items: this._normalizeMany(dataResult.rows),
        total,
        page,
        limit,
      };
    } catch (error) {
      console.error('Postgres readProductsFiltered error:', error.message);
      return null;
    }
  }

  static async update(collection, id, updates) {
    const pool = getPgPool();
    if (!pool) return null;

    const table = this.getTableName(collection);

    // Always bump updated_at. Spread updates first so our forced updatedAt wins on collisions.
    const payload = { ...updates, updatedAt: new Date() };

    const complexFields = ['items', 'images', 'sizes', 'colors', 'description', 'shippingAddress', 'shipping_address', 'metadata', 'pages', 'sizeChart', 'size_chart', 'permissions'];

    // Use a Map keyed by the final DB column name to guarantee no duplicate assignments
    // (objects returned by findBy/read contain both camelCase and snake_case because _normalize
    // spreads the raw row then adds camel aliases). Also never re-assign user_id on updates
    // (carts/wishlists etc. are owned by a user; re-assigning the owner id is meaningless and
    // triggers "multiple assignments to same column" when both userId + user_id are present).
    const colMap = new Map();

    for (const [key, val] of Object.entries(payload)) {
      let col = key;
      if (key === 'userId') col = 'user_id';
      if (key === 'productId') col = 'product_id';
      if (key === 'orderId') col = 'order_id';
      if (key === 'orderNumber') col = 'order_number';
      if (key === 'purchaseOrderId') col = 'purchase_order_id';
      if (key === 'paymentToken') col = 'payment_token';
      if (key === 'paymentJwt') col = 'payment_jwt';
      if (key === 'razorpayOrderId') col = 'razorpay_order_id';
      if (key === 'paymentGateway') col = 'payment_gateway';
      if (key === 'trackingNumber') col = 'tracking_number';
      if (key === 'shippingAddress') col = 'shipping_address';
      if (key === 'createdAt') col = 'created_at';
      if (key === 'updatedAt') col = 'updated_at';
      if (key === 'isActive') col = 'is_active';
      if (key === 'isDefault') col = 'is_default';
      if (key === 'isReel') col = 'is_reel';
      if (key === 'quickDry') col = 'quick_dry';
      if (key === 'sizeChart') col = 'size_chart';
      if (key === 'sortOrder') col = 'sort_order';
      if (key === 'publicId') col = 'public_id';
      if (key === 'transactionId') col = 'transaction_id';
      if (key === 'originalPrice') col = 'original_price';
      if (key === 'shippingCost') col = 'shipping_cost';
      if (key === 'paymentMethod') col = 'payment_method';
      if (key === 'paymentStatus') col = 'payment_status';
      if (key === 'shippingStatus') col = 'shipping_status';
      if (key === 'logoCharge') col = 'logo_charge';
      if (key === 'productName') col = 'product_name';
      if (key === 'createdBy') col = 'created_by';
      if (key === 'expiresAt') col = 'expires_at';
      if (key === 'profilePicture') col = 'profile_picture';
      if (key === 'googleAuth') col = 'google_auth';
      if (key === 'subDescription') col = 'sub_description';
      if (key === 'productInformation') col = 'product_information';
      if (key === 'repliedAt') col = 'replied_at';
      if (key === 'resetToken') col = 'reset_token';
      if (key === 'firstName') col = 'first_name';
      if (key === 'middleName') col = 'middle_name';
      if (key === 'lastName') col = 'last_name';

      if (col === '_id' || col === 'id' || col === 'user_id') continue; // never update PK or owner

      let v = val;
      if (v === undefined) continue;

      // For JSON/JSONB columns, explicitly stringify objects/arrays (same as create path)
      if (complexFields.includes(key) && v != null) {
        if (typeof v === 'object') {
          v = JSON.stringify(v);
        } else if (typeof v === 'string') {
          try {
            JSON.parse(v);
          } catch (_) {
            v = JSON.stringify([]);
          }
        }
      }

      colMap.set(col, v); // last writer wins for any remaining camel/snake collisions
    }

    if (colMap.size === 0) return await this.read(collection, id);

    const sets = [];
    const values = [];
    let idx = 1;

    for (const [col, v] of colMap.entries()) {
      sets.push(`${col} = $${idx++}`);
      values.push(v);
    }

    values.push(id);
    const sql = `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`;

    try {
      const { rows } = await pool.query(sql, values);
      return this._normalize(rows[0] || null);
    } catch (error) {
      console.error(`Postgres update error [${collection}/${id}]:`, error.message);
      return null;
    }
  }

  static async delete(collection, id) {
    const pool = getPgPool();
    if (!pool) return false;

    const table = this.getTableName(collection);
    try {
      await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      return true;
    } catch (error) {
      console.error(`Postgres delete error [${collection}/${id}]:`, error.message);
      return false;
    }
  }

  static async findBy(collection, field, value) {
    const pool = getPgPool();
    if (!pool) return null;

    const table = this.getTableName(collection);

    // Map common camelCase fields to columns
    let col = field;
    if (field === 'userId') col = 'user_id';
    if (field === 'productId') col = 'product_id';
    if (field === 'orderId') col = 'order_id';
    if (field === 'purchaseOrderId') col = 'purchase_order_id';
    if (field === 'paymentToken') col = 'payment_token';
    if (field === 'paymentJwt') col = 'payment_jwt';
    if (field === 'razorpayOrderId') col = 'razorpay_order_id';
    if (field === 'paymentGateway') col = 'payment_gateway';
    if (field === 'trackingNumber') col = 'tracking_number';
    if (field === 'isActive') col = 'is_active';
    if (field === 'isDefault') col = 'is_default';
    if (field === 'googleAuth') col = 'google_auth';

    try {
      const { rows } = await pool.query(`SELECT * FROM ${table} WHERE ${col} = $1 LIMIT 1`, [value]);
      return this._normalize(rows[0] || null);
    } catch (error) {
      console.error(`Postgres findBy error [${collection} ${field}=${value}]:`, error.message);
      return null;
    }
  }

  static async filterBy(collection, field, value) {
    const pool = getPgPool();
    if (!pool) return [];

    const table = this.getTableName(collection);

    let col = field;
    if (field === 'userId') col = 'user_id';
    if (field === 'productId') col = 'product_id';
    if (field === 'orderId') col = 'order_id';

    try {
      const { rows } = await pool.query(`SELECT * FROM ${table} WHERE ${col} = $1 ORDER BY created_at DESC NULLS LAST`, [value]);
      return this._normalizeMany(rows);
    } catch (error) {
      console.error(`Postgres filterBy error [${collection} ${field}=${value}]:`, error.message);
      return [];
    }
  }

  static async readReviewsByProductId(productId) {
    const pool = getPgPool();
    if (!pool) return null;

    try {
      const { rows } = await pool.query(
        `SELECT * FROM reviews
         WHERE product_id = $1 AND (status = 'approved' OR status IS NULL)
         ORDER BY created_at DESC NULLS LAST`,
        [productId]
      );
      return this._normalizeMany(rows);
    } catch (error) {
      console.error('Postgres readReviewsByProductId error:', error.message);
      return null;
    }
  }
}

// ==================== UNIFIED DATABASE CLASS (PostgreSQL only) ====================
class Database {
  static dbType = 'postgres';
  static postgresDB = PostgresDatabase;

  static create(collection, item) {
    return this.postgresDB.create(collection, item);
  }

  static read(collection, id) {
    return this.postgresDB.read(collection, id);
  }

  static readAll(collection) {
    return this.postgresDB.readAll(collection);
  }

  static readProductsFiltered(options) {
    return this.postgresDB.readProductsFiltered(options);
  }

  static readReviewsByProductId(productId) {
    return this.postgresDB.readReviewsByProductId(productId);
  }

  static update(collection, id, updates) {
    return this.postgresDB.update(collection, id, updates);
  }

  static delete(collection, id) {
    return this.postgresDB.delete(collection, id);
  }

  static findBy(collection, field, value) {
    return this.postgresDB.findBy(collection, field, value);
  }

  static filterBy(collection, field, value) {
    return this.postgresDB.filterBy(collection, field, value);
  }

  static getDatabaseType() {
    return this.dbType;
  }
}

module.exports = Database;
