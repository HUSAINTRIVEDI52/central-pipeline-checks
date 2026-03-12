const Notification = require('../models/Notification');
const notificationService = require('../services/notificationService');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiResponse, getPaginationMeta } = require('../utils/helpers');

// @desc    Get user notifications
// @route   GET /api/notifications
// @access  Private
const getNotifications = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    type,
    isRead,
    priority
  } = req.query;

  const result = await notificationService.getUserNotifications(req.user.id, {
    page: parseInt(page),
    limit: parseInt(limit),
    type,
    isRead: isRead === 'true' ? true : isRead === 'false' ? false : undefined,
    priority
  });

  res.json(apiResponse(true, 'Notifications retrieved successfully', result.notifications, result.pagination));
});

// @desc    Mark notification as read
// @route   PATCH /api/notifications/:id/read
// @access  Private
const markAsRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markAsRead(req.params.id, req.user.id);
  
  res.json(apiResponse(true, 'Notification marked as read', notification));
});

// @desc    Mark all notifications as read
// @route   PATCH /api/notifications/mark-all-read
// @access  Private
const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { recipientId: req.user.id, isRead: false },
    { isRead: true, readAt: new Date() }
  );

  res.json(apiResponse(true, 'All notifications marked as read'));
});

// @desc    Delete notification
// @route   DELETE /api/notifications/:id
// @access  Private
const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndDelete({
    _id: req.params.id,
    recipientId: req.user.id
  });

  if (!notification) {
    return res.status(404).json(apiResponse(false, 'Notification not found'));
  }

  res.json(apiResponse(true, 'Notification deleted successfully'));
});

// @desc    Clear all notifications
// @route   DELETE /api/notifications/clear
// @access  Private
const clearAllNotifications = asyncHandler(async (req, res) => {
  await Notification.deleteMany({ recipientId: req.user.id });

  res.json(apiResponse(true, 'All notifications cleared'));
});

// @desc    Get notification counts
// @route   GET /api/notifications/counts
// @access  Private
const getNotificationCounts = asyncHandler(async (req, res) => {
  const [total, unread] = await Promise.all([
    Notification.countDocuments({ recipientId: req.user.id }),
    Notification.countDocuments({ recipientId: req.user.id, isRead: false })
  ]);

  res.json(apiResponse(true, 'Notification counts retrieved', {
    total,
    unread,
    read: total - unread
  }));
});

// @desc    Send notification (Admin only)
// @route   POST /api/notifications/send
// @access  Private (Admin)
const sendNotification = asyncHandler(async (req, res) => {
  const {
    recipientIds,
    title,
    message,
    type = 'system',
    priority = 'medium',
    data = {}
  } = req.body;

  if (req.user.role !== 'admin') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const notificationData = {
    title,
    message,
    type,
    priority,
    data,
    channels: {
      push: { status: 'pending' },
      email: { status: 'pending' }
    }
  };

  const results = await notificationService.sendBulkNotification(recipientIds, notificationData);

  res.json(apiResponse(true, 'Notifications sent', results));
});

// @desc    Send promotional notification
// @route   POST /api/notifications/promotional
// @access  Private (Admin)
const sendPromotionalNotification = asyncHandler(async (req, res) => {
  const {
    title,
    message,
    couponCode,
    validUntil,
    targetUsers = [],
    location
  } = req.body;

  if (req.user.role !== 'admin') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const promotion = {
    _id: 'promo_' + Date.now(),
    title,
    description: message,
    couponCode,
    validUntil
  };

  let results;
  
  if (location) {
    // Send to users in specific location
    results = await notificationService.sendLocationBasedNotification(
      location.coordinates,
      location.radius,
      {
        title,
        message,
        type: 'promotion',
        priority: 'medium',
        data: promotion
      }
    );
  } else if (targetUsers.length > 0) {
    // Send to specific users
    results = await notificationService.sendPromotionalNotification(targetUsers, promotion);
  } else {
    return res.status(400).json(apiResponse(false, 'Target users or location required'));
  }

  res.json(apiResponse(true, 'Promotional notification sent', results));
});

// @desc    Update notification preferences
// @route   PUT /api/notifications/preferences
// @access  Private
const updatePreferences = asyncHandler(async (req, res) => {
  const User = require('../models/User');
  
  const user = await User.findById(req.user.id);
  
  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  user.notificationPreferences = {
    ...user.notificationPreferences,
    ...req.body
  };

  await user.save();

  res.json(apiResponse(true, 'Notification preferences updated', user.notificationPreferences));
});

// @desc    Get notification preferences
// @route   GET /api/notifications/preferences
// @access  Private
const getPreferences = asyncHandler(async (req, res) => {
  const User = require('../models/User');
  
  const user = await User.findById(req.user.id).select('notificationPreferences');
  
  if (!user) {
    return res.status(404).json(apiResponse(false, 'User not found'));
  }

  res.json(apiResponse(true, 'Notification preferences retrieved', user.notificationPreferences));
});

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications,
  getNotificationCounts,
  sendNotification,
  sendPromotionalNotification,
  updatePreferences,
  getPreferences
};
