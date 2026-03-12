const mongoose = require("mongoose");

const shopSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Shop owner is required"],
    },
    name: {
      type: String,
      required: [true, "Shop name is required"],
      trim: true,
      maxlength: [100, "Shop name cannot exceed 100 characters"],
    },
    description: {
      type: String,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    category: {
      type: String,
      required: [true, "Shop category is required"],
      enum: [
        "grocery",
        "pharmacy",
        "restaurant",
        "electronics",
        "clothing",
        "books",
        "other",
      ],
    },
    images: [
      {
        url: String,
        caption: String,
      },
    ],
    address: {
      street: {
        type: String,
        required: [true, "Street address is required"],
      },
      city: {
        type: String,
        required: [true, "City is required"],
      },
      state: {
        type: String,
        required: [true, "State is required"],
      },
      pincode: {
        type: String,
        required: [true, "Pincode is required"],
        match: [/^[1-9][0-9]{5}$/, "Please enter a valid pincode"],
      },
      landmark: String,
      coordinates: {
        latitude: {
          type: Number,
          required: [true, "Latitude is required"],
          min: -90,
          max: 90,
        },
        longitude: {
          type: Number,
          required: [true, "Longitude is required"],
          min: -180,
          max: 180,
        },
      },
    },
    contact: {
      phone: {
        type: String,
        required: [true, "Contact phone is required"],
        match: [/^[6-9]\d{9}$/, "Please enter a valid 10-digit phone number"],
      },
      email: {
        type: String,
        lowercase: true,
        match: [
          /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
          "Please enter a valid email",
        ],
      },
      whatsapp: String,
    },
    operatingHours: [
      {
        day: {
          type: String,
          enum: [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
          ],
        },
        openTime: String, // Format: "HH:MM"
        closeTime: String, // Format: "HH:MM"
        isClosed: {
          type: Boolean,
          default: false,
        },
      },
    ],
    deliveryRadius: {
      type: Number,
      required: [true, "Delivery radius is required"],
      min: [0.5, "Minimum delivery radius is 0.5 km"],
      max: [50, "Maximum delivery radius is 50 km"],
      default: 5,
    },
    deliveryFee: {
      type: Number,
      required: [true, "Delivery fee is required"],
      min: [0, "Delivery fee cannot be negative"],
      default: 0,
    },
    minimumOrderAmount: {
      type: Number,
      required: [true, "Minimum order amount is required"],
      min: [0, "Minimum order amount cannot be negative"],
      default: 0,
    },
    rating: {
      average: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
      },
      count: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isOpen: {
      type: Boolean,
      default: true,
    },
    gstNumber: {
      type: String,
      match: [
        /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
        "Please enter a valid GST number",
      ],
    },
    fssaiNumber: String,
    documents: [
      {
        type: {
          type: String,
          enum: [
            "gst_certificate",
            "fssai_license",
            "shop_license",
            "identity_proof",
          ],
        },
        url: String,
        verificationStatus: {
          type: String,
          enum: ["pending", "verified", "rejected"],
          default: "pending",
        },
      },
    ],
    stats: {
      totalOrders: {
        type: Number,
        default: 0,
      },
      completedOrders: {
        type: Number,
        default: 0,
      },
      totalRevenue: {
        type: Number,
        default: 0,
      },
      averagePreparationTime: {
        type: Number,
        default: 30, // minutes
      },
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for better performance
shopSchema.index({ ownerId: 1 });
shopSchema.index({ category: 1 });
shopSchema.index({ isActive: 1, isVerified: 1 });
shopSchema.index({ "address.coordinates": "2dsphere" });
shopSchema.index({ "address.pincode": 1 });
shopSchema.index({ "rating.average": -1 });

// Virtual for products
shopSchema.virtual("products", {
  ref: "Product",
  localField: "_id",
  foreignField: "shopId",
});

// Method to check if shop is currently open
shopSchema.methods.isCurrentlyOpen = function () {
  if (!this.isOpen || !this.isActive || !this.operatingHours) return false;

  const now = new Date();

  // Correct way to get the current day of the week (e.g., "mon", "tue")
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const currentDay = days[now.getDay()];

  // Correct way to get HH:MM format
  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const currentTime = `${hours}:${minutes}`;

  const todaysHours = this.operatingHours.find(
    (hours) => hours.day.toLowerCase() === currentDay
  );

  if (!todaysHours || todaysHours.isClosed) return false;

  return (
    currentTime >= todaysHours.openTime && currentTime <= todaysHours.closeTime
  );
};

// Method to calculate distance from a point
shopSchema.methods.getDistanceFrom = function (lat, lng) {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat - this.address.coordinates.latitude) * Math.PI) / 180;
  const dLng = ((lng - this.address.coordinates.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((this.address.coordinates.latitude * Math.PI) / 180) *
      Math.cos((lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Method to update rating
shopSchema.methods.updateRating = function (newRating) {
  const totalRating = this.rating.average * this.rating.count + newRating;
  this.rating.count += 1;
  this.rating.average = totalRating / this.rating.count;
};

module.exports = mongoose.model("Shop", shopSchema);
