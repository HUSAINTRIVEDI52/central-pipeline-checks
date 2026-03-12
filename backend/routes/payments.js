const express = require("express");
const Payment = require("../models/Payment");
const Order = require("../models/Order");
const {
  authenticate,
  authorize,
  requireVerification,
} = require("../middleware/auth");
const {
  validateObjectIdParam,
  validatePagination,
} = require("../middleware/validation");
const {
  createPayment,
  verifyRazorpayPayment,
  verifyStripePayment,
  processRefund,
  handleWebhook,
} = require("../services/paymentService");

const router = express.Router();

// @desc    Create payment for order
// @route   POST /api/payments
// @access  Private (Customer)
const initiatePayment = async (req, res) => {
  try {
    const { orderId, paymentMethod } = req.body;

    if (!orderId || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: "Order ID and payment method are required",
      });
    }

    // Get order details
    const order = await Order.findById(orderId).populate("customerId shopId");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Check if user owns this order
    if (order.customerId._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized for this order",
      });
    }

    // Check if order is in valid state for payment
    if (!["pending", "confirmed"].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: "Order is not in a valid state for payment",
      });
    }

    // Check if payment already exists
    const existingPayment = await Payment.findOne({ orderId });
    if (existingPayment && existingPayment.status === "success") {
      return res.status(400).json({
        success: false,
        message: "Order is already paid",
      });
    }

    // Create payment
    const payment = await createPayment({
      orderId: order._id,
      amount: order.pricing.total,
      paymentMethod,
      customerInfo: {
        name: req.user.fullName,
        email: req.user.email,
        phone: req.user.phone,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
      },
    });

    res.status(201).json({
      success: true,
      message: "Payment initiated successfully",
      payment: {
        id: payment._id,
        transactionId: payment.transactionId,
        amount: payment.amount,
        status: payment.status,
        paymentMethod: payment.paymentMethod,
        paymentLink: payment.metadata?.paymentLink,
        gatewayTransactionId: payment.gatewayTransactionId,
      },
    });
  } catch (error) {
    console.error("Initiate payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initiate payment",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// @desc    Verify payment
// @route   POST /api/payments/verify
// @access  Private (Customer)
const verifyPayment = async (req, res) => {
  try {
    const { paymentId, orderId, signature, sessionId, gateway } = req.body;

    let verification = { verified: false };

    switch (gateway) {
      case "razorpay":
        if (!paymentId || !orderId || !signature) {
          return res.status(400).json({
            success: false,
            message: "Missing required Razorpay verification parameters",
          });
        }
        verification = await verifyRazorpayPayment(
          paymentId,
          orderId,
          signature,
        );
        break;

      case "stripe":
        if (!sessionId) {
          return res.status(400).json({
            success: false,
            message: "Missing Stripe session ID",
          });
        }
        verification = await verifyStripePayment(sessionId);
        break;

      default:
        return res.status(400).json({
          success: false,
          message: "Invalid payment gateway",
        });
    }

    if (!verification.verified) {
      return res.status(400).json({
        success: false,
        message: verification.error || "Payment verification failed",
      });
    }

    // Find payment record - for Razorpay, it's stored with order ID as gatewayTransactionId
    let payment;
    if (gateway === "razorpay") {
      payment = await Payment.findOne({
        gatewayTransactionId: orderId, // orderId is Razorpay order ID (order_xxx)
      }).populate("orderId");
    } else {
      payment = await Payment.findOne({
        $or: [
          { gatewayTransactionId: paymentId },
          { gatewayTransactionId: sessionId },
        ],
      }).populate("orderId");
    }

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found",
      });
    }

    // Update payment status
    await payment.updateStatus("success", verification.payment);

    // Update order payment status and confirm the order
    const order = payment.orderId;
    if (order) {
      order.paymentStatus = "paid";

      // If order is still pending, confirm it
      if (order.status === "pending") {
        order.status = "confirmed";
      }

      await order.save();
    }

    res.json({
      success: true,
      message: "Payment verified successfully",
      payment: {
        id: payment._id,
        transactionId: payment.gatewayTransactionId,
        status: payment.status,
        amount: payment.amount,
      },
    });
  } catch (error) {
    console.error("Verify payment error:", error);
    res.status(500).json({
      success: false,
      message: "Payment verification failed",
    });
  }
};

// @desc    Get payment details
// @route   GET /api/payments/:id
// @access  Private (Customer/Shop Owner/Admin)
const getPayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id).populate({
      path: "orderId",
      populate: {
        path: "customerId shopId",
        select: "fullName email phone name",
      },
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    // Check if user can access this payment
    const order = payment.orderId;
    const canAccess =
      req.user.role === "admin" ||
      order.customerId._id.toString() === req.user._id.toString() ||
      (req.user.role === "shop_owner" &&
        order.shopId.ownerId &&
        order.shopId.ownerId.toString() === req.user._id.toString());

    if (!canAccess) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this payment",
      });
    }

    res.json({
      success: true,
      payment,
    });
  } catch (error) {
    console.error("Get payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get payment details",
    });
  }
};

// @desc    Get payment history
// @route   GET /api/payments
// @access  Private
const getPayments = async (req, res) => {
  try {
    const {
      orderId,
      status,
      paymentMethod,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = req.query;

    // Build filter based on user role
    let filter = {};

    if (req.user.role === "customer") {
      // Get payments for user's orders
      const userOrders = await Order.find({ customerId: req.user._id }).select(
        "_id",
      );
      filter.orderId = { $in: userOrders.map((order) => order._id) };
    } else if (req.user.role === "shop_owner") {
      // Get payments for shop's orders
      const shop = await Shop.findOne({ ownerId: req.user._id });
      if (shop) {
        const shopOrders = await Order.find({ shopId: shop._id }).select("_id");
        filter.orderId = { $in: shopOrders.map((order) => order._id) };
      } else {
        return res.json({
          success: true,
          data: {
            payments: [],
            pagination: { total: 0, pages: 0, page: 1, limit },
          },
        });
      }
    }
    // Admin can see all payments (no additional filter)

    // Apply additional filters
    if (orderId) filter.orderId = orderId;
    if (status) filter.status = status;
    if (paymentMethod) filter.paymentMethod = paymentMethod;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const payments = await Payment.find(filter)
      .populate({
        path: "orderId",
        select: "orderId customerId shopId pricing.total",
        populate: {
          path: "customerId shopId",
          select: "fullName email name",
        },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Payment.countDocuments(filter);

    res.json({
      success: true,
      data: {
        payments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get payments error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get payments",
    });
  }
};

// @desc    Process refund
// @route   POST /api/payments/:id/refund
// @access  Private (Admin/Shop Owner)
const initiateRefund = async (req, res) => {
  try {
    const { amount, reason } = req.body;

    if (!amount || !reason) {
      return res.status(400).json({
        success: false,
        message: "Amount and reason are required",
      });
    }

    const payment = await Payment.findById(req.params.id).populate("orderId");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    // Check authorization
    const order = payment.orderId;
    const canRefund =
      req.user.role === "admin" ||
      (req.user.role === "shop_owner" &&
        order.shopId &&
        order.shopId.toString() === req.user.shopId);

    if (!canRefund) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to process refunds for this payment",
      });
    }

    // Validate refund amount
    if (amount > payment.refundableAmount) {
      return res.status(400).json({
        success: false,
        message: `Refund amount cannot exceed ₹${payment.refundableAmount}`,
      });
    }

    // Process refund
    const refund = await processRefund(payment._id, amount, reason);

    // Update order status if full refund
    if (amount === payment.refundableAmount) {
      order.status = "cancelled";
      order.refundAmount = amount;
      await order.save();
    }

    res.json({
      success: true,
      message: "Refund processed successfully",
      refund: refund.refund,
    });
  } catch (error) {
    console.error("Initiate refund error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to process refund",
    });
  }
};

// @desc    Handle payment webhooks
// @route   POST /api/payments/webhook/:gateway
// @access  Public (Webhook)
const handlePaymentWebhook = async (req, res) => {
  try {
    const { gateway } = req.params;
    const signature =
      req.get("X-Razorpay-Signature") || req.get("Stripe-Signature");

    if (!signature) {
      return res.status(400).json({
        success: false,
        message: "Missing webhook signature",
      });
    }

    await handleWebhook(gateway, req.body, signature);

    res.json({
      success: true,
      message: "Webhook processed successfully",
    });
  } catch (error) {
    console.error("Webhook handling error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Webhook processing failed",
    });
  }
};

// @desc    Get payment analytics
// @route   GET /api/payments/analytics
// @access  Private (Admin/Shop Owner)
const getPaymentAnalytics = async (req, res) => {
  try {
    const { startDate, endDate, shopId } = req.query;

    const start = startDate
      ? new Date(startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    // Check authorization for shop-specific analytics
    let analyticsShopId = null;
    if (req.user.role === "shop_owner") {
      const shop = await Shop.findOne({ ownerId: req.user._id });
      if (shop) {
        analyticsShopId = shop._id;
      }
    } else if (req.user.role === "admin" && shopId) {
      analyticsShopId = shopId;
    }

    const analytics = await Payment.getPaymentAnalytics(
      start,
      end,
      analyticsShopId,
    );

    res.json({
      success: true,
      analytics: analytics[0] || {
        totalTransactions: 0,
        totalAmount: 0,
        successfulTransactions: 0,
        failedTransactions: 0,
        totalRefunded: 0,
        codTransactions: 0,
        onlineTransactions: 0,
      },
      dateRange: { start, end },
    });
  } catch (error) {
    console.error("Get payment analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get payment analytics",
    });
  }
};

// Apply middleware and routes
router.post(
  "/",
  authenticate,
  authorize("customer"),
  requireVerification,
  initiatePayment,
);

router.post(
  "/verify",
  authenticate,
  authorize("customer"),
  requireVerification,
  verifyPayment,
);

router.get(
  "/",
  authenticate,
  requireVerification,
  validatePagination,
  getPayments,
);

router.get(
  "/analytics",
  authenticate,
  authorize("admin", "shop_owner"),
  requireVerification,
  getPaymentAnalytics,
);

router.get(
  "/:id",
  authenticate,
  requireVerification,
  validateObjectIdParam("id"),
  getPayment,
);

router.post(
  "/:id/refund",
  authenticate,
  authorize("admin", "shop_owner"),
  requireVerification,
  validateObjectIdParam("id"),
  initiateRefund,
);

// Webhook endpoints (no authentication required)
router.post("/webhook/razorpay", handlePaymentWebhook);
router.post("/webhook/stripe", handlePaymentWebhook);

module.exports = router;
