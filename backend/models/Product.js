const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shop',
    required: [true, 'Shop ID is required']
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Category ID is required']
  },
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [100, 'Product name cannot exceed 100 characters']
  },
  description: {
    type: String,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  shortDescription: {
    type: String,
    maxlength: [200, 'Short description cannot exceed 200 characters'],
    trim: true
  },
  features: [String],
  boxContent: [String],
  warranty: {
    text: String,
    type: {
      type: String,
      enum: ['Brand Warranty', 'Seller Warranty', 'No Warranty'],
      default: 'Brand Warranty'
    },
    duration: String // e.g., "1 Year"
  },
  deliveryInfo: {
    standardDeliveryDays: {
      type: Number,
      default: 5
    },
    expressDeliveryDays: {
      type: Number,
      default: 2
    },
    isExpressAvailable: {
      type: Boolean,
      default: false
    }
  },
  stockLocations: [{
    location: String, // Warehouse ID or Name
    quantity: Number
  }],
  offers: [{
    code: String,
    description: String,
    discountPercentage: Number
  }],
  images: [{
    url: {
      type: String,
      required: true
    },
    alt: String,
    isPrimary: {
      type: Boolean,
      default: false
    }
  }],
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0, 'Price cannot be negative']
  },
  discountPrice: {
    type: Number,
    min: [0, 'Discount price cannot be negative'],
    validate: {
      validator: function(value) {
        return !value || value < this.price;
      },
      message: 'Discount price must be less than regular price'
    }
  },
  unit: {
    type: String,
    required: [true, 'Unit is required'],
    enum: ['kg', 'gram', 'liter', 'ml', 'piece', 'packet', 'box', 'bottle', 'dozen']
  },
  quantity: {
    type: Number,
    default: 1,
    min: [0.1, 'Quantity must be at least 0.1']
  },
  stock: {
    available: {
      type: Number,
      required: [true, 'Available stock is required'],
      min: [0, 'Stock cannot be negative']
    },
    reserved: {
      type: Number,
      default: 0,
      min: [0, 'Reserved stock cannot be negative']
    },
    lowStockThreshold: {
      type: Number,
      default: 5,
      min: [0, 'Low stock threshold cannot be negative']
    }
  },
  status: {
    type: String,
    enum: ['in_stock', 'out_of_stock', 'low_stock', 'discontinued'],
    default: 'in_stock'
  },
  specifications: [{
    key: String,
    value: String
  }],
  tags: [String],
  sku: {
    type: String,
    unique: true,
    sparse: true
  },
  barcode: {
    type: String,
    unique: true,
    sparse: true
  },
  rating: {
    average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    count: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  nutrition: {
    calories: Number,
    protein: Number,
    carbs: Number,
    fat: Number,
    fiber: Number,
    sugar: Number
  },
  allergens: [String],
  expiryDate: Date,
  manufacturingDate: Date,
  brand: String,
  manufacturer: String,
  isActive: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  viewCount: {
    type: Number,
    default: 0
  },
  salesCount: {
    type: Number,
    default: 0
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
productSchema.index({ shopId: 1, isActive: 1 });
productSchema.index({ categoryId: 1 });
productSchema.index({ name: 'text', description: 'text' });
productSchema.index({ price: 1 });
productSchema.index({ 'rating.average': -1 });
productSchema.index({ salesCount: -1 });
productSchema.index({ tags: 1 });
productSchema.index({ categoryId: 1, price: 1 });
productSchema.index({ categoryId: 1, 'rating.average': -1 });
productSchema.index({ tags: 1, isActive: 1 });
productSchema.index({ sku: 1 });
productSchema.index({ barcode: 1 });

// Virtual for effective price (considering discount)
productSchema.virtual('effectivePrice').get(function() {
  return this.discountPrice || this.price;
});

// Virtual for discount percentage
productSchema.virtual('discountPercentage').get(function() {
  if (!this.discountPrice) return 0;
  return Math.round(((this.price - this.discountPrice) / this.price) * 100);
});

// Virtual for availability status
productSchema.virtual('isAvailable').get(function() {
  return this.isActive && this.status === 'in_stock' && this.stock.available > 0;
});

// Virtual for stock status
productSchema.virtual('stockStatus').get(function() {
  if (this.stock.available <= 0) return 'out_of_stock';
  if (this.stock.available <= this.stock.lowStockThreshold) return 'low_stock';
  return 'in_stock';
});

// Pre-save middleware to update stock status
productSchema.pre('save', function(next) {
  if (this.isModified('stock.available')) {
    if (this.stock.available <= 0) {
      this.status = 'out_of_stock';
    } else if (this.stock.available <= this.stock.lowStockThreshold) {
      this.status = 'low_stock';
    } else {
      this.status = 'in_stock';
    }
  }
  next();
});

// Pre-save middleware to generate SKU if not provided
productSchema.pre('save', function(next) {
  if (!this.sku && this.isNew) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    this.sku = `SKU-${timestamp}-${random}`.toUpperCase();
  }
  next();
});

// Method to update rating
productSchema.methods.updateRating = function(newRating) {
  const totalRating = (this.rating.average * this.rating.count) + newRating;
  this.rating.count += 1;
  this.rating.average = totalRating / this.rating.count;
};

// Method to reserve stock
productSchema.methods.reserveStock = function(quantity) {
  if (this.stock.available < quantity) {
    throw new Error('Insufficient stock available');
  }
  this.stock.available -= quantity;
  this.stock.reserved += quantity;
};

// Method to release reserved stock
productSchema.methods.releaseStock = function(quantity) {
  this.stock.reserved = Math.max(0, this.stock.reserved - quantity);
  this.stock.available += quantity;
};

// Method to confirm stock usage
productSchema.methods.confirmStockUsage = function(quantity) {
  this.stock.reserved = Math.max(0, this.stock.reserved - quantity);
  this.salesCount += quantity;
};

// Method to increment view count
productSchema.methods.incrementView = function() {
  this.viewCount += 1;
  return this.save({ validateBeforeSave: false });
};

// Static method for search
productSchema.statics.searchProducts = function(query, options = {}) {
  const {
    shopId,
    categoryId,
    minPrice,
    maxPrice,
    inStock = true,
    sortBy = 'name',
    sortOrder = 1,
    limit = 20,
    skip = 0
  } = options;

  const searchCriteria = {
    isActive: true,
    ...(shopId && { shopId }),
    ...(categoryId && { categoryId }),
    ...(inStock && { status: 'in_stock' }),
    ...(minPrice && { $or: [{ discountPrice: { $gte: minPrice } }, { $and: [{ discountPrice: { $exists: false } }, { price: { $gte: minPrice } }] }] }),
    ...(maxPrice && { $or: [{ discountPrice: { $lte: maxPrice } }, { $and: [{ discountPrice: { $exists: false } }, { price: { $lte: maxPrice } }] }] })
  };

  if (query) {
    searchCriteria.$text = { $search: query };
  }

  return this.find(searchCriteria)
    .populate('shopId', 'name address rating')
    .populate('categoryId', 'name')
    .sort({ [sortBy]: sortOrder })
    .limit(limit)
    .skip(skip);
};

// Index in Meilisearch after save
productSchema.post('save', async function(doc) {
  try {
    const meiliSearchService = require('../services/meiliSearchService');
    await doc.populate('shopId categoryId');
    await meiliSearchService.indexProduct(doc);
    console.log(`Synced product ${doc._id} to Meilisearch`);
  } catch (error) {
    console.error(`Failed to sync product ${doc._id} to Meilisearch:`, error);
  }
});

// Remove from Meilisearch after remove
productSchema.post('remove', async function(doc) {
  try {
    const meiliSearchService = require('../services/meiliSearchService');
    await meiliSearchService.deleteProduct(doc._id);
    console.log(`Removed product ${doc._id} from Meilisearch`);
  } catch (error) {
    console.error(`Failed to remove product ${doc._id} from Meilisearch:`, error);
  }
});

// Index in Meilisearch after update
productSchema.post(/^findOneAnd/, async function(doc) {
  if (doc) {
    try {
      const meiliSearchService = require('../services/meiliSearchService');
      await doc.populate('shopId categoryId');
      await meiliSearchService.indexProduct(doc);
      console.log(`Synced updated product ${doc._id} to Meilisearch`);
    } catch (error) {
      console.error(`Failed to sync updated product ${doc._id} to Meilisearch:`, error);
    }
  }
});

module.exports = mongoose.model('Product', productSchema);
