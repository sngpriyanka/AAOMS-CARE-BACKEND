const Database = require('../models/DatabaseAdapter');
const { v4: uuidv4 } = require('uuid');

const COLLECTION = 'instagramFeeds';

exports.getInstagramFeed = async (req, res) => {
  try {
    const items = await Database.readAll(COLLECTION);
    const activeItems = items
      .filter(item => item.isActive !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    res.json({ success: true, data: activeItems });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching Instagram feed', error: error.message });
  }
};

exports.createInstagramFeedItem = async (req, res) => {
  try {
    const { image, link, alt, isReel, sortOrder } = req.body;

    if (!image || !link) {
      return res.status(400).json({ success: false, message: 'Image and link are required' });
    }

    const id = uuidv4();
    const item = await Database.create(COLLECTION, {
      id,
      _id: id,
      image,
      link,
      alt: alt || 'Instagram post',
      isReel: Boolean(isReel),
      sortOrder: Number(sortOrder || 0),
      isActive: true,
      createdBy: req.user ? req.user.id : null,
      createdAt: new Date().toISOString()
    });

    res.status(201).json({ success: true, message: 'Instagram feed item created', data: item });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error creating Instagram feed item', error: error.message });
  }
};

exports.updateInstagramFeedItem = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {
      ...req.body,
      sortOrder: req.body.sortOrder !== undefined ? Number(req.body.sortOrder) : undefined,
      updatedAt: new Date().toISOString()
    };

    Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);
    const item = await Database.update(COLLECTION, id, updates);

    if (!item) {
      return res.status(404).json({ success: false, message: 'Instagram feed item not found' });
    }

    res.json({ success: true, message: 'Instagram feed item updated', data: item });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating Instagram feed item', error: error.message });
  }
};

exports.deleteInstagramFeedItem = async (req, res) => {
  try {
    await Database.delete(COLLECTION, req.params.id);
    res.json({ success: true, message: 'Instagram feed item deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting Instagram feed item', error: error.message });
  }
};
