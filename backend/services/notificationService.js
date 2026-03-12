const admin = require('firebase-admin');
const Notification = require('../models/Notification');
const { sendSMS } = require('./smsService');
const { sendEmail } = require('./emailService');

class NotificationService {
  constructor() {
    // Initialize Firebase Admin if not already done
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        })
      });
    }
  }

  async createNotification(notificationData) {
    try {
      const notification = new Notification(notificationData);
      await notification.save();

      // Send notifications through different channels
      const promises = [];

      if (notificationData.channels?.push?.status === 'pending') {
        promises.push(this.sendPushNotification(notification));
      }

      if (notificationData.channels?.email?.status === 'pending') {
        promises.push(this.sendEmailNotification(notification));
      }

      if (notificationData.channels?.sms?.status === 'pending') {
        promises.push(this.sendSMSNotification(notification));
      }

      // Execute all notifications in parallel
      await Promise.allSettled(promises);

      return notification;
    } catch (error) {
      console.error('Failed to create notification:', error);
      throw error;
    }
  }

  async sendPushNotification(notification) {
    try {
      // Get user's FCM tokens
      const User = require('../models/User');
      const user = await User.findById(notification.recipientId);
      
      if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
        throw new Error('No FCM tokens found for user');
      }

      const payload = {
        notification: {
          title: notification.title,
          body: notification.message,
          icon: '/icon-192x192.png',
          badge: '/icon-72x72.png',
          sound: 'default'
        },
        data: {
          notificationId: notification._id.toString(),
          type: notification.type,
          priority: notification.priority,
          ...(notification.data || {})
        }
      };

      // Add action buttons based on notification type
      if (notification.type === 'order_update') {
        payload.notification.actions = [
          { action: 'track', title: 'Track Order' },
          { action: 'view', title: 'View Details' }
        ];
      }

      const results = await admin.messaging().sendToDevice(user.fcmTokens, payload, {
        priority: notification.priority === 'urgent' ? 'high' : 'normal',
        timeToLive: 24 * 60 * 60, // 24 hours
        collapseKey: notification.type
      });

      // Update notification status
      notification.channels.push.status = 'sent';
      notification.channels.push.sentAt = new Date();
      notification.channels.push.messageId = results.results[0]?.messageId;

      // Handle failed tokens
      const failedTokens = [];
      results.results.forEach((result, index) => {
        if (result.error) {
          failedTokens.push(user.fcmTokens[index]);
        }
      });

      // Remove failed tokens from user
      if (failedTokens.length > 0) {
        user.fcmTokens = user.fcmTokens.filter(token => !failedTokens.includes(token));
        await user.save();
      }

      await notification.save();
      return results;

    } catch (error) {
      console.error('Push notification failed:', error);
      
      // Update notification status
      notification.channels.push.status = 'failed';
      notification.channels.push.error = error.message;
      await notification.save();
      
      throw error;
    }
  }

  async sendEmailNotification(notification) {
    try {
      const User = require('../models/User');
      const user = await User.findById(notification.recipientId);
      
      if (!user || !user.email) {
        throw new Error('User email not found');
      }

      // Generate email content based on notification type
      const emailContent = this.generateEmailContent(notification, user);

      await sendEmail({
        to: user.email,
        subject: notification.title,
        html: emailContent
      });

      // Update notification status
      notification.channels.email.status = 'sent';
      notification.channels.email.sentAt = new Date();
      await notification.save();

    } catch (error) {
      console.error('Email notification failed:', error);
      
      notification.channels.email.status = 'failed';
      notification.channels.email.error = error.message;
      await notification.save();
      
      throw error;
    }
  }

  async sendSMSNotification(notification) {
    try {
      const User = require('../models/User');
      const user = await User.findById(notification.recipientId);
      
      if (!user || !user.phone) {
        throw new Error('User phone not found');
      }

      // Generate SMS content
      const smsContent = this.generateSMSContent(notification);

      const result = await sendSMS(user.phone, smsContent);

      // Update notification status
      notification.channels.sms.status = 'sent';
      notification.channels.sms.sentAt = new Date();
      notification.channels.sms.messageId = result.sid;
      await notification.save();

    } catch (error) {
      console.error('SMS notification failed:', error);
      
      notification.channels.sms.status = 'failed';
      notification.channels.sms.error = error.message;
      await notification.save();
      
      throw error;
    }
  }

  generateEmailContent(notification, user) {
    const baseTemplate = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #4CAF50; color: white; padding: 20px; text-align: center;">
          <h1>LocalIt</h1>
        </div>
        <div style="padding: 20px;">
          <h2>${notification.title}</h2>
          <p>Hello ${user.fullName},</p>
          <p>${notification.message}</p>
          {{CONTENT}}
        </div>
        <div style="background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666;">
          <p>This is an automated message from LocalIt. Please do not reply to this email.</p>
        </div>
      </div>
    `;

    let specificContent = '';

    switch (notification.type) {
      case 'order_update':
        specificContent = `
          <div style="background: #f9f9f9; padding: 15px; margin: 15px 0; border-radius: 5px;">
            <h3>Order Details</h3>
            <p><strong>Order ID:</strong> ${notification.data?.orderId || 'N/A'}</p>
            <p><strong>Status:</strong> ${notification.data?.status || 'Updated'}</p>
          </div>
          <div style="text-align: center; margin: 20px 0;">
            <a href="${process.env.FRONTEND_URL}/orders/${notification.data?.orderId}" 
               style="background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
               Track Order
            </a>
          </div>
        `;
        break;

      case 'promotion':
        specificContent = `
          <div style="background: #e8f5e8; padding: 15px; margin: 15px 0; border-radius: 5px; border: 2px solid #4CAF50;">
            ${notification.data?.couponCode ? 
              `<h3 style="text-align: center; color: #4CAF50;">Use Code: ${notification.data.couponCode}</h3>` : ''
            }
          </div>
          <div style="text-align: center; margin: 20px 0;">
            <a href="${process.env.FRONTEND_URL}/shops" 
               style="background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
               Shop Now
            </a>
          </div>
        `;
        break;

      default:
        specificContent = `
          <div style="text-align: center; margin: 20px 0;">
            <a href="${process.env.FRONTEND_URL}" 
               style="background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
               Open LocalIt
            </a>
          </div>
        `;
    }

    return baseTemplate.replace('{{CONTENT}}', specificContent);
  }

  generateSMSContent(notification) {
    let content = `LocalIt: ${notification.message}`;

    if (notification.type === 'order_update' && notification.data?.orderId) {
      content = `LocalIt Order ${notification.data.orderId}: ${notification.message}`;
    }

    // Keep SMS under 160 characters for single message
    if (content.length > 160) {
      content = content.substring(0, 157) + '...';
    }

    return content;
  }

  // Send notification to multiple users
  async sendBulkNotification(recipientIds, notificationData) {
    const results = [];

    for (const recipientId of recipientIds) {
      try {
        const notification = await this.createNotification({
          ...notificationData,
          recipientId
        });
        results.push({ recipientId, success: true, notificationId: notification._id });
      } catch (error) {
        results.push({ recipientId, success: false, error: error.message });
      }
    }

    return results;
  }

  // Send notification to users in a specific area
  async sendLocationBasedNotification(coordinates, radius, notificationData) {
    const User = require('../models/User');
    
    const users = await User.find({
      'addresses.coordinates': {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [coordinates.longitude, coordinates.latitude]
          },
          $maxDistance: radius * 1000 // Convert km to meters
        }
      },
      isActive: true
    });

    const recipientIds = users.map(user => user._id);
    return await this.sendBulkNotification(recipientIds, notificationData);
  }

  // Send notification to users with specific role
  async sendRoleBasedNotification(role, notificationData) {
    const User = require('../models/User');
    
    const users = await User.find({ role, isActive: true }).select('_id');
    const recipientIds = users.map(user => user._id);
    
    return await this.sendBulkNotification(recipientIds, notificationData);
  }

  // Order-related notifications
  async notifyOrderCreated(order) {
    const notifications = [];

    // Notify customer
    notifications.push(this.createNotification({
      recipientId: order.customerId,
      title: 'Order Placed Successfully!',
      message: `Your order #${order.orderId} has been placed and sent to ${order.shopName}.`,
      type: 'order_update',
      priority: 'high',
      data: { orderId: order.orderId, status: 'pending' },
      relatedId: order._id,
      relatedType: 'order',
      channels: {
        push: { status: 'pending' },
        email: { status: 'pending' },
        sms: { status: 'pending' }
      }
    }));

    // Notify shop owner
    const Shop = require('../models/Shop');
    const shop = await Shop.findById(order.shopId).populate('ownerId');
    
    if (shop && shop.ownerId) {
      notifications.push(this.createNotification({
        recipientId: shop.ownerId._id,
        title: 'New Order Received!',
        message: `New order #${order.orderId} from ${order.customerName}. Please review and accept.`,
        type: 'new_order',
        priority: 'urgent',
        data: { orderId: order.orderId },
        relatedId: order._id,
        relatedType: 'order',
        channels: {
          push: { status: 'pending' },
          sms: { status: 'pending' }
        }
      }));
    }

    return await Promise.allSettled(notifications);
  }

  async notifyOrderStatusChange(order, newStatus, note) {
    const statusMessages = {
      confirmed: 'has been confirmed and is being prepared',
      preparing: 'is being prepared by the shop',
      ready_for_pickup: 'is ready for pickup',
      out_for_delivery: 'is out for delivery',
      delivered: 'has been delivered successfully',
      cancelled: 'has been cancelled'
    };

    const message = `Your order #${order.orderId} ${statusMessages[newStatus] || 'has been updated'}.`;

    return await this.createNotification({
      recipientId: order.customerId,
      title: 'Order Update',
      message: note || message,
      type: 'order_update',
      priority: newStatus === 'cancelled' ? 'urgent' : 'high',
      data: { orderId: order.orderId, status: newStatus },
      relatedId: order._id,
      relatedType: 'order',
      channels: {
        push: { status: 'pending' },
        sms: { status: 'pending' }
      }
    });
  }

  // Delivery partner notifications
  async notifyDeliveryTaskAssigned(deliveryPartnerId, order) {
    return await this.createNotification({
      recipientId: deliveryPartnerId,
      title: 'New Delivery Task',
      message: `New delivery task assigned: Order #${order.orderId}. Pickup from ${order.shopName}.`,
      type: 'delivery_task',
      priority: 'urgent',
      data: { orderId: order.orderId, taskType: 'pickup' },
      relatedId: order._id,
      relatedType: 'order',
      channels: {
        push: { status: 'pending' },
        sms: { status: 'pending' }
      }
    });
  }

  // Promotional notifications
  async sendPromotionalNotification(targetUsers, promotion) {
    const notificationData = {
      title: promotion.title,
      message: promotion.description,
      type: 'promotion',
      priority: 'medium',
      data: {
        promotionId: promotion._id,
        couponCode: promotion.couponCode,
        validUntil: promotion.validUntil
      },
      relatedId: promotion._id,
      relatedType: 'promotion',
      channels: {
        push: { status: 'pending' },
        email: { status: 'pending' }
      }
    };

    return await this.sendBulkNotification(targetUsers, notificationData);
  }

  // System notifications
  async sendSystemMaintenance(message, scheduledTime) {
    const User = require('../models/User');
    const users = await User.find({ isActive: true }).select('_id');
    const recipientIds = users.map(user => user._id);

    return await this.sendBulkNotification(recipientIds, {
      title: 'Scheduled Maintenance',
      message: `${message} Scheduled for ${scheduledTime}.`,
      type: 'system',
      priority: 'medium',
      channels: {
        push: { status: 'pending' },
        email: { status: 'pending' }
      }
    });
  }

  // Mark notification as read
  async markAsRead(notificationId, userId) {
    const notification = await Notification.findOne({
      _id: notificationId,
      recipientId: userId
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();

    return notification;
  }

  // Get user notifications
  async getUserNotifications(userId, options = {}) {
    const {
      page = 1,
      limit = 20,
      type,
      isRead,
      priority
    } = options;

    const filter = { recipientId: userId };
    if (type) filter.type = type;
    if (isRead !== undefined) filter.isRead = isRead;
    if (priority) filter.priority = priority;

    const skip = (page - 1) * limit;

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('relatedId');

    const total = await Notification.countDocuments(filter);

    return {
      notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }
}

module.exports = new NotificationService();
