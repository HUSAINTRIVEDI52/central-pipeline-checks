const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Order = require('../models/Order');
const { logSystem } = require('../utils/logger');

// Socket authentication middleware
const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication error'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return next(new Error('User not found'));
    }

    socket.userId = user._id.toString();
    socket.userRole = user.role;
    
    logSystem('socket_connected', 'info', { userId: socket.userId, role: socket.userRole });
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
};

// Socket connection handler
const handleConnection = (io) => {
  return (socket) => {
    console.log(`User ${socket.userId} connected with role ${socket.userRole}`);

    // Join user to their personal room
    socket.join(`user_${socket.userId}`);
    
    // Join role-based rooms
    socket.join(`role_${socket.userRole}`);

    // Handle order tracking subscription
    socket.on('trackOrder', async (orderId) => {
      try {
        const order = await Order.findById(orderId);
        
        if (!order) {
          socket.emit('error', { message: 'Order not found' });
          return;
        }

        // Check if user can track this order
        const canTrack = order.customerId.toString() === socket.userId ||
                        order.shopId.ownerId?.toString() === socket.userId ||
                        order.deliveryPartnerId?.toString() === socket.userId ||
                        socket.userRole === 'admin';

        if (!canTrack) {
          socket.emit('error', { message: 'Unauthorized to track this order' });
          return;
        }

        // Join order tracking room
        socket.join(`order_${orderId}`);
        
        // Send current order status
        socket.emit('orderUpdate', {
          orderId: order._id,
          status: order.status,
          timestamp: new Date()
        });

        logSystem('order_tracking_started', 'info', { userId: socket.userId, orderId });
      } catch (error) {
        socket.emit('error', { message: 'Failed to track order' });
      }
    });

    // Handle delivery partner location updates
    socket.on('updateLocation', (locationData) => {
      if (socket.userRole !== 'delivery_partner') {
        socket.emit('error', { message: 'Only delivery partners can update location' });
        return;
      }

      const { latitude, longitude, orderId } = locationData;

      if (!latitude || !longitude) {
        socket.emit('error', { message: 'Invalid location data' });
        return;
      }

      // Broadcast location to order tracking room
      if (orderId) {
        socket.to(`order_${orderId}`).emit('deliveryLocationUpdate', {
          latitude,
          longitude,
          timestamp: new Date(),
          deliveryPartnerId: socket.userId
        });
      }

      logSystem('delivery_location_updated', 'info', { 
        userId: socket.userId, 
        orderId, 
        location: { latitude, longitude } 
      });
    });

    // Handle order status updates (for shop owners and delivery partners)
    socket.on('updateOrderStatus', async (data) => {
      try {
        const { orderId, status, note } = data;
        
        const order = await Order.findById(orderId);
        
        if (!order) {
          socket.emit('error', { message: 'Order not found' });
          return;
        }

        // Check permissions
        const canUpdate = order.shopId.ownerId?.toString() === socket.userId ||
                         order.deliveryPartnerId?.toString() === socket.userId ||
                         socket.userRole === 'admin';

        if (!canUpdate) {
          socket.emit('error', { message: 'Unauthorized to update order status' });
          return;
        }

        // Update order status
        order.status = status;
        if (note) {
          order.statusHistory.push({
            status,
            note,
            updatedBy: socket.userId,
            timestamp: new Date()
          });
        }
        await order.save();

        // Broadcast to all tracking this order
        io.to(`order_${orderId}`).emit('orderStatusUpdate', {
          orderId,
          status,
          note,
          timestamp: new Date(),
          updatedBy: socket.userId
        });

        // Notify customer specifically
        io.to(`user_${order.customerId}`).emit('orderNotification', {
          type: 'status_update',
          orderId,
          status,
          message: `Your order is now ${status.replace(/_/g, ' ')}`
        });

        logSystem('order_status_updated', 'info', { 
          userId: socket.userId, 
          orderId, 
          status, 
          note 
        });

      } catch (error) {
        socket.emit('error', { message: 'Failed to update order status' });
      }
    });

    // Handle new order notifications (for shop owners)
    socket.on('subscribeToShopOrders', (shopId) => {
      if (socket.userRole !== 'shop_owner') {
        socket.emit('error', { message: 'Only shop owners can subscribe to shop orders' });
        return;
      }

      socket.join(`shop_${shopId}_orders`);
      logSystem('shop_order_subscription', 'info', { userId: socket.userId, shopId });
    });

    // Handle delivery partner availability
    socket.on('updateAvailability', async (isAvailable) => {
      if (socket.userRole !== 'delivery_partner') {
        socket.emit('error', { message: 'Only delivery partners can update availability' });
        return;
      }

      try {
        await User.findByIdAndUpdate(socket.userId, {
          'deliveryPartnerProfile.isAvailable': isAvailable,
          'deliveryPartnerProfile.lastActive': new Date()
        });

        socket.emit('availabilityUpdated', { isAvailable });
        
        logSystem('delivery_availability_updated', 'info', { 
          userId: socket.userId, 
          isAvailable 
        });
      } catch (error) {
        socket.emit('error', { message: 'Failed to update availability' });
      }
    });

    // Handle chat messages (for order-specific communication)
    socket.on('sendMessage', async (data) => {
      try {
        const { orderId, message, recipientId } = data;
        
        const order = await Order.findById(orderId);
        
        if (!order) {
          socket.emit('error', { message: 'Order not found' });
          return;
        }

        // Check if user is part of this order
        const isAuthorized = order.customerId.toString() === socket.userId ||
                           order.shopId.ownerId?.toString() === socket.userId ||
                           order.deliveryPartnerId?.toString() === socket.userId;

        if (!isAuthorized) {
          socket.emit('error', { message: 'Unauthorized to send message' });
          return;
        }

        const messageData = {
          orderId,
          senderId: socket.userId,
          recipientId,
          message,
          timestamp: new Date()
        };

        // Send to specific recipient
        io.to(`user_${recipientId}`).emit('newMessage', messageData);
        
        // Confirm to sender
        socket.emit('messageSent', messageData);

        logSystem('order_message_sent', 'info', { 
          senderId: socket.userId, 
          recipientId, 
          orderId 
        });

      } catch (error) {
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`User ${socket.userId} disconnected`);
      logSystem('socket_disconnected', 'info', { userId: socket.userId });
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
      logSystem('socket_error', 'error', { userId: socket.userId, error: error.message });
    });
  };
};

// Utility functions for emitting events from external modules
const emitToUser = (io, userId, event, data) => {
  io.to(`user_${userId}`).emit(event, data);
};

const emitToOrder = (io, orderId, event, data) => {
  io.to(`order_${orderId}`).emit(event, data);
};

const emitToShop = (io, shopId, event, data) => {
  io.to(`shop_${shopId}_orders`).emit(event, data);
};

const emitToRole = (io, role, event, data) => {
  io.to(`role_${role}`).emit(event, data);
};

module.exports = {
  authenticateSocket,
  handleConnection,
  emitToUser,
  emitToOrder,
  emitToShop,
  emitToRole
};
