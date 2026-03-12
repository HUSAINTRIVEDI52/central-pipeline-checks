const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Recipient ID is required']
  },
  title: {
    type: String,
    required: [true, 'Notification title is required'],
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  message: {
    type: String,
    required: [true, 'Notification message is required'],
    maxlength: [500, 'Message cannot exceed 500 characters']
  },
  type: {
    type: String,
    enum: ['order_update', 'payment', 'delivery', 'promotion', 'system', 'reminder', 'alert'],
    required: [true, 'Notification type is required']
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  channels: {
    push: {
      sent: {
        type: Boolean,
        default: false
      },
      sentAt: Date,
      status: {
        type: String,
        enum: ['pending', 'sent', 'failed'],
        default: 'pending'
      },
      response: mongoose.Schema.Types.Mixed
    },
    email: {
      sent: {
        type: Boolean,
        default: false
      },
      sentAt: Date,
      status: {
        type: String,
        enum: ['pending', 'sent', 'failed'],
        default: 'pending'
      },
      response: mongoose.Schema.Types.Mixed
    },
    sms: {
      sent: {
        type: Boolean,
        default: false
      },
      sentAt: Date,
      status: {
        type: String,
        enum: ['pending', 'sent', 'failed'],
        default: 'pending'
      },
      response: mongoose.Schema.Types.Mixed
    }
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  relatedId: mongoose.Schema.Types.ObjectId, // Can reference Order, Payment, etc.
  relatedType: {
    type: String,
    enum: ['order', 'payment', 'shop', 'product', 'user']
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  actionRequired: {
    type: Boolean,
    default: false
  },
  actionTaken: {
    type: Boolean,
    default: false
  },
  actionTakenAt: Date,
  expiresAt: Date,
  scheduledFor: Date,
  attempts: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 3
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ priority: 1 });
notificationSchema.index({ isRead: 1 });
notificationSchema.index({ scheduledFor: 1 });
notificationSchema.index({ expiresAt: 1 });
notificationSchema.index({ relatedId: 1, relatedType: 1 });

// Virtual for whether notification is expired
notificationSchema.virtual('isExpired').get(function() {
  return this.expiresAt && new Date() > this.expiresAt;
});

// Virtual for whether notification should be sent now
notificationSchema.virtual('shouldSendNow').get(function() {
  if (this.isExpired) return false;
  if (!this.scheduledFor) return true;
  return new Date() >= this.scheduledFor;
});

// Method to mark as read
notificationSchema.methods.markAsRead = function() {
  if (!this.isRead) {
    this.isRead = true;
    this.readAt = new Date();
  }
  return this.save();
};

// Method to mark action as taken
notificationSchema.methods.markActionTaken = function() {
  if (this.actionRequired && !this.actionTaken) {
    this.actionTaken = true;
    this.actionTakenAt = new Date();
  }
  return this.save();
};

// Method to update channel status
notificationSchema.methods.updateChannelStatus = function(channel, status, response = null) {
  if (!['push', 'email', 'sms'].includes(channel)) {
    throw new Error('Invalid notification channel');
  }
  
  this.channels[channel].status = status;
  this.channels[channel].sent = status === 'sent';
  
  if (status === 'sent') {
    this.channels[channel].sentAt = new Date();
  }
  
  if (response) {
    this.channels[channel].response = response;
  }
  
  return this.save();
};

// Method to increment attempt count
notificationSchema.methods.incrementAttempt = function() {
  this.attempts += 1;
  return this.save();
};

// Method to check if can retry
notificationSchema.methods.canRetry = function() {
  return this.attempts < this.maxAttempts && !this.isExpired;
};

// Static method to create and send notification
notificationSchema.statics.createNotification = async function(notificationData) {
  const notification = new this(notificationData);
  await notification.save();
  
  // Trigger sending logic here (you would implement the actual sending)
  // This could involve FCM, email service, SMS service, etc.
  
  return notification;
};

// Static method to get unread notifications for user
notificationSchema.statics.getUnreadForUser = function(userId, limit = 20) {
  return this.find({
    recipientId: userId,
    isRead: false,
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } }
    ]
  })
  .sort({ createdAt: -1 })
  .limit(limit);
};

// Static method to get notifications by type
notificationSchema.statics.getByType = function(userId, type, limit = 50) {
  return this.find({
    recipientId: userId,
    type: type
  })
  .sort({ createdAt: -1 })
  .limit(limit);
};

// Static method to mark all as read for user
notificationSchema.statics.markAllAsReadForUser = function(userId) {
  return this.updateMany(
    { recipientId: userId, isRead: false },
    { 
      $set: { 
        isRead: true, 
        readAt: new Date() 
      } 
    }
  );
};

// Static method to cleanup expired notifications
notificationSchema.statics.cleanupExpired = function() {
  return this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
};

// Static method to get pending notifications to send
notificationSchema.statics.getPendingNotifications = function() {
  const now = new Date();
  return this.find({
    $or: [
      { 'channels.push.status': 'pending' },
      { 'channels.email.status': 'pending' },
      { 'channels.sms.status': 'pending' }
    ],
    attempts: { $lt: '$maxAttempts' },
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: now } }
    ],
    $or: [
      { scheduledFor: { $exists: false } },
      { scheduledFor: { $lte: now } }
    ]
  });
};

// Static method for notification analytics
notificationSchema.statics.getAnalytics = function(startDate, endDate, userId = null) {
  const matchStage = {
    createdAt: { $gte: startDate, $lte: endDate }
  };
  
  if (userId) {
    matchStage.recipientId = new mongoose.Types.ObjectId(userId);
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$type',
        total: { $sum: 1 },
        read: { $sum: { $cond: ['$isRead', 1, 0] } },
        pushSent: { $sum: { $cond: ['$channels.push.sent', 1, 0] } },
        emailSent: { $sum: { $cond: ['$channels.email.sent', 1, 0] } },
        smsSent: { $sum: { $cond: ['$channels.sms.sent', 1, 0] } }
      }
    },
    {
      $project: {
        type: '$_id',
        total: 1,
        read: 1,
        readRate: { $divide: ['$read', '$total'] },
        pushSent: 1,
        emailSent: 1,
        smsSent: 1
      }
    }
  ]);
};

module.exports = mongoose.model('Notification', notificationSchema);
