const Razorpay = require('razorpay');
const crypto = require('crypto');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Cart = require('../models/Cart');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiResponse } = require('../utils/helpers');
const { logPayment } = require('../utils/logger');

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// @desc    Create payment order
// @route   POST /api/payments/create-order
// @access  Private
const createPaymentOrder = asyncHandler(async (req, res) => {
  const { orderId, amount, currency = 'INR' } = req.body;

  // Verify order exists and belongs to user
  const order = await Order.findOne({
    _id: orderId,
    customerId: req.user.id
  });

  if (!order) {
    return res.status(404).json(apiResponse(false, 'Order not found'));
  }

  if (order.status !== 'confirmed') {
    return res.status(400).json(apiResponse(false, 'Order is not ready for payment'));
  }

  try {
    // Create Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount: amount * 100, // Convert to paise
      currency,
      receipt: `order_${orderId}`,
      notes: {
        orderId: orderId,
        customerId: req.user.id
      }
    });

    // Save payment record
    const payment = await Payment.create({
      orderId,
      customerId: req.user.id,
      paymentId: razorpayOrder.id,
      amount,
      currency,
      provider: 'razorpay',
      status: 'pending'
    });

    logPayment('payment_order_created', razorpayOrder.id, orderId, amount);

    res.json(apiResponse(true, 'Payment order created successfully', {
      paymentId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID
    }));

  } catch (error) {
    console.error('Razorpay error:', error);
    return res.status(500).json(apiResponse(false, 'Payment order creation failed'));
  }
});

// @desc    Verify payment
// @route   POST /api/payments/verify
// @access  Private
const verifyPayment = asyncHandler(async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  } = req.body;

  // Verify signature
  const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
  hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
  const generated_signature = hmac.digest('hex');

  if (generated_signature !== razorpay_signature) {
    logPayment('payment_verification_failed', razorpay_payment_id, razorpay_order_id, 0, { reason: 'Invalid signature' });
    return res.status(400).json(apiResponse(false, 'Payment verification failed'));
  }

  try {
    // Update payment record
    const payment = await Payment.findOneAndUpdate(
      { paymentId: razorpay_order_id },
      {
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
        status: 'completed',
        completedAt: new Date()
      },
      { new: true }
    );

    if (!payment) {
      return res.status(404).json(apiResponse(false, 'Payment record not found'));
    }

    // Update order status
    const order = await Order.findByIdAndUpdate(
      payment.orderId,
      {
        status: 'preparing',
        paymentStatus: 'paid'
      },
      { new: true }
    );

    // Clear cart on the backend after successful payment
    if (order) {
      const cart = await Cart.findOne({ userId: order.customerId });
      if (cart) {
        await cart.clearCart();
      }
    }

    logPayment('payment_verified', razorpay_payment_id, payment.orderId, payment.amount);

    res.json(apiResponse(true, 'Payment verified successfully', {
      payment,
      order
    }));

  } catch (error) {
    console.error('Payment verification error:', error);
    return res.status(500).json(apiResponse(false, 'Payment verification failed'));
  }
});

// @desc    Get payment details
// @route   GET /api/payments/:id
// @access  Private
const getPayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id)
    .populate('orderId')
    .populate('customerId', 'fullName email');

  if (!payment) {
    return res.status(404).json(apiResponse(false, 'Payment not found'));
  }

  // Check access permission
  if (payment.customerId._id.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  res.json(apiResponse(true, 'Payment retrieved successfully', payment));
});

// @desc    Get user payments
// @route   GET /api/payments/user/history
// @access  Private
const getUserPayments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;

  const filter = { customerId: req.user.id };
  if (status) filter.status = status;

  const skip = (page - 1) * limit;

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .populate('orderId', 'orderId')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip),
    Payment.countDocuments(filter)
  ]);

  const pagination = {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / limit)
  };

  res.json(apiResponse(true, 'Payment history retrieved successfully', payments, pagination));
});

// @desc    Refund payment
// @route   POST /api/payments/:id/refund
// @access  Private (Admin)
const refundPayment = asyncHandler(async (req, res) => {
  const { amount, reason } = req.body;

  if (req.user.role !== 'admin') {
    return res.status(403).json(apiResponse(false, 'Access denied'));
  }

  const payment = await Payment.findById(req.params.id);

  if (!payment) {
    return res.status(404).json(apiResponse(false, 'Payment not found'));
  }

  if (payment.status !== 'completed') {
    return res.status(400).json(apiResponse(false, 'Can only refund completed payments'));
  }

  try {
    // Create refund on Razorpay
    const refund = await razorpay.payments.refund(payment.razorpayPaymentId, {
      amount: amount * 100, // Convert to paise
      notes: {
        reason: reason,
        refunded_by: req.user.id
      }
    });

    // Update payment record
    payment.refunds.push({
      refundId: refund.id,
      amount: amount,
      reason: reason,
      status: 'pending',
      createdAt: new Date()
    });

    payment.refundedAmount = (payment.refundedAmount || 0) + amount;

    if (payment.refundedAmount >= payment.amount) {
      payment.status = 'refunded';
    } else {
      payment.status = 'partially_refunded';
    }

    await payment.save();

    logPayment('payment_refunded', payment.razorpayPaymentId, payment.orderId, amount, { reason });

    res.json(apiResponse(true, 'Refund initiated successfully', payment));

  } catch (error) {
    console.error('Refund error:', error);
    return res.status(500).json(apiResponse(false, 'Refund initiation failed'));
  }
});

// @desc    Handle Razorpay webhook
// @route   POST /api/payments/webhook
// @access  Public
const handleWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const body = JSON.stringify(req.body);

  // Verify webhook signature
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(400).json(apiResponse(false, 'Invalid signature'));
  }

  const event = req.body.event;
  const paymentData = req.body.payload.payment.entity;

  try {
    switch (event) {
      case 'payment.captured':
        await handlePaymentCaptured(paymentData);
        break;

      case 'payment.failed':
        await handlePaymentFailed(paymentData);
        break;

      case 'refund.processed':
        await handleRefundProcessed(req.body.payload.refund.entity);
        break;

      default:
        console.log('Unhandled webhook event:', event);
    }

    res.json(apiResponse(true, 'Webhook processed successfully'));

  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json(apiResponse(false, 'Webhook processing failed'));
  }
});

// Helper functions for webhook handling
const handlePaymentCaptured = async (paymentData) => {
  const payment = await Payment.findOne({
    razorpayPaymentId: paymentData.id
  });

  if (payment && payment.status !== 'completed') {
    payment.status = 'completed';
    payment.completedAt = new Date();
    await payment.save();

    logPayment('payment_captured', paymentData.id, payment.orderId, payment.amount);
  }
};

const handlePaymentFailed = async (paymentData) => {
  const payment = await Payment.findOne({
    paymentId: paymentData.order_id
  });

  if (payment) {
    payment.status = 'failed';
    payment.failureReason = paymentData.error_description;
    await payment.save();

    logPayment('payment_failed', paymentData.id, payment.orderId, payment.amount, {
      reason: paymentData.error_description
    });
  }
};

const handleRefundProcessed = async (refundData) => {
  const payment = await Payment.findOne({
    razorpayPaymentId: refundData.payment_id
  });

  if (payment) {
    const refund = payment.refunds.find(r => r.refundId === refundData.id);
    if (refund) {
      refund.status = 'processed';
      refund.processedAt = new Date();
      await payment.save();

      logPayment('refund_processed', refundData.id, payment.orderId, refundData.amount);
    }
  }
};

module.exports = {
  createPaymentOrder,
  verifyPayment,
  getPayment,
  getUserPayments,
  refundPayment,
  handleWebhook
};
