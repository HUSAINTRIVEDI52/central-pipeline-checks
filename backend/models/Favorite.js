const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true
  },
  items: [{
    itemType: {
      type: String,
      enum: ['product', 'shop'],
      required: true
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'items.itemType'
    },
    addedAt: {
      type: Date,
      default: Date.now
    },
    notes: {
      type: String,
      maxlength: [500, 'Notes cannot exceed 500 characters']
    }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound index to ensure userId is unique
favoriteSchema.index({ userId: 1 }, { unique: true });
favoriteSchema.index({ 'items.itemId': 1, 'items.itemType': 1 });
favoriteSchema.index({ userId: 1, 'items.addedAt': -1 });

// Virtual for total favorites count
favoriteSchema.virtual('totalFavorites').get(function() {
  return this.items.length;
});

// Virtual for products count
favoriteSchema.virtual('productsCount').get(function() {
  return this.items.filter(item => item.itemType === 'product').length;
});

// Virtual for shops count
favoriteSchema.virtual('shopsCount').get(function() {
  return this.items.filter(item => item.itemType === 'shop').length;
});

// Method to add favorite
favoriteSchema.methods.addFavorite = function(itemType, itemId, notes = '') {
  // Check if item already exists in favorites
  const exists = this.items.some(
    item => item.itemId.toString() === itemId.toString() && item.itemType === itemType
  );
  
  if (exists) {
    throw new Error('Item already in favorites');
  }
  
  this.items.push({
    itemType,
    itemId,
    addedAt: new Date(),
    notes
  });
  
  return this.save();
};

// Method to remove favorite
favoriteSchema.methods.removeFavorite = function(itemType, itemId) {
  this.items = this.items.filter(
    item => !(item.itemId.toString() === itemId.toString() && item.itemType === itemType)
  );
  
  return this.save();
};

// Method to check if item is favorited
favoriteSchema.methods.isFavorite = function(itemType, itemId) {
  return this.items.some(
    item => item.itemId.toString() === itemId.toString() && item.itemType === itemType
  );
};

// Method to toggle favorite
favoriteSchema.methods.toggleFavorite = async function(itemType, itemId, notes = '') {
  const isFav = this.isFavorite(itemType, itemId);
  
  if (isFav) {
    return this.removeFavorite(itemType, itemId);
  } else {
    return this.addFavorite(itemType, itemId, notes);
  }
};

// Method to clear all favorites
favoriteSchema.methods.clearAll = function() {
  this.items = [];
  return this.save();
};

// Method to clear favorites by type
favoriteSchema.methods.clearByType = function(itemType) {
  this.items = this.items.filter(item => item.itemType !== itemType);
  return this.save();
};

// Method to update notes
favoriteSchema.methods.updateNotes = function(itemType, itemId, notes) {
  const item = this.items.find(
    item => item.itemId.toString() === itemId.toString() && item.itemType === itemType
  );
  
  if (!item) {
    throw new Error('Item not found in favorites');
  }
  
  item.notes = notes;
  return this.save();
};

// Method to get favorites with populated details
favoriteSchema.methods.getFavoritesWithDetails = async function(itemType = null) {
  const query = itemType ? { 'items.itemType': itemType } : {};
  
  await this.populate({
    path: 'items.itemId',
    select: function() {
      return this.itemType === 'product' 
        ? 'name price discountPrice images unit stock status shopId'
        : 'name description address rating isActive isOpen';
    }
  });
  
  return itemType 
    ? this.items.filter(item => item.itemType === itemType)
    : this.items;
};

// Static method to get or create favorites for user
favoriteSchema.statics.getOrCreateFavorites = async function(userId) {
  let favorites = await this.findOne({ userId });
  
  if (!favorites) {
    favorites = new this({ userId, items: [] });
    await favorites.save();
  }
  
  return favorites;
};

// Static method to check if item is in user's favorites
favoriteSchema.statics.isUserFavorite = async function(userId, itemType, itemId) {
  const favorites = await this.findOne({ 
    userId,
    'items.itemType': itemType,
    'items.itemId': itemId
  });
  
  return !!favorites;
};

// Static method to get user's favorite products
favoriteSchema.statics.getUserFavoriteProducts = async function(userId) {
  const favorites = await this.findOne({ userId })
    .populate({
      path: 'items.itemId',
      match: { itemType: 'product' },
      select: 'name price discountPrice images unit stock status'
    });
  
  return favorites ? favorites.items.filter(item => item.itemType === 'product') : [];
};

// Static method to get user's favorite shops
favoriteSchema.statics.getUserFavoriteShops = async function(userId) {
  const favorites = await this.findOne({ userId })
    .populate({
      path: 'items.itemId',
      match: { itemType: 'shop' },
      select: 'name description address rating isActive isOpen'
    });
  
  return favorites ? favorites.items.filter(item => item.itemType === 'shop') : [];
};

module.exports = mongoose.model('Favorite', favoriteSchema);
