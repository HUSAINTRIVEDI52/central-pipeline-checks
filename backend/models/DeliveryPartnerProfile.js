const mongoose = require('mongoose');

const deliveryPartnerProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    unique: true
  },
  vehicleType: {
    type: String,
    required: [true, 'Vehicle type is required'],
    enum: ['bicycle', 'motorcycle', 'car', 'scooter', 'on_foot']
  },
  vehicleDetails: {
    registrationNumber: String,
    model: String,
    color: String,
    insuranceExpiry: Date,
    licenseNumber: String,
    licenseExpiry: Date
  },
  currentLocation: {
    latitude: {
      type: Number,
      min: -90,
      max: 90
    },
    longitude: {
      type: Number,
      min: -180,
      max: 180
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    },
    accuracy: Number // in meters
  },
  availabilityStatus: {
    type: String,
    enum: ['available', 'busy', 'offline'],
    default: 'offline'
  },
  workingHours: [{
    day: {
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    },
    startTime: String, // Format: "HH:MM"
    endTime: String,   // Format: "HH:MM"
    isWorking: {
      type: Boolean,
      default: true
    }
  }],
  serviceAreas: [{
    pincode: String,
    area: String,
    radius: {
      type: Number,
      default: 5 // in kilometers
    }
  }],
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
  stats: {
    totalDeliveries: {
      type: Number,
      default: 0
    },
    completedDeliveries: {
      type: Number,
      default: 0
    },
    cancelledDeliveries: {
      type: Number,
      default: 0
    },
    totalEarnings: {
      type: Number,
      default: 0
    },
    averageDeliveryTime: {
      type: Number,
      default: 0 // in minutes
    },
    onTimeDeliveryRate: {
      type: Number,
      default: 0 // percentage
    }
  },
  bankDetails: {
    accountNumber: String,
    ifscCode: String,
    accountHolderName: String,
    upiId: String
  },
  documents: [{
    type: {
      type: String,
      enum: ['aadhar_card', 'pan_card', 'driving_license', 'vehicle_registration', 'insurance', 'photo']
    },
    url: String,
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending'
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  emergencyContact: {
    name: String,
    phone: String,
    relationship: String
  },
  preferences: {
    maxDeliveryDistance: {
      type: Number,
      default: 10 // in kilometers
    },
    preferredPaymentMode: {
      type: String,
      enum: ['cash', 'digital'],
      default: 'digital'
    },
    notifications: {
      sms: {
        type: Boolean,
        default: true
      },
      email: {
        type: Boolean,
        default: true
      },
      push: {
        type: Boolean,
        default: true
      }
    }
  },
  currentTask: {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order'
    },
    status: {
      type: String,
      enum: ['assigned', 'accepted', 'picked_up', 'in_transit', 'delivered']
    },
    acceptedAt: Date,
    pickedUpAt: Date,
    deliveredAt: Date
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
deliveryPartnerProfileSchema.index({ userId: 1 });
deliveryPartnerProfileSchema.index({ availabilityStatus: 1, isActive: 1 });
deliveryPartnerProfileSchema.index({ currentLocation: '2dsphere' });
deliveryPartnerProfileSchema.index({ 'serviceAreas.pincode': 1 });
deliveryPartnerProfileSchema.index({ isVerified: 1 });
deliveryPartnerProfileSchema.index({ 'rating.average': -1 });

// Virtual for completion rate
deliveryPartnerProfileSchema.virtual('completionRate').get(function() {
  if (this.stats.totalDeliveries === 0) return 0;
  return (this.stats.completedDeliveries / this.stats.totalDeliveries) * 100;
});

// Virtual for availability during current time
deliveryPartnerProfileSchema.virtual('isCurrentlyAvailable').get(function() {
  if (!this.isActive || !this.isVerified || this.availabilityStatus !== 'available') {
    return false;
  }
  
  const now = new Date();
  const currentDay = now.toLocaleLowerCase().substring(0, 3);
  const currentTime = now.toTimeString().substring(0, 5);
  
  const todaysSchedule = this.workingHours.find(schedule => 
    schedule.day.startsWith(currentDay) && schedule.isWorking
  );
  
  if (!todaysSchedule) return false;
  
  return currentTime >= todaysSchedule.startTime && currentTime <= todaysSchedule.endTime;
});

// Method to update location
deliveryPartnerProfileSchema.methods.updateLocation = function(latitude, longitude, accuracy = null) {
  this.currentLocation = {
    latitude,
    longitude,
    lastUpdated: new Date(),
    accuracy
  };
  return this.save({ validateBeforeSave: false });
};

// Method to update availability status
deliveryPartnerProfileSchema.methods.updateAvailability = function(status) {
  if (!['available', 'busy', 'offline'].includes(status)) {
    throw new Error('Invalid availability status');
  }
  
  this.availabilityStatus = status;
  return this.save();
};

// Method to accept delivery task
deliveryPartnerProfileSchema.methods.acceptTask = function(orderId) {
  this.currentTask = {
    orderId,
    status: 'accepted',
    acceptedAt: new Date()
  };
  this.availabilityStatus = 'busy';
  return this.save();
};

// Method to update task status
deliveryPartnerProfileSchema.methods.updateTaskStatus = function(status) {
  if (!this.currentTask.orderId) {
    throw new Error('No active task to update');
  }
  
  this.currentTask.status = status;
  
  switch (status) {
    case 'picked_up':
      this.currentTask.pickedUpAt = new Date();
      break;
    case 'delivered':
      this.currentTask.deliveredAt = new Date();
      this.stats.completedDeliveries += 1;
      this.availabilityStatus = 'available';
      // Calculate delivery time and update average
      if (this.currentTask.pickedUpAt) {
        const deliveryTime = (this.currentTask.deliveredAt - this.currentTask.pickedUpAt) / (1000 * 60);
        this.updateAverageDeliveryTime(deliveryTime);
      }
      this.currentTask = undefined;
      break;
  }
  
  return this.save();
};

// Method to update average delivery time
deliveryPartnerProfileSchema.methods.updateAverageDeliveryTime = function(newTime) {
  const totalTime = (this.stats.averageDeliveryTime * (this.stats.completedDeliveries - 1)) + newTime;
  this.stats.averageDeliveryTime = totalTime / this.stats.completedDeliveries;
};

// Method to update rating
deliveryPartnerProfileSchema.methods.updateRating = function(newRating) {
  const totalRating = (this.rating.average * this.rating.count) + newRating;
  this.rating.count += 1;
  this.rating.average = totalRating / this.rating.count;
};

// Method to calculate distance from a point
deliveryPartnerProfileSchema.methods.getDistanceFrom = function(lat, lng) {
  if (!this.currentLocation.latitude || !this.currentLocation.longitude) {
    return null;
  }
  
  const R = 6371; // Earth's radius in km
  const dLat = (lat - this.currentLocation.latitude) * Math.PI / 180;
  const dLng = (lng - this.currentLocation.longitude) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(this.currentLocation.latitude * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Static method to find available partners near location
deliveryPartnerProfileSchema.statics.findNearbyAvailable = function(latitude, longitude, maxDistance = 10) {
  return this.find({
    isActive: true,
    isVerified: true,
    availabilityStatus: 'available',
    currentLocation: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance * 1000 // Convert km to meters
      }
    }
  }).populate('userId', 'fullName phone');
};

// Static method to get partner performance analytics
deliveryPartnerProfileSchema.statics.getPerformanceAnalytics = function(userId, startDate, endDate) {
  return this.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    {
      $lookup: {
        from: 'orders',
        localField: 'userId',
        foreignField: 'deliveryPartnerId',
        as: 'orders'
      }
    },
    {
      $addFields: {
        ordersInRange: {
          $filter: {
            input: '$orders',
            cond: {
              $and: [
                { $gte: ['$$this.createdAt', startDate] },
                { $lte: ['$$this.createdAt', endDate] }
              ]
            }
          }
        }
      }
    },
    {
      $project: {
        totalDeliveries: { $size: '$ordersInRange' },
        completedDeliveries: {
          $size: {
            $filter: {
              input: '$ordersInRange',
              cond: { $eq: ['$$this.status', 'delivered'] }
            }
          }
        },
        totalEarnings: { $sum: '$ordersInRange.deliveryFee' },
        averageRating: '$rating.average',
        completionRate: '$completionRate'
      }
    }
  ]);
};

module.exports = mongoose.model('DeliveryPartnerProfile', deliveryPartnerProfileSchema);
