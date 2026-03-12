const Address = require('../models/Address');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiResponse } = require('../utils/helpers');

// @desc    Get all user addresses
// @route   GET /api/addresses
// @access  Private
const getAddresses = asyncHandler(async (req, res) => {
  const addresses = await Address.getUserAddresses(req.user.id);
  
  res.json(apiResponse(true, 'Addresses retrieved successfully', {
    addresses,
    count: addresses.length
  }));
});

// @desc    Get single address
// @route   GET /api/addresses/:id
// @access  Private
const getAddress = asyncHandler(async (req, res) => {
  const address = await Address.findOne({ 
    _id: req.params.id, 
    userId: req.user.id,
    isActive: true
  });
  
  if (!address) {
    return res.status(404).json(apiResponse(false, 'Address not found'));
  }
  
  res.json(apiResponse(true, 'Address retrieved successfully', { address }));
});

// @desc    Get default address
// @route   GET /api/addresses/default
// @access  Private
const getDefaultAddress = asyncHandler(async (req, res) => {
  const address = await Address.getDefaultAddress(req.user.id);
  
  if (!address) {
    return res.status(404).json(apiResponse(false, 'No default address found'));
  }
  
  res.json(apiResponse(true, 'Default address retrieved successfully', { address }));
});

// @desc    Create new address
// @route   POST /api/addresses
// @access  Private
const createAddress = asyncHandler(async (req, res) => {
  const addressData = {
    ...req.body,
    userId: req.user.id
  };
  
  const address = await Address.create(addressData);
  
  res.status(201).json(apiResponse(true, 'Address created successfully', { address }));
});

// @desc    Update address
// @route   PUT /api/addresses/:id
// @access  Private
const updateAddress = asyncHandler(async (req, res) => {
  let address = await Address.findOne({ 
    _id: req.params.id, 
    userId: req.user.id 
  });
  
  if (!address) {
    return res.status(404).json(apiResponse(false, 'Address not found'));
  }
  
  // Update fields
  Object.keys(req.body).forEach(key => {
    if (key !== 'userId' && key !== '_id') {
      address[key] = req.body[key];
    }
  });
  
  await address.save();
  
  res.json(apiResponse(true, 'Address updated successfully', { address }));
});

// @desc    Set address as default
// @route   PUT /api/addresses/:id/default
// @access  Private
const setDefaultAddress = asyncHandler(async (req, res) => {
  const address = await Address.findOne({ 
    _id: req.params.id, 
    userId: req.user.id,
    isActive: true
  });
  
  if (!address) {
    return res.status(404).json(apiResponse(false, 'Address not found'));
  }
  
  await address.setAsDefault();
  
  res.json(apiResponse(true, 'Default address updated successfully', { address }));
});

// @desc    Delete address (soft delete)
// @route   DELETE /api/addresses/:id
// @access  Private
const deleteAddress = asyncHandler(async (req, res) => {
  const address = await Address.findOne({ 
    _id: req.params.id, 
    userId: req.user.id 
  });
  
  if (!address) {
    return res.status(404).json(apiResponse(false, 'Address not found'));
  }
  
  await address.softDelete();
  
  res.json(apiResponse(true, 'Address deleted successfully'));
});

// @desc    Permanently delete address
// @route   DELETE /api/addresses/:id/permanent
// @access  Private
const permanentDeleteAddress = asyncHandler(async (req, res) => {
  const address = await Address.findOneAndDelete({ 
    _id: req.params.id, 
    userId: req.user.id 
  });
  
  if (!address) {
    return res.status(404).json(apiResponse(false, 'Address not found'));
  }
  
  res.json(apiResponse(true, 'Address permanently deleted'));
});

module.exports = {
  getAddresses,
  getAddress,
  getDefaultAddress,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
  permanentDeleteAddress
};
