const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    unique: true,
    required: false // Will be auto-generated in pre-save middleware
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Customer ID is required']
  },
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    required: [true, 'Shop ID is required']
  },
  deliveryPartnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  items: [{
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1']
    },
    price: {
      type: Number,
      required: true,
      min: [0, 'Price cannot be negative']
    },
    discountPrice: Number,
    totalPrice: {
      type: Number,
      required: true,
      min: [0, 'Total price cannot be negative']
    }
  }],
  pricing: {
    subtotal: {
      type: Number,
      required: true,
      min: [0, 'Subtotal cannot be negative']
    },
    deliveryFee: {
      type: Number,
      default: 0,
      min: [0, 'Delivery fee cannot be negative']
    },
    tax: {
      type: Number,
      default: 0,
      min: [0, 'Tax cannot be negative']
    },
    discount: {
      type: Number,
      default: 0,
      min: [0, 'Discount cannot be negative']
    },
    total: {
      type: Number,
      required: true,
      min: [0, 'Total cannot be negative']
    }
  },
  deliveryAddress: {
    street: {
      type: String,
      required: true
    },
    city: {
      type: String,
      required: true
    },
    state: {
      type: String,
      required: true
    },
    pincode: {
      type: String,
      required: true
    },
    landmark: String,
    coordinates: {
      latitude: {
        type: Number,
        required: true
      },
      longitude: {
        type: Number,
        required: true
      }
    },
    contactName: String,
    contactPhone: String
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'cancelled', 'rejected'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['cod', 'card', 'upi', 'wallet', 'razorpay', 'stripe'],
    required: [true, 'Payment method is required']
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  couponCode: String,
  specialInstructions: String,
  timeline: [{
    status: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    note: String,
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  estimatedDeliveryTime: Date,
  actualDeliveryTime: Date,
  preparationTime: Number, // in minutes
  deliveryTime: Number, // in minutes
  rating: {
    overall: {
      type: Number,
      min: 1,
      max: 5
    },
    food: {
      type: Number,
      min: 1,
      max: 5
    },
    delivery: {
      type: Number,
      min: 1,
      max: 5
    },
    packaging: {
      type: Number,
      min: 1,
      max: 5
    },
    comment: String,
    submittedAt: Date
  },
  cancellationReason: String,
  refundAmount: {
    type: Number,
    default: 0,
    min: [0, 'Refund amount cannot be negative']
  },
  deliveryTracking: {
    pickupTime: Date,
    deliveryStartTime: Date,
    currentLocation: {
      latitude: Number,
      longitude: Number,
      timestamp: Date
    },
    route: [{
      latitude: Number,
      longitude: Number,
      timestamp: Date
    }]
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
orderSchema.index({ orderId: 1 });
orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ shopId: 1, status: 1 });
orderSchema.index({ deliveryPartnerId: 1, status: 1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ 'deliveryAddress.coordinates': '2dsphere' });

// Pre-save middleware to generate order ID
orderSchema.pre('save', function(next) {
  if (!this.orderId && this.isNew) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 4).toUpperCase();
    this.orderId = `ORD-${timestamp}-${random}`;
  }
  next();
});

// Pre-save middleware to add timeline entry
orderSchema.pre('save', function(next) {
  if (this.isModified('status') && !this.isNew) {
    this.timeline.push({
      status: this.status,
      timestamp: new Date(),
      note: `Order status updated to ${this.status}`
    });
  }
  next();
});

// Virtual for order age in minutes
orderSchema.virtual('ageInMinutes').get(function() {
  return Math.floor((Date.now() - this.createdAt.getTime()) / (1000 * 60));
});

// Virtual for estimated delivery remaining time
orderSchema.virtual('deliveryTimeRemaining').get(function() {
  if (!this.estimatedDeliveryTime) return null;
  const remaining = this.estimatedDeliveryTime.getTime() - Date.now();
  return Math.max(0, Math.floor(remaining / (1000 * 60))); // in minutes
});

// Virtual for order items count
orderSchema.virtual('itemsCount').get(function() {
  return this.items.reduce((total, item) => total + item.quantity, 0);
});

// Method to update status with timeline
orderSchema.methods.updateStatus = function(newStatus, note, updatedBy) {
  this.status = newStatus;
  this.timeline.push({
    status: newStatus,
    timestamp: new Date(),
    note: note || `Order status updated to ${newStatus}`,
    updatedBy
  });
  
  // Set specific timestamps based on status
  switch (newStatus) {
    case 'confirmed':
      this.estimatedDeliveryTime = new Date(Date.now() + 45 * 60000); // 45 minutes from now
      break;
    case 'out_for_delivery':
      this.deliveryTracking.deliveryStartTime = new Date();
      break;
    case 'delivered':
      this.actualDeliveryTime = new Date();
      this.paymentStatus = this.paymentMethod === 'cod' ? 'paid' : this.paymentStatus;
      break;
  }
};

// Method to calculate preparation time
orderSchema.methods.calculatePreparationTime = function() {
  const confirmed = this.timeline.find(t => t.status === 'confirmed');
  const ready = this.timeline.find(t => t.status === 'ready_for_pickup');
  
  if (confirmed && ready) {
    this.preparationTime = Math.floor((ready.timestamp - confirmed.timestamp) / (1000 * 60));
  }
};

// Method to calculate delivery time
orderSchema.methods.calculateDeliveryTime = function() {
  const outForDelivery = this.timeline.find(t => t.status === 'out_for_delivery');
  const delivered = this.timeline.find(t => t.status === 'delivered');
  
  if (outForDelivery && delivered) {
    this.deliveryTime = Math.floor((delivered.timestamp - outForDelivery.timestamp) / (1000 * 60));
  }
};

// Method to add rating
orderSchema.methods.addRating = function(ratingData) {
  this.rating = {
    ...ratingData,
    submittedAt: new Date()
  };
};

// Static method to get orders by status
orderSchema.statics.getOrdersByStatus = function(status, options = {}) {
  const { shopId, customerId, deliveryPartnerId, limit = 50, skip = 0 } = options;
  
  const query = { status };
  if (shopId) query.shopId = shopId;
  if (customerId) query.customerId = customerId;
  if (deliveryPartnerId) query.deliveryPartnerId = deliveryPartnerId;
  
  return this.find(query)
    .populate('customerId', 'fullName phone')
    .populate('shopId', 'name address contact')
    .populate('deliveryPartnerId', 'fullName phone')
    .populate('items.productId', 'name images')
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip);
};

// Static method for order analytics
orderSchema.statics.getOrderAnalytics = function(shopId, startDate, endDate) {
  const matchStage = {
    shopId: new mongoose.Types.ObjectId(shopId),
    createdAt: { $gte: startDate, $lte: endDate }
  };
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$pricing.total' },
        averageOrderValue: { $avg: '$pricing.total' },
        completedOrders: {
          $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
        },
        cancelledOrders: {
          $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
        }
      }
    }
  ]);
};

module.exports = mongoose.model('Order', orderSchema);
