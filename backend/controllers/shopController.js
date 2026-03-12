const Shop = require('../models/Shop');
const User = require('../models/User');
const Product = require('../models/Product');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiResponse, getPaginationMeta, calculateDistance } = require('../utils/helpers');

const { getRedisClient } = require('../config/redis');

// @desc    Get all shops
// @route   GET /api/shops
// @access  Public
const getShops = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    category,
    search,
    latitude,
    longitude,
    radius = 10, // km
    isOpen,
    sort = 'createdAt'
  } = req.query;

  // Generate cache key based on query params
  const cacheKey = `shops:${JSON.stringify(req.query)}`;
  const redisClient = getRedisClient();

  if (redisClient) {
    try {
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        return res.json(JSON.parse(cachedData));
      }
    } catch (err) {
      console.error('Redis Get Error:', err);
    }
  }

  // Build filter object
  const filter = { isActive: true, isVerified: true };
  
  if (category) filter.category = category;
  if (isOpen === 'true') {
    const now = new Date();
    const currentTime = now.getHours() * 100 + now.getMinutes(); // HHMM format
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'lowercase' });
    
    filter[`operatingHours.${currentDay}.isOpen`] = true;
    filter.$expr = {
      $and: [
        { $lte: [{ $toInt: `$operatingHours.${currentDay}.openTime` }, currentTime] },
        { $gte: [{ $toInt: `$operatingHours.${currentDay}.closeTime` }, currentTime] }
      ]
    };
  }

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } }
    ];
  }

  // Location-based filtering
  if (latitude && longitude) {
    filter['address.coordinates'] = {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        },
        $maxDistance: radius * 1000 // Convert km to meters
      }
    };
  }

  // Build sort object
  let sortObj = {};
  switch (sort) {
    case 'rating':
      sortObj = { 'ratings.average': -1 };
      break;
    case 'name':
      sortObj = { name: 1 };
      break;
    case 'distance':
      if (latitude && longitude) {
        // MongoDB will sort by distance automatically when using $near
        sortObj = {};
      } else {
        sortObj = { createdAt: -1 };
      }
      break;
    default:
      sortObj = { createdAt: -1 };
  }

  const skip = (page - 1) * limit;

  const [shops, total] = await Promise.all([
    Shop.find(filter)
      .populate('ownerId', 'fullName email phone')
      .sort(sortObj)
      .limit(parseInt(limit))
      .skip(skip),
    Shop.countDocuments(filter)
  ]);

  const pagination = getPaginationMeta(page, limit, total);
  const responseData = apiResponse(true, 'Shops retrieved successfully', shops, pagination);

  // Cache the response
  if (redisClient) {
    try {
      await redisClient.setEx(cacheKey, 300, JSON.stringify(responseData)); // Cache for 5 minutes
    } catch (err) {
      console.error('Redis Set Error:', err);
    }
  }

  res.json(responseData);
});

// @desc    Get single shop
// @route   GET /api/shops/:id
// @access  Public
const getShop = asyncHandler(async (req, res) => {
  const shopId = req.params.id;
  const cacheKey = `shop:${shopId}`;
  const redisClient = getRedisClient();

  if (redisClient) {
    try {
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        // Increment view count asynchronously even if cached
        Shop.findByIdAndUpdate(shopId, { $inc: { 'analytics.views': 1 } }).exec();
        return res.json(JSON.parse(cachedData));
      }
    } catch (err) {
      console.error('Redis Get Error:', err);
    }
  }

  const shop = await Shop.findById(shopId)
    .populate('ownerId', 'fullName email phone profileImage');

  if (!shop || !shop.isActive) {
    return res.status(404).json(apiResponse(false, 'Shop not found'));
  }

  // Increment view count
  shop.analytics.views += 1;
  await shop.save();

  const responseData = apiResponse(true, 'Shop retrieved successfully', shop);

  // Cache the response
  if (redisClient) {
    try {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(responseData)); // Cache for 1 hour
    } catch (err) {
      console.error('Redis Set Error:', err);
    }
  }

  res.json(responseData);
});

// @desc    Create shop
// @route   POST /api/shops
// @access  Private (Shop Owner)
const createShop = asyncHandler(async (req, res) => {
  // Check if user already has a shop
  const existingShop = await Shop.findOne({ ownerId: req.user.id });
  
  if (existingShop) {
    return res.status(400).json(apiResponse(false, 'You already have a shop registered'));
  }

  const shopData = {
    ...req.body,
    ownerId: req.user.id
  };

  const shop = await Shop.create(shopData);
  
  // Invalidate cache
  const redisClient = getRedisClient();
  if (redisClient) {
    // Similar to products, we can't easily clear all shop lists without SCAN
    // But we can clear the specific shop key if it existed (unlikely)
    // and maybe a "recent shops" key
  }

  res.status(201).json(apiResponse(true, 'Shop created successfully', shop));
});

// @desc    Update shop
// @route   PUT /api/shops/:id
// @access  Private (Shop Owner)
const updateShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findById(req.params.id);

  if (!shop) {
    return res.status(404).json(apiResponse(false, 'Shop not found'));
  }

  // Check ownership
  if (shop.ownerId.toString() !== req.user.id) {
    return res.status(403).json(apiResponse(false, 'Not authorized to update this shop'));
  }

  const updatedShop = await Shop.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  );

  // Invalidate cache
  const redisClient = getRedisClient();
  if (redisClient) {
    await redisClient.del(`shop:${req.params.id}`);
  }

  res.json(apiResponse(true, 'Shop updated successfully', updatedShop));
});

// @desc    Delete shop
// @route   DELETE /api/shops/:id
// @access  Private (Shop Owner)
const deleteShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findById(req.params.id);

  if (!shop) {
    return res.status(404).json(apiResponse(false, 'Shop not found'));
  }

  // Check ownership
  if (shop.ownerId.toString() !== req.user.id) {
    return res.status(403).json(apiResponse(false, 'Not authorized to delete this shop'));
  }

  // Soft delete
  shop.isActive = false;
  await shop.save();

  // Invalidate cache
  const redisClient = getRedisClient();
  if (redisClient) {
    await redisClient.del(`shop:${req.params.id}`);
  }

  res.json(apiResponse(true, 'Shop deleted successfully'));
});

// @desc    Get shop products
// @route   GET /api/shops/:id/products
// @access  Public
const getShopProducts = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    category,
    search,
    inStock,
    sort = 'createdAt'
  } = req.query;

  const shopId = req.params.id;

  // Verify shop exists
  const shop = await Shop.findById(shopId);
  if (!shop || !shop.isActive) {
    return res.status(404).json(apiResponse(false, 'Shop not found'));
  }

  // Build filter
  const filter = { shopId, isActive: true };
  
  if (category) filter.category = category;
  if (inStock === 'true') filter.stock = { $gt: 0 };
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }

  // Build sort
  let sortObj = {};
  switch (sort) {
    case 'price_asc':
      sortObj = { price: 1 };
      break;
    case 'price_desc':
      sortObj = { price: -1 };
      break;
    case 'name':
      sortObj = { name: 1 };
      break;
    default:
      sortObj = { createdAt: -1 };
  }

  const skip = (page - 1) * limit;

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(sortObj)
      .limit(parseInt(limit))
      .skip(skip),
    Product.countDocuments(filter)
  ]);

  const pagination = getPaginationMeta(page, limit, total);

  res.json(apiResponse(true, 'Shop products retrieved successfully', products, pagination));
});

// @desc    Get shop categories
// @route   GET /api/shops/categories
// @access  Public
const getShopCategories = asyncHandler(async (req, res) => {
  const categories = await Shop.distinct('category', { isActive: true, isVerified: true });
  
  res.json(apiResponse(true, 'Shop categories retrieved successfully', categories));
});

// @desc    Add shop review
// @route   POST /api/shops/:id/reviews
// @access  Private
const addShopReview = asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  const shopId = req.params.id;
  const userId = req.user.id;

  const shop = await Shop.findById(shopId);

  if (!shop) {
    return res.status(404).json(apiResponse(false, 'Shop not found'));
  }

  // Check if user already reviewed this shop
  const existingReview = shop.reviews.find(
    review => review.userId.toString() === userId
  );

  if (existingReview) {
    return res.status(400).json(apiResponse(false, 'You have already reviewed this shop'));
  }

  const review = {
    userId,
    rating,
    comment,
    createdAt: new Date()
  };

  shop.reviews.push(review);

  // Update average rating
  const totalRating = shop.reviews.reduce((sum, review) => sum + review.rating, 0);
  shop.ratings.average = totalRating / shop.reviews.length;
  shop.ratings.count = shop.reviews.length;

  await shop.save();

  res.status(201).json(apiResponse(true, 'Review added successfully', review));
});

// @desc    Get nearby shops
// @route   GET /api/shops/nearby
// @access  Public
const getNearbyShops = asyncHandler(async (req, res) => {
  const { latitude, longitude, radius = 5, limit = 10 } = req.query;

  if (!latitude || !longitude) {
    return res.status(400).json(apiResponse(false, 'Latitude and longitude are required'));
  }

  const shops = await Shop.find({
    isActive: true,
    isVerified: true,
    'address.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        },
        $maxDistance: radius * 1000
      }
    }
  })
    .limit(parseInt(limit))
    .populate('ownerId', 'fullName');

  res.json(apiResponse(true, 'Nearby shops retrieved successfully', shops));
});

// @desc    Toggle shop status (open/close)
// @route   PATCH /api/shops/:id/toggle-status
// @access  Private (Shop Owner)
const toggleShopStatus = asyncHandler(async (req, res) => {
  const shop = await Shop.findById(req.params.id);

  if (!shop) {
    return res.status(404).json(apiResponse(false, 'Shop not found'));
  }

  if (shop.ownerId.toString() !== req.user.id) {
    return res.status(403).json(apiResponse(false, 'Not authorized'));
  }

  const now = new Date();
  const currentDay = now.toLocaleDateString('en-US', { weekday: 'lowercase' });
  
  shop.operatingHours[currentDay].isOpen = !shop.operatingHours[currentDay].isOpen;
  await shop.save();

  res.json(apiResponse(true, 'Shop status updated successfully', {
    isOpen: shop.operatingHours[currentDay].isOpen
  }));
});

module.exports = {
  getShops,
  getShop,
  createShop,
  updateShop,
  deleteShop,
  getShopProducts,
  getShopCategories,
  addShopReview,
  getNearbyShops,
  toggleShopStatus
};
