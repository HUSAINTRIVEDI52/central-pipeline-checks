const express = require('express');
const Notification = require('../models/Notification');
const { authenticate, authorize, requireVerification } = require('../middleware/auth');
const { validateObjectIdParam, validatePagination } = require('../middleware/validation');
const { sendPushNotification, sendEmail } = require('../utils/notifications');

const router = express.Router();

// @desc    Get user notifications
// @route   GET /api/notifications
// @access  Private
const getUserNotifications = async (req, res) => {
  try {
    const {
      type,
      isRead,
      priority,
      page = 1,
      limit = 20
    } = req.query;

    const filter = { recipientId: req.user._id };

    if (type) filter.type = type;
    if (isRead !== undefined) filter.isRead = isRead === 'true';
    if (priority) filter.priority = priority;

    // Don't show expired notifications
    filter.$or = [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } }
    ];

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({
      recipientId: req.user._id,
      isRead: false,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } }
      ]
    });

    res.json({
      success: true,
      data: {
        notifications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        },
        unreadCount
      }
    });

  } catch (error) {
    console.error('Get user notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notifications'
    });
  }
};

// @desc    Get notification by ID
// @route   GET /api/notifications/:id
// @access  Private
const getNotificationById = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id)
      .populate('relatedId');

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Check if user owns this notification
    if (notification.recipientId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this notification'
      });
    }

    // Mark as read when viewed
    if (!notification.isRead) {
      await notification.markAsRead();
    }

    res.json({
      success: true,
      notification
    });

  } catch (error) {
    console.error('Get notification by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notification'
    });
  }
};

// @desc    Mark notification as read
// @route   PATCH /api/notifications/:id/read
// @access  Private
const markNotificationAsRead = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Check if user owns this notification
    if (notification.recipientId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this notification'
      });
    }

    await notification.markAsRead();

    res.json({
      success: true,
      message: 'Notification marked as read',
      notification
    });

  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
};

// @desc    Mark all notifications as read
// @route   PATCH /api/notifications/read-all
// @access  Private
const markAllNotificationsAsRead = async (req, res) => {
  try {
    const result = await Notification.markAllAsReadForUser(req.user._id);

    res.json({
      success: true,
      message: 'All notifications marked as read',
      modifiedCount: result.modifiedCount
    });

  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read'
    });
  }
};

// @desc    Mark action as taken
// @route   PATCH /api/notifications/:id/action
// @access  Private
const markActionTaken = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Check if user owns this notification
    if (notification.recipientId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this notification'
      });
    }

    if (!notification.actionRequired) {
      return res.status(400).json({
        success: false,
        message: 'This notification does not require action'
      });
    }

    await notification.markActionTaken();

    res.json({
      success: true,
      message: 'Action marked as taken',
      notification
    });

  } catch (error) {
    console.error('Mark action taken error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark action as taken'
    });
  }
};

// @desc    Delete notification
// @route   DELETE /api/notifications/:id
// @access  Private
const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Check if user owns this notification
    if (notification.recipientId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this notification'
      });
    }

    await Notification.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Notification deleted successfully'
    });

  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification'
    });
  }
};

// @desc    Create notification (Admin only)
// @route   POST /api/notifications
// @access  Private (Admin)
const createNotification = async (req, res) => {
  try {
    const {
      recipientId,
      title,
      message,
      type,
      priority = 'medium',
      channels = { push: { status: 'pending' } },
      data = {},
      relatedId,
      relatedType,
      actionRequired = false,
      expiresAt,
      scheduledFor
    } = req.body;

    const notification = await Notification.createNotification({
      recipientId,
      title,
      message,
      type,
      priority,
      channels,
      data,
      relatedId,
      relatedType,
      actionRequired,
      expiresAt,
      scheduledFor
    });

    res.status(201).json({
      success: true,
      message: 'Notification created successfully',
      notification
    });

  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create notification'
    });
  }
};

// @desc    Send bulk notification (Admin only)
// @route   POST /api/notifications/bulk
// @access  Private (Admin)
const sendBulkNotification = async (req, res) => {
  try {
    const {
      recipients, // Array of user IDs or 'all'
      title,
      message,
      type = 'system',
      priority = 'medium',
      channels = { push: { status: 'pending' } },
      data = {},
      criteria = {} // Filter criteria for selecting recipients
    } = req.body;

    let targetUsers = [];

    if (recipients === 'all') {
      // Send to all active users
      const User = require('../models/User');
      targetUsers = await User.find({ 
        isActive: true, 
        isVerified: true,
        ...criteria 
      }).select('_id fcmToken');
    } else if (Array.isArray(recipients)) {
      // Send to specific users
      const User = require('../models/User');
      targetUsers = await User.find({
        _id: { $in: recipients },
        isActive: true,
        isVerified: true
      }).select('_id fcmToken');
    } else {
      return res.status(400).json({
        success: false,
        message: 'Recipients must be "all" or an array of user IDs'
      });
    }

    if (targetUsers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid recipients found'
      });
    }

    // Create notifications for each user
    const notifications = [];
    for (const user of targetUsers) {
      const notification = await Notification.createNotification({
        recipientId: user._id,
        title,
        message,
        type,
        priority,
        channels,
        data,
        actionRequired: false
      });
      notifications.push(notification);
    }

    // Send push notifications if enabled
    if (channels.push && channels.push.status === 'pending') {
      try {
        const { sendBulkNotification } = require('../utils/notifications');
        await sendBulkNotification(targetUsers, { title, message, data });
      } catch (pushError) {
        console.error('Bulk push notification failed:', pushError);
      }
    }

    res.status(201).json({
      success: true,
      message: `Bulk notification sent to ${notifications.length} users`,
      sentCount: notifications.length,
      totalTargeted: targetUsers.length
    });

  } catch (error) {
    console.error('Send bulk notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send bulk notification'
    });
  }
};

// @desc    Get notification statistics
// @route   GET /api/notifications/stats
// @access  Private
const getNotificationStats = async (req, res) => {
  try {
    const stats = {
      total: 0,
      unread: 0,
      byType: {},
      byPriority: {},
      actionRequired: 0
    };

    // Get user's notification statistics
    const userStats = await Notification.aggregate([
      { 
        $match: { 
          recipientId: req.user._id,
          $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: { $gt: new Date() } }
          ]
        } 
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          unread: { $sum: { $cond: ['$isRead', 0, 1] } },
          actionRequired: { $sum: { $cond: ['$actionRequired', 1, 0] } }
        }
      }
    ]);

    if (userStats.length > 0) {
      stats.total = userStats[0].total;
      stats.unread = userStats[0].unread;
      stats.actionRequired = userStats[0].actionRequired;
    }

    // Get breakdown by type
    const typeStats = await Notification.aggregate([
      { 
        $match: { 
          recipientId: req.user._id,
          $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: { $gt: new Date() } }
          ]
        } 
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          unread: { $sum: { $cond: ['$isRead', 0, 1] } }
        }
      }
    ]);

    typeStats.forEach(stat => {
      stats.byType[stat._id] = {
        total: stat.count,
        unread: stat.unread
      };
    });

    // Get breakdown by priority
    const priorityStats = await Notification.aggregate([
      { 
        $match: { 
          recipientId: req.user._id,
          $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: { $gt: new Date() } }
          ]
        } 
      },
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 },
          unread: { $sum: { $cond: ['$isRead', 0, 1] } }
        }
      }
    ]);

    priorityStats.forEach(stat => {
      stats.byPriority[stat._id] = {
        total: stat.count,
        unread: stat.unread
      };
    });

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('Get notification stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notification statistics'
    });
  }
};

// @desc    Test notification (Admin only)
// @route   POST /api/notifications/test
// @access  Private (Admin)
const testNotification = async (req, res) => {
  try {
    const { userId, channel = 'push' } = req.body;

    const User = require('../models/User');
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    let result = {};

    switch (channel) {
      case 'push':
        if (user.fcmToken) {
          result = await sendPushNotification({
            token: user.fcmToken,
            title: 'Test Notification',
            message: 'This is a test push notification from LocalIt',
            data: { test: true }
          });
        } else {
          result = { success: false, error: 'User has no FCM token' };
        }
        break;

      case 'email':
        result = await sendEmail({
          to: user.email,
          subject: 'Test Email from LocalIt',
          html: '<p>This is a test email notification.</p>',
          text: 'This is a test email notification.'
        });
        break;


      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid notification channel'
        });
    }

    res.json({
      success: true,
      message: `Test ${channel} notification sent`,
      result
    });

  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test notification'
    });
  }
};

// Apply middleware and routes
router.get('/', 
  authenticate, 
  requireVerification,
  validatePagination,
  getUserNotifications
);

router.get('/stats', 
  authenticate, 
  requireVerification,
  getNotificationStats
);

router.post('/', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  createNotification
);

router.post('/bulk', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  sendBulkNotification
);

router.post('/test', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  testNotification
);

router.patch('/read-all', 
  authenticate, 
  requireVerification,
  markAllNotificationsAsRead
);

router.get('/:id', 
  authenticate, 
  requireVerification,
  validateObjectIdParam('id'),
  getNotificationById
);

router.patch('/:id/read', 
  authenticate, 
  requireVerification,
  validateObjectIdParam('id'),
  markNotificationAsRead
);

router.patch('/:id/action', 
  authenticate, 
  requireVerification,
  validateObjectIdParam('id'),
  markActionTaken
);

router.delete('/:id', 
  authenticate, 
  requireVerification,
  validateObjectIdParam('id'),
  deleteNotification
);

module.exports = router;
