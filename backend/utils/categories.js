/**
 * Central category definitions for AAOMS.
 * Shop-by-category items, main-nav featured categories, and aliases.
 */

const SHOP_BY_CATEGORY = [
  { slug: 'ot-dress', name: 'OT DRESS', subtitle: 'PROFESSIONAL OPERATING THEATRE DRESS' },
  { slug: 'ot-gown', name: 'OT GOWN', subtitle: 'STERILE OPERATING THEATRE GOWNS' },
  { slug: 'patient-gown', name: 'PATIENT GOWN', subtitle: 'COMFORTABLE GOWNS FOR PATIENT CARE' },
  { slug: 'hospital-mattress-pillow', name: 'HOSPITAL MATTRESS & PILLOW', subtitle: 'QUALITY MATTRESS AND PILLOW SOLUTIONS' },
  { slug: 'bed-sheets', name: 'BED SHEETS', subtitle: 'DURABLE HOSPITAL BED SHEETS' },
  { slug: 'triangular-bandage', name: 'TRIANGULAR BANDAGE', subtitle: 'ESSENTIAL FIRST AID BANDAGES' },
  { slug: 'wrapper', name: 'WRAPPER', subtitle: 'PROTECTIVE MEDICAL WRAPPERS' },
  { slug: 'abdominal-sheet', name: 'ABDOMINAL SHEET', subtitle: 'SPECIALIZED ABDOMINAL COVERAGE' },
  { slug: 'eye-towel', name: 'EYE TOWEL', subtitle: 'GENTLE TOWELS FOR EYE CARE' },
  { slug: 'pillow-cover', name: 'PILLOW COVER', subtitle: 'HYGIENIC HOSPITAL PILLOW COVERS' },
];

const MAIN_NAV_CATEGORIES = [
  { slug: 'apron', name: 'APRON', subtitle: 'PROFESSIONAL GRADE APRONS FOR EVERY WORKSPACE' },
  { slug: 'scrubs', name: 'SCRUBS', subtitle: 'COMFORTABLE MEDICAL SCRUBS FOR HEALTHCARE PROFESSIONALS' },
];

const LEGACY_CATEGORIES = [
  { slug: 't-shirts', name: 'T-SHIRTS', subtitle: 'EXPRESS YOUR STYLE' },
  { slug: 'boutique-products', name: 'SCHOOL PRODUCTS', subtitle: 'EXCLUSIVE HANDCRAFTED COLLECTION' },
  { slug: 'printed-tshirts', name: 'PRINTED T-SHIRTS', subtitle: 'EXPRESS YOUR STYLE WITH UNIQUE DESIGNS' },
  { slug: 'plain-tshirts', name: 'PLAIN T-SHIRTS', subtitle: 'SIMPLE. CLEAN. ESSENTIAL.' },
  { slug: 'printed-sweatshirts', name: 'PRINTED SWEAT-SHIRTS', subtitle: 'COZY WITH CHARACTER' },
  { slug: 'plain-sweatshirts', name: 'PLAIN SWEAT-SHIRTS', subtitle: 'MINIMAL. COMFORTABLE. VERSATILE.' },
  { slug: 'hoodies', name: 'HOODIES', subtitle: 'WARMTH MEETS STYLE' },
  { slug: 'hoppers', name: 'HOPPERS', subtitle: 'YOUR GO-TO PANTS FOR WHEREVER LIFE TAKES YOU' },
  { slug: 'travel-pants', name: 'TRAVEL PANTS', subtitle: 'READY FOR ANY ADVENTURE' },
  { slug: 'cargo-pants', name: 'CARGO PANTS', subtitle: 'UTILITY MEETS COMFORT' },
  { slug: 'cargo-shorts', name: 'CARGO SHORTS', subtitle: 'SUMMER READY' },
];

const CATEGORY_ALIASES = {
  't-shirts': ['t-shirts', 'tshirts'],
  tshirts: ['t-shirts', 'tshirts'],
  scrubs: ['scrub', 'scrubs'],
  scrub: ['scrub', 'scrubs'],
};

const ALL_CATEGORIES = [...SHOP_BY_CATEGORY, ...MAIN_NAV_CATEGORIES, ...LEGACY_CATEGORIES];

const CATEGORY_LABELS = Object.fromEntries(
  ALL_CATEGORIES.map((cat) => [cat.slug, { title: cat.name, subtitle: cat.subtitle }])
);

CATEGORY_LABELS.all = { title: 'ALL COLLECTIONS', subtitle: 'EXPLORE EVERYTHING' };

const SHOP_BY_CATEGORY_SLUGS = SHOP_BY_CATEGORY.map((c) => c.slug);
const MAIN_NAV_SLUGS = MAIN_NAV_CATEGORIES.map((c) => c.slug);
const ADMIN_CATEGORIES = [...SHOP_BY_CATEGORY_SLUGS, ...MAIN_NAV_SLUGS, ...LEGACY_CATEGORIES.map((c) => c.slug)];

const DEFAULT_PRODUCT_CATEGORY = SHOP_BY_CATEGORY_SLUGS[0];

const getCategoryLabel = (slug) => {
  if (CATEGORY_LABELS[slug]) return CATEGORY_LABELS[slug];
  if (slug === 'tshirts' || slug === 't-shirts') return CATEGORY_LABELS['t-shirts'];
  if (slug === 'scrubs' || slug === 'scrub') return CATEGORY_LABELS.scrubs;
  return {
    title: slug.split('-').map((word) => word.toUpperCase()).join(' '),
    subtitle: 'EXPLORE OUR COLLECTION',
  };
};

const getMatchingCategories = (slug) => CATEGORY_ALIASES[slug] || [slug];

module.exports = {
  SHOP_BY_CATEGORY,
  MAIN_NAV_CATEGORIES,
  LEGACY_CATEGORIES,
  ALL_CATEGORIES,
  CATEGORY_ALIASES,
  CATEGORY_LABELS,
  SHOP_BY_CATEGORY_SLUGS,
  MAIN_NAV_SLUGS,
  ADMIN_CATEGORIES,
  DEFAULT_PRODUCT_CATEGORY,
  getCategoryLabel,
  getMatchingCategories,
};