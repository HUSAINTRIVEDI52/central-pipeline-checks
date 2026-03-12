const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: [true, 'Coupon code is required'],
    unique: true,
    uppercase: true,
    trim: true,
    minlength: [3, 'Coupon code must be at least 3 characters'],
    maxlength: [20, 'Coupon code cannot exceed 20 characters']
  },
  name: {
    type: String,
    required: [true, 'Coupon name is required'],
    maxlength: [100, 'Coupon name cannot exceed 100 characters']
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    default: null // null means platform-wide coupon
  },
  discountType: {
    type: String,
    enum: ['percentage', 'fixed_amount', 'free_delivery'],
    required: [true, 'Discount type is required']
  },
  discountValue: {
    type: Number,
    required: [true, 'Discount value is required'],
    min: [0, 'Discount value cannot be negative']
  },
  maxDiscountAmount: {
    type: Number,
    min: [0, 'Maximum discount amount cannot be negative']
  },
  minimumOrderAmount: {
    type: Number,
    required: [true, 'Minimum order amount is required'],
    min: [0, 'Minimum order amount cannot be negative'],
    default: 0
  },
  applicableCategories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  applicableProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  userType: {
    type: String,
    enum: ['all', 'new_users', 'existing_users', 'specific_users'],
    default: 'all'
  },
  applicableUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  usageLimit: {
    total: {
      type: Number,
      min: [1, 'Total usage limit must be at least 1']
    },
    perUser: {
      type: Number,
      default: 1,
      min: [1, 'Per user limit must be at least 1']
    }
  },
  usageCount: {
    total: {
      type: Number,
      default: 0,
      min: [0, 'Usage count cannot be negative']
    },
    users: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      count: {
        type: Number,
        default: 0,
        min: [0, 'User usage count cannot be negative']
      },
      lastUsed: Date
    }]
  },
  validFrom: {
    type: Date,
    required: [true, 'Valid from date is required']
  },
  validUntil: {
    type: Date,
    required: [true, 'Valid until date is required']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isVisible: {
    type: Boolean,
    default: true
  },
  terms: {
    type: String,
    maxlength: [1000, 'Terms cannot exceed 1000 characters']
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Creator is required']
  },
  metadata: {
    campaignName: String,
    source: {
      type: String,
      enum: ['admin_panel', 'shop_dashboard', 'api', 'bulk_import']
    },
    tags: [String]
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
couponSchema.index({ code: 1 });
couponSchema.index({ shopId: 1, isActive: 1 });
couponSchema.index({ validFrom: 1, validUntil: 1 });
couponSchema.index({ isActive: 1, validFrom: 1, validUntil: 1 });
couponSchema.index({ applicableCategories: 1 });
couponSchema.index({ createdBy: 1 });

// Virtual for whether coupon is currently valid
couponSchema.virtual('isCurrentlyValid').get(function() {
  const now = new Date();
  return this.isActive && 
         now >= this.validFrom && 
         now <= this.validUntil &&
         (!this.usageLimit.total || this.usageCount.total < this.usageLimit.total);
});

// Virtual for usage percentage
couponSchema.virtual('usagePercentage').get(function() {
  if (!this.usageLimit.total) return 0;
  return (this.usageCount.total / this.usageLimit.total) * 100;
});

// Pre-save validation
couponSchema.pre('save', function(next) {
  // Validate dates
  if (this.validUntil <= this.validFrom) {
    return next(new Error('Valid until date must be after valid from date'));
  }
  
  // Validate discount value for percentage type
  if (this.discountType === 'percentage' && this.discountValue > 100) {
    return next(new Error('Percentage discount cannot exceed 100%'));
  }
  
  // Ensure max discount is set for percentage coupons
  if (this.discountType === 'percentage' && !this.maxDiscountAmount) {
    return next(new Error('Maximum discount amount is required for percentage coupons'));
  }
  
  next();
});

// Method to check if user can use this coupon
couponSchema.methods.canUserUse = function(userId, orderAmount = 0) {
  const errors = [];
  
  // Check if coupon is active and valid
  if (!this.isCurrentlyValid) {
    errors.push('Coupon is not currently valid');
  }
  
  // Check minimum order amount
  if (orderAmount < this.minimumOrderAmount) {
    errors.push(`Minimum order amount is ₹${this.minimumOrderAmount}`);
  }
  
  // Check user type restrictions
  if (this.userType === 'specific_users' && !this.applicableUsers.includes(userId)) {
    errors.push('This coupon is not applicable for your account');
  }
  
  // Check per-user usage limit
  const userUsage = this.usageCount.users.find(u => u.userId.toString() === userId.toString());
  if (userUsage && userUsage.count >= this.usageLimit.perUser) {
    errors.push('You have already used this coupon the maximum number of times');
  }
  
  return {
    canUse: errors.length === 0,
    errors
  };
};

// Method to calculate discount amount
couponSchema.methods.calculateDiscount = function(orderAmount, deliveryFee = 0) {
  if (!this.isCurrentlyValid) {
    return { discount: 0, error: 'Coupon is not valid' };
  }
  
  let discount = 0;
  
  switch (this.discountType) {
    case 'percentage':
      discount = (orderAmount * this.discountValue) / 100;
      if (this.maxDiscountAmount && discount > this.maxDiscountAmount) {
        discount = this.maxDiscountAmount;
      }
      break;
      
    case 'fixed_amount':
      discount = Math.min(this.discountValue, orderAmount);
      break;
      
    case 'free_delivery':
      discount = deliveryFee;
      break;
  }
  
  return {
    discount: Math.round(discount * 100) / 100, // Round to 2 decimal places
    discountType: this.discountType,
    appliedValue: this.discountValue
  };
};

// Method to use coupon
couponSchema.methods.useCoupon = function(userId) {
  // Increment total usage
  this.usageCount.total += 1;
  
  // Update user usage
  const userUsageIndex = this.usageCount.users.findIndex(
    u => u.userId.toString() === userId.toString()
  );
  
  if (userUsageIndex > -1) {
    this.usageCount.users[userUsageIndex].count += 1;
    this.usageCount.users[userUsageIndex].lastUsed = new Date();
  } else {
    this.usageCount.users.push({
      userId,
      count: 1,
      lastUsed: new Date()
    });
  }
  
  return this.save();
};

// Static method to validate coupon code
couponSchema.statics.validateCouponCode = async function(code, userId, orderAmount, shopId = null) {
  const coupon = await this.findOne({
    code: code.toUpperCase(),
    isActive: true
  });
  
  if (!coupon) {
    return { valid: false, error: 'Invalid coupon code' };
  }
  
  // Check if coupon is shop-specific
  if (coupon.shopId && shopId && coupon.shopId.toString() !== shopId.toString()) {
    return { valid: false, error: 'This coupon is not valid for this shop' };
  }
  
  // Check if user can use the coupon
  const canUse = coupon.canUserUse(userId, orderAmount);
  
  if (!canUse.canUse) {
    return { valid: false, error: canUse.errors[0] };
  }
  
  return { valid: true, coupon };
};

// Static method to get available coupons for user
couponSchema.statics.getAvailableCoupons = function(userId, shopId = null, orderAmount = 0) {
  const now = new Date();
  const query = {
    isActive: true,
    isVisible: true,
    validFrom: { $lte: now },
    validUntil: { $gte: now },
    minimumOrderAmount: { $lte: orderAmount }
  };
  
  // Add shop filter
  if (shopId) {
    query.$or = [
      { shopId: shopId },
      { shopId: null } // Platform-wide coupons
    ];
  } else {
    query.shopId = null; // Only platform-wide coupons
  }
  
  return this.find(query)
    .populate('shopId', 'name')
    .sort({ discountValue: -1 })
    .limit(20);
};

// Static method to get coupon analytics
couponSchema.statics.getCouponAnalytics = function(startDate, endDate, shopId = null) {
  const matchStage = {
    createdAt: { $gte: startDate, $lte: endDate }
  };
  
  if (shopId) {
    matchStage.shopId = new mongoose.Types.ObjectId(shopId);
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$discountType',
        totalCoupons: { $sum: 1 },
        totalUsage: { $sum: '$usageCount.total' },
        activeCoupons: { $sum: { $cond: ['$isActive', 1, 0] } },
        avgDiscountValue: { $avg: '$discountValue' }
      }
    }
  ]);
};

// Static method to cleanup expired coupons
couponSchema.statics.cleanupExpired = function() {
  const now = new Date();
  return this.updateMany(
    { validUntil: { $lt: now }, isActive: true },
    { $set: { isActive: false } }
  );
};

module.exports = mongoose.model('Coupon', couponSchema);
