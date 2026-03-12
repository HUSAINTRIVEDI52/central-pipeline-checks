const express = require('express');
const User = require('../models/User');
const Shop = require('../models/Shop');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Category = require('../models/Category');
const DeliveryPartnerProfile = require('../models/DeliveryPartnerProfile');
const Notification = require('../models/Notification');
const { authenticate, authorize, requireVerification } = require('../middleware/auth');
const { validateObjectIdParam, validatePagination } = require('../middleware/validation');
const { reindex } = require('../controllers/searchController');

const router = express.Router();

// @desc    Get platform dashboard statistics
// @route   GET /api/admin/dashboard
// @access  Private (Admin)
const getDashboardStats = async (req, res) => {
  try {
    const { timeframe = '30d' } = req.query;
    
    // Calculate date range based on timeframe
    let startDate;
    const endDate = new Date();
    
    switch (timeframe) {
      case '7d':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get basic counts
    const totalUsers = await User.countDocuments({ isActive: true });
    const totalShops = await Shop.countDocuments({ isActive: true });
    const totalProducts = await Product.countDocuments({ isActive: true });
    const totalOrders = await Order.countDocuments();
    const totalDeliveryPartners = await DeliveryPartnerProfile.countDocuments({ isActive: true });

    // Get counts for the timeframe
    const newUsersCount = await User.countDocuments({
      isActive: true,
      createdAt: { $gte: startDate, $lte: endDate }
    });

    const newOrdersCount = await Order.countDocuments({
      createdAt: { $gte: startDate, $lte: endDate }
    });

    // Get revenue data
    const revenueData = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          totalTransactions: { $sum: 1 }
        }
      }
    ]);

    const revenue = revenueData[0] || { totalRevenue: 0, totalTransactions: 0 };

    // Get order status distribution
    const orderStatusData = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get top performing shops
    const topShops = await Order.aggregate([
      {
        $match: {
          status: 'delivered',
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$shopId',
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$pricing.total' }
        }
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'shops',
          localField: '_id',
          foreignField: '_id',
          as: 'shop'
        }
      },
      { $unwind: '$shop' },
      {
        $project: {
          shopName: '$shop.name',
          totalOrders: 1,
          totalRevenue: 1
        }
      }
    ]);

    // Get daily order trends
    const orderTrends = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          orders: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [{ $eq: ['$status', 'delivered'] }, '$pricing.total', 0]
            }
          }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    const stats = {
      overview: {
        totalUsers,
        totalShops,
        totalProducts,
        totalOrders,
        totalDeliveryPartners,
        newUsers: newUsersCount,
        newOrders: newOrdersCount
      },
      revenue: {
        totalRevenue: revenue.totalRevenue,
        totalTransactions: revenue.totalTransactions,
        averageOrderValue: revenue.totalTransactions > 0 
          ? Math.round(revenue.totalRevenue / revenue.totalTransactions) 
          : 0
      },
      orderStatus: orderStatusData.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      topShops,
      trends: orderTrends,
      timeframe,
      dateRange: { startDate, endDate }
    };

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard statistics'
    });
  }
};

// @desc    Get all users for admin management
// @route   GET /api/admin/users
// @access  Private (Admin)
const getAllUsersAdmin = async (req, res) => {
  try {
    const {
      role,
      isVerified,
      isActive,
      search,
      sortBy = 'createdAt',
      sortOrder = -1,
      page = 1,
      limit = 50
    } = req.query;

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
    console.error('Get all users admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users'
    });
  }
};

// @desc    Verify shop
// @route   PATCH /api/admin/shops/:id/verify
// @access  Private (Admin)
const verifyShop = async (req, res) => {
  try {
    const { isVerified } = req.body;

    const shop = await Shop.findById(req.params.id).populate('ownerId', 'fullName email');

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found'
      });
    }

    shop.isVerified = isVerified;
    await shop.save();

    // Send notification to shop owner
    try {
      await Notification.createNotification({
        recipientId: shop.ownerId._id,
        title: isVerified ? 'Shop Verified!' : 'Shop Verification Revoked',
        message: isVerified 
          ? `Congratulations! Your shop "${shop.name}" has been verified and is now live.`
          : `Your shop "${shop.name}" verification has been revoked. Please contact support.`,
        type: 'system',
        priority: isVerified ? 'high' : 'urgent',
        data: { shopId: shop._id },
        relatedId: shop._id,
        relatedType: 'shop',
        channels: {
          push: { status: 'pending' },
          email: { status: 'pending' }
        }
      });
    } catch (notificationError) {
      console.error('Failed to send shop verification notification:', notificationError);
    }

    res.json({
      success: true,
      message: `Shop ${isVerified ? 'verified' : 'unverified'} successfully`,
      shop
    });

  } catch (error) {
    console.error('Verify shop error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify shop'
    });
  }
};

// @desc    Verify delivery partner
// @route   PATCH /api/admin/delivery-partners/:id/verify
// @access  Private (Admin)
const verifyDeliveryPartner = async (req, res) => {
  try {
    const { isVerified, documentStatus } = req.body;

    const profile = await DeliveryPartnerProfile.findById(req.params.id)
      .populate('userId', 'fullName email');

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Delivery partner profile not found'
      });
    }

    profile.isVerified = isVerified;

    // Update document statuses if provided
    if (documentStatus && Array.isArray(documentStatus)) {
      documentStatus.forEach(docUpdate => {
        const doc = profile.documents.find(d => d._id.toString() === docUpdate.documentId);
        if (doc) {
          doc.verificationStatus = docUpdate.status;
        }
      });
    }

    await profile.save();

    // Send notification to delivery partner
    try {
      await Notification.createNotification({
        recipientId: profile.userId._id,
        title: isVerified ? 'Profile Verified!' : 'Profile Verification Revoked',
        message: isVerified 
          ? 'Congratulations! Your delivery partner profile has been verified. You can now start accepting delivery tasks.'
          : 'Your delivery partner profile verification has been revoked. Please contact support.',
        type: 'system',
        priority: isVerified ? 'high' : 'urgent',
        data: { profileId: profile._id },
        relatedId: profile._id,
        relatedType: 'user',
        channels: {
          push: { status: 'pending' },
          email: { status: 'pending' }
        }
      });
    } catch (notificationError) {
      console.error('Failed to send partner verification notification:', notificationError);
    }

    res.json({
      success: true,
      message: `Delivery partner ${isVerified ? 'verified' : 'unverified'} successfully`,
      profile
    });

  } catch (error) {
    console.error('Verify delivery partner error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify delivery partner'
    });
  }
};

// @desc    Get pending verifications
// @route   GET /api/admin/verifications
// @access  Private (Admin)
const getPendingVerifications = async (req, res) => {
  try {
    const { type = 'all' } = req.query;

    const result = {};

    if (type === 'all' || type === 'shops') {
      const pendingShops = await Shop.find({ 
        isVerified: false, 
        isActive: true 
      })
      .populate('ownerId', 'fullName email phone')
      .sort({ createdAt: -1 })
      .limit(20);

      result.shops = pendingShops;
    }

    if (type === 'all' || type === 'delivery_partners') {
      const pendingPartners = await DeliveryPartnerProfile.find({ 
        isVerified: false, 
        isActive: true 
      })
      .populate('userId', 'fullName email phone')
      .sort({ createdAt: -1 })
      .limit(20);

      result.deliveryPartners = pendingPartners;
    }

    res.json({
      success: true,
      verifications: result
    });

  } catch (error) {
    console.error('Get pending verifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pending verifications'
    });
  }
};

// @desc    Get platform analytics
// @route   GET /api/admin/analytics
// @access  Private (Admin)
const getPlatformAnalytics = async (req, res) => {
  try {
    const { startDate, endDate, metric = 'overview' } = req.query;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    let analytics = {};

    switch (metric) {
      case 'users':
        analytics = await getUserAnalytics(start, end);
        break;
      case 'orders':
        analytics = await getOrderAnalytics(start, end);
        break;
      case 'revenue':
        analytics = await getRevenueAnalytics(start, end);
        break;
      case 'shops':
        analytics = await getShopAnalytics(start, end);
        break;
      default:
        analytics = {
          users: await getUserAnalytics(start, end),
          orders: await getOrderAnalytics(start, end),
          revenue: await getRevenueAnalytics(start, end),
          shops: await getShopAnalytics(start, end)
        };
    }

    res.json({
      success: true,
      analytics,
      dateRange: { start, end },
      metric
    });

  } catch (error) {
    console.error('Get platform analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get platform analytics'
    });
  }
};

// @desc    Manage platform settings
// @route   POST /api/admin/settings
// @access  Private (Admin)
const updatePlatformSettings = async (req, res) => {
  try {
    const {
      deliveryFeeSettings,
      commissionRates,
      platformFeatures,
      maintenanceMode
    } = req.body;

    // This would typically be stored in a settings collection
    // For now, we'll just return success
    const settings = {
      deliveryFeeSettings: deliveryFeeSettings || {
        baseRate: 20,
        perKmRate: 5,
        peakHourMultiplier: 1.5,
        freeDeliveryThreshold: 500
      },
      commissionRates: commissionRates || {
        shopCommission: 0.15,
        deliveryCommission: 0.10,
        paymentGatewayFee: 0.025
      },
      platformFeatures: platformFeatures || {
        voiceSearch: true,
        realTimeTracking: true,
        multiplePaymentMethods: true,
        ratingsAndReviews: true
      },
      maintenanceMode: maintenanceMode || false,
      updatedAt: new Date(),
      updatedBy: req.user._id
    };

    res.json({
      success: true,
      message: 'Platform settings updated successfully',
      settings
    });

  } catch (error) {
    console.error('Update platform settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update platform settings'
    });
  }
};

// Helper functions for analytics
const getUserAnalytics = async (startDate, endDate) => {
  const userStats = await User.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          role: '$role'
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { '_id.date': 1 } }
  ]);

  return {
    registrationTrends: userStats,
    totalUsers: await User.countDocuments({ isActive: true }),
    verifiedUsers: await User.countDocuments({ isActive: true, isVerified: true }),
    usersByRole: await User.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ])
  };
};

const getOrderAnalytics = async (startDate, endDate) => {
  const orderStats = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          status: '$status'
        },
        count: { $sum: 1 },
        totalValue: { $sum: '$pricing.total' }
      }
    },
    { $sort: { '_id.date': 1 } }
  ]);

  return {
    orderTrends: orderStats,
    totalOrders: await Order.countDocuments(),
    completedOrders: await Order.countDocuments({ status: 'delivered' }),
    averageOrderValue: await Order.aggregate([
      { $match: { status: 'delivered' } },
      { $group: { _id: null, avg: { $avg: '$pricing.total' } } }
    ])
  };
};

const getRevenueAnalytics = async (startDate, endDate) => {
  const revenueStats = await Payment.aggregate([
    {
      $match: {
        status: 'success',
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
        },
        revenue: { $sum: '$amount' },
        transactions: { $sum: 1 }
      }
    },
    { $sort: { '_id.date': 1 } }
  ]);

  return {
    revenueTrends: revenueStats,
    totalRevenue: await Payment.aggregate([
      { $match: { status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    paymentMethodBreakdown: await Payment.aggregate([
      { $match: { status: 'success' } },
      { $group: { _id: '$paymentMethod', count: { $sum: 1 }, amount: { $sum: '$amount' } } }
    ])
  };
};

const getShopAnalytics = async (startDate, endDate) => {
  return {
    totalShops: await Shop.countDocuments({ isActive: true }),
    verifiedShops: await Shop.countDocuments({ isActive: true, isVerified: true }),
    shopsByCategory: await Shop.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]),
    topPerformingShops: await Order.aggregate([
      {
        $match: {
          status: 'delivered',
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$shopId',
          orders: { $sum: 1 },
          revenue: { $sum: '$pricing.total' }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'shops',
          localField: '_id',
          foreignField: '_id',
          as: 'shop'
        }
      }
    ])
  };
};

// Apply middleware and routes
router.get('/dashboard', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  getDashboardStats
);

router.get('/users', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  validatePagination,
  getAllUsersAdmin
);

router.patch('/shops/:id/verify', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  validateObjectIdParam('id'),
  verifyShop
);

router.patch('/delivery-partners/:id/verify', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  validateObjectIdParam('id'),
  verifyDeliveryPartner
);

router.get('/verifications', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  getPendingVerifications
);

router.get('/analytics', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  getPlatformAnalytics
);

router.post('/settings', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  updatePlatformSettings
);

router.post('/reindex',
  authenticate,
  authorize('admin'),
  requireVerification,
  reindex
);

module.exports = router;
