const Database = require('../models/DatabaseAdapter');
const { v4: uuidv4 } = require('uuid');
const {
  toStoredMediaPath,
  expandMediaValue,
  deleteLocalFile,
  isLocalUploadPath,
} = require('../utils/localUpload');

const COLLECTION = 'testimonials';

const expandTestimonialMedia = (item, req) => {
  if (!item) return item;
  return {
    ...item,
    image: expandMediaValue(item.image, req) || '',
    publicId:
      item.publicId && isLocalUploadPath(item.publicId)
        ? toStoredMediaPath(item.publicId)
        : item.publicId || '',
  };
};

const ensureTestimonialSchema = async () => {
  try {
    const { getPool } = require('../models/postgres');
    const { ensureTestimonialsTable } = require('../models/migrations/initTables');
    const pool = getPool && getPool();
    if (!pool) return;

    const client = await pool.connect();
    try {
      await ensureTestimonialsTable(client);
    } finally {
      client.release();
    }
  } catch (e) {
    console.warn('Testimonial schema ensure warning:', e.message);
  }
};

const MIN_TEXT_LENGTH = 20;
const MAX_TEXT_LENGTH = 500;

const validateRating = (rating) => {
  const value = Number(rating);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    return null;
  }
  return value;
};

const validateText = (text) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 'Testimonial text is required';
  if (trimmed.length < MIN_TEXT_LENGTH) {
    return `Testimonial text must be at least ${MIN_TEXT_LENGTH} characters`;
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    return `Testimonial text must be ${MAX_TEXT_LENGTH} characters or fewer`;
  }
  return null;
};

const sortTestimonials = (items) =>
  [...items].sort((a, b) => {
    const orderDiff = (a.sortOrder || 0) - (b.sortOrder || 0);
    if (orderDiff !== 0) return orderDiff;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

exports.getTestimonials = async (req, res) => {
  try {
    await ensureTestimonialSchema();
    const items = await Database.readAll(COLLECTION);
    const activeItems = sortTestimonials(items.filter((item) => item.isActive !== false));
    res.json({
      success: true,
      data: activeItems.map((i) => expandTestimonialMedia(i, req)),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching testimonials', error: error.message });
  }
};

exports.getAllTestimonials = async (req, res) => {
  try {
    await ensureTestimonialSchema();
    const items = await Database.readAll(COLLECTION);
    res.json({
      success: true,
      data: sortTestimonials(items).map((i) => expandTestimonialMedia(i, req)),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching testimonials', error: error.message });
  }
};

exports.getTestimonialById = async (req, res) => {
  try {
    const item = await Database.read(COLLECTION, req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Testimonial not found' });
    }
    res.json({ success: true, data: expandTestimonialMedia(item, req) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching testimonial', error: error.message });
  }
};

exports.createTestimonial = async (req, res) => {
  try {
    await ensureTestimonialSchema();

    const { name, title, text, image, publicId, productId, sortOrder, isActive } = req.body;
    const rating = validateRating(req.body.rating);

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Title/role is required' });
    }
    const textError = validateText(text);
    if (textError) {
      return res.status(400).json({ success: false, message: textError });
    }
    if (rating === null) {
      return res.status(400).json({ success: false, message: 'Rating must be an integer between 1 and 5' });
    }

    const storedImage = toStoredMediaPath(image || '') || '';
    const storedPublicId = toStoredMediaPath(publicId || '') || storedImage;

    const id = uuidv4();
    const item = await Database.create(COLLECTION, {
      id,
      _id: id,
      name: name.trim(),
      title: title.trim(),
      text: text.trim(),
      rating,
      image: storedImage,
      publicId: storedPublicId || '',
      productId: productId || '',
      sortOrder: Number(sortOrder || 0),
      isActive: isActive !== false,
      createdAt: new Date().toISOString(),
      createdBy: req.user?.id || null,
    });

    res.status(201).json({
      success: true,
      message: 'Testimonial created',
      data: expandTestimonialMedia(item, req),
    });
  } catch (error) {
    console.error('createTestimonial error:', error);
    res.status(500).json({ success: false, message: 'Error creating testimonial', error: error.message });
  }
};

exports.updateTestimonial = async (req, res) => {
  try {
    await ensureTestimonialSchema();

    const existing = await Database.read(COLLECTION, req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Testimonial not found' });
    }

    const updates = { ...req.body };

    if (updates.name !== undefined) {
      if (!updates.name || !String(updates.name).trim()) {
        return res.status(400).json({ success: false, message: 'Name cannot be empty' });
      }
      updates.name = String(updates.name).trim();
    }
    if (updates.title !== undefined) {
      if (!updates.title || !String(updates.title).trim()) {
        return res.status(400).json({ success: false, message: 'Title/role cannot be empty' });
      }
      updates.title = String(updates.title).trim();
    }
    if (updates.text !== undefined) {
      const textError = validateText(updates.text);
      if (textError) {
        return res.status(400).json({ success: false, message: textError });
      }
      updates.text = String(updates.text).trim();
    }
    if (updates.rating !== undefined) {
      const rating = validateRating(updates.rating);
      if (rating === null) {
        return res.status(400).json({ success: false, message: 'Rating must be an integer between 1 and 5' });
      }
      updates.rating = rating;
    }
    if (updates.sortOrder !== undefined) {
      updates.sortOrder = Number(updates.sortOrder || 0);
    }
    if (updates.isActive !== undefined) {
      updates.isActive = Boolean(updates.isActive);
    }
    if (updates.image !== undefined) {
      updates.image = toStoredMediaPath(updates.image) || '';
    }
    if (updates.publicId !== undefined) {
      updates.publicId = toStoredMediaPath(updates.publicId) || updates.image || '';
    }

    updates.updatedAt = new Date().toISOString();
    Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);

    const item = await Database.update(COLLECTION, req.params.id, updates);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Testimonial not found' });
    }

    // Delete previous local image if replaced
    try {
      const oldImg = toStoredMediaPath(existing.image || existing.publicId || '');
      const newImg = toStoredMediaPath(item.image || item.publicId || '');
      if (oldImg && isLocalUploadPath(oldImg) && oldImg !== newImg) {
        deleteLocalFile(oldImg);
      }
    } catch (e) {
      console.warn('Testimonial image cleanup warning:', e.message);
    }

    res.json({
      success: true,
      message: 'Testimonial updated',
      data: expandTestimonialMedia(item, req),
    });
  } catch (error) {
    console.error('updateTestimonial error:', error);
    res.status(500).json({ success: false, message: 'Error updating testimonial', error: error.message });
  }
};

exports.deleteTestimonial = async (req, res) => {
  try {
    const existing = await Database.read(COLLECTION, req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Testimonial not found' });
    }

    await Database.delete(COLLECTION, req.params.id);

    try {
      // --- Cloudinary delete (COMMENTED OUT — do not remove) ---
      // const { deleteFromCloudinary } = require('../utils/cloudinaryConfig');
      // if (existing.publicId) await deleteFromCloudinary(existing.publicId);

      // --- Local disk delete (ACTIVE) ---
      const img = existing.image || existing.publicId;
      if (img && isLocalUploadPath(img)) deleteLocalFile(img); // fs.unlink for /uploads/...
    } catch (e) {
      console.warn('Testimonial file cleanup warning:', e.message);
    }

    res.json({ success: true, message: 'Testimonial deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting testimonial', error: error.message });
  }
};