const mongoose = require('mongoose');

const cartSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    unique: true
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
      min: [1, 'Quantity must be at least 1'],
      max: [50, 'Maximum quantity per item is 50']
    },
    addedAt: {
      type: Date,
      default: Date.now
    },
    notes: String
  }],
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    default: null
  },
  couponCode: String,
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
cartSchema.index({ userId: 1 });
cartSchema.index({ 'items.productId': 1 });
cartSchema.index({ lastUpdated: 1 });

// Virtual for total items count
cartSchema.virtual('totalItems').get(function() {
  return this.items.reduce((total, item) => total + item.quantity, 0);
});

// Virtual for items count (unique products)
cartSchema.virtual('itemsCount').get(function() {
  return this.items.length;
});

// Pre-save middleware to update lastUpdated
cartSchema.pre('save', function(next) {
  this.lastUpdated = new Date();
  next();
});

// Method to add item to cart
cartSchema.methods.addItem = async function(productId, quantity = 1, shopId) {
  if (quantity < 1) {
    throw new Error('Quantity must be at least 1');
  }

  // Check if item already exists in cart
  const existingItemIndex = this.items.findIndex(
    item => item.productId.toString() === productId.toString()
  );

  // If cart is empty or from different shop, set the shop
  if (this.items.length === 0 || !this.shopId) {
    this.shopId = shopId;
  }

  // Validate shop consistency (all items must be from same shop)
  if (this.shopId && this.shopId.toString() !== shopId.toString()) {
    throw new Error('Cannot add items from different shops. Please clear cart first.');
  }

  if (existingItemIndex > -1) {
    // Update quantity if item exists
    this.items[existingItemIndex].quantity += quantity;
    
    // Ensure quantity doesn't exceed maximum
    if (this.items[existingItemIndex].quantity > 50) {
      this.items[existingItemIndex].quantity = 50;
    }
  } else {
    // Add new item to cart
    this.items.push({
      productId,
      quantity,
      addedAt: new Date()
    });
  }

  return this.save();
};

// Method to update item quantity
cartSchema.methods.updateItemQuantity = function(productId, quantity) {
  const itemIndex = this.items.findIndex(
    item => item.productId.toString() === productId.toString()
  );

  if (itemIndex === -1) {
    throw new Error('Item not found in cart');
  }

  if (quantity <= 0) {
    // Remove item if quantity is 0 or negative
    this.items.splice(itemIndex, 1);
  } else {
    // Update quantity
    this.items[itemIndex].quantity = Math.min(quantity, 50);
  }

  // Clear shopId if no items left
  if (this.items.length === 0) {
    this.shopId = null;
    this.couponCode = null;
  }

  return this.save();
};

// Method to remove item from cart
cartSchema.methods.removeItem = function(productId) {
  this.items = this.items.filter(
    item => item.productId.toString() !== productId.toString()
  );

  // Clear shopId if no items left
  if (this.items.length === 0) {
    this.shopId = null;
    this.couponCode = null;
  }

  return this.save();
};

// Method to clear cart
cartSchema.methods.clearCart = function() {
  this.items = [];
  this.shopId = null;
  this.couponCode = null;
  return this.save();
};

// Method to apply coupon
cartSchema.methods.applyCoupon = function(couponCode) {
  this.couponCode = couponCode;
  return this.save();
};

// Method to remove coupon
cartSchema.methods.removeCoupon = function() {
  this.couponCode = null;
  return this.save();
};

// Method to get cart with populated product details
cartSchema.methods.getCartWithProducts = async function () {
  // Use await and chain all population options within a single call
  // using an array of objects.
  return await this.populate([
    {
      // Populate the product details
      path: "items.productId",
      select: "name price discountPrice images unit quantity stock status",
      // Populate the shop ID within the product
      populate: {
        path: "shopId",
        select: "name address deliveryFee minimumOrderAmount",
      },
    },
    {
      // Populate the main shop ID (top level)
      path: "shopId",
      select:
        "name address deliveryFee minimumOrderAmount operatingHours isOpen",
    },
  ]);
};
// Method to calculate cart totals
cartSchema.methods.calculateTotals = async function() {
  await this.populate('items.productId shopId');
  
  let subtotal = 0;
  let totalItems = 0;
  const unavailableItems = [];

  // Calculate subtotal and check availability
  for (const item of this.items) {
    const product = item.productId;
    
    if (!product) {
      unavailableItems.push({
        productId: item.productId, // This might be the ID if not populated, or null if populated and missing
        productName: 'Unknown Product',
        reason: 'Product no longer exists'
      });
      continue;
    }
    
    if (!product.isActive || product.status !== 'in_stock') {
      unavailableItems.push({
        productId: product._id,
        productName: product.name,
        reason: 'Product unavailable'
      });
      continue;
    }

    if (product.stock.available < item.quantity) {
      unavailableItems.push({
        productId: product._id,
        productName: product.name,
        reason: `Only ${product.stock.available} items available`
      });
      continue;
    }

    const effectivePrice = product.discountPrice || product.price;
    subtotal += effectivePrice * item.quantity;
    totalItems += item.quantity;
  }

  // Get shop details for delivery fee and minimum order
  const shop = this.shopId;
  const deliveryFee = shop ? shop.deliveryFee : 0;
  const minimumOrderAmount = shop ? shop.minimumOrderAmount : 0;

  // Calculate tax (assuming 5% tax)
  const tax = subtotal * 0.05;
  
  // Calculate total
  const total = subtotal + deliveryFee + tax;

  return {
    subtotal,
    deliveryFee,
    tax,
    total,
    totalItems,
    itemsCount: this.items.length,
    minimumOrderAmount,
    isMinimumMet: subtotal >= minimumOrderAmount,
    unavailableItems,
    couponCode: this.couponCode
  };
};

// Method to validate cart before checkout
cartSchema.methods.validateForCheckout = async function() {
  const totals = await this.calculateTotals();
  const errors = [];

  // Check if cart is empty
  if (this.items.length === 0) {
    errors.push('Cart is empty');
  }

  // Check if shop is available
  if (!this.shopId) {
    errors.push('No shop selected');
  } else {
    await this.populate('shopId');
    const shop = this.shopId;
    
    if (!shop) {
      errors.push('Shop no longer exists');
    } else if (!shop.isActive || !shop.isOpen) {
      errors.push('Shop is currently closed');
    }
  }

  // Check unavailable items
  if (totals.unavailableItems.length > 0) {
    errors.push(`${totals.unavailableItems.length} item(s) are unavailable`);
  }

  // Check minimum order amount
  if (!totals.isMinimumMet) {
    errors.push(`Minimum order amount is ₹${totals.minimumOrderAmount}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    totals
  };
};

// Static method to get or create cart for user
cartSchema.statics.getOrCreateCart = async function(userId) {
  let cart = await this.findOne({ userId });
  
  if (!cart) {
    cart = new this({ userId, items: [] });
    await cart.save();
  }

  return cart;
};

// Static method to cleanup old carts (items added more than 7 days ago)
cartSchema.statics.cleanupOldCarts = async function() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const result = await this.updateMany(
    { 'items.addedAt': { $lt: sevenDaysAgo } },
    { $pull: { items: { addedAt: { $lt: sevenDaysAgo } } } }
  );

  // Remove empty carts after cleanup
  await this.deleteMany({ items: { $size: 0 } });
  
  return result;
};

module.exports = mongoose.model('Cart', cartSchema);
