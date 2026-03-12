const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true
  },
  label: {
    type: String,
    enum: ['home', 'work', 'other'],
    default: 'home',
    required: true
  },
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    match: [/^[6-9]\d{9}$/, 'Please provide a valid Indian phone number']
  },
  addressLine1: {
    type: String,
    required: [true, 'Address line 1 is required'],
    trim: true,
    maxlength: [200, 'Address line 1 cannot exceed 200 characters']
  },
  addressLine2: {
    type: String,
    trim: true,
    maxlength: [200, 'Address line 2 cannot exceed 200 characters']
  },
  landmark: {
    type: String,
    trim: true,
    maxlength: [100, 'Landmark cannot exceed 100 characters']
  },
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true,
    maxlength: [50, 'City name cannot exceed 50 characters']
  },
  state: {
    type: String,
    required: [true, 'State is required'],
    trim: true,
    maxlength: [50, 'State name cannot exceed 50 characters']
  },
  pincode: {
    type: String,
    required: [true, 'Pincode is required'],
    match: [/^\d{6}$/, 'Please provide a valid 6-digit pincode']
  },
  coordinates: {
    latitude: {
      type: Number,
      min: [-90, 'Latitude must be between -90 and 90'],
      max: [90, 'Latitude must be between -90 and 90']
    },
    longitude: {
      type: Number,
      min: [-180, 'Longitude must be between -180 and 180'],
      max: [180, 'Longitude must be between -180 and 180']
    }
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
addressSchema.index({ userId: 1, isDefault: 1 });
addressSchema.index({ userId: 1, isActive: 1 });
addressSchema.index({ coordinates: '2dsphere' }); // For geospatial queries

// Virtual for full address
addressSchema.virtual('fullAddress').get(function() {
  const parts = [
    this.addressLine1,
    this.addressLine2,
    this.landmark,
    this.city,
    this.state,
    this.pincode
  ].filter(Boolean);
  return parts.join(', ');
});

// Pre-save middleware to ensure only one default address per user
addressSchema.pre('save', async function(next) {
  if (this.isDefault && this.isModified('isDefault')) {
    // Unset other default addresses for this user
    await this.constructor.updateMany(
      { userId: this.userId, _id: { $ne: this._id } },
      { $set: { isDefault: false } }
    );
  }
  
  // If this is the first address, make it default
  if (this.isNew) {
    const count = await this.constructor.countDocuments({ 
      userId: this.userId,
      _id: { $ne: this._id }
    });
    if (count === 0) {
      this.isDefault = true;
    }
  }
  
  next();
});

// Method to set as default
addressSchema.methods.setAsDefault = async function() {
  // Unset all other default addresses for this user
  await this.constructor.updateMany(
    { userId: this.userId, _id: { $ne: this._id } },
    { $set: { isDefault: false } }
  );
  
  this.isDefault = true;
  return this.save();
};

// Method to soft delete
addressSchema.methods.softDelete = function() {
  this.isActive = false;
  return this.save();
};

// Static method to get default address
addressSchema.statics.getDefaultAddress = function(userId) {
  return this.findOne({ userId, isDefault: true, isActive: true });
};

// Static method to get all active addresses for user
addressSchema.statics.getUserAddresses = function(userId) {
  return this.find({ userId, isActive: true }).sort({ isDefault: -1, createdAt: -1 });
};

module.exports = mongoose.model('Address', addressSchema);
