const User = require('../models/User');
const Shop = require('../models/Shop');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Payment = require('../models/Payment');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiResponse, getPaginationMeta } = require('../utils/helpers');
const { logSystem } = require('../utils/logger');

// @desc    Get dashboard statistics
// @route   GET /api/admin/dashboard
// @access  Private (Admin)
const getDashboardStats = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const [
    totalUsers,
    totalShops,
    totalOrders,
    totalRevenue,
    todayOrders,
    todayRevenue,
    pendingVerifications,
    activeDeliveryPartners
  ] = await Promise.all([
    User.countDocuments({ isActive: true }),
    Shop.countDocuments({ isActive: true }),
    Order.countDocuments(),
    Order.aggregate([
      { $match: { status: 'delivered' } },
      { $group: { _id: null, total: { $sum: '$pricing.total' } } }
    ]),
    Order.countDocuments({
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
    }),
    Order.aggregate([
      {
        $match: {
          status: 'delivered',
          createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        }
      },
      { $group: { _id: null, total: { $sum: '$pricing.total' } } }
    ]),
    Shop.countDocuments({ isVerified: false, isActive: true }),
    User.countDocuments({ role: 'delivery_partner', isActive: true })
  ]);

  const stats = {
    overview: {
      totalUsers,
      totalShops,
      totalOrders,
      totalRevenue: totalRevenue[0]?.total || 0,
      todayOrders,
      todayRevenue: todayRevenue[0]?.total || 0,
      pendingVerifications,
      activeDeliveryPartners
    },
    growth: {
      // These would typically be calculated from historical data
      userGrowth: 12.5, // % growth
      orderGrowth: 8.3,
      revenueGrowth: 15.7
    }
  };

  res.json(apiResponse(true, 'Dashboard statistics retrieved', stats));
});

// @desc    Get all users
// @route   GET /api/admin/users
// @access  Private (Admin)
const getUsers = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const {
    page = 1,
    limit = 20,
    role,
    isActive,
    search
  } = req.query;

  const filter = {};
  
  if (role) filter.role = role;
  if (isActive !== undefined) filter.isActive = isActive === 'true';
  if (search) {
    filter.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    User.find(filter)
      .select('-password -otp -resetPasswordToken')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip),
    User.countDocuments(filter)
  ]);

  const pagination = getPaginationMeta(page, limit, total);

  res.json(apiResponse(true, 'Users retrieved successfully', users, pagination));
});

// @desc    Get single user
// @route   GET /api/admin/users/:id
// @access  Private (Admin)
const getUser = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const user = await User.findById(req.params.id)
    .select('-password -otp -resetPasswordToken')
    .populate('addresses');

  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  // Get user statistics
  const [orderCount, totalSpent] = await Promise.all([
    Order.countDocuments({ customerId: user._id }),
    Order.aggregate([
      { $match: { customerId: user._id, status: 'delivered' } },
      { $group: { _id: null, total: { $sum: '$pricing.total' } } }
    ])
  ]);

  const userStats = {
    orderCount,
    totalSpent: totalSpent[0]?.total || 0
  };

  res.json(apiResponse(true, 'User retrieved successfully', { user, stats: userStats }));
});

// @desc    Update user status
// @route   PATCH /api/admin/users/:id/status
// @access  Private (Admin)
const updateUserStatus = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const { isActive } = req.body;

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isActive },
    { new: true }
  ).select('-password -otp');

  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  logSystem('user_status_updated', 'info', { 
    userId: user._id, 
    newStatus: isActive,
    updatedBy: req.user.id 
  });

  res.json(apiResponse(true, 'User status updated successfully', user));
});

// @desc    Get all shops
// @route   GET /api/admin/shops
// @access  Private (Admin)
const getShops = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const {
    page = 1,
    limit = 20,
    isVerified,
    isActive,
    category,
    search
  } = req.query;

  const filter = {};
  
  if (isVerified !== undefined) filter.isVerified = isVerified === 'true';
  if (isActive !== undefined) filter.isActive = isActive === 'true';
  if (category) filter.category = category;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (page - 1) * limit;

  const [shops, total] = await Promise.all([
    Shop.find(filter)
      .populate('ownerId', 'fullName email phone')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip),
    Shop.countDocuments(filter)
  ]);

  const pagination = getPaginationMeta(page, limit, total);

  res.json(apiResponse(true, 'Shops retrieved successfully', shops, pagination));
});

// @desc    Verify shop
// @route   PATCH /api/admin/shops/:id/verify
// @access  Private (Admin)
const verifyShop = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const { isVerified, rejectionReason } = req.body;

  const shop = await Shop.findByIdAndUpdate(
    req.params.id,
    { 
      isVerified,
      verificationDate: isVerified ? new Date() : null,
      rejectionReason: !isVerified ? rejectionReason : null
    },
    { new: true }
  ).populate('ownerId', 'fullName email');

  if (!shop) {
    return res.status(404).json(apiResponse(false, 'Shop not found'));
  }

  // Send notification to shop owner
  // TODO: Implement notification service call

  logSystem('shop_verification_updated', 'info', { 
    shopId: shop._id, 
    verified: isVerified,
    verifiedBy: req.user.id 
  });

  res.json(apiResponse(true, 'Shop verification updated successfully', shop));
});

// @desc    Get pending verifications
// @route   GET /api/admin/verifications
// @access  Private (Admin)
const getPendingVerifications = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const [pendingShops, pendingDeliveryPartners] = await Promise.all([
    Shop.find({ isVerified: false, isActive: true })
      .populate('ownerId', 'fullName email phone')
      .sort({ createdAt: -1 })
      .limit(10),
    User.find({ 
      role: 'delivery_partner', 
      isVerified: false, 
      isActive: true 
    })
      .select('-password -otp')
      .sort({ createdAt: -1 })
      .limit(10)
  ]);

  res.json(apiResponse(true, 'Pending verifications retrieved', {
    shops: pendingShops,
    deliveryPartners: pendingDeliveryPartners
  }));
});

// @desc    Get orders overview
// @route   GET /api/admin/orders
// @access  Private (Admin)
const getOrders = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const {
    page = 1,
    limit = 20,
    status,
    startDate,
    endDate
  } = req.query;

  const filter = {};
  
  if (status) filter.status = status;
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate('customerId', 'fullName email')
      .populate('shopId', 'name')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip),
    Order.countDocuments(filter)
  ]);

  const pagination = getPaginationMeta(page, limit, total);

  res.json(apiResponse(true, 'Orders retrieved successfully', orders, pagination));
});

// @desc    Get revenue analytics
// @route   GET /api/admin/analytics/revenue
// @access  Private (Admin)
const getRevenueAnalytics = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const { period = 'month' } = req.query;

  let matchStage = { status: 'delivered' };
  let groupStage;

  switch (period) {
    case 'day':
      groupStage = {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        },
        revenue: { $sum: '$pricing.total' },
        orders: { $sum: 1 }
      };
      break;
    case 'week':
      groupStage = {
        _id: {
          year: { $year: '$createdAt' },
          week: { $week: '$createdAt' }
        },
        revenue: { $sum: '$pricing.total' },
        orders: { $sum: 1 }
      };
      break;
    default: // month
      groupStage = {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        },
        revenue: { $sum: '$pricing.total' },
        orders: { $sum: 1 }
      };
  }

  const analytics = await Order.aggregate([
    { $match: matchStage },
    { $group: groupStage },
    { $sort: { '_id.year': -1, '_id.month': -1, '_id.day': -1 } },
    { $limit: 12 }
  ]);

  res.json(apiResponse(true, 'Revenue analytics retrieved', analytics));
});

// @desc    Update platform settings
// @route   PUT /api/admin/settings
// @access  Private (Admin)
const updateSettings = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  // TODO: Implement settings model and update logic
  const settings = req.body;

  logSystem('platform_settings_updated', 'info', { 
    updatedBy: req.user.id,
    settings: Object.keys(settings)
  });

  res.json(apiResponse(true, 'Settings updated successfully', settings));
});

module.exports = {
  getDashboardStats,
  getUsers,
  getUser,
  updateUserStatus,
  getShops,
  verifyShop,
  getPendingVerifications,
  getOrders,
  getRevenueAnalytics,
  updateSettings
};
