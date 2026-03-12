const express = require('express');
const {
  getAddresses,
  getAddress,
  getDefaultAddress,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
  permanentDeleteAddress
} = require('../controllers/addressController');
const { authenticate, requireVerification } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authenticate);
router.use(requireVerification);

// @route   GET /api/addresses
// @desc    Get all user addresses
// @access  Private
router.get('/', getAddresses);

// @route   GET /api/addresses/default
// @desc    Get default address
// @access  Private
router.get('/default', getDefaultAddress);

// @route   GET /api/addresses/:id
// @desc    Get single address
// @access  Private
router.get('/:id', getAddress);

// @route   POST /api/addresses
// @desc    Create new address
// @access  Private
router.post('/', createAddress);

// @route   PUT /api/addresses/:id
// @desc    Update address
// @access  Private
router.put('/:id', updateAddress);

// @route   PUT /api/addresses/:id/default
// @desc    Set address as default
// @access  Private
router.put('/:id/default', setDefaultAddress);

// @route   DELETE /api/addresses/:id
// @desc    Delete address (soft delete)
// @access  Private
router.delete('/:id', deleteAddress);

// @route   DELETE /api/addresses/:id/permanent
// @desc    Permanently delete address
// @access  Private
router.delete('/:id/permanent', permanentDeleteAddress);

module.exports = router;
