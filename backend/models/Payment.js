const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: [true, 'Order ID is required']
  },
  transactionId: {
    type: String,
    unique: true,
    sparse: true, // Allow null values for unique index
    required: false // Will be auto-generated in pre-save middleware
  },
  paymentGateway: {
    type: String,
    enum: ['razorpay', 'stripe', 'cod'],
    required: [true, 'Payment gateway is required']
  },
  gatewayTransactionId: String, // ID from payment gateway (Razorpay/Stripe)
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [0, 'Amount cannot be negative']
  },
  currency: {
    type: String,
    default: 'INR',
    enum: ['INR', 'USD']
  },
  status: {
    type: String,
    enum: ['initiated', 'pending', 'success', 'failed', 'refunded', 'partial_refund'],
    default: 'initiated'
  },
  paymentMethod: {
    type: String,
    enum: ['cod', 'card', 'upi', 'netbanking', 'wallet'],
    required: [true, 'Payment method is required']
  },
  gatewayResponse: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  refunds: [{
    refundId: String,
    amount: {
      type: Number,
      min: [0, 'Refund amount cannot be negative']
    },
    reason: String,
    status: {
      type: String,
      enum: ['initiated', 'processed', 'failed']
    },
    initiatedAt: {
      type: Date,
      default: Date.now
    },
    processedAt: Date,
    gatewayRefundId: String
  }],
  failureReason: String,
  attempts: {
    type: Number,
    default: 1,
    min: 1
  },
  metadata: {
    customerIP: String,
    userAgent: String,
    paymentLink: String
  },
  webhookEvents: [{
    event: String,
    data: mongoose.Schema.Types.Mixed,
    receivedAt: {
      type: Date,
      default: Date.now
    }
  }],
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
paymentSchema.index({ orderId: 1 });
paymentSchema.index({ transactionId: 1 });
paymentSchema.index({ gatewayTransactionId: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ createdAt: -1 });

// Pre-save middleware to generate transaction ID
paymentSchema.pre('save', function(next) {
  if (!this.transactionId && this.isNew) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 6).toUpperCase();
    this.transactionId = `TXN-${timestamp}-${random}`;
  }
  next();
});

// Virtual for total refunded amount
paymentSchema.virtual('totalRefunded').get(function() {
  return this.refunds.reduce((total, refund) => {
    return refund.status === 'processed' ? total + refund.amount : total;
  }, 0);
});

// Virtual for refundable amount
paymentSchema.virtual('refundableAmount').get(function() {
  if (this.status !== 'success') return 0;
  return this.amount - this.totalRefunded;
});

// Method to update payment status
paymentSchema.methods.updateStatus = function(status, gatewayResponse = {}, failureReason = null) {
  this.status = status;
  
  if (Object.keys(gatewayResponse).length > 0) {
    this.gatewayResponse = { ...this.gatewayResponse, ...gatewayResponse };
  }
  
  if (failureReason) {
    this.failureReason = failureReason;
  }
  
  return this.save();
};

// Method to add refund
paymentSchema.methods.addRefund = function(amount, reason, refundId = null) {
  if (this.status !== 'success') {
    throw new Error('Cannot refund a payment that is not successful');
  }
  
  if (amount > this.refundableAmount) {
    throw new Error('Refund amount exceeds refundable amount');
  }
  
  const refund = {
    refundId: refundId || `REF-${Date.now().toString(36).toUpperCase()}`,
    amount,
    reason,
    status: 'initiated'
  };
  
  this.refunds.push(refund);
  
  // Update payment status based on refund amount
  if (amount === this.refundableAmount) {
    this.status = 'refunded';
  } else {
    this.status = 'partial_refund';
  }
  
  return this.save();
};

// Method to update refund status
paymentSchema.methods.updateRefundStatus = function(refundId, status, gatewayRefundId = null) {
  const refund = this.refunds.find(r => r.refundId === refundId);
  
  if (!refund) {
    throw new Error('Refund not found');
  }
  
  refund.status = status;
  
  if (status === 'processed') {
    refund.processedAt = new Date();
  }
  
  if (gatewayRefundId) {
    refund.gatewayRefundId = gatewayRefundId;
  }
  
  return this.save();
};

// Method to add webhook event
paymentSchema.methods.addWebhookEvent = function(event, data) {
  this.webhookEvents.push({
    event,
    data,
    receivedAt: new Date()
  });
  
  return this.save({ validateBeforeSave: false });
};

// Method to increment attempt count
paymentSchema.methods.incrementAttempt = function() {
  this.attempts += 1;
  return this.save({ validateBeforeSave: false });
};

// Static method to get payment analytics
paymentSchema.statics.getPaymentAnalytics = function(startDate, endDate, shopId = null) {
  const matchStage = {
    createdAt: { $gte: startDate, $lte: endDate }
  };
  
  const pipeline = [
    { $match: matchStage }
  ];
  
  if (shopId) {
    pipeline.push({
      $lookup: {
        from: 'orders',
        localField: 'orderId',
        foreignField: '_id',
        as: 'order'
      }
    });
    pipeline.push({
      $match: {
        'order.shopId': new mongoose.Types.ObjectId(shopId)
      }
    });
  }
  
  pipeline.push({
    $group: {
      _id: null,
      totalTransactions: { $sum: 1 },
      totalAmount: { $sum: '$amount' },
      successfulTransactions: {
        $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
      },
      failedTransactions: {
        $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
      },
      totalRefunded: {
        $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, '$amount', 0] }
      },
      codTransactions: {
        $sum: { $cond: [{ $eq: ['$paymentMethod', 'cod'] }, 1, 0] }
      },
      onlineTransactions: {
        $sum: { $cond: [{ $ne: ['$paymentMethod', 'cod'] }, 1, 0] }
      }
    }
  });
  
  return this.aggregate(pipeline);
};

// Static method to get failed payments that can be retried
paymentSchema.statics.getRetryablePayments = function(maxAttempts = 3) {
  return this.find({
    status: 'failed',
    attempts: { $lt: maxAttempts },
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
  }).populate('orderId');
};

module.exports = mongoose.model('Payment', paymentSchema);
