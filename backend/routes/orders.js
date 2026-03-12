const express = require('express');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Shop = require('../models/Shop');
const DeliveryPartnerProfile = require('../models/DeliveryPartnerProfile');
const Notification = require('../models/Notification');
const { authenticate, authorize, requireVerification } = require('../middleware/auth');
const {
  validateOrderCreation,
  validateObjectIdParam,
  validatePagination
} = require('../middleware/validation');
const { createPayment } = require('../services/paymentService');
const { assignDeliveryPartner } = require('../services/deliveryService');
const { sendNotification } = require('../utils/notifications');
const trackingController = require('../controllers/trackingController');

const router = express.Router();

// Tracking routes
router.get('/:orderId/tracking', authenticate, trackingController.getTrackingStatus);
router.post('/:orderId/location', authenticate, trackingController.updateLocation);
router.post('/:orderId/simulate', authenticate, trackingController.simulateMovement);

// @desc    Create new order from cart
// @route   POST /api/orders
// @access  Private (Customer)
const createOrder = async (req, res) => {
  console.log('📦 [Orders] ========== CREATE ORDER REQUEST ==========');
  console.log('📦 [Orders] Request body:', JSON.stringify(req.body, null, 2));
  console.log('📦 [Orders] User ID:', req.user?._id);

  try {
    const { addressId, deliveryAddress, paymentMethod, specialInstructions, notes, couponCode } = req.body;

    // Strict validation for payment method
    if (!paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Payment method is required'
      });
    }

    const validPaymentMethods = ['cod', 'card', 'upi', 'wallet'];
    if (!validPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method'
      });
    }

    console.log('📦 [Orders] Extracted params:', {
      addressId,
      paymentMethod,
      hasDeliveryAddress: !!deliveryAddress,
      notes
    });

    // Get delivery address - either from addressId or direct deliveryAddress
    let finalDeliveryAddress = deliveryAddress;

    if (addressId && !deliveryAddress) {
      // Fetch address from user's addresses
      const Address = require('../models/Address');
      const address = await Address.findOne({ _id: addressId, userId: req.user._id });

      if (!address) {
        return res.status(400).json({
          success: false,
          message: 'Address not found'
        });
      }

      // Convert address to deliveryAddress format
      const street = [address.addressLine1, address.addressLine2, address.landmark]
        .filter(Boolean)
        .join(', ');

      // Ensure coordinates have valid values
      const coords = address.coordinates || {};
      const latitude = coords.latitude || 23.0225; // Default to Ahmedabad coordinates
      const longitude = coords.longitude || 72.5714;

      finalDeliveryAddress = {
        street: street || address.addressLine1,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        country: address.country || 'India',
        coordinates: {
          latitude: latitude,
          longitude: longitude
        }
      };

      console.log('📦 [Orders] Converted address:', finalDeliveryAddress);
    }

    if (!finalDeliveryAddress) {
      return res.status(400).json({
        success: false,
        message: 'Delivery address is required'
      });
    }

    // Get user's cart
    console.log('📦 [Orders] Fetching cart for user:', req.user._id);
    const cart = await Cart.findOne({ userId: req.user._id }).populate({
      path: 'items.productId',
      populate: {
        path: 'shopId',
        select: 'name address deliveryFee minimumOrderAmount ownerId'
      }
    });

    console.log('📦 [Orders] Cart found:', cart ? `Yes, ${cart.items.length} items` : 'No');

    if (!cart || cart.items.length === 0) {
      console.log('📦 [Orders] Cart is empty or not found');
      return res.status(400).json({
        success: false,
        message: 'Cart is empty'
      });
    }

    // Re-validate stock for all items immediately before order creation
    for (const item of cart.items) {
      if (!item.productId) {
        return res.status(400).json({
          success: false,
          message: 'One or more items in your cart are no longer available'
        });
      }
      const product = await Product.findById(item.productId._id);
      if (!product) {
        return res.status(400).json({
          success: false,
          message: `Product not found`
        });
      }
      if (product.stock.available < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}. Available: ${product.stock.available}`
        });
      }
    }

    console.log('📦 [Orders] Cart items:', cart.items.map(item => ({
      productId: item.productId?._id,
      quantity: item.quantity
    })));

    // Validate cart for checkout
    const validation = await cart.validateForCheckout();
    if (!validation.isValid) {
      console.error('❌ [Orders] Cart validation failed:', validation.errors);
      return res.status(400).json({
        success: false,
        message: 'Cart validation failed',
        errors: validation.errors
      });
    }

    const { totals } = validation;
    const shop = cart.items[0].productId.shopId;

    // Create order items
    const orderItems = cart.items.map(item => ({
      productId: item.productId._id,
      quantity: item.quantity,
      price: item.productId.price,
      discountPrice: item.productId.discountPrice,
      totalPrice: (item.productId.discountPrice || item.productId.price) * item.quantity
    }));

    // Calculate order pricing
    const pricing = {
      subtotal: totals.subtotal,
      deliveryFee: totals.deliveryFee,
      tax: totals.tax,
      discount: 0, // Will be calculated if coupon is applied
      total: totals.total
    };

    // Apply coupon if provided
    if (couponCode) {
      // TODO: Implement coupon validation and discount calculation
      // This would involve checking the coupon validity and calculating discount
    }

    // Create order
    const order = new Order({
      customerId: req.user._id,
      shopId: shop._id,
      items: orderItems,
      pricing,
      deliveryAddress: finalDeliveryAddress,
      paymentMethod,
      specialInstructions: specialInstructions || notes,
      couponCode
    });

    await order.save();

    // Reserve stock for all items
    for (const item of cart.items) {
      const product = await Product.findById(item.productId._id);
      try {
        product.reserveStock(item.quantity);
        await product.save();
      } catch (stockError) {
        // Rollback order if stock reservation fails
        await Order.findByIdAndDelete(order._id);
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}`
        });
      }
    }

    // Create payment if not COD
    let payment = null;
    if (paymentMethod !== 'cod') {
      try {
        payment = await createPayment({
          orderId: order._id,
          amount: pricing.total,
          paymentMethod,
          customerInfo: {
            name: req.user.fullName,
            email: req.user.email,
            phone: req.user.phone
          }
        });

        order.paymentStatus = 'pending';
      } catch (paymentError) {
        console.error('Payment creation failed:', paymentError);
        // Don't fail the order, just set payment as failed
        order.paymentStatus = 'failed';
      }
    }

    await order.save();

    // Clear cart after successful order if COD
    // For online payments, cart is cleared upon successful payment verification
    if (paymentMethod === 'cod') {
      await cart.clearCart();
    }

    // Send notifications
    try {
      // Notify customer
      if (req.user._id) {
        await Notification.createNotification({
          recipientId: req.user._id,
          title: 'Order Placed Successfully',
          message: `Your order ${order.orderId} has been placed and is awaiting confirmation.`,
          type: 'order_update',
          data: { orderId: order._id },
          relatedId: order._id,
          relatedType: 'order',
          channels: {
            push: { status: 'pending' },
            email: { status: 'pending' }
          }
        });
      }

      // Notify shop owner
      if (shop && shop.ownerId) {
        await Notification.createNotification({
          recipientId: shop.ownerId,
          title: 'New Order Received',
          message: `You have received a new order ${order.orderId}. Please review and confirm.`,
          type: 'order_update',
          priority: 'high',
          data: { orderId: order._id },
          relatedId: order._id,
          relatedType: 'order',
          actionRequired: true,
          channels: {
            push: { status: 'pending' },
            email: { status: 'pending' }
          }
        });
      } else {
        console.warn('⚠️ [Orders] Shop owner ID missing, skipping shop notification. Shop:', {
          id: shop?._id,
          name: shop?.name,
          hasOwnerId: !!shop?.ownerId
        });
      }
    } catch (notificationError) {
      console.error('Notification sending failed:', notificationError);
    }

    // Emit real-time update
    const io = req.app.get('socketio');
    io.to(`user_${req.user._id}`).emit('order_created', { order });
    io.to(`user_${shop.ownerId}`).emit('new_order', { order });

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order: {
        ...order.toObject(),
        payment: payment ? {
          id: payment._id,
          status: payment.status,
          paymentLink: payment.metadata?.paymentLink,
          razorpayOrderId: payment.gatewayTransactionId // Razorpay order ID for checkout
        } : null
      }
    });

  } catch (error) {
    console.error('📦 [Orders] Create order error:', error);
    console.error('📦 [Orders] Error stack:', error.stack);

    // Handle specific error cases
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: Object.values(error.errors).map(e => e.message)
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Get user's orders
// @route   GET /api/orders
// @access  Private
const getUserOrders = async (req, res) => {
  try {
    const {
      status,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;

    const filter = {};

    // Set filter based on user role
    if (req.user.role === 'customer') {
      filter.customerId = req.user._id;
    } else if (req.user.role === 'delivery_partner') {
      filter.deliveryPartnerId = req.user._id;
    } else if (req.user.role === 'shop_owner') {
      // Get user's shop
      const shop = await Shop.findOne({ ownerId: req.user._id });
      if (shop) {
        filter.shopId = shop._id;
      } else {
        return res.status(404).json({
          success: false,
          message: 'No shop found for this user'
        });
      }
    }

    if (status) {
      filter.status = status;
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const orders = await Order.find(filter)
      .populate('customerId', 'fullName phone')
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
      message: 'Failed to get orders'
    });
  }
};

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('customerId', 'fullName phone email')
      .populate('shopId', 'name address contact operatingHours')
      .populate('deliveryPartnerId', 'fullName phone')
      .populate('items.productId', 'name images unit price discountPrice');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user has permission to view this order
    const hasPermission =
      req.user.role === 'admin' ||
      order.customerId._id.toString() === req.user._id.toString() ||
      order.deliveryPartnerId?._id.toString() === req.user._id.toString() ||
      (req.user.role === 'shop_owner' &&
        await Shop.findOne({ _id: order.shopId._id, ownerId: req.user._id }));

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this order'
      });
    }

    res.json({
      success: true,
      order
    });

  } catch (error) {
    console.error('Get order by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get order'
    });
  }
};

// @desc    Update order status
// @route   PATCH /api/orders/:id/status
// @access  Private
const updateOrderStatus = async (req, res) => {
  try {
    const { status, note } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    const order = await Order.findById(req.params.id)
      .populate('shopId')
      .populate('customerId', 'fullName')
      .populate('deliveryPartnerId', 'fullName');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check permissions based on status change
    let hasPermission = false;

    if (req.user.role === 'admin') {
      hasPermission = true;
    } else if (req.user.role === 'shop_owner' &&
      order.shopId.ownerId.toString() === req.user._id.toString()) {
      // Shop owners can confirm/reject orders
      if (['confirmed', 'preparing', 'ready_for_pickup', 'rejected'].includes(status)) {
        hasPermission = true;
      }
    } else if (req.user.role === 'delivery_partner' &&
      order.deliveryPartnerId?._id.toString() === req.user._id.toString()) {
      // Delivery partners can update delivery status
      if (['out_for_delivery', 'delivered'].includes(status)) {
        hasPermission = true;
      }
    } else if (req.user.role === 'customer' &&
      order.customerId._id.toString() === req.user._id.toString()) {
      // Customers can only cancel orders
      if (status === 'cancelled' && ['pending', 'confirmed'].includes(order.status)) {
        hasPermission = true;
      }
    }

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update order status'
      });
    }

    // Update order status
    order.updateStatus(status, note, req.user._id);

    // Handle specific status changes
    if (status === 'confirmed') {
      // Confirm stock reservation
      for (const item of order.items) {
        const product = await Product.findById(item.productId);
        product.confirmStockUsage(item.quantity);
        await product.save();
      }

      // Assign delivery partner
      try {
        const deliveryPartner = await assignDeliveryPartner(order);
        if (deliveryPartner) {
          order.deliveryPartnerId = deliveryPartner._id;
        }
      } catch (assignError) {
        console.error('Delivery partner assignment failed:', assignError);
      }
    } else if (status === 'cancelled' || status === 'rejected') {
      // Release reserved stock
      for (const item of order.items) {
        const product = await Product.findById(item.productId);
        product.releaseStock(item.quantity);
        await product.save();
      }
    } else if (status === 'delivered') {
      // Calculate times
      order.calculatePreparationTime();
      order.calculateDeliveryTime();
    }

    await order.save();

    // Send notifications
    try {
      const notifications = [];

      // Notify customer about status change
      if (order.customerId._id.toString() !== req.user._id.toString()) {
        notifications.push({
          recipientId: order.customerId._id,
          title: `Order ${status.replace('_', ' ').toUpperCase()}`,
          message: `Your order ${order.orderId} is now ${status.replace('_', ' ')}.`,
          type: 'order_update',
          data: { orderId: order._id, status },
          relatedId: order._id,
          relatedType: 'order',
          channels: {
            push: { status: 'pending' }
          }
        });
      }

      // Notify delivery partner if assigned
      if (status === 'ready_for_pickup' && order.deliveryPartnerId) {
        notifications.push({
          recipientId: order.deliveryPartnerId._id,
          title: 'Pickup Ready',
          message: `Order ${order.orderId} is ready for pickup.`,
          type: 'delivery',
          priority: 'high',
          data: { orderId: order._id },
          relatedId: order._id,
          relatedType: 'order',
          actionRequired: true,
          channels: {
            push: { status: 'pending' }
          }
        });
      }

      // Create all notifications
      for (const notificationData of notifications) {
        await Notification.createNotification(notificationData);
      }
    } catch (notificationError) {
      console.error('Notification sending failed:', notificationError);
    }

    // Emit real-time updates
    const io = req.app.get('socketio');
    io.to(`order_${order._id}`).emit('status_update', {
      orderId: order._id,
      status,
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: 'Order status updated successfully',
      order
    });

  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update order status'
    });
  }
};

// @desc    Cancel order
// @route   DELETE /api/orders/:id
// @access  Private (Customer)
const cancelOrder = async (req, res) => {
  try {
    const { reason } = req.body;

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user can cancel this order
    if (order.customerId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this order'
      });
    }

    // Check if order can be cancelled
    if (!['pending', 'confirmed'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: 'Order cannot be cancelled at this stage'
      });
    }

    // Update order status
    order.updateStatus('cancelled', `Cancelled by customer: ${reason}`, req.user._id);
    order.cancellationReason = reason;

    // Release reserved stock
    for (const item of order.items) {
      const product = await Product.findById(item.productId);
      product.releaseStock(item.quantity);
      await product.save();
    }

    await order.save();

    res.json({
      success: true,
      message: 'Order cancelled successfully',
      order
    });

  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel order'
    });
  }
};

// @desc    Add order rating
// @route   POST /api/orders/:id/rating
// @access  Private (Customer)
const addOrderRating = async (req, res) => {
  try {
    const { overall, food, delivery, packaging, comment } = req.body;

    const order = await Order.findById(req.params.id)
      .populate('shopId')
      .populate('deliveryPartnerId');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user can rate this order
    if (order.customerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to rate this order'
      });
    }

    // Check if order is delivered
    if (order.status !== 'delivered') {
      return res.status(400).json({
        success: false,
        message: 'Can only rate delivered orders'
      });
    }

    // Check if already rated
    if (order.rating.overall) {
      return res.status(400).json({
        success: false,
        message: 'Order has already been rated'
      });
    }

    // Add rating to order
    order.addRating({
      overall,
      food,
      delivery,
      packaging,
      comment
    });

    // Update shop rating
    if (overall && order.shopId) {
      const shop = await Shop.findById(order.shopId._id);
      shop.updateRating(overall);
      await shop.save();
    }

    // Update delivery partner rating
    if (delivery && order.deliveryPartnerId) {
      const deliveryPartner = await DeliveryPartnerProfile.findOne({
        userId: order.deliveryPartnerId._id
      });
      if (deliveryPartner) {
        deliveryPartner.updateRating(delivery);
        await deliveryPartner.save();
      }
    }

    await order.save();

    res.json({
      success: true,
      message: 'Rating added successfully',
      rating: order.rating
    });

  } catch (error) {
    console.error('Add order rating error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add rating'
    });
  }
};

// Apply middleware and routes
router.post('/',
  authenticate,
  authorize('customer'),
  requireVerification,
  validateOrderCreation,
  createOrder
);

router.get('/',
  authenticate,
  requireVerification,
  validatePagination,
  getUserOrders
);

router.get('/:id',
  authenticate,
  requireVerification,
  validateObjectIdParam('id'),
  getOrderById
);

router.patch('/:id/status',
  authenticate,
  requireVerification,
  validateObjectIdParam('id'),
  updateOrderStatus
);

router.delete('/:id',
  authenticate,
  authorize('customer', 'admin'),
  requireVerification,
  validateObjectIdParam('id'),
  cancelOrder
);

router.post('/:id/rating',
  authenticate,
  authorize('customer'),
  requireVerification,
  validateObjectIdParam('id'),
  addOrderRating
);

module.exports = router;
