const Database = require('../models/DatabaseAdapter');
const { v4: uuidv4 } = require('uuid');

// Get user addresses
exports.getUserAddresses = async (req, res) => {
  try {
    const userId = req.user.id;

    const userAddresses = await Database.filterBy('addresses', 'userId', userId);

    res.json({
      success: true,
      data: userAddresses
    });
  } catch (error) {
    console.error('[Address Get] Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error fetching addresses',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Add address
exports.addAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, address, city, state, pincode, phone, isDefault, district, landmark } = req.body;

    console.log('[Address Add] Request body:', { name, address, city, state, pincode, phone, district, landmark, userId });

    if (!name || !address || !city || !state || !phone) {
      console.warn('[Address Add] Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, address, city, state, and phone are required'
      });
    }

    const allAddresses = await Database.readAll('addresses');
    console.log('[Address Add] Current addresses count:', allAddresses.length);

    // === Duplicate prevention logic ===
    // Compare all key address fields (normalized) against user's existing saved addresses.
    // If exact match (Full Name, Phone, Address Line, City, Region/State, Pincode, District, Landmark),
    // do not create a duplicate record. Use the existing one instead.
    const normalize = (val) => String(val || '').trim().toLowerCase().replace(/\s+/g, ' ');

    const userAddrs = allAddresses.filter(addr => addr.userId === userId);

    const incoming = {
      name: normalize(name),
      address: normalize(address),
      city: normalize(city),
      state: normalize(state),
      pincode: normalize(pincode),
      phone: normalize(phone),
      district: normalize(district),
      landmark: normalize(landmark)
    };

    const existingMatch = userAddrs.find(addr =>
      normalize(addr.name) === incoming.name &&
      normalize(addr.address) === incoming.address &&
      normalize(addr.city) === incoming.city &&
      normalize(addr.state) === incoming.state &&
      normalize(addr.pincode || '') === incoming.pincode &&
      normalize(addr.phone) === incoming.phone &&
      normalize(addr.district || '') === incoming.district &&
      normalize(addr.landmark || '') === incoming.landmark
    );

    if (existingMatch) {
      console.log('[Address Add] Exact duplicate address found for user. Skipping create. Existing ID:', existingMatch.id);
      // If the user requested this as default but the match is not, promote the existing one
      if (isDefault && !existingMatch.isDefault) {
        const otherDefaults = userAddrs.filter(a => a.isDefault && a.id !== existingMatch.id);
        for (const addr of otherDefaults) {
          await Database.update('addresses', addr.id, { isDefault: false });
        }
        await Database.update('addresses', existingMatch.id, { isDefault: true });
      }
      const freshUserAddresses = (await Database.readAll('addresses')).filter(addr => addr.userId === userId);
      return res.json({
        success: true,
        data: freshUserAddresses,
        message: 'Address already saved. Using existing record.',
        isDuplicate: true,
        address: existingMatch
      });
    }

    if (isDefault) {
      // Unset other defaults for this user (mongo compatible)
      const userAddrsForDefault = allAddresses.filter(addr => addr.userId === userId && addr.isDefault);
      for (const addr of userAddrsForDefault) {
        await Database.update('addresses', addr.id, { isDefault: false });
      }
    }

    const newAddressData = {
      id: uuidv4(),
      userId,
      name,
      address,
      city,
      state,
      pincode: pincode || '',
      phone: phone || '',
      district: district || '',
      landmark: landmark || '',
      isDefault: !!isDefault
    };

    const newAddress = await Database.create('addresses', newAddressData);

    console.log('[Address Add] New address created:', newAddress.id || newAddress._id);

    const userAddresses = (await Database.readAll('addresses')).filter(addr => addr.userId === userId);
    console.log('[Address Add] User addresses after add:', userAddresses.length);

    res.json({
      success: true,
      data: userAddresses,
      message: 'Address added successfully'
    });
  } catch (error) {
    console.error('[Address Add] Error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Error adding address',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete address
exports.deleteAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressId } = req.params;

    console.log('[Address Delete] Attempting to delete address:', addressId, 'for user:', userId);

    const allAddresses = await Database.readAll('addresses');
    const address = allAddresses.find(addr => addr.id === addressId);

    if (!address) {
      console.warn('[Address Delete] Address not found:', addressId);
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    if (address.userId !== userId) {
      console.warn('[Address Delete] Unauthorized access attempt');
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    await Database.delete('addresses', addressId);

    console.log('[Address Delete] Address deleted successfully');

    const userAddresses = (await Database.readAll('addresses')).filter(addr => addr.userId === userId);

    res.json({
      success: true,
      data: userAddresses,
      message: 'Address deleted successfully'
    });
  } catch (error) {
    console.error('[Address Delete] Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error deleting address',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update address
exports.updateAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressId } = req.params;
    const { name, address, city, state, pincode, phone, isDefault, district, landmark } = req.body;

    console.log('[Address Update] Attempting to update address:', addressId, 'for user:', userId);

    if (!name || !address || !city || !state || !phone) {
      console.warn('[Address Update] Missing required fields');
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, address, city, state, and phone are required'
      });
    }

    const allAddresses = await Database.readAll('addresses');
    const existing = allAddresses.find(addr => addr.id === addressId);

    if (!existing) {
      console.warn('[Address Update] Address not found:', addressId);
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    if (existing.userId !== userId) {
      console.warn('[Address Update] Unauthorized access attempt');
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Prepare updates (support both pincode and legacy zipcode)
    const updates = {
      name,
      address,
      city,
      state,
      pincode: pincode || '',
      zipcode: pincode || '',
      phone,
      district: district || '',
      landmark: landmark || '',
      updatedAt: new Date().toISOString()
    };

    // Update the address fields first
    await Database.update('addresses', addressId, updates);

    // Handle default address if needed (update other user's defaults)
    if (isDefault) {
      const otherDefaults = allAddresses.filter(addr => addr.userId === userId && addr.isDefault && addr.id !== addressId);
      for (const addr of otherDefaults) {
        await Database.update('addresses', addr.id, { isDefault: false });
      }
      await Database.update('addresses', addressId, { isDefault: true });
    }

    console.log('[Address Update] Address updated successfully');

    const userAddresses = (await Database.readAll('addresses')).filter(addr => addr.userId === userId);

    res.json({
      success: true,
      data: userAddresses,
      message: 'Address updated successfully'
    });
  } catch (error) {
    console.error('[Address Update] Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error updating address',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Set default address
exports.setDefaultAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressId } = req.params;

    console.log('[Address SetDefault] Setting default address:', addressId, 'for user:', userId);

    const allAddresses = await Database.readAll('addresses');
    const address = allAddresses.find(addr => addr.id === addressId);

    if (!address) {
      console.warn('[Address SetDefault] Address not found:', addressId);
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    if (address.userId !== userId) {
      console.warn('[Address SetDefault] Unauthorized access attempt');
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Unset all defaults for user
    const userDefaults = allAddresses.filter(addr => addr.userId === userId && addr.isDefault);
    for (const addr of userDefaults) {
      if (addr.id !== addressId) {
        await Database.update('addresses', addr.id, { isDefault: false });
      }
    }

    // Set this one as default
    await Database.update('addresses', addressId, { isDefault: true });

    console.log('[Address SetDefault] Default address set successfully');

    const userAddresses = (await Database.readAll('addresses')).filter(addr => addr.userId === userId);

    res.json({
      success: true,
      data: userAddresses,
      message: 'Default address updated successfully'
    });
  } catch (error) {
    console.error('[Address SetDefault] Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error setting default address',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
