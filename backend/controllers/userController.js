const User = require('../models/User');
const authService = require('../services/authService');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiResponse } = require('../utils/helpers');

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getProfile = asyncHandler(async (req, res) => {
  const user = await authService.getProfile(req.user.id);
  
  res.json(apiResponse(true, 'Profile retrieved successfully', user));
});

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateProfile = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user.id, req.body);
  
  res.json(apiResponse(true, 'Profile updated successfully', user));
});

// @desc    Add user address
// @route   POST /api/users/addresses
// @access  Private
const addAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  
  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  const newAddress = {
    label: req.body.label,
    fullName: req.body.fullName,
    phone: req.body.phone,
    addressLine1: req.body.addressLine1,
    addressLine2: req.body.addressLine2,
    city: req.body.city,
    state: req.body.state,
    pincode: req.body.pincode,
    coordinates: req.body.coordinates,
    isDefault: req.body.isDefault || false
  };

  // If this is set as default, make others non-default
  if (newAddress.isDefault) {
    user.addresses.forEach(addr => addr.isDefault = false);
  }

  user.addresses.push(newAddress);
  await user.save();

  res.status(201).json(apiResponse(true, 'Address added successfully', user.addresses));
});

// @desc    Update user address
// @route   PUT /api/users/addresses/:id
// @access  Private
const updateAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  
  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  const address = user.addresses.id(req.params.id);
  
  if (!address) {
    return res.status(404).json(apiResponse(false, 'Address not found'));
  }

  // Update address fields
  Object.keys(req.body).forEach(key => {
    if (key !== '_id') {
      address[key] = req.body[key];
    }
  });

  // If this is set as default, make others non-default
  if (req.body.isDefault) {
    user.addresses.forEach(addr => {
      if (addr._id.toString() !== req.params.id) {
        addr.isDefault = false;
      }
    });
  }

  await user.save();

  res.json(apiResponse(true, 'Address updated successfully', user.addresses));
});

// @desc    Delete user address
// @route   DELETE /api/users/addresses/:id
// @access  Private
const deleteAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  
  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  const address = user.addresses.id(req.params.id);
  
  if (!address) {
    return res.status(404).json(apiResponse(false, 'Address not found'));
  }

  user.addresses.pull(req.params.id);
  await user.save();

  res.json(apiResponse(true, 'Address deleted successfully', user.addresses));
});

// @desc    Get user addresses
// @route   GET /api/users/addresses
// @access  Private
const getAddresses = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('addresses');
  
  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  res.json(apiResponse(true, 'Addresses retrieved successfully', user.addresses));
});

// @desc    Update user preferences
// @route   PUT /api/users/preferences
// @access  Private
const updatePreferences = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  
  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  user.preferences = { ...user.preferences, ...req.body };
  await user.save();

  res.json(apiResponse(true, 'Preferences updated successfully', user.preferences));
});

// @desc    Get user preferences
// @route   GET /api/users/preferences
// @access  Private
const getPreferences = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('preferences');
  
  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  res.json(apiResponse(true, 'Preferences retrieved successfully', user.preferences));
});

// @desc    Upload profile image
// @route   POST /api/users/profile-image
// @access  Private
const uploadProfileImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json(apiResponse(false, 'No file uploaded'));
  }

  const user = await User.findById(req.user.id);
  
  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  const imageUrl = `/uploads/profiles/${req.file.filename}`;
  user.profileImage = imageUrl;
  await user.save();

  res.json(apiResponse(true, 'Profile image updated successfully', { profileImage: imageUrl }));
});

// @desc    Delete user account
// @route   DELETE /api/users/account
// @access  Private
const deleteAccount = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  
  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  // Soft delete - mark as inactive
  user.isActive = false;
  user.deletedAt = new Date();
  await user.save();

  res.json(apiResponse(true, 'Account deleted successfully'));
});

// @desc    Get user statistics
// @route   GET /api/users/stats
// @access  Private
const getUserStats = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  
  // Get user's order statistics
  const Order = require('../models/Order');
  
  const [
    totalOrders,
    completedOrders,
    totalSpent,
    thisMonthOrders
  ] = await Promise.all([
    Order.countDocuments({ customerId: userId }),
    Order.countDocuments({ customerId: userId, status: 'delivered' }),
    Order.aggregate([
      { $match: { customerId: userId, status: 'delivered' } },
      { $group: { _id: null, total: { $sum: '$pricing.total' } } }
    ]),
    Order.countDocuments({
      customerId: userId,
      createdAt: {
        $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      }
    })
  ]);

  const stats = {
    totalOrders,
    completedOrders,
    totalSpent: totalSpent[0]?.total || 0,
    thisMonthOrders,
    averageOrderValue: totalSpent[0]?.total ? (totalSpent[0].total / completedOrders) : 0
  };

  res.json(apiResponse(true, 'User statistics retrieved successfully', stats));
});

// @desc    Get user order history
// @route   GET /api/users/orders
// @access  Private
const getOrderHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;
  const userId = req.user.id;

  const Order = require('../models/Order');
  
  const filter = { customerId: userId };
  if (status) filter.status = status;

  const orders = await Order.find(filter)
    .populate('shopId', 'name')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Order.countDocuments(filter);

  const pagination = {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / limit)
  };

  res.json(apiResponse(true, 'Order history retrieved successfully', orders, pagination));
});

// @desc    Add item to favorites
// @route   POST /api/users/favorites
// @access  Private
const addToFavorites = asyncHandler(async (req, res) => {
  const { itemId, itemType } = req.body; // itemType: 'product' or 'shop'
  
  const user = await User.findById(req.user.id);
  
  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  // Check if already in favorites
  const existingFavorite = user.favorites.find(
    fav => fav.itemId.toString() === itemId && fav.itemType === itemType
  );

  if (existingFavorite) {
    return res.status(400).json(apiResponse(false, 'Item already in favorites'));
  }

  user.favorites.push({ itemId, itemType });
  await user.save();

  res.json(apiResponse(true, 'Item added to favorites', user.favorites));
});

// @desc    Remove item from favorites
// @route   DELETE /api/users/favorites/:id
// @access  Private
const removeFromFavorites = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  
  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  user.favorites.pull(req.params.id);
  await user.save();

  res.json(apiResponse(true, 'Item removed from favorites', user.favorites));
});

// @desc    Get user favorites
// @route   GET /api/users/favorites
// @access  Private
const getFavorites = asyncHandler(async (req, res) => {
  const { type } = req.query; // Filter by type if provided
  
  const user = await User.findById(req.user.id)
    .populate('favorites.itemId')
    .select('favorites');
  
  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  let favorites = user.favorites;
  
  if (type) {
    favorites = favorites.filter(fav => fav.itemType === type);
  }

  res.json(apiResponse(true, 'Favorites retrieved successfully', favorites));
});

module.exports = {
  getProfile,
  updateProfile,
  addAddress,
  updateAddress,
  deleteAddress,
  getAddresses,
  updatePreferences,
  getPreferences,
  uploadProfileImage,
  deleteAccount,
  getUserStats,
  getOrderHistory,
  addToFavorites,
  removeFromFavorites,
  getFavorites
};
