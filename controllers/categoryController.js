const {
  SHOP_BY_CATEGORY,
  MAIN_NAV_CATEGORIES,
  ALL_CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_ALIASES,
} = require('../utils/categories');

const getCategoriesFromDb = async (section) => {
  try {
    const { getPool } = require('../models/postgres');
    const pool = getPool && getPool();
    if (!pool) return null;

    let query = 'SELECT slug, name, subtitle, nav_section, display_order FROM categories WHERE is_active = true';
    const params = [];

    if (section) {
      params.push(section);
      query += ` AND nav_section = $${params.length}`;
    }

    query += ' ORDER BY display_order ASC';
    const result = await pool.query(query, params);
    if (!result.rows.length) return null;

    return result.rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      subtitle: row.subtitle || '',
      navSection: row.nav_section,
      displayOrder: row.display_order,
    }));
  } catch {
    return null;
  }
};

exports.getCategories = async (req, res) => {
  try {
    const { section } = req.query;

    const dbCategories = await getCategoriesFromDb(section);
    if (dbCategories) {
      return res.json({
        success: true,
        data: dbCategories,
        labels: CATEGORY_LABELS,
        aliases: CATEGORY_ALIASES,
        source: 'database',
      });
    }

    let categories = ALL_CATEGORIES;
    if (section === 'shop_by_category') {
      categories = SHOP_BY_CATEGORY;
    } else if (section === 'main_nav') {
      categories = MAIN_NAV_CATEGORIES;
    }

    res.json({
      success: true,
      data: categories,
      labels: CATEGORY_LABELS,
      aliases: CATEGORY_ALIASES,
      source: 'config',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching categories', error: error.message });
  }
};