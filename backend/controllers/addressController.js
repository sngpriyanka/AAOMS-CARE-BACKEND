const Database = require('../models/DatabaseAdapter');
const { v4: uuidv4 } = require('uuid');
const { validateIndianPhone, INDIAN_MOBILE_ERROR } = require('../utils/validators');
const { toPhone10 } = require('../utils/phoneUtils');
const {
  normalizeAddressFields,
  validateAddressFields,
  addressesAreDuplicate,
} = require('../utils/addressUtils');

const mapStoredAddress = (address) => ({
  ...address,
  firstName: address.firstName || address.first_name || '',
  middleName: address.middleName || address.middle_name || '',
  lastName: address.lastName || address.last_name || '',
  pincode: address.pincode || address.zipcode || '',
});

// Get user addresses
exports.getUserAddresses = async (req, res) => {
  try {
    const userId = req.user.id;
    const userAddresses = await Database.filterBy('addresses', 'userId', userId);

    res.json({
      success: true,
      data: userAddresses.map(mapStoredAddress),
    });
  } catch (error) {
    console.error('[Address Get] Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error fetching addresses',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

const prepareAddressRecord = (body) => {
  const fields = normalizeAddressFields(body);
  const validation = validateAddressFields(fields);

  if (!validation.valid) {
    return { error: validation.message };
  }

  const phone10 = toPhone10(fields.phone);
  if (!validateIndianPhone(phone10)) {
    return { error: INDIAN_MOBILE_ERROR };
  }

  return {
    fields: {
      ...fields,
      phone: phone10,
    },
  };
};

// Add address
exports.addAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const prepared = prepareAddressRecord(req.body);

    if (prepared.error) {
      return res.status(400).json({ success: false, message: prepared.error });
    }

    const { fields } = prepared;
    const allAddresses = await Database.readAll('addresses');
    const userAddrs = allAddresses.filter((addr) => addr.userId === userId);

    const existingMatch = userAddrs.find((addr) => addressesAreDuplicate(addr, fields));

    if (existingMatch) {
      if (fields.isDefault && !existingMatch.isDefault) {
        const otherDefaults = userAddrs.filter((a) => a.isDefault && a.id !== existingMatch.id);
        for (const addr of otherDefaults) {
          await Database.update('addresses', addr.id, { isDefault: false });
        }
        await Database.update('addresses', existingMatch.id, { isDefault: true });
      }

      const freshUserAddresses = (await Database.readAll('addresses')).filter((addr) => addr.userId === userId);
      return res.json({
        success: true,
        data: freshUserAddresses.map(mapStoredAddress),
        message: 'Address already saved. Using existing record.',
        isDuplicate: true,
        address: mapStoredAddress(existingMatch),
      });
    }

    if (fields.isDefault) {
      const userAddrsForDefault = allAddresses.filter((addr) => addr.userId === userId && addr.isDefault);
      for (const addr of userAddrsForDefault) {
        await Database.update('addresses', addr.id, { isDefault: false });
      }
    }

    const newAddressData = {
      id: uuidv4(),
      userId,
      firstName: fields.firstName,
      middleName: fields.middleName,
      lastName: fields.lastName,
      name: fields.name,
      address: fields.address,
      city: fields.city,
      state: fields.state,
      pincode: fields.pincode,
      zipcode: fields.pincode,
      phone: fields.phone,
      landmark: fields.landmark,
      isDefault: fields.isDefault,
    };

    await Database.create('addresses', newAddressData);

    const userAddresses = (await Database.readAll('addresses'))
      .filter((addr) => addr.userId === userId)
      .map(mapStoredAddress);

    res.json({
      success: true,
      data: userAddresses,
      message: 'Address added successfully',
    });
  } catch (error) {
    console.error('[Address Add] Error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Error adding address',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Delete address
exports.deleteAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressId } = req.params;

    const allAddresses = await Database.readAll('addresses');
    const address = allAddresses.find((addr) => addr.id === addressId);

    if (!address) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    if (address.userId !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    await Database.delete('addresses', addressId);

    const userAddresses = (await Database.readAll('addresses'))
      .filter((addr) => addr.userId === userId)
      .map(mapStoredAddress);

    res.json({
      success: true,
      data: userAddresses,
      message: 'Address deleted successfully',
    });
  } catch (error) {
    console.error('[Address Delete] Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error deleting address',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Update address
exports.updateAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressId } = req.params;
    const prepared = prepareAddressRecord(req.body);

    if (prepared.error) {
      return res.status(400).json({ success: false, message: prepared.error });
    }

    const { fields } = prepared;
    const allAddresses = await Database.readAll('addresses');
    const existing = allAddresses.find((addr) => addr.id === addressId);

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    if (existing.userId !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const updates = {
      firstName: fields.firstName,
      middleName: fields.middleName,
      lastName: fields.lastName,
      name: fields.name,
      address: fields.address,
      city: fields.city,
      state: fields.state,
      pincode: fields.pincode,
      zipcode: fields.pincode,
      phone: fields.phone,
      landmark: fields.landmark,
      updatedAt: new Date().toISOString(),
    };

    await Database.update('addresses', addressId, updates);

    if (fields.isDefault) {
      const otherDefaults = allAddresses.filter(
        (addr) => addr.userId === userId && addr.isDefault && addr.id !== addressId
      );
      for (const addr of otherDefaults) {
        await Database.update('addresses', addr.id, { isDefault: false });
      }
      await Database.update('addresses', addressId, { isDefault: true });
    }

    const userAddresses = (await Database.readAll('addresses'))
      .filter((addr) => addr.userId === userId)
      .map(mapStoredAddress);

    res.json({
      success: true,
      data: userAddresses,
      message: 'Address updated successfully',
    });
  } catch (error) {
    console.error('[Address Update] Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error updating address',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Set default address
exports.setDefaultAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressId } = req.params;

    const allAddresses = await Database.readAll('addresses');
    const address = allAddresses.find((addr) => addr.id === addressId);

    if (!address) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    if (address.userId !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const userDefaults = allAddresses.filter((addr) => addr.userId === userId && addr.isDefault);
    for (const addr of userDefaults) {
      if (addr.id !== addressId) {
        await Database.update('addresses', addr.id, { isDefault: false });
      }
    }

    await Database.update('addresses', addressId, { isDefault: true });

    const userAddresses = (await Database.readAll('addresses'))
      .filter((addr) => addr.userId === userId)
      .map(mapStoredAddress);

    res.json({
      success: true,
      data: userAddresses,
      message: 'Default address updated successfully',
    });
  } catch (error) {
    console.error('[Address SetDefault] Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error setting default address',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};