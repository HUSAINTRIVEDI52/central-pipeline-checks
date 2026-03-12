const Razorpay = require("razorpay");
const Stripe = require("stripe");
const Payment = require("../models/Payment");

// Initialize payment gateways
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Create payment based on method
const createPayment = async ({
  orderId,
  amount,
  paymentMethod,
  customerInfo,
}) => {
  try {
    // Create payment record
    const payment = new Payment({
      orderId,
      amount,
      paymentGateway: paymentMethod,
      paymentMethod: paymentMethod === "cod" ? "cod" : "card",
      currency: "INR",
      metadata: {
        customerIP: customerInfo.ip,
        userAgent: customerInfo.userAgent,
      },
    });

    // Handle different payment methods
    let gatewayResponse = {};

    switch (paymentMethod) {
      case "card":
      case "upi":
      case "wallet":
      case "razorpay":
        // All online payments go through Razorpay
        gatewayResponse = await createRazorpayPayment(
          amount,
          orderId,
          customerInfo,
        );
        payment.gatewayTransactionId = gatewayResponse.id;
        payment.metadata.paymentLink = gatewayResponse.short_url;
        payment.paymentGateway = "razorpay";
        payment.paymentMethod = paymentMethod === "upi" ? "upi" : "card";
        break;

      case "stripe":
        gatewayResponse = await createStripePayment(
          amount,
          orderId,
          customerInfo,
        );
        payment.gatewayTransactionId = gatewayResponse.id;
        payment.metadata.paymentLink = gatewayResponse.url;
        break;

      case "cod":
        payment.status = "pending";
        gatewayResponse = { method: "cash_on_delivery" };
        break;

      default:
        throw new Error("Invalid payment method");
    }

    payment.gatewayResponse = gatewayResponse;
    await payment.save();

    return payment;
  } catch (error) {
    console.error("Payment creation error:", error);
    throw error;
  }
};

// Create Razorpay payment
const createRazorpayPayment = async (amount, orderId, customerInfo) => {
  try {
    const options = {
      amount: Math.round(amount * 100), // Convert to paise
      currency: "INR",
      receipt: `order_${orderId}`,
      payment_capture: 1,
      notes: {
        order_id: orderId,
        customer_name: customerInfo.name,
        customer_email: customerInfo.email,
        customer_phone: customerInfo.phone,
      },
    };

    const order = await razorpay.orders.create(options);

    return {
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: order.status,
      short_url: `${process.env.FRONTEND_URL}/payment/razorpay/${order.id}`,
    };
  } catch (error) {
    console.error("Razorpay payment creation error:", error);
    throw new Error("Failed to create Razorpay payment");
  }
};

// Create Stripe payment
const createStripePayment = async (amount, orderId, customerInfo) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "inr",
            product_data: {
              name: `LocalIt Order #${orderId}`,
              description: "Local delivery order payment",
            },
            unit_amount: Math.round(amount * 100), // Convert to paise
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      customer_email: customerInfo.email,
      metadata: {
        order_id: orderId,
        customer_name: customerInfo.name,
        customer_phone: customerInfo.phone,
      },
      success_url: `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment/cancel?order_id=${orderId}`,
    });

    return {
      id: session.id,
      amount: amount * 100,
      currency: "inr",
      status: "pending",
      url: session.url,
    };
  } catch (error) {
    console.error("Stripe payment creation error:", error);
    throw new Error("Failed to create Stripe payment");
  }
};

// Verify Razorpay payment
const verifyRazorpayPayment = async (paymentId, orderId, signature) => {
  try {
    const crypto = require("crypto");

    // Verify signature - Razorpay format: "${razorpay_order_id}|${razorpay_payment_id}"
    const generated_signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    if (generated_signature !== signature) {
      throw new Error("Invalid payment signature");
    }

    // Get payment details from Razorpay
    const payment = await razorpay.payments.fetch(paymentId);

    // Find payment record using razorpay order ID (order_xxx)
    // Note: gatewayTransactionId stores the Razorpay order ID when payment was created
    const paymentRecord = await Payment.findOne({
      gatewayTransactionId: orderId, // orderId here is Razorpay order ID (order_xxx)
    });

    if (!paymentRecord) {
      throw new Error("Payment record not found");
    }

    return {
      verified: true,
      payment: {
        id: payment.id,
        amount: payment.amount / 100,
        status: payment.status,
        method: payment.method,
        captured: payment.captured,
        created_at: payment.created_at,
      },
      paymentRecordId: paymentRecord._id,
    };
  } catch (error) {
    console.error("Razorpay verification error:", error);
    return {
      verified: false,
      error: error.message,
    };
  }
};

// Verify Stripe payment
const verifyStripePayment = async (sessionId) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
      return {
        verified: true,
        payment: {
          id: session.payment_intent,
          amount: session.amount_total / 100,
          status: "paid",
          method: "card",
          created_at: session.created,
        },
      };
    } else {
      return {
        verified: false,
        error: "Payment not completed",
      };
    }
  } catch (error) {
    console.error("Stripe verification error:", error);
    return {
      verified: false,
      error: error.message,
    };
  }
};

// Process refund
const processRefund = async (paymentId, amount, reason) => {
  try {
    const payment = await Payment.findById(paymentId);

    if (!payment) {
      throw new Error("Payment not found");
    }

    if (payment.status !== "success") {
      throw new Error("Cannot refund unsuccessful payment");
    }

    let refundResponse = {};

    switch (payment.paymentGateway) {
      case "razorpay":
        refundResponse = await processRazorpayRefund(
          payment.gatewayTransactionId,
          amount,
          reason,
        );
        break;

      case "stripe":
        refundResponse = await processStripeRefund(
          payment.gatewayTransactionId,
          amount,
          reason,
        );
        break;

      case "cod":
        // For COD, mark refund as processed immediately
        refundResponse = {
          id: `cod_refund_${Date.now()}`,
          status: "processed",
          amount: amount,
        };
        break;

      default:
        throw new Error("Unsupported payment gateway for refund");
    }

    // Update payment record with refund
    await payment.addRefund(amount, reason, refundResponse.id);

    if (refundResponse.status === "processed") {
      await payment.updateRefundStatus(refundResponse.id, "processed");
    }

    return {
      success: true,
      refund: refundResponse,
    };
  } catch (error) {
    console.error("Refund processing error:", error);
    throw error;
  }
};

// Process Razorpay refund
const processRazorpayRefund = async (paymentId, amount, reason) => {
  try {
    const refund = await razorpay.payments.refund(paymentId, {
      amount: Math.round(amount * 100), // Convert to paise
      notes: {
        reason: reason,
        refund_type: "partial",
      },
    });

    return {
      id: refund.id,
      amount: refund.amount / 100,
      status: "processed",
      gateway_refund_id: refund.id,
    };
  } catch (error) {
    console.error("Razorpay refund error:", error);
    throw new Error("Failed to process Razorpay refund");
  }
};

// Process Stripe refund
const processStripeRefund = async (paymentIntentId, amount, reason) => {
  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: Math.round(amount * 100), // Convert to paise
      reason: "requested_by_customer",
      metadata: {
        reason: reason,
      },
    });

    return {
      id: refund.id,
      amount: refund.amount / 100,
      status: refund.status === "succeeded" ? "processed" : "initiated",
      gateway_refund_id: refund.id,
    };
  } catch (error) {
    console.error("Stripe refund error:", error);
    throw new Error("Failed to process Stripe refund");
  }
};

// Handle webhook events
const handleWebhook = async (source, event, signature) => {
  try {
    let isValid = false;

    // Verify webhook signature
    switch (source) {
      case "razorpay":
        isValid = verifyRazorpayWebhook(event, signature);
        break;
      case "stripe":
        isValid = verifyStripeWebhook(event, signature);
        break;
      default:
        throw new Error("Unknown webhook source");
    }

    if (!isValid) {
      throw new Error("Invalid webhook signature");
    }

    // Process webhook event
    await processWebhookEvent(source, event);

    return { success: true };
  } catch (error) {
    console.error("Webhook handling error:", error);
    throw error;
  }
};

// Verify Razorpay webhook
const verifyRazorpayWebhook = (payload, signature) => {
  try {
    const crypto = require("crypto");
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest("hex");

    return expectedSignature === signature;
  } catch (error) {
    return false;
  }
};

// Verify Stripe webhook
const verifyStripeWebhook = (payload, signature) => {
  try {
    stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
    return true;
  } catch (error) {
    return false;
  }
};

// Process webhook event
const processWebhookEvent = async (source, event) => {
  try {
    // Find payment by gateway transaction ID
    let gatewayTransactionId;
    let eventType;
    let eventData;

    if (source === "razorpay") {
      gatewayTransactionId = event.payload.payment.entity.order_id;
      eventType = event.event;
      eventData = event.payload.payment.entity;
    } else if (source === "stripe") {
      gatewayTransactionId = event.data.object.id;
      eventType = event.type;
      eventData = event.data.object;
    }

    const payment = await Payment.findOne({ gatewayTransactionId });

    if (!payment) {
      console.log(`Payment not found for webhook: ${gatewayTransactionId}`);
      return;
    }

    // Add webhook event to payment record
    await payment.addWebhookEvent(eventType, eventData);

    // Update payment status based on event
    switch (eventType) {
      case "payment.captured":
      case "checkout.session.completed":
        await payment.updateStatus("success", eventData);
        break;

      case "payment.failed":
      case "checkout.session.expired":
        await payment.updateStatus("failed", eventData);
        break;

      case "refund.processed":
        if (eventData.refund && eventData.refund.id) {
          await payment.updateRefundStatus(eventData.refund.id, "processed");
        }
        break;
    }
  } catch (error) {
    console.error("Webhook event processing error:", error);
    throw error;
  }
};

module.exports = {
  createPayment,
  verifyRazorpayPayment,
  verifyStripePayment,
  processRefund,
  handleWebhook,
};
