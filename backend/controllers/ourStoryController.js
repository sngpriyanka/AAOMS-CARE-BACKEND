/**
 * Our Story CMS — home BrandStory section + full /our-story page content & images.
 * Single-row content stored in our_story table (id = 'default').
 */

const Database = require('../models/DatabaseAdapter');
const {
  toStoredMediaPath,
  expandMediaValue,
  cleanupRemovedMedia,
} = require('../utils/localUpload');

const COLLECTION = 'ourStory';
const STORY_ID = 'default';

const DEFAULT_CONTENT = {
  // Home page BrandStory section
  homeBackgroundImage:
    'https://images.unsplash.com/photo-1551632811-561732d1e306?w=1400&h=700&fit=crop',
  foundedText: 'FOUNDED IN 2026, INDIA',
  mainText:
    'AAOMS CARE IS A HEALTHCARE APPAREL BRAND FOR MODERN HEALTHCARE, WELLNESS & COMFORTABLE MEDICAL WEAR.',
  highlightedWords: ['AAOMS CARE', 'Healthcare', 'Wellness', 'Comfort'],
  storyLink: '/our-story',

  // Full Our Story page
  aboutTitle: 'ABOUT',
  tagline: 'CRAFTED FOR\nHEALTH, INSPIRED\nBY CARE.',
  heroImage:
    'https://www.skylarkhimalayantravel.com/wp-content/uploads/2019/11/WhatsApp-Image-2024-11-13-at-20.33.24-1600x1080.jpeg',
  secondaryImage:
    'https://www.shutterstock.com/image-photo/travel-traveler-backpack-260nw-294861680.jpg',
  logoImage: '/images/aaoms-care-logo.png',
  storyTitle: 'OUR STORY',
  storyText:
    "AAOMS CARE STARTED AS A BOLD ADVENTURE BACK IN 2024. OVER THE YEARS, WE'VE TRANSFORMED AND EVOLVED, FROM MEETING THE ESSENTIAL NEEDS OF HEALTHCARE PROFESSIONALS TO BECOMING A TRUSTED NAME IN HOSPITAL AND MEDICAL TEXTILES. WHAT'S REMAINED CONSTANT? OUR ENTHUSIASM FOR GOOD DESIGN, INSATIABLE CURIOSITY, AND UNYIELDING HUNGER FOR INNOVATION.",
  valueSections: [
    {
      title: 'INSPIRED BY HEALTHCARE',
      paragraphs: [
        "EVERY HOSPITAL, CLINIC, AND MEDICAL ENVIRONMENT WE STUDY IGNITES OUR CREATIVITY, PUSHING US TO DESIGN PRODUCTS THAT NOT ONLY SUPPORT THE DEMANDING WORK OF HEALTHCARE PROFESSIONALS BUT ALSO KEEP YOU LOOKING PROFESSIONAL AND FEELING COMFORTABLE. WHETHER YOU'RE IN THE OPERATING THEATRE, WARDS, OR CONSULTATION ROOMS, OUR MEDICAL APPAREL COMBINES FUNCTIONALITY WITH COMFORT, ENSURING YOU'RE ALWAYS READY FOR THE NEXT CRITICAL SHIFT.",
      ],
    },
    {
      title: 'COMMITTED TO SUSTAINABILITY',
      paragraphs: [
        "BUT CARING FOR PEOPLE MEANS CARING FOR THE PLANET TOO. THAT'S WHY WE'RE DEDICATED TO RESPONSIBLE EFFORTS LIKE USING HIGH-QUALITY, ECO-FRIENDLY, AND RECYCLABLE FABRICS IN OUR SCRUBS, OT GOWNS, APRONS, HOSPITAL CURTAINS, AND BED LINEN. SUSTAINABILITY ISN'T JUST A BUZZWORD FOR US; IT'S AT THE HEART OF EVERYTHING WE DO.",
        "OUR COMMITMENT DOESN'T STOP THERE. WITH OUR ENVIRONMENTAL RESPONSIBILITY PROGRAM, WE FOCUS ON REDUCING MEDICAL TEXTILE WASTE AND PROMOTING CIRCULAR PRACTICES FOR EVERY PRODUCT WE SELL. IT'S OUR WAY OF ENSURING THAT EVERY STEP WE TAKE LEAVES A POSITIVE IMPACT.",
      ],
    },
    {
      title: 'DRIVEN BY PURPOSE',
      paragraphs: [
        'CARE AND COMPASSION ARE OUR LIFEBLOOD. THEY INSPIRE US TO EXPLORE BOUNDARIES AND TRY FRESH IDEAS, FROM DESIGNING ADVANCED OT GOWNS AND SCRUBS TO CREATING COMPLETE HOSPITAL TEXTILE SOLUTIONS. OUR PASSION FOR PURPOSE DRIVES OUR ENDLESS PURSUIT OF RELIABLE, INNOVATIVE, AND HIGH-PERFORMANCE MEDICAL PRODUCTS.',
        'WE INVITE EVERYONE IN THE HEALTHCARE COMMUNITY TO JOIN US ON THIS AMAZING JOURNEY AND LIVE BY OUR VALUES. BECAUSE, IN THE END, THE JOY OF ANY MISSION LIES IN DOING IT TOGETHER.',
      ],
    },
  ],
  galleryImages: [
    'https://images.travelandleisureasia.com/wp-content/uploads/sites/2/2021/01/14101943/New-Featured-1-3.jpg',
    'https://thatoneadventurecouple.com/wp-content/uploads/2019/02/rattlesnake-ridge-hike-seattle-washington.jpg',
  ],
};

const IMAGE_KEYS = [
  'homeBackgroundImage',
  'heroImage',
  'secondaryImage',
  'logoImage',
];

function collectImagePaths(content = {}) {
  const paths = [];
  IMAGE_KEYS.forEach((k) => {
    if (content[k]) paths.push(content[k]);
  });
  if (Array.isArray(content.galleryImages)) {
    content.galleryImages.forEach((u) => {
      if (u) paths.push(u);
    });
  }
  return paths;
}

function normalizeContent(raw = {}) {
  const gallery = Array.isArray(raw.galleryImages)
    ? raw.galleryImages.map((u) => toStoredMediaPath(u) || u).filter(Boolean)
    : [...DEFAULT_CONTENT.galleryImages];

  const valueSections = Array.isArray(raw.valueSections)
    ? raw.valueSections
        .map((s) => ({
          title: String(s?.title || '').trim(),
          paragraphs: Array.isArray(s?.paragraphs)
            ? s.paragraphs.map((p) => String(p || '').trim()).filter(Boolean)
            : s?.text
              ? [String(s.text).trim()]
              : [],
        }))
        .filter((s) => s.title || s.paragraphs.length)
    : DEFAULT_CONTENT.valueSections;

  const highlightedWords = Array.isArray(raw.highlightedWords)
    ? raw.highlightedWords.map((w) => String(w || '').trim()).filter(Boolean)
    : DEFAULT_CONTENT.highlightedWords;

  const storeImg = (key) => {
    const v = raw[key];
    if (v === undefined || v === null || v === '') {
      return DEFAULT_CONTENT[key] || '';
    }
    // Keep absolute external URLs as-is; local uploads → /uploads/...
    if (/^https?:\/\//i.test(String(v))) return String(v).trim();
    return toStoredMediaPath(v) || String(v).trim();
  };

  return {
    homeBackgroundImage: storeImg('homeBackgroundImage'),
    foundedText:
      raw.foundedText !== undefined
        ? String(raw.foundedText || '').trim()
        : DEFAULT_CONTENT.foundedText,
    mainText:
      raw.mainText !== undefined
        ? String(raw.mainText || '').trim()
        : DEFAULT_CONTENT.mainText,
    highlightedWords,
    storyLink:
      raw.storyLink !== undefined
        ? String(raw.storyLink || '/our-story').trim() || '/our-story'
        : DEFAULT_CONTENT.storyLink,
    aboutTitle:
      raw.aboutTitle !== undefined
        ? String(raw.aboutTitle || '').trim()
        : DEFAULT_CONTENT.aboutTitle,
    tagline:
      raw.tagline !== undefined
        ? String(raw.tagline || '').trim()
        : DEFAULT_CONTENT.tagline,
    heroImage: storeImg('heroImage'),
    secondaryImage: storeImg('secondaryImage'),
    logoImage: storeImg('logoImage'),
    storyTitle:
      raw.storyTitle !== undefined
        ? String(raw.storyTitle || '').trim()
        : DEFAULT_CONTENT.storyTitle,
    storyText:
      raw.storyText !== undefined
        ? String(raw.storyText || '').trim()
        : DEFAULT_CONTENT.storyText,
    valueSections,
    galleryImages: gallery.length ? gallery : [...DEFAULT_CONTENT.galleryImages],
  };
}

function expandContent(content, req) {
  if (!content) return content;
  const expand = (v) => {
    if (!v) return v;
    if (/^https?:\/\//i.test(v) || v.startsWith('data:')) return v;
    return expandMediaValue(v, req) || v;
  };
  return {
    ...content,
    homeBackgroundImage: expand(content.homeBackgroundImage),
    heroImage: expand(content.heroImage),
    secondaryImage: expand(content.secondaryImage),
    logoImage: expand(content.logoImage),
    galleryImages: (content.galleryImages || []).map(expand),
  };
}

async function ensureOurStoryTable() {
  try {
    const { getPool } = require('../models/postgres');
    const { ensureOurStoryTable } = require('../models/migrations/initTables');
    const pool = getPool && getPool();
    if (!pool) return;
    const client = await pool.connect();
    try {
      await ensureOurStoryTable(client);
    } finally {
      client.release();
    }
  } catch (e) {
    console.warn('Our Story schema ensure warning:', e.message);
  }
}

async function getOrCreateRecord() {
  await ensureOurStoryTable();
  let row = await Database.read(COLLECTION, STORY_ID);
  if (!row) {
    const content = normalizeContent(DEFAULT_CONTENT);
    row = await Database.create(COLLECTION, {
      id: STORY_ID,
      _id: STORY_ID,
      content,
      updatedAt: new Date().toISOString(),
    });
  }
  const content =
    row.content && typeof row.content === 'object'
      ? normalizeContent({ ...DEFAULT_CONTENT, ...row.content })
      : normalizeContent(DEFAULT_CONTENT);
  return { row, content };
}

exports.getOurStory = async (req, res) => {
  try {
    const { content } = await getOrCreateRecord();
    res.json({
      success: true,
      data: expandContent(content, req),
    });
  } catch (error) {
    console.error('getOurStory error:', error);
    res.status(500).json({
      success: false,
      message: 'Error loading Our Story content',
      error: error.message,
    });
  }
};

exports.updateOurStory = async (req, res) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can update Our Story content',
      });
    }

    const { content: previous } = await getOrCreateRecord();
    const next = normalizeContent({ ...previous, ...(req.body || {}) });

    // Cleanup local files no longer referenced
    try {
      cleanupRemovedMedia(collectImagePaths(previous), collectImagePaths(next));
    } catch (e) {
      console.warn('Our Story image cleanup warning:', e.message);
    }

    const existing = await Database.read(COLLECTION, STORY_ID);
    let saved;
    if (existing) {
      saved = await Database.update(COLLECTION, STORY_ID, {
        content: next,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user?.id || null,
      });
    } else {
      saved = await Database.create(COLLECTION, {
        id: STORY_ID,
        _id: STORY_ID,
        content: next,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user?.id || null,
      });
    }

    const content =
      saved?.content && typeof saved.content === 'object'
        ? normalizeContent(saved.content)
        : next;

    res.json({
      success: true,
      message: 'Our Story content updated successfully',
      data: expandContent(content, req),
    });
  } catch (error) {
    console.error('updateOurStory error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating Our Story content',
      error: error.message,
    });
  }
};

exports.DEFAULT_CONTENT = DEFAULT_CONTENT;
