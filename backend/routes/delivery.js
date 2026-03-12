const express = require('express');
const DeliveryPartnerProfile = require('../models/DeliveryPartnerProfile');
const Order = require('../models/Order');
const User = require('../models/User');
const { authenticate, authorize, requireVerification } = require('../middleware/auth');
const { validateLocationUpdate, validateObjectIdParam, validatePagination } = require('../middleware/validation');
const { 
  findNearbyDeliveryPartners,
  assignDeliveryPartner,
  reassignDeliveryPartner,
  getOptimalRoute,
  updatePartnerLocation,
  getDeliveryAnalytics
} = require('../services/deliveryService');
const { upload, optimizeImage } = require('../middleware/upload');

const router = express.Router();

// @desc    Create delivery partner profile
// @route   POST /api/delivery/profile
// @access  Private (Delivery Partner)
const createDeliveryProfile = async (req, res) => {
  try {
    // Check if user is a delivery partner
    if (req.user.role !== 'delivery_partner') {
      return res.status(403).json({
        success: false,
        message: 'Only delivery partners can create delivery profiles'
      });
    }

    // Check if profile already exists
    const existingProfile = await DeliveryPartnerProfile.findOne({ userId: req.user._id });
    if (existingProfile) {
      return res.status(400).json({
        success: false,
        message: 'Delivery profile already exists'
      });
    }

    const profileData = {
      ...req.body,
      userId: req.user._id
    };

    const profile = new DeliveryPartnerProfile(profileData);
    await profile.save();

    await profile.populate('userId', 'fullName phone email');

    res.status(201).json({
      success: true,
      message: 'Delivery profile created successfully',
      profile
    });

  } catch (error) {
    console.error('Create delivery profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create delivery profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get delivery partner profile
// @route   GET /api/delivery/profile
// @access  Private (Delivery Partner)
const getDeliveryProfile = async (req, res) => {
  try {
    const profile = await DeliveryPartnerProfile.findOne({ userId: req.user._id })
      .populate('userId', 'fullName phone email profileImage');

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Delivery profile not found'
      });
    }

    // Get current active order if any
    let activeOrder = null;
    if (profile.currentTask && profile.currentTask.orderId) {
      activeOrder = await Order.findById(profile.currentTask.orderId)
        .populate('customerId', 'fullName phone')
        .populate('shopId', 'name address contact')
        .select('orderId status deliveryAddress pricing timeline');
    }

    res.json({
      success: true,
      profile: {
        ...profile.toObject(),
        activeOrder
      }
    });

  } catch (error) {
    console.error('Get delivery profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get delivery profile'
    });
  }
};

// @desc    Update delivery partner profile
// @route   PUT /api/delivery/profile
// @access  Private (Delivery Partner)
const updateDeliveryProfile = async (req, res) => {
  try {
    const profile = await DeliveryPartnerProfile.findOne({ userId: req.user._id });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Delivery profile not found'
      });
    }

    const allowedUpdates = [
      'vehicleType', 'vehicleDetails', 'workingHours', 'serviceAreas',
      'bankDetails', 'emergencyContact', 'preferences'
    ];

    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const updatedProfile = await DeliveryPartnerProfile.findByIdAndUpdate(
      profile._id,
      updates,
      { new: true, runValidators: true }
    ).populate('userId', 'fullName phone email');

    res.json({
      success: true,
      message: 'Profile updated successfully',
      profile: updatedProfile
    });

  } catch (error) {
    console.error('Update delivery profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

// @desc    Update delivery partner availability
// @route   PATCH /api/delivery/availability
// @access  Private (Delivery Partner)
const updateAvailability = async (req, res) => {
  try {
    const { status } = req.body;

    if (!['available', 'busy', 'offline'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid availability status'
      });
    }

    const profile = await DeliveryPartnerProfile.findOne({ userId: req.user._id });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Delivery profile not found'
      });
    }

    await profile.updateAvailability(status);

    res.json({
      success: true,
      message: 'Availability updated successfully',
      availabilityStatus: profile.availabilityStatus
    });

  } catch (error) {
    console.error('Update availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update availability'
    });
  }
};

// @desc    Update delivery partner location
// @route   POST /api/delivery/location
// @access  Private (Delivery Partner)
const updateLocation = async (req, res) => {
  try {
    const { latitude, longitude, accuracy } = req.body;

    const location = await updatePartnerLocation(
      req.user._id,
      latitude,
      longitude,
      accuracy
    );

    res.json({
      success: true,
      message: 'Location updated successfully',
      location
    });

  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update location'
    });
  }
};

// @desc    Get available delivery tasks
// @route   GET /api/delivery/tasks
// @access  Private (Delivery Partner)
const getAvailableTasks = async (req, res) => {
  try {
    const profile = await DeliveryPartnerProfile.findOne({ userId: req.user._id });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Delivery profile not found'
      });
    }

    if (!profile.isCurrentlyAvailable) {
      return res.json({
        success: true,
        tasks: [],
        message: 'You are not currently available for deliveries'
      });
    }

    // Find orders that need delivery partners
    const availableTasks = await Order.find({
      status: 'ready_for_pickup',
      deliveryPartnerId: null,
      'deliveryAddress.coordinates': {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [
              profile.currentLocation.longitude,
              profile.currentLocation.latitude
            ]
          },
          $maxDistance: profile.preferences.maxDeliveryDistance * 1000
        }
      }
    })
    .populate('customerId', 'fullName phone')
    .populate('shopId', 'name address contact')
    .limit(10)
    .sort({ createdAt: -1 });

    // Calculate distance for each task
    const tasksWithDistance = availableTasks.map(task => {
      const distance = profile.getDistanceFrom(
        task.deliveryAddress.coordinates.latitude,
        task.deliveryAddress.coordinates.longitude
      );

      return {
        ...task.toObject(),
        distance: Math.round(distance * 100) / 100,
        estimatedEarnings: task.pricing.deliveryFee
      };
    });

    res.json({
      success: true,
      tasks: tasksWithDistance
    });

  } catch (error) {
    console.error('Get available tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get available tasks'
    });
  }
};

// @desc    Accept delivery task
// @route   POST /api/delivery/tasks/:orderId/accept
// @access  Private (Delivery Partner)
const acceptDeliveryTask = async (req, res) => {
  try {
    const { orderId } = req.params;

    const profile = await DeliveryPartnerProfile.findOne({ userId: req.user._id });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Delivery profile not found'
      });
    }

    if (!profile.isCurrentlyAvailable) {
      return res.status(400).json({
        success: false,
        message: 'You are not available for deliveries'
      });
    }

    if (profile.currentTask && profile.currentTask.orderId) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active delivery task'
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.status !== 'ready_for_pickup') {
      return res.status(400).json({
        success: false,
        message: 'Order is not ready for pickup'
      });
    }

    if (order.deliveryPartnerId) {
      return res.status(400).json({
        success: false,
        message: 'Order already assigned to another delivery partner'
      });
    }

    // Accept the task
    await profile.acceptTask(orderId);
    
    // Update order
    order.deliveryPartnerId = req.user._id;
    order.updateStatus('out_for_delivery', 'Delivery partner assigned', req.user._id);
    await order.save();

    // Populate order details
    await order.populate('customerId shopId', 'fullName phone name address contact');

    // Emit real-time update
    const io = req.app.get('socketio');
    io.to(`order_${orderId}`).emit('status_update', {
      orderId,
      status: 'out_for_delivery',
      deliveryPartner: {
        id: req.user._id,
        name: req.user.fullName,
        phone: req.user.phone
      }
    });

    res.json({
      success: true,
      message: 'Delivery task accepted successfully',
      order
    });

  } catch (error) {
    console.error('Accept delivery task error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept delivery task'
    });
  }
};

// @desc    Update task status
// @route   PATCH /api/delivery/tasks/status
// @access  Private (Delivery Partner)
const updateTaskStatus = async (req, res) => {
  try {
    const { status, note } = req.body;

    const profile = await DeliveryPartnerProfile.findOne({ userId: req.user._id });

    if (!profile || !profile.currentTask || !profile.currentTask.orderId) {
      return res.status(400).json({
        success: false,
        message: 'No active delivery task found'
      });
    }

    const validStatuses = ['picked_up', 'in_transit', 'delivered'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task status'
      });
    }

    // Update profile task status
    await profile.updateTaskStatus(status);

    // Update order status
    const order = await Order.findById(profile.currentTask.orderId);
    if (order) {
      order.updateStatus('delivered', note || `Order ${status}`, req.user._id);
      await order.save();

      // Emit real-time update
      const io = req.app.get('socketio');
      io.to(`order_${order._id}`).emit('status_update', {
        orderId: order._id,
        status: 'delivered',
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      message: 'Task status updated successfully',
      status
    });

  } catch (error) {
    console.error('Update task status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update task status'
    });
  }
};

// @desc    Get delivery history
// @route   GET /api/delivery/history
// @access  Private (Delivery Partner)
const getDeliveryHistory = async (req, res) => {
  try {
    const {
      status,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;

    const filter = { deliveryPartnerId: req.user._id };

    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const deliveries = await Order.find(filter)
      .populate('customerId', 'fullName phone')
      .populate('shopId', 'name address')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(filter);

    res.json({
      success: true,
      data: {
        deliveries,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Get delivery history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get delivery history'
    });
  }
};

// @desc    Get delivery analytics
// @route   GET /api/delivery/analytics
// @access  Private (Delivery Partner)
const getPartnerAnalytics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const analytics = await getDeliveryAnalytics(req.user._id, start, end);

    res.json({
      success: true,
      analytics,
      dateRange: { start, end }
    });

  } catch (error) {
    console.error('Get partner analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get delivery analytics'
    });
  }
};

// @desc    Get optimal route
// @route   POST /api/delivery/route
// @access  Private (Delivery Partner)
const getDeliveryRoute = async (req, res) => {
  try {
    const { waypoints } = req.body;

    if (!Array.isArray(waypoints) || waypoints.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Waypoints array is required'
      });
    }

    const route = await getOptimalRoute(req.user._id, waypoints);

    res.json({
      success: true,
      route
    });

  } catch (error) {
    console.error('Get delivery route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get delivery route'
    });
  }
};

// @desc    Upload delivery documents
// @route   POST /api/delivery/documents
// @access  Private (Delivery Partner)
const uploadDeliveryDocuments = async (req, res) => {
  try {
    const profile = await DeliveryPartnerProfile.findOne({ userId: req.user._id });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Delivery profile not found'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No documents uploaded'
      });
    }

    const documents = req.files.map((file, index) => {
      const documentType = req.body.documentTypes ? req.body.documentTypes[index] : 'identity_proof';
      
      return {
        type: documentType,
        url: `/${file.path}`,
        uploadedAt: new Date(),
        verificationStatus: 'pending'
      };
    });

    profile.documents.push(...documents);
    await profile.save();

    res.json({
      success: true,
      message: 'Documents uploaded successfully',
      documents
    });

  } catch (error) {
    console.error('Upload delivery documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload documents'
    });
  }
};

// @desc    Get nearby delivery partners (Admin only)
// @route   GET /api/delivery/nearby
// @access  Private (Admin)
const getNearbyPartners = async (req, res) => {
  try {
    const { latitude, longitude, radius = 10 } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const partners = await findNearbyDeliveryPartners(
      parseFloat(latitude),
      parseFloat(longitude),
      parseFloat(radius)
    );

    res.json({
      success: true,
      partners,
      searchRadius: parseFloat(radius)
    });

  } catch (error) {
    console.error('Get nearby partners error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get nearby delivery partners'
    });
  }
};

// Apply middleware and routes
router.post('/profile', 
  authenticate, 
  authorize('delivery_partner'), 
  requireVerification,
  createDeliveryProfile
);

router.get('/profile', 
  authenticate, 
  authorize('delivery_partner'), 
  requireVerification,
  getDeliveryProfile
);

router.put('/profile', 
  authenticate, 
  authorize('delivery_partner'), 
  requireVerification,
  updateDeliveryProfile
);

router.patch('/availability', 
  authenticate, 
  authorize('delivery_partner'), 
  requireVerification,
  updateAvailability
);

router.post('/location', 
  authenticate, 
  authorize('delivery_partner'), 
  requireVerification,
  validateLocationUpdate,
  updateLocation
);

router.get('/tasks', 
  authenticate, 
  authorize('delivery_partner'), 
  requireVerification,
  getAvailableTasks
);

router.post('/tasks/:orderId/accept', 
  authenticate, 
  authorize('delivery_partner'), 
  requireVerification,
  validateObjectIdParam('orderId'),
  acceptDeliveryTask
);

router.patch('/tasks/status', 
  authenticate, 
  authorize('delivery_partner'), 
  requireVerification,
  updateTaskStatus
);

router.get('/history', 
  authenticate, 
  authorize('delivery_partner'), 
  requireVerification,
  validatePagination,
  getDeliveryHistory
);

router.get('/analytics', 
  authenticate, 
  authorize('delivery_partner'), 
  requireVerification,
  getPartnerAnalytics
);

router.post('/route', 
  authenticate, 
  authorize('delivery_partner'), 
  requireVerification,
  getDeliveryRoute
);

router.post('/documents', 
  authenticate, 
  authorize('delivery_partner'), 
  requireVerification,
  upload.array('documents', 5),
  uploadDeliveryDocuments
);

router.get('/nearby', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  getNearbyPartners
);

module.exports = router;
