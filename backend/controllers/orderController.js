const Order = require('../models/Order');
const Product = require('../models/Product');
const Shop = require('../models/Shop');
const User = require('../models/User');
const Cart = require('../models/Cart');
const notificationService = require('../services/notificationService');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiResponse, getPaginationMeta, generateOrderId } = require('../utils/helpers');
const { logOrder } = require('../utils/logger');

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
const createOrder = asyncHandler(async (req, res) => {
  const {
    shopId,
    items,
    deliveryAddress,
    paymentMethod,
    specialInstructions,
    couponCode
  } = req.body;

  // Validate shop
  const shop = await Shop.findById(shopId);
  if (!shop || !shop.isActive) {
    return res.status(404).json(apiResponse(false, 'Shop not found'));
  }

  // Validate and calculate items
  let subtotal = 0;
  const orderItems = [];

  for (const item of items) {
    const product = await Product.findById(item.productId);

    if (!product || !product.isActive) {
      return res.status(404).json(apiResponse(false, `Product ${item.productId} not found`));
    }

    if (product.stock.available < item.quantity) {
      return res.status(400).json(apiResponse(false, `Insufficient stock for ${product.name}`));
    }

    const itemTotal = product.price * item.quantity;
    subtotal += itemTotal;

    orderItems.push({
      productId: product._id,
      name: product.name,
      price: product.price,
      quantity: item.quantity,
      total: itemTotal
    });
  }

  // Calculate pricing
  const deliveryFee = 25; // Fixed delivery fee for now
  let discount = 0;

  // Apply coupon if provided
  if (couponCode) {
    // TODO: Implement coupon validation and discount calculation
    discount = 0;
  }

  const total = subtotal + deliveryFee - discount;

  // Create order
  const order = await Order.create({
    orderId: generateOrderId(),
    customerId: req.user.id,
    shopId,
    items: orderItems,
    pricing: {
      subtotal,
      deliveryFee,
      discount,
      total
    },
    deliveryAddress,
    paymentMethod,
    specialInstructions,
    couponCode
  });

  // Update product stock
  for (const item of items) {
    await Product.findByIdAndUpdate(
      item.productId,
      { $inc: { 'stock.available': -item.quantity, 'analytics.orders': 1 } }
    );
  }

  // Clear user's cart for this shop only if payment is COD
  // For online payments, cart is cleared upon successful payment verification
  if (paymentMethod === 'cod') {
    const cart = await Cart.findOne({ userId: req.user.id });
    if (cart) {
      await cart.clearCart();
    }
  }

  // Send notifications
  await notificationService.notifyOrderCreated(order);

  logOrder('order_created', order.orderId, req.user.id, { shopId, total });

  res.status(201).json(apiResponse(true, 'Order created successfully', order));
});

// @desc    Get user orders
// @route   GET /api/orders
// @access  Private
const getOrders = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    status,
    shopId
  } = req.query;

  const filter = { customerId: req.user.id };

  if (status) filter.status = status;
  if (shopId) filter.shopId = shopId;

  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate('shopId', 'name address')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip),
    Order.countDocuments(filter)
  ]);

  const pagination = getPaginationMeta(page, limit, total);

  res.json(apiResponse(true, 'Orders retrieved successfully', orders, pagination));
});

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private
const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('customerId', 'fullName phone email')
    .populate('shopId', 'name address contact')
    .populate('deliveryPartnerId', 'fullName phone profileImage');

  if (!order) {
    return res.status(404).json(apiResponse(false, 'Order not found'));
  }

  // Check access permission
  const hasAccess = order.customerId._id.toString() === req.user.id ||
    order.shopId.ownerId?.toString() === req.user.id ||
    order.deliveryPartnerId?._id.toString() === req.user.id ||
    req.user.role === 'admin';

  if (!hasAccess) {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  res.json(apiResponse(true, 'Order retrieved successfully', order));
});

// @desc    Update order status
// @route   PATCH /api/orders/:id/status
// @access  Private (Shop Owner/Delivery Partner/Admin)
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;

  const order = await Order.findById(req.params.id)
    .populate('shopId')
    .populate('customerId')
    .populate('deliveryPartnerId');

  if (!order) {
    return res.status(404).json(apiResponse(false, 'Order not found'));
  }

  // Check permission to update status
  const canUpdate = order.shopId.ownerId?.toString() === req.user.id ||
    order.deliveryPartnerId?._id.toString() === req.user.id ||
    req.user.role === 'admin';

  if (!canUpdate) {
    return res.status(403).json(apiResponse(false, 'Not authorized to update order status'));
  }

  // Validate status transition
  const validTransitions = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['ready_for_pickup', 'cancelled'],
    ready_for_pickup: ['out_for_delivery'],
    out_for_delivery: ['delivered'],
    delivered: [],
    cancelled: []
  };

  if (!validTransitions[order.status].includes(status)) {
    return res.status(400).json(apiResponse(false, 'Invalid status transition'));
  }

  // Update order
  order.status = status;
  if (note) {
    order.statusHistory.push({
      status,
      note,
      updatedBy: req.user.id,
      timestamp: new Date()
    });
  }

  if (status === 'delivered') {
    order.deliveredAt = new Date();
  }

  await order.save();

  // Send notification
  await notificationService.notifyOrderStatusChange(order, status, note);

  logOrder('status_updated', order.orderId, req.user.id, { status, note });

  res.json(apiResponse(true, 'Order status updated successfully', order));
});

// @desc    Cancel order
// @route   PATCH /api/orders/:id/cancel
// @access  Private
const cancelOrder = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  const order = await Order.findById(req.params.id).populate('shopId');

  if (!order) {
    return res.status(404).json(apiResponse(false, 'Order not found'));
  }

  // Check permission
  const canCancel = order.customerId.toString() === req.user.id ||
    order.shopId.ownerId?.toString() === req.user.id ||
    req.user.role === 'admin';

  if (!canCancel) {
    return res.status(403).json(apiResponse(false, 'Not authorized to cancel this order'));
  }

  // Check if order can be cancelled
  if (['delivered', 'cancelled'].includes(order.status)) {
    return res.status(400).json(apiResponse(false, 'Order cannot be cancelled'));
  }

  // Update order
  order.status = 'cancelled';
  order.cancellationReason = reason;
  order.statusHistory.push({
    status: 'cancelled',
    note: reason,
    updatedBy: req.user.id,
    timestamp: new Date()
  });

  await order.save();

  // Restore product stock
  for (const item of order.items) {
    await Product.findByIdAndUpdate(
      item.productId,
      { $inc: { 'stock.available': item.quantity } }
    );
  }

  logOrder('order_cancelled', order.orderId, req.user.id, { reason });

  res.json(apiResponse(true, 'Order cancelled successfully', order));
});

// @desc    Get shop orders
// @route   GET /api/orders/shop/:shopId
// @access  Private (Shop Owner)
const getShopOrders = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    status,
    startDate,
    endDate
  } = req.query;

  const shopId = req.params.shopId;

  // Verify shop ownership
  const shop = await Shop.findById(shopId);
  if (!shop || shop.ownerId.toString() !== req.user.id) {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  // Build filter
  const filter = { shopId };

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
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip),
    Order.countDocuments(filter)
  ]);

  const pagination = getPaginationMeta(page, limit, total);

  res.json(apiResponse(true, 'Shop orders retrieved successfully', orders, pagination));
});

// @desc    Assign delivery partner
// @route   PATCH /api/orders/:id/assign-delivery
// @access  Private (Shop Owner/Admin)
const assignDeliveryPartner = asyncHandler(async (req, res) => {
  const { deliveryPartnerId } = req.body;

  const order = await Order.findById(req.params.id).populate('shopId');

  if (!order) {
    return res.status(404).json(apiResponse(false, 'Order not found'));
  }

  // Check permission
  const canAssign = order.shopId.ownerId?.toString() === req.user.id ||
    req.user.role === 'admin';

  if (!canAssign) {
    return res.status(403).json(apiResponse(false, 'Not authorized'));
  }

  // Validate delivery partner
  const deliveryPartner = await User.findById(deliveryPartnerId);
  if (!deliveryPartner || deliveryPartner.role !== 'delivery_partner') {
    return res.status(404).json(apiResponse(false, 'Delivery partner not found'));
  }

  order.deliveryPartnerId = deliveryPartnerId;
  order.status = 'out_for_delivery';
  await order.save();

  logOrder('delivery_assigned', order.orderId, req.user.id, { deliveryPartnerId });

  res.json(apiResponse(true, 'Delivery partner assigned successfully', order));
});

// @desc    Rate order
// @route   POST /api/orders/:id/rate
// @access  Private
const rateOrder = asyncHandler(async (req, res) => {
  const { rating, review } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    return res.status(404).json(apiResponse(false, 'Order not found'));
  }

  // Check if user can rate this order
  if (order.customerId.toString() !== req.user.id) {
    return res.status(403).json(apiResponse(false, 'Not authorized to rate this order'));
  }

  if (order.status !== 'delivered') {
    return res.status(400).json(apiResponse(false, 'Order must be delivered to rate'));
  }

  if (order.rating) {
    return res.status(400).json(apiResponse(false, 'Order already rated'));
  }

  order.rating = {
    rating,
    review,
    ratedAt: new Date()
  };

  await order.save();

  res.json(apiResponse(true, 'Order rated successfully', order.rating));
});

module.exports = {
  createOrder,
  getOrders,
  getOrder,
  updateOrderStatus,
  cancelOrder,
  getShopOrders,
  assignDeliveryPartner,
  rateOrder
};
