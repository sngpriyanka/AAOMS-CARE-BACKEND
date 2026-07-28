const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/roleMiddleware');
const { getUserAddresses, addAddress, updateAddress, deleteAddress, setDefaultAddress } = require('../controllers/addressController');

router.get('/', protect, getUserAddresses);
router.post('/', protect, addAddress);
router.put('/:addressId', protect, updateAddress);
router.delete('/:addressId', protect, deleteAddress);
router.post('/:addressId/default', protect, setDefaultAddress);

module.exports = router;
