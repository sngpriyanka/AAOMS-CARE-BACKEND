const Database = require('../models/DatabaseAdapter');
const { v4: uuidv4 } = require('uuid');

// Self-healing: ensure critical banner columns exist (for Postgres users who didn't restart after schema updates)
const ensureBannerSchema = async () => {
  try {
    const { getPool } = require('../models/postgres');
    const pool = getPool && getPool();
    if (!pool) return; // not using Postgres or pool not ready

    await pool.query(`ALTER TABLE banners ADD COLUMN IF NOT EXISTS created_by TEXT;`);
    await pool.query(`ALTER TABLE banners ADD COLUMN IF NOT EXISTS public_id TEXT;`);
    await pool.query(`ALTER TABLE banners ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`);
    await pool.query(`ALTER TABLE banners ADD COLUMN IF NOT EXISTS pages JSONB DEFAULT '["home"]';`);
    await pool.query(`ALTER TABLE banners ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`);
  } catch (e) {
    // Non-fatal – table may not exist yet or using JSON DB
    if (!/relation "banners" does not exist/i.test(e.message || '')) {
      console.warn('Banner schema ensure warning:', e.message);
    }
  }
};

const COLLECTION = 'banners';

exports.getBanners = async (req, res) => {
  try {
    const { page } = req.query;
    let banners = await Database.readAll(COLLECTION);
    banners = banners.filter(banner => banner.isActive !== false);
    if (page) {
      // Support legacy/aliased page keys for t-shirts and scrubs (e.g. "tshirts" <-> "t-shirts")
      const pageAliases = {
        't-shirts': ['t-shirts', 'tshirts'],
        tshirts: ['t-shirts', 'tshirts'],
        scrubs: ['scrub', 'scrubs'],
        scrub: ['scrub', 'scrubs'],
      };
      const allowedPages = pageAliases[page] || [page];
      banners = banners.filter(banner => {
        const bp = banner.pages || [];
        return allowedPages.some(p => bp.includes(p));
      });
    }
    banners.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    res.json({ success: true, data: banners });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching banners', error: error.message });
  }
};

exports.createBanner = async (req, res) => {
  try {
    await ensureBannerSchema(); // make sure columns exist even without full server restart

    const { name, url, publicId, pages: rawPages, link, title, subtitle } = req.body;
    if (!name || !url) {
      return res.status(400).json({ success: false, message: 'Banner name and image URL are required' });
    }

    // Robustly coerce pages into a proper array (handles cases where it arrives as JSON string, object, etc.)
    let pages;
    if (Array.isArray(rawPages)) {
      pages = rawPages;
    } else if (typeof rawPages === 'string') {
      try {
        const parsed = JSON.parse(rawPages);
        pages = Array.isArray(parsed) ? parsed : [rawPages];
      } catch (_) {
        pages = rawPages ? [rawPages] : ['home'];
      }
    } else if (rawPages && typeof rawPages === 'object') {
      // e.g. { "home": true } style from old data / bad form
      pages = Object.keys(rawPages).filter(Boolean);
    } else {
      pages = ['home'];
    }
    if (!pages.length) pages = ['home'];

    const id = uuidv4();
    const banner = await Database.create(COLLECTION, {
      id,
      _id: id,
      name,
      url,
      publicId: publicId || '',
      pages,
      link: link || '/collection',
      title,
      subtitle,
      isActive: true,
      createdAt: new Date().toISOString(),
      createdBy: req.user?.id || null,
    });
    res.status(201).json({ success: true, message: 'Banner created', data: banner });
  } catch (error) {
    console.error('createBanner error:', error); // full details in backend logs
    res.status(500).json({ success: false, message: 'Error creating banner', error: error.message });
  }
};

exports.updateBanner = async (req, res) => {
  try {
    await ensureBannerSchema();

    const body = { ...req.body };

    // Same robust pages coercion as create (in case form sent stringified or object pages)
    if (body.pages !== undefined) {
      const rawPages = body.pages;
      let pages;
      if (Array.isArray(rawPages)) {
        pages = rawPages;
      } else if (typeof rawPages === 'string') {
        try {
          const parsed = JSON.parse(rawPages);
          pages = Array.isArray(parsed) ? parsed : [rawPages];
        } catch (_) {
          pages = rawPages ? [rawPages] : ['home'];
        }
      } else if (rawPages && typeof rawPages === 'object') {
        pages = Object.keys(rawPages).filter(Boolean);
      } else {
        pages = ['home'];
      }
      if (!pages.length) pages = ['home'];
      body.pages = pages;
    }

    const banner = await Database.update(COLLECTION, req.params.id, {
      ...body,
      updatedAt: new Date().toISOString(),
    });
    if (!banner) {
      return res.status(404).json({ success: false, message: 'Banner not found' });
    }
    res.json({ success: true, message: 'Banner updated', data: banner });
  } catch (error) {
    console.error('updateBanner error:', error);
    res.status(500).json({ success: false, message: 'Error updating banner', error: error.message });
  }
};

exports.deleteBanner = async (req, res) => {
  try {
    await Database.delete(COLLECTION, req.params.id);
    res.json({ success: true, message: 'Banner deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting banner', error: error.message });
  }
};
