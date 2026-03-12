const express = require("express");
const Shop = require("../models/Shop");
const Product = require("../models/Product");
const Order = require("../models/Order");
const {
  authenticate,
  authorize,
  requireVerification,
} = require("../middleware/auth");
const {
  validateShopCreation,
  validateObjectIdParam,
  validatePagination,
  validateSearch,
} = require("../middleware/validation");
const { upload } = require("../middleware/upload");

const router = express.Router();

// @desc    Create new shop
// @route   POST /api/shops
// @access  Private (Shop Owner)
const createShop = async (req, res) => {
  try {
    // Check if user already has a shop
    const existingShop = await Shop.findOne({ ownerId: req.user._id });

    if (existingShop) {
      return res.status(400).json({
        success: false,
        message: "You already have a shop registered",
      });
    }

    const shopData = {
      ...req.body,
      ownerId: req.user._id,
    };

    const shop = new Shop(shopData);
    await shop.save();

    await shop.populate("ownerId", "fullName email phone");

    res.status(201).json({
      success: true,
      message: "Shop created successfully",
      shop,
    });
  } catch (error) {
    console.error("Create shop error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create shop",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// @desc    Get all shops with filters
// @route   GET /api/shops
// @access  Public
const getShops = async (req, res) => {
  try {
    const {
      search,
      category,
      latitude,
      longitude,
      radius = 10,
      isVerified,
      isOpen,
      sortBy = "rating.average",
      sortOrder = -1,
      page = 1,
      limit = 20,
    } = req.query;

    // Build filter query
    const filter = {
      isActive: true,
    };

    if (search) {
      filter.$text = { $search: search };
    }

    if (category) {
      filter.category = category;
    }

    if (isVerified !== undefined) {
      filter.isVerified = isVerified === "true";
    }

    if (isOpen !== undefined) {
      filter.isOpen = isOpen === "true";
    }

    // Location-based filtering
    if (latitude && longitude) {
      filter["address.coordinates"] = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(longitude), parseFloat(latitude)],
          },
          $maxDistance: parseFloat(radius) * 1000, // Convert km to meters
        },
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const shops = await Shop.find(filter)
      .populate("ownerId", "fullName phone")
      .sort({ [sortBy]: parseInt(sortOrder) })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await Shop.countDocuments(filter);

    // Add distance calculation if location provided
    if (latitude && longitude) {
      shops.forEach((shop) => {
        shop._doc.distance = shop.getDistanceFrom(
          parseFloat(latitude),
          parseFloat(longitude)
        );
      });
    }

    res.json({
      success: true,
      data: {
        shops,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get shops error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get shops",
    });
  }
};

// @desc    Get shop by ID
// @route   GET /api/shops/:id
// @access  Public
const getShopById = async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id)
      .populate("ownerId", "fullName phone email")
      .populate({
        path: "products",
        match: { isActive: true },
        options: { limit: 10, sort: { createdAt: -1 } },
      });

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    // Check if shop is currently open
    const isCurrentlyOpen = shop.isCurrentlyOpen();

    res.json({
      success: true,
      shop: {
        ...shop.toObject(),
        isCurrentlyOpen,
      },
    });
  } catch (error) {
    console.error("Get shop by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get shop",
    });
  }
};

// @desc    Update shop
// @route   PUT /api/shops/:id
// @access  Private (Shop Owner)
const updateShop = async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id);

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    // Check if user owns the shop or is admin
    if (
      shop.ownerId.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this shop",
      });
    }

    const allowedUpdates = [
      "name",
      "description",
      "category",
      "images",
      "contact",
      "operatingHours",
      "deliveryRadius",
      "deliveryFee",
      "minimumOrderAmount",
      "isOpen",
    ];

    const updates = {};
    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const updatedShop = await Shop.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).populate("ownerId", "fullName email phone");

    res.json({
      success: true,
      message: "Shop updated successfully",
      shop: updatedShop,
    });
  } catch (error) {
    console.error("Update shop error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update shop",
    });
  }
};

// @desc    Get shop products
// @route   GET /api/shops/:id/products
// @access  Public
const getShopProducts = async (req, res) => {
  try {
    const {
      category,
      search,
      inStock = true,
      sortBy = "name",
      sortOrder = 1,
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {
      shopId: req.params.id,
      isActive: true,
    };

    if (category) {
      filter.categoryId = category;
    }

    if (search) {
      filter.$text = { $search: search };
    }

    if (inStock === "true") {
      filter.status = "in_stock";
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const products = await Product.find(filter)
      .populate("categoryId", "name")
      .sort({ [sortBy]: parseInt(sortOrder) })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Product.countDocuments(filter);

    res.json({
      success: true,
      data: {
        products,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get shop products error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get shop products",
    });
  }
};

// @desc    Get shop orders
// @route   GET /api/shops/:id/orders
// @access  Private (Shop Owner)
const getShopOrders = async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id);

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    // Check if user owns the shop or is admin
    if (
      shop.ownerId.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view shop orders",
      });
    }

    const { status, startDate, endDate, page = 1, limit = 20 } = req.query;

    const filter = { shopId: req.params.id };

    if (status) {
      filter.status = status;
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const orders = await Order.getOrdersByStatus(status, {
      shopId: req.params.id,
      limit: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit),
    });

    const total = await Order.countDocuments(filter);

    res.json({
      success: true,
      data: {
        orders,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get shop orders error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get shop orders",
    });
  }
};

// @desc    Get shop analytics
// @route   GET /api/shops/:id/analytics
// @access  Private (Shop Owner)
const getShopAnalytics = async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id);

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    // Check if user owns the shop or is admin
    if (
      shop.ownerId.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view shop analytics",
      });
    }

    const { startDate, endDate } = req.query;

    const start = startDate
      ? new Date(startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    // Get order analytics
    const analytics = await Order.getOrderAnalytics(req.params.id, start, end);

    // Get product analytics
    const productCount = await Product.countDocuments({
      shopId: req.params.id,
      isActive: true,
    });

    // Get top products
    const topProducts = await Order.aggregate([
      { $match: { shopId: shop._id, createdAt: { $gte: start, $lte: end } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.productId",
          totalQuantity: { $sum: "$items.quantity" },
          totalRevenue: { $sum: "$items.totalPrice" },
        },
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
    ]);

    res.json({
      success: true,
      analytics: {
        summary: analytics[0] || {
          totalOrders: 0,
          totalRevenue: 0,
          averageOrderValue: 0,
          completedOrders: 0,
          cancelledOrders: 0,
        },
        productCount,
        topProducts,
        dateRange: { start, end },
      },
    });
  } catch (error) {
    console.error("Get shop analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get shop analytics",
    });
  }
};

// @desc    Upload shop images
// @route   POST /api/shops/:id/images
// @access  Private (Shop Owner)
const uploadShopImages = async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id);

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    // Check if user owns the shop
    if (shop.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to upload images for this shop",
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No images uploaded",
      });
    }

    const images = req.files.map((file) => ({
      url: `/uploads/${file.filename}`,
      caption: req.body.caption || "",
    }));

    shop.images.push(...images);
    await shop.save();

    res.json({
      success: true,
      message: "Images uploaded successfully",
      images,
    });
  } catch (error) {
    console.error("Upload shop images error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload images",
    });
  }
};

// Apply middleware and routes
router.post(
  "/",
  authenticate,
  authorize("shop_owner"),
  requireVerification,
  validateShopCreation,
  createShop
); // done

router.get("/", validatePagination, validateSearch, getShops); // done

router.get("/:id", validateObjectIdParam("id"), getShopById); // done

router.put(
  "/:id",
  authenticate,
  requireVerification,
  validateObjectIdParam("id"),
  updateShop
);

router.get(
  "/:id/products",
  validateObjectIdParam("id"),
  validatePagination,
  getShopProducts
);

router.get(
  "/:id/orders",
  authenticate,
  requireVerification,
  validateObjectIdParam("id"),
  getShopOrders
);

router.get(
  "/:id/analytics",
  authenticate,
  requireVerification,
  validateObjectIdParam("id"),
  getShopAnalytics
);

router.post(
  "/:id/images",
  authenticate,
  requireVerification,
  validateObjectIdParam("id"),
  upload.array("images", 5),
  uploadShopImages
);

module.exports = router;
