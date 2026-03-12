const express = require('express');
const Product = require('../models/Product');
const Shop = require('../models/Shop');
const Category = require('../models/Category');
const { authenticate, authorize, requireVerification } = require('../middleware/auth');
const { 
  validateProductCreation, 
  validateObjectIdParam, 
  validatePagination,
  validateSearch 
} = require('../middleware/validation');
const { upload } = require('../middleware/upload');

const router = express.Router();
const { getSuggestions } = require('../controllers/searchController');
const { 
  getReviews, 
  addReview, 
  updateReview, 
  deleteReview 
} = require('../controllers/productController');

router.get('/search/suggestions', getSuggestions);

// @desc    Create new product
// @route   POST /api/products
// @access  Private (Shop Owner)
const createProduct = async (req, res) => {
  try {
    // Check if user owns a shop
    const shop = await Shop.findOne({ ownerId: req.user._id });
    
    if (!shop) {
      return res.status(400).json({
        success: false,
        message: 'You need to register a shop first to add products'
      });
    }

    if (!shop.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'Your shop needs to be verified before adding products'
      });
    }

    // Verify category exists
    const category = await Category.findById(req.body.categoryId);
    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category'
      });
    }

    const productData = {
      ...req.body,
      shopId: shop._id
    };

    const product = new Product(productData);
    await product.save();

    await product.populate('shopId categoryId');

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product
    });

  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create product',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get all products with filters
// @route   GET /api/products
// @access  Public
const getProducts = async (req, res) => {
  try {
    const {
      search,
      categoryId,
      shopId,
      minPrice,
      maxPrice,
      inStock = true,
      sortBy = 'createdAt',
      sortOrder = -1,
      page = 1,
      limit = 20
    } = req.query;

    const options = {
      shopId,
      categoryId,
      minPrice: minPrice ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
      inStock: inStock === 'true',
      sortBy,
      sortOrder: parseInt(sortOrder),
      limit: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit)
    };

    const products = await Product.find()
    
    // Get total count for pagination
    const filter = {
      isActive: true,
      ...(shopId && { shopId }),
      ...(categoryId && { categoryId }),
      ...(inStock === 'true' && { status: 'in_stock' }),
      ...(minPrice && { $or: [{ discountPrice: { $gte: parseFloat(minPrice) } }, { $and: [{ discountPrice: { $exists: false } }, { price: { $gte: parseFloat(minPrice) } }] }] }),
      ...(maxPrice && { $or: [{ discountPrice: { $lte: parseFloat(maxPrice) } }, { $and: [{ discountPrice: { $exists: false } }, { price: { $lte: parseFloat(maxPrice) } }] }] })
    };

    if (search) {
      filter.$text = { $search: search };
    }

    const total = await Product.countDocuments(filter);

    res.json({
      success: true,
      data: {
        products,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get products'
    });
  }
};

// @desc    Get product by ID
// @route   GET /api/products/:id
// @access  Public
const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('shopId', 'name address contact rating operatingHours')
      .populate('categoryId', 'name');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Increment view count
    await product.incrementView();

    // Get related products from same shop/category
    const relatedProducts = await Product.find({
      $or: [
        { shopId: product.shopId, _id: { $ne: product._id } },
        { categoryId: product.categoryId, _id: { $ne: product._id } }
      ],
      isActive: true,
      status: 'in_stock'
    })
    .populate('shopId', 'name rating')
    .limit(10);

    res.json({
      success: true,
      product,
      relatedProducts
    });

  } catch (error) {
    console.error('Get product by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get product'
    });
  }
};

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private (Shop Owner)
const updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('shopId');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if user owns the shop or is admin
    if (product.shopId.ownerId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this product'
      });
    }

    const allowedUpdates = [
      'name', 'description', 'images', 'price', 'discountPrice', 
      'unit', 'quantity', 'stock', 'specifications', 'tags', 
      'nutrition', 'allergens', 'brand', 'isActive', 'isFeatured'
    ];

    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).populate('shopId categoryId');

    res.json({
      success: true,
      message: 'Product updated successfully',
      product: updatedProduct
    });

  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update product'
    });
  }
};

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private (Shop Owner)
const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('shopId');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if user owns the shop or is admin
    if (product.shopId.ownerId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this product'
      });
    }

    // Soft delete by setting isActive to false
    product.isActive = false;
    await product.save();

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });

  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete product'
    });
  }
};

// @desc    Update product stock
// @route   PATCH /api/products/:id/stock
// @access  Private (Shop Owner)
const updateProductStock = async (req, res) => {
  try {
    const { available, lowStockThreshold } = req.body;

    if (available === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Available stock is required'
      });
    }

    const product = await Product.findById(req.params.id).populate('shopId');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if user owns the shop or is admin
    if (product.shopId.ownerId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update stock for this product'
      });
    }

    product.stock.available = available;
    if (lowStockThreshold !== undefined) {
      product.stock.lowStockThreshold = lowStockThreshold;
    }

    await product.save();

    res.json({
      success: true,
      message: 'Stock updated successfully',
      stock: product.stock,
      status: product.status
    });

  } catch (error) {
    console.error('Update stock error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update stock'
    });
  }
};

// @desc    Upload product images
// @route   POST /api/products/:id/images
// @access  Private (Shop Owner)
const uploadProductImages = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('shopId');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if user owns the shop
    if (product.shopId.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to upload images for this product'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No images uploaded'
      });
    }

    const images = req.files.map((file, index) => ({
      url: `/uploads/${file.filename}`,
      alt: req.body.alt || product.name,
      isPrimary: index === 0 && product.images.length === 0
    }));

    product.images.push(...images);
    await product.save();

    res.json({
      success: true,
      message: 'Images uploaded successfully',
      images
    });

  } catch (error) {
    console.error('Upload product images error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload images'
    });
  }
};

// @desc    Get trending products
// @route   GET /api/products/trending
// @access  Public
const getTrendingProducts = async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const products = await Product.find({
      isActive: true,
      status: 'in_stock'
    })
    .populate('shopId', 'name rating')
    .populate('categoryId', 'name')
    .sort({ salesCount: -1, viewCount: -1 })
    .limit(parseInt(limit));

    res.json({
      success: true,
      products
    });

  } catch (error) {
    console.error('Get trending products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get trending products'
    });
  }
};

// @desc    Get featured products
// @route   GET /api/products/featured
// @access  Public
const getFeaturedProducts = async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const products = await Product.find({
      isActive: true,
      isFeatured: true,
      status: 'in_stock'
    })
    .populate('shopId', 'name rating')
    .populate('categoryId', 'name')
    .sort({ createdAt: -1 })
    .limit(parseInt(limit));

    res.json({
      success: true,
      products
    });

  } catch (error) {
    console.error('Get featured products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get featured products'
    });
  }
};

// @desc    Get products by category
// @route   GET /api/products/category/:categoryId
// @access  Public
const getProductsByCategory = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20,
      sortBy = 'name',
      sortOrder = 1 
    } = req.query;

    const category = await Category.findById(req.params.categoryId);
    
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const products = await Product.find({
      categoryId: req.params.categoryId,
      isActive: true,
      status: 'in_stock'
    })
    .populate('shopId', 'name rating')
    .sort({ [sortBy]: parseInt(sortOrder) })
    .skip(skip)
    .limit(parseInt(limit));

    const total = await Product.countDocuments({
      categoryId: req.params.categoryId,
      isActive: true
    });

    res.json({
      success: true,
      category,
      data: {
        products,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Get products by category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get products by category'
    });
  }
};

// Apply middleware and routes
router.post('/', 
  authenticate, 
  authorize('shop_owner'), 
  requireVerification,
  validateProductCreation, 
  createProduct
);

router.get('/', 
  validatePagination,
  validateSearch,
  getProducts
);

router.get('/trending', getTrendingProducts);
router.get('/featured', getFeaturedProducts);

router.get('/category/:categoryId',
  validateObjectIdParam('categoryId'),
  validatePagination,
  getProductsByCategory
);

router.get('/:id', 
  validateObjectIdParam('id'), 
  getProductById
);

router.get('/:id/reviews',
  validateObjectIdParam('id'),
  validatePagination,
  getReviews
);

router.post('/:id/reviews',
  authenticate,
  requireVerification,
  validateObjectIdParam('id'),
  addReview
);

router.put('/:id/reviews/:reviewId',
  authenticate,
  requireVerification,
  validateObjectIdParam('id'),
  updateReview
);

router.delete('/:id/reviews/:reviewId',
  authenticate,
  requireVerification,
  validateObjectIdParam('id'),
  deleteReview
);

router.put('/:id', 
  authenticate, 
  requireVerification,
  validateObjectIdParam('id'), 
  updateProduct
);

router.delete('/:id', 
  authenticate, 
  requireVerification,
  validateObjectIdParam('id'), 
  deleteProduct
);

router.patch('/:id/stock', 
  authenticate, 
  requireVerification,
  validateObjectIdParam('id'), 
  updateProductStock
);

router.post('/:id/images', 
  authenticate, 
  requireVerification,
  validateObjectIdParam('id'),
  upload.array('images', 5),
  uploadProductImages
);

module.exports = router;
