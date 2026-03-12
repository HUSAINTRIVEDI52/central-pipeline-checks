const express = require('express');
const User = require('../models/User');
const Shop = require('../models/Shop');
const Order = require('../models/Order');
const DeliveryPartnerProfile = require('../models/DeliveryPartnerProfile');
const { authenticate, authorize, requireVerification, checkOwnership } = require('../middleware/auth');
const { validateObjectIdParam, validatePagination } = require('../middleware/validation');
const { upload, optimizeImage } = require('../middleware/upload');

const router = express.Router();
const { 
  getSearchHistory, 
  addToSearchHistory, 
  clearSearchHistory 
} = require('../controllers/searchController');

router.get('/search-history', authenticate, getSearchHistory);
router.post('/search-history', authenticate, addToSearchHistory);
router.delete('/search-history', authenticate, clearSearchHistory);

// @desc    Get all users (Admin only)
// @route   GET /api/users
// @access  Private (Admin)
const getAllUsers = async (req, res) => {
  try {
    const {
      role,
      isVerified,
      isActive,
      search,
      sortBy = 'createdAt',
      sortOrder = -1,
      page = 1,
      limit = 20
    } = req.query;

    // Build filter
    const filter = {};
    
    if (role) filter.role = role;
    if (isVerified !== undefined) filter.isVerified = isVerified === 'true';
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const users = await User.find(filter)
      .select('-password -otp')
      .sort({ [sortBy]: parseInt(sortOrder) })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users'
    });
  }
};

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private (Own profile or Admin)
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password -otp');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user can access this profile
    if (req.user._id.toString() !== req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this profile'
      });
    }

    // Get additional profile data based on role
    let additionalData = {};

    if (user.role === 'shop_owner') {
      const shop = await Shop.findOne({ ownerId: user._id });
      additionalData.shop = shop;
    } else if (user.role === 'delivery_partner') {
      const profile = await DeliveryPartnerProfile.findOne({ userId: user._id });
      additionalData.deliveryProfile = profile;
    }

    // Get user statistics
    const stats = await getUserStatistics(user._id, user.role);

    res.json({
      success: true,
      user: {
        ...user.toObject(),
        ...additionalData,
        stats
      }
    });

  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user'
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/:id
// @access  Private (Own profile or Admin)
const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check permissions
    if (req.user._id.toString() !== req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this profile'
      });
    }

    const allowedUpdates = ['fullName', 'address', 'fcmToken'];
    
    // Admin can update additional fields
    if (req.user.role === 'admin') {
      allowedUpdates.push('isVerified', 'isActive', 'role');
    }

    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // Handle profile image upload
    if (req.file) {
      updates.profileImage = `/${req.file.path}`;
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).select('-password -otp');

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser
    });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
};

// @desc    Delete/Deactivate user
// @route   DELETE /api/users/:id
// @access  Private (Admin only)
const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Soft delete by deactivating account
    user.isActive = false;
    await user.save();

    // Handle role-specific cleanup
    if (user.role === 'shop_owner') {
      // Deactivate shop
      await Shop.updateOne(
        { ownerId: user._id },
        { isActive: false }
      );
    } else if (user.role === 'delivery_partner') {
      // Deactivate delivery profile
      await DeliveryPartnerProfile.updateOne(
        { userId: user._id },
        { isActive: false, availabilityStatus: 'offline' }
      );
    }

    res.json({
      success: true,
      message: 'User account deactivated successfully'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deactivate user'
    });
  }
};

// @desc    Get user's orders
// @route   GET /api/users/:id/orders
// @access  Private (Own orders or Admin)
const getUserOrders = async (req, res) => {
  try {
    // Check permissions
    if (req.user._id.toString() !== req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view these orders'
      });
    }

    const {
      status,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;

    const filter = { customerId: req.params.id };

    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const orders = await Order.find(filter)
      .populate('shopId', 'name address contact')
      .populate('deliveryPartnerId', 'fullName phone')
      .populate('items.productId', 'name images unit')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(filter);

    res.json({
      success: true,
      data: {
        orders,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Get user orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user orders'
    });
  }
};

// @desc    Update user address
// @route   POST /api/users/:id/address
// @access  Private (Own profile)
const addUserAddress = async (req, res) => {
  try {
    // Check permissions
    if (req.user._id.toString() !== req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this profile'
      });
    }

    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const { label, street, city, state, pincode, landmark, coordinates, isDefault } = req.body;

    // If this is set as default, unset other default addresses
    if (isDefault) {
      user.address.forEach(addr => {
        addr.isDefault = false;
      });
    }

    const newAddress = {
      label,
      street,
      city,
      state,
      pincode,
      landmark,
      coordinates,
      isDefault: isDefault || user.address.length === 0 // First address is default
    };

    user.address.push(newAddress);
    await user.save();

    res.json({
      success: true,
      message: 'Address added successfully',
      address: newAddress
    });

  } catch (error) {
    console.error('Add user address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add address'
    });
  }
};

// @desc    Update user address
// @route   PUT /api/users/:id/address/:addressId
// @access  Private (Own profile)
const updateUserAddress = async (req, res) => {
  try {
    // Check permissions
    if (req.user._id.toString() !== req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this profile'
      });
    }

    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const address = user.address.id(req.params.addressId);
    
    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    const allowedUpdates = ['label', 'street', 'city', 'state', 'pincode', 'landmark', 'coordinates', 'isDefault'];
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        address[field] = req.body[field];
      }
    });

    // If this is set as default, unset other default addresses
    if (req.body.isDefault) {
      user.address.forEach(addr => {
        if (addr._id.toString() !== req.params.addressId) {
          addr.isDefault = false;
        }
      });
    }

    await user.save();

    res.json({
      success: true,
      message: 'Address updated successfully',
      address
    });

  } catch (error) {
    console.error('Update user address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update address'
    });
  }
};

// @desc    Delete user address
// @route   DELETE /api/users/:id/address/:addressId
// @access  Private (Own profile)
const deleteUserAddress = async (req, res) => {
  try {
    // Check permissions
    if (req.user._id.toString() !== req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this profile'
      });
    }

    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const address = user.address.id(req.params.addressId);
    
    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    const wasDefault = address.isDefault;
    address.remove();

    // If deleted address was default, make first remaining address default
    if (wasDefault && user.address.length > 0) {
      user.address[0].isDefault = true;
    }

    await user.save();

    res.json({
      success: true,
      message: 'Address deleted successfully'
    });

  } catch (error) {
    console.error('Delete user address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete address'
    });
  }
};

// Helper function to get user statistics
const getUserStatistics = async (userId, userRole) => {
  try {
    const stats = {};

    if (userRole === 'customer') {
      // Customer statistics
      const orders = await Order.find({ customerId: userId });
      stats.totalOrders = orders.length;
      stats.completedOrders = orders.filter(o => o.status === 'delivered').length;
      stats.totalSpent = orders
        .filter(o => o.status === 'delivered')
        .reduce((sum, o) => sum + o.pricing.total, 0);
      stats.averageOrderValue = stats.completedOrders > 0 ? 
        Math.round(stats.totalSpent / stats.completedOrders) : 0;
    } else if (userRole === 'shop_owner') {
      // Shop owner statistics
      const shop = await Shop.findOne({ ownerId: userId });
      if (shop) {
        const orders = await Order.find({ shopId: shop._id });
        stats.totalOrders = orders.length;
        stats.completedOrders = orders.filter(o => o.status === 'delivered').length;
        stats.totalRevenue = orders
          .filter(o => o.status === 'delivered')
          .reduce((sum, o) => sum + o.pricing.total, 0);
        stats.shopRating = shop.rating.average;
      }
    } else if (userRole === 'delivery_partner') {
      // Delivery partner statistics
      const orders = await Order.find({ deliveryPartnerId: userId });
      stats.totalDeliveries = orders.length;
      stats.completedDeliveries = orders.filter(o => o.status === 'delivered').length;
      stats.totalEarnings = orders
        .filter(o => o.status === 'delivered')
        .reduce((sum, o) => sum + o.pricing.deliveryFee, 0);
      
      const profile = await DeliveryPartnerProfile.findOne({ userId });
      if (profile) {
        stats.rating = profile.rating.average;
      }
    }

    return stats;

  } catch (error) {
    console.error('Error getting user statistics:', error);
    return {};
  }
};

// Apply middleware and routes
router.get('/', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  validatePagination,
  getAllUsers
);

router.get('/:id', 
  authenticate, 
  requireVerification,
  validateObjectIdParam('id'),
  getUserById
);

router.put('/:id', 
  authenticate, 
  requireVerification,
  validateObjectIdParam('id'),
  upload.single('profileImage'),
  optimizeImage,
  updateUser
);

router.delete('/:id', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  validateObjectIdParam('id'),
  deleteUser
);

router.get('/:id/orders', 
  authenticate, 
  requireVerification,
  validateObjectIdParam('id'),
  validatePagination,
  getUserOrders
);

router.post('/:id/address', 
  authenticate, 
  requireVerification,
  validateObjectIdParam('id'),
  addUserAddress
);

router.put('/:id/address/:addressId', 
  authenticate, 
  requireVerification,
  validateObjectIdParam('id'),
  updateUserAddress
);

router.delete('/:id/address/:addressId', 
  authenticate, 
  requireVerification,
  validateObjectIdParam('id'),
  deleteUserAddress
);

module.exports = router;
