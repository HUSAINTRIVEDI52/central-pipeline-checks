const User = require('../models/User');
const Order = require('../models/Order');
const DeliveryPartnerProfile = require('../models/DeliveryPartnerProfile');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiResponse, getPaginationMeta, calculateDistance } = require('../utils/helpers');
const { logDelivery } = require('../utils/logger');

// @desc    Get delivery partner profile
// @route   GET /api/delivery/profile
// @access  Private (Delivery Partner)
const getProfile = asyncHandler(async (req, res) => {
  if (req.user.role !== 'delivery_partner') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const user = await User.findById(req.user.id)
    .populate('deliveryPartnerProfile')
    .select('-password -otp');

  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  res.json(apiResponse(true, 'Profile retrieved successfully', user));
});

// @desc    Update delivery partner profile
// @route   PUT /api/delivery/profile
// @access  Private (Delivery Partner)
const updateProfile = asyncHandler(async (req, res) => {
  if (req.user.role !== 'delivery_partner') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const allowedUpdates = [
    'vehicleType',
    'vehicleNumber',
    'licenseNumber',
    'aadharNumber',
    'panNumber',
    'bankDetails',
    'emergencyContact',
    'workingHours'
  ];

  const updates = {};
  Object.keys(req.body).forEach(key => {
    if (allowedUpdates.includes(key)) {
      updates[key] = req.body[key];
    }
  });

  let profile = await DeliveryPartnerProfile.findOne({ userId: req.user.id });
  
  if (!profile) {
    profile = await DeliveryPartnerProfile.create({
      userId: req.user.id,
      ...updates
    });
  } else {
    profile = await DeliveryPartnerProfile.findOneAndUpdate(
      { userId: req.user.id },
      updates,
      { new: true, runValidators: true }
    );
  }

  res.json(apiResponse(true, 'Profile updated successfully', profile));
});

// @desc    Get available delivery tasks
// @route   GET /api/delivery/tasks
// @access  Private (Delivery Partner)
const getAvailableTasks = asyncHandler(async (req, res) => {
  if (req.user.role !== 'delivery_partner') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const { latitude, longitude, radius = 5 } = req.query;

  if (!latitude || !longitude) {
    return res.status(400).json(apiResponse(false, 'Location is required'));
  }

  // Find orders ready for pickup without assigned delivery partner
  const availableOrders = await Order.find({
    status: 'ready_for_pickup',
    deliveryPartnerId: null,
    'deliveryAddress.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        },
        $maxDistance: radius * 1000 // Convert km to meters
      }
    }
  })
    .populate('shopId', 'name address contact')
    .populate('customerId', 'fullName phone')
    .sort({ createdAt: 1 }) // First come, first served
    .limit(10);

  res.json(apiResponse(true, 'Available tasks retrieved', availableOrders));
});

// @desc    Accept delivery task
// @route   POST /api/delivery/tasks/:orderId/accept
// @access  Private (Delivery Partner)
const acceptTask = asyncHandler(async (req, res) => {
  if (req.user.role !== 'delivery_partner') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const order = await Order.findById(req.params.orderId);

  if (!order) {
    return res.status(404).json(apiResponse(false, 'Order not found'));
  }

  if (order.status !== 'ready_for_pickup') {
    return res.status(400).json(apiResponse(false, 'Order is not ready for pickup'));
  }

  if (order.deliveryPartnerId) {
    return res.status(400).json(apiResponse(false, 'Order already assigned to another partner'));
  }

  // Check if delivery partner is available
  const partner = await User.findById(req.user.id).populate('deliveryPartnerProfile');
  
  if (!partner.deliveryPartnerProfile?.isAvailable) {
    return res.status(400).json(apiResponse(false, 'You must be available to accept tasks'));
  }

  // Assign order to delivery partner
  order.deliveryPartnerId = req.user.id;
  order.status = 'out_for_delivery';
  order.statusHistory.push({
    status: 'out_for_delivery',
    timestamp: new Date(),
    updatedBy: req.user.id
  });

  await order.save();

  logDelivery('task_accepted', req.params.orderId, req.user.id);

  // TODO: Send notifications to customer and shop

  res.json(apiResponse(true, 'Task accepted successfully', order));
});

// @desc    Update delivery status
// @route   PATCH /api/delivery/tasks/:orderId/status
// @access  Private (Delivery Partner)
const updateDeliveryStatus = asyncHandler(async (req, res) => {
  if (req.user.role !== 'delivery_partner') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const { status, note, location } = req.body;
  
  const order = await Order.findById(req.params.orderId);

  if (!order) {
    return res.status(404).json(apiResponse(false, 'Order not found'));
  }

  if (order.deliveryPartnerId.toString() !== req.user.id) {
    return res.status(403).json(apiResponse(false, 'Not assigned to this order'));
  }

  const validStatuses = ['out_for_delivery', 'delivered'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json(apiResponse(false, 'Invalid status'));
  }

  order.status = status;
  order.statusHistory.push({
    status,
    note,
    timestamp: new Date(),
    updatedBy: req.user.id
  });

  if (status === 'delivered') {
    order.deliveredAt = new Date();
  }

  await order.save();

  // Update delivery partner location if provided
  if (location) {
    await User.findByIdAndUpdate(req.user.id, {
      'deliveryPartnerProfile.currentLocation': {
        type: 'Point',
        coordinates: [location.longitude, location.latitude]
      },
      'deliveryPartnerProfile.lastLocationUpdate': new Date()
    });
  }

  logDelivery('status_updated', req.params.orderId, req.user.id, { status, note });

  // TODO: Send real-time updates via socket

  res.json(apiResponse(true, 'Delivery status updated', order));
});

// @desc    Get delivery history
// @route   GET /api/delivery/history
// @access  Private (Delivery Partner)
const getDeliveryHistory = asyncHandler(async (req, res) => {
  if (req.user.role !== 'delivery_partner') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const {
    page = 1,
    limit = 20,
    status,
    startDate,
    endDate
  } = req.query;

  const filter = { deliveryPartnerId: req.user.id };
  
  if (status) filter.status = status;
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate('customerId', 'fullName phone')
      .populate('shopId', 'name address')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip),
    Order.countDocuments(filter)
  ]);

  const pagination = getPaginationMeta(page, limit, total);

  res.json(apiResponse(true, 'Delivery history retrieved', orders, pagination));
});

// @desc    Get delivery statistics
// @route   GET /api/delivery/stats
// @access  Private (Delivery Partner)
const getDeliveryStats = asyncHandler(async (req, res) => {
  if (req.user.role !== 'delivery_partner') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const { period = 'month' } = req.query;
  
  let matchDate = {};
  const now = new Date();
  
  switch (period) {
    case 'today':
      matchDate = {
        $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        $lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      };
      break;
    case 'week':
      const weekStart = new Date(now.setDate(now.getDate() - now.getDay()));
      matchDate = { $gte: weekStart };
      break;
    case 'month':
      matchDate = {
        $gte: new Date(now.getFullYear(), now.getMonth(), 1),
        $lt: new Date(now.getFullYear(), now.getMonth() + 1, 1)
      };
      break;
  }

  const [
    totalDeliveries,
    completedDeliveries,
    totalEarnings,
    avgRating
  ] = await Promise.all([
    Order.countDocuments({
      deliveryPartnerId: req.user.id,
      createdAt: matchDate
    }),
    Order.countDocuments({
      deliveryPartnerId: req.user.id,
      status: 'delivered',
      createdAt: matchDate
    }),
    Order.aggregate([
      {
        $match: {
          deliveryPartnerId: req.user.id,
          status: 'delivered',
          createdAt: matchDate
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$deliveryFee' } // Assuming delivery fee goes to partner
        }
      }
    ]),
    Order.aggregate([
      {
        $match: {
          deliveryPartnerId: req.user.id,
          status: 'delivered',
          'rating.rating': { $exists: true }
        }
      },
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$rating.rating' }
        }
      }
    ])
  ]);

  const stats = {
    totalDeliveries,
    completedDeliveries,
    totalEarnings: totalEarnings[0]?.total || 0,
    avgRating: avgRating[0]?.avgRating || 0,
    completionRate: totalDeliveries > 0 ? (completedDeliveries / totalDeliveries * 100) : 0
  };

  res.json(apiResponse(true, 'Delivery statistics retrieved', stats));
});

// @desc    Update availability status
// @route   PATCH /api/delivery/availability
// @access  Private (Delivery Partner)
const updateAvailability = asyncHandler(async (req, res) => {
  if (req.user.role !== 'delivery_partner') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const { isAvailable } = req.body;

  const user = await User.findByIdAndUpdate(
    req.user.id,
    {
      'deliveryPartnerProfile.isAvailable': isAvailable,
      'deliveryPartnerProfile.lastActive': new Date()
    },
    { new: true }
  ).populate('deliveryPartnerProfile');

  logDelivery('availability_updated', null, req.user.id, { isAvailable });

  res.json(apiResponse(true, 'Availability updated', {
    isAvailable: user.deliveryPartnerProfile.isAvailable
  }));
});

// @desc    Update current location
// @route   PATCH /api/delivery/location
// @access  Private (Delivery Partner)
const updateLocation = asyncHandler(async (req, res) => {
  if (req.user.role !== 'delivery_partner') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json(apiResponse(false, 'Invalid location data'));
  }

  await User.findByIdAndUpdate(req.user.id, {
    'deliveryPartnerProfile.currentLocation': {
      type: 'Point',
      coordinates: [longitude, latitude]
    },
    'deliveryPartnerProfile.lastLocationUpdate': new Date()
  });

  // TODO: Emit location update via socket for real-time tracking

  res.json(apiResponse(true, 'Location updated successfully'));
});

module.exports = {
  getProfile,
  updateProfile,
  getAvailableTasks,
  acceptTask,
  updateDeliveryStatus,
  getDeliveryHistory,
  getDeliveryStats,
  updateAvailability,
  updateLocation
};
