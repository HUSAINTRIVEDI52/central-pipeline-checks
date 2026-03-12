const Product = require('../models/Product');
const Shop = require('../models/Shop');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiResponse, getPaginationMeta } = require('../utils/helpers');

const { getRedisClient } = require('../config/redis');



// @desc    Get all products
// @route   GET /api/products
// @access  Public
const getProducts = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    category,
    shopId,
    search,
    minPrice,
    maxPrice,
    inStock,
    sort = 'createdAt',
    sortBy, // Added sortBy
    sortOrder = 'desc' // Added sortOrder with default
  } = req.query;

  // Use Meilisearch if search query is present
  if (search) {
    const meiliSearchService = require('../services/meiliSearchService'); // Local import for Meilisearch
    const options = {
      shopId,
      categoryId,
      minPrice: minPrice ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
      inStock: inStock === 'true',
      sortBy,
      sortOrder: sortOrder, // Use the new sortOrder
      limit: parseInt(limit),
      page: parseInt(page)
    };

    const searchResults = await meiliSearchService.search(search, options);
    
    return res.json({
      success: true,
      data: {
        products: searchResults.hits,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: searchResults.total,
          pages: searchResults.totalPages
        }
      }
    });
  }

  // Generate cache key based on query params
  const cacheKey = `products:${JSON.stringify(req.query)}`;
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
  const filter = { isActive: true };
  
  if (category) filter.category = category;
  if (categoryId) filter.categoryId = categoryId; // Added filter for categoryId
  if (shopId) filter.shopId = shopId;
  if (inStock === 'true') filter.stock = { $gt: 0 };
  
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = parseFloat(minPrice);
    if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
  }

  // Build sort object
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
    case 'rating':
      sortObj = { 'ratings.average': -1 };
      break;
    default:
      sortObj = { createdAt: -1 };
  }

  const skip = (page - 1) * limit;

  const [products, total] = await Promise.all([
    Product.find(filter)
      .populate('shopId', 'name')
      .sort(sortObj)
      .limit(parseInt(limit))
      .skip(skip),
    Product.countDocuments(filter)
  ]);

  const pagination = getPaginationMeta(page, limit, total);
  const responseData = apiResponse(true, 'Products retrieved successfully', products, pagination);

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

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
const getProduct = asyncHandler(async (req, res) => {
  const productId = req.params.id;
  const cacheKey = `product:${productId}`;
  const redisClient = getRedisClient();

  if (redisClient) {
    try {
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        // Increment view count asynchronously even if cached
        Product.findByIdAndUpdate(productId, { $inc: { 'analytics.views': 1 } }).exec();
        return res.json(JSON.parse(cachedData));
      }
    } catch (err) {
      console.error('Redis Get Error:', err);
    }
  }

  const product = await Product.findById(productId)
    .populate('shopId', 'name address contact')
    .populate('reviews.userId', 'fullName profileImage');

  if (!product) {
    return res.status(404).json(apiResponse(false, 'Product not found'));
  }

  // Increment view count
  product.analytics.views += 1;
  await product.save();

  const responseData = apiResponse(true, 'Product retrieved successfully', product);

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

// @desc    Create product
// @route   POST /api/products
// @access  Private (Shop Owner)
const createProduct = asyncHandler(async (req, res) => {
  // Verify shop ownership
  const shop = await Shop.findOne({ ownerId: req.user.id });
  
  if (!shop) {
    return res.status(403).json(apiResponse(false, 'You must own a shop to create products'));
  }

  const productData = {
    ...req.body,
    shopId: shop._id
  };

  const product = await Product.create(productData);
  
  // Index in search service
  searchService.indexProduct(product);

  // Invalidate cache
  const redisClient = getRedisClient();
  if (redisClient) {
    // Invalidate product list cache (using pattern matching if possible, or just clearing known keys)
    // Since we can't easily delete by pattern in simple redis setup without SCAN, 
    // we might just let them expire or use a specific key for "all products" if we had one.
    // For now, we will just log it. In a real app, we'd use a tagged cache or specific keys.
    // A simple approach is to clear the most common list keys or use a versioning strategy.
    // Here we will just clear the specific product key if it existed (unlikely for new)
    // and maybe a "recent products" key if we had one.
    
    // Ideally, we should clear keys starting with "products:"
    // For this implementation, we will assume short TTL (5 mins) is acceptable for lists,
    // or we could implement a 'flush all products' if critical.
    
    // Let's try to clear at least the basic list if we can, but without SCAN it's hard.
    // We will rely on TTL for lists for now to avoid blocking Redis with SCAN.
  }
  
  res.status(201).json(apiResponse(true, 'Product created successfully', product));
});

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private (Shop Owner)
const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).populate('shopId');

  if (!product) {
    return res.status(404).json(apiResponse(false, 'Product not found'));
  }

  // Check ownership
  if (product.shopId.ownerId.toString() !== req.user.id) {
    return res.status(403).json(apiResponse(false, 'Not authorized to update this product'));
  }

  const updatedProduct = await Product.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  );

  // Update index
  searchService.indexProduct(updatedProduct);

  // Invalidate cache
  const redisClient = getRedisClient();
  if (redisClient) {
    await redisClient.del(`product:${req.params.id}`);
  }

  res.json(apiResponse(true, 'Product updated successfully', updatedProduct));
});

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private (Shop Owner)
const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).populate('shopId');

  if (!product) {
    return res.status(404).json(apiResponse(false, 'Product not found'));
  }

  // Check ownership
  if (product.shopId.ownerId.toString() !== req.user.id) {
    return res.status(403).json(apiResponse(false, 'Not authorized to delete this product'));
  }

  // Soft delete
  product.isActive = false;
  await product.save();

  // Invalidate cache
  const redisClient = getRedisClient();
  if (redisClient) {
    await redisClient.del(`product:${req.params.id}`);
  }

  res.json(apiResponse(true, 'Product deleted successfully'));
});

// @desc    Update product stock
// @route   PATCH /api/products/:id/stock
// @access  Private (Shop Owner)
const updateStock = asyncHandler(async (req, res) => {
  const { stock } = req.body;
  
  const product = await Product.findById(req.params.id).populate('shopId');

  if (!product) {
    return res.status(404).json(apiResponse(false, 'Product not found'));
  }

  // Check ownership
  if (product.shopId.ownerId.toString() !== req.user.id) {
    return res.status(403).json(apiResponse(false, 'Not authorized to update this product'));
  }

  product.stock.available = stock.available;
  if (stock.lowStockThreshold !== undefined) {
    product.stock.lowStockThreshold = stock.lowStockThreshold;
  }
  await product.save();

  res.json(apiResponse(true, 'Stock updated successfully', { stock: product.stock }));
});

// @desc    Add product review
// @route   POST /api/products/:id/reviews
// @access  Private
const addReview = asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  const productId = req.params.id;
  const userId = req.user.id;

  const product = await Product.findById(productId);

  if (!product) {
    return res.status(404).json(apiResponse(false, 'Product not found'));
  }

  // Check if user already reviewed this product
  const existingReview = product.reviews.find(
    review => review.userId.toString() === userId
  );

  if (existingReview) {
    return res.status(400).json(apiResponse(false, 'You have already reviewed this product'));
  }

  const review = {
    userId,
    rating,
    comment,
    createdAt: new Date()
  };

  product.reviews.push(review);

  // Update average rating
  const totalRating = product.reviews.reduce((sum, review) => sum + review.rating, 0);
  product.ratings.average = totalRating / product.reviews.length;
  product.ratings.count = product.reviews.length;

  await product.save();

  res.status(201).json(apiResponse(true, 'Review added successfully', review));
});

// @desc    Update product review
// @route   PUT /api/products/:id/reviews/:reviewId
// @access  Private
const updateReview = asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  const { id: productId, reviewId } = req.params;
  const userId = req.user.id;

  const product = await Product.findById(productId);

  if (!product) {
    return res.status(404).json(apiResponse(false, 'Product not found'));
  }

  const review = product.reviews.id(reviewId);

  if (!review) {
    return res.status(404).json(apiResponse(false, 'Review not found'));
  }

  // Check ownership
  if (review.userId.toString() !== userId) {
    return res.status(403).json(apiResponse(false, 'Not authorized to update this review'));
  }

  review.rating = rating;
  review.comment = comment;
  review.updatedAt = new Date();

  // Update average rating
  const totalRating = product.reviews.reduce((sum, review) => sum + review.rating, 0);
  product.ratings.average = totalRating / product.reviews.length;

  await product.save();

  res.json(apiResponse(true, 'Review updated successfully', review));
});

// @desc    Delete product review
// @route   DELETE /api/products/:id/reviews/:reviewId
// @access  Private
const deleteReview = asyncHandler(async (req, res) => {
  const { id: productId, reviewId } = req.params;
  const userId = req.user.id;

  const product = await Product.findById(productId);

  if (!product) {
    return res.status(404).json(apiResponse(false, 'Product not found'));
  }

  const review = product.reviews.id(reviewId);

  if (!review) {
    return res.status(404).json(apiResponse(false, 'Review not found'));
  }

  // Check ownership or admin
  if (review.userId.toString() !== userId && req.user.role !== 'admin') {
    return res.status(403).json(apiResponse(false, 'Not authorized to delete this review'));
  }

  product.reviews.pull(reviewId);

  // Update average rating
  if (product.reviews.length > 0) {
    const totalRating = product.reviews.reduce((sum, review) => sum + review.rating, 0);
    product.ratings.average = totalRating / product.reviews.length;
    product.ratings.count = product.reviews.length;
  } else {
    product.ratings.average = 0;
    product.ratings.count = 0;
  }

  await product.save();

  res.json(apiResponse(true, 'Review deleted successfully'));
});

// @desc    Get product categories
// @route   GET /api/products/categories
// @access  Public
const getCategories = asyncHandler(async (req, res) => {
  const categories = await Product.distinct('category', { isActive: true });
  
  res.json(apiResponse(true, 'Categories retrieved successfully', categories));
});

// @desc    Get trending products
// @route   GET /api/products/trending
// @access  Public
const getTrendingProducts = asyncHandler(async (req, res) => {
  const { limit = 10 } = req.query;

  const products = await Product.find({ isActive: true })
    .populate('shopId', 'name')
    .sort({ 'analytics.views': -1, 'analytics.orders': -1 })
    .limit(parseInt(limit));

  res.json(apiResponse(true, 'Trending products retrieved successfully', products));
});

// @desc    Get product recommendations
// @route   GET /api/products/:id/recommendations
// @access  Public
const getRecommendations = asyncHandler(async (req, res) => {
  const { limit = 5 } = req.query;
  const productId = req.params.id;

  const product = await Product.findById(productId);

  if (!product) {
    return res.status(404).json(apiResponse(false, 'Product not found'));
  }

  // Get similar products based on category and tags
  const recommendations = await Product.find({
    _id: { $ne: productId },
    isActive: true,
    $or: [
      { category: product.category },
      { tags: { $in: product.tags } }
    ]
  })
    .populate('shopId', 'name')
    .sort({ 'ratings.average': -1 })
    .limit(parseInt(limit));

  res.json(apiResponse(true, 'Recommendations retrieved successfully', recommendations));
});

// @desc    Get product reviews
// @route   GET /api/products/:id/reviews
// @access  Public
const getReviews = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, sort = 'newest' } = req.query;
  const productId = req.params.id;

  const product = await Product.findById(productId)
    .select('reviews')
    .populate('reviews.userId', 'fullName profileImage');

  if (!product) {
    return res.status(404).json(apiResponse(false, 'Product not found'));
  }

  let reviews = product.reviews;

  // Sort reviews
  if (sort === 'newest') {
    reviews.sort((a, b) => b.createdAt - a.createdAt);
  } else if (sort === 'oldest') {
    reviews.sort((a, b) => a.createdAt - b.createdAt);
  } else if (sort === 'highest') {
    reviews.sort((a, b) => b.rating - a.rating);
  } else if (sort === 'lowest') {
    reviews.sort((a, b) => a.rating - b.rating);
  }

  // Pagination
  const total = reviews.length;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  const paginatedReviews = reviews.slice(startIndex, endIndex);

  const pagination = getPaginationMeta(page, limit, total);

  res.json(apiResponse(true, 'Reviews retrieved successfully', paginatedReviews, pagination));
});

module.exports = {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  updateStock,
  addReview,
  updateReview,
  deleteReview,
  getCategories,
  getTrendingProducts,
  getRecommendations,
  getReviews
};
