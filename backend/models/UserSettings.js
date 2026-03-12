const mongoose = require('mongoose');

const userSettingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    unique: true,
    index: true
  },
  notifications: {
    push: {
      enabled: { type: Boolean, default: true },
      orderUpdates: { type: Boolean, default: true },
      promotions: { type: Boolean, default: true },
      newProducts: { type: Boolean, default: false },
      chatMessages: { type: Boolean, default: true },
      deliveryUpdates: { type: Boolean, default: true }
    },
    email: {
      enabled: { type: Boolean, default: true },
      orderUpdates: { type: Boolean, default: true },
      promotions: { type: Boolean, default: false },
      newsletter: { type: Boolean, default: false }
    },
    sms: {
      enabled: { type: Boolean, default: true },
      orderUpdates: { type: Boolean, default: true },
      deliveryUpdates: { type: Boolean, default: true }
    }
  },
  privacy: {
    showProfile: { type: Boolean, default: true },
    showOrders: { type: Boolean, default: false },
    showReviews: { type: Boolean, default: true },
    allowDataCollection: { type: Boolean, default: true },
    shareLocationAlways: { type: Boolean, default: false }
  },
  preferences: {
    language: {
      type: String,
      enum: ['en', 'hi', 'ta', 'te', 'kn', 'ml', 'bn', 'gu', 'mr', 'pa'],
      default: 'en'
    },
    currency: {
      type: String,
      enum: ['INR', 'USD', 'EUR', 'GBP'],
      default: 'INR'
    },
    theme: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'auto'
    },
    fontSize: {
      type: String,
      enum: ['small', 'medium', 'large'],
      default: 'medium'
    },
    defaultView: {
      type: String,
      enum: ['grid', 'list'],
      default: 'grid'
    }
  },
  delivery: {
    defaultAddressId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Address',
      default: null
    },
    preferredDeliveryTime: {
      type: String,
      enum: ['morning', 'afternoon', 'evening', 'night', 'anytime'],
      default: 'anytime'
    },
    leaveAtDoor: { type: Boolean, default: false },
    contactlessDelivery: { type: Boolean, default: false },
    deliveryInstructions: {
      type: String,
      maxlength: [500, 'Delivery instructions cannot exceed 500 characters']
    }
  },
  payment: {
    defaultPaymentMethod: {
      type: String,
      enum: ['cash', 'card', 'upi', 'wallet', 'netbanking'],
      default: 'cash'
    },
    saveCards: { type: Boolean, default: false },
    preferredUPI: { type: String, default: '' }
  },
  shopping: {
    autoAddToCart: { type: Boolean, default: false },
    showOutOfStock: { type: Boolean, default: true },
    sortBy: {
      type: String,
      enum: ['relevance', 'price_low', 'price_high', 'rating', 'newest', 'popular'],
      default: 'relevance'
    },
    priceRange: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 10000 }
    },
    preferredCategories: [{
      type: String,
      trim: true
    }]
  },
  security: {
    twoFactorAuth: { type: Boolean, default: false },
    biometricAuth: { type: Boolean, default: false },
    requirePinForOrders: { type: Boolean, default: false },
    sessionTimeout: {
      type: Number,
      enum: [15, 30, 60, 120, 0], // in minutes, 0 = never
      default: 0
    }
  },
  accessibility: {
    screenReader: { type: Boolean, default: false },
    highContrast: { type: Boolean, default: false },
    largeText: { type: Boolean, default: false },
    reduceMotion: { type: Boolean, default: false }
  },
  dataUsage: {
    downloadImages: {
      type: String,
      enum: ['always', 'wifi_only', 'never'],
      default: 'always'
    },
    autoplayVideos: { type: Boolean, default: false },
    lowDataMode: { type: Boolean, default: false }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
userSettingsSchema.index({ userId: 1 });

// Method to update notification settings
userSettingsSchema.methods.updateNotifications = function(type, settings) {
  if (!['push', 'email', 'sms'].includes(type)) {
    throw new Error('Invalid notification type');
  }
  
  this.notifications[type] = { ...this.notifications[type], ...settings };
  return this.save();
};

// Method to update privacy settings
userSettingsSchema.methods.updatePrivacy = function(settings) {
  this.privacy = { ...this.privacy, ...settings };
  return this.save();
};

// Method to update preferences
userSettingsSchema.methods.updatePreferences = function(settings) {
  this.preferences = { ...this.preferences, ...settings };
  return this.save();
};

// Method to update delivery settings
userSettingsSchema.methods.updateDelivery = function(settings) {
  this.delivery = { ...this.delivery, ...settings };
  return this.save();
};

// Method to update payment settings
userSettingsSchema.methods.updatePayment = function(settings) {
  this.payment = { ...this.payment, ...settings };
  return this.save();
};

// Method to update shopping preferences
userSettingsSchema.methods.updateShopping = function(settings) {
  this.shopping = { ...this.shopping, ...settings };
  return this.save();
};

// Method to update security settings
userSettingsSchema.methods.updateSecurity = function(settings) {
  this.security = { ...this.security, ...settings };
  return this.save();
};

// Method to toggle specific setting
userSettingsSchema.methods.toggleSetting = function(category, setting) {
  if (!this[category] || this[category][setting] === undefined) {
    throw new Error('Invalid category or setting');
  }
  
  this[category][setting] = !this[category][setting];
  return this.save();
};

// Method to reset to defaults
userSettingsSchema.methods.resetToDefaults = function() {
  // Keep userId and reset everything else to defaults
  const defaultSettings = new this.constructor({ userId: this.userId });
  
  Object.keys(defaultSettings.toObject()).forEach(key => {
    if (key !== '_id' && key !== 'userId' && key !== '__v') {
      this[key] = defaultSettings[key];
    }
  });
  
  return this.save();
};

// Static method to get or create settings for user
userSettingsSchema.statics.getOrCreateSettings = async function(userId) {
  let settings = await this.findOne({ userId });
  
  if (!settings) {
    settings = new this({ userId });
    await settings.save();
  }
  
  return settings;
};

// Static method to get notification preferences
userSettingsSchema.statics.getNotificationPreferences = async function(userId) {
  const settings = await this.findOne({ userId }).select('notifications');
  return settings ? settings.notifications : null;
};

// Static method to check if user has specific notification enabled
userSettingsSchema.statics.hasNotificationEnabled = async function(userId, type, category) {
  const settings = await this.findOne({ userId });
  
  if (!settings || !settings.notifications[type]) {
    return false;
  }
  
  return settings.notifications[type].enabled && 
         (settings.notifications[type][category] !== false);
};

module.exports = mongoose.model('UserSettings', userSettingsSchema);
