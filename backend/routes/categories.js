const express = require('express');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { authenticate, authorize, requireVerification } = require('../middleware/auth');
const { validateObjectIdParam, validatePagination } = require('../middleware/validation');
const { upload, optimizeImage } = require('../middleware/upload');

const router = express.Router();

// @desc    Get all categories (tree structure)
// @route   GET /api/categories
// @access  Public
const getCategories = async (req, res) => {
  try {
    const { tree = 'false', parent } = req.query;

    let categories;

    if (tree === 'true') {
      // Get categories in tree structure
      categories = await Category.getCategoryTree();
    } else if (parent) {
      // Get subcategories of a parent
      categories = await Category.find({ 
        parentCategory: parent === 'root' ? null : parent,
        isActive: true 
      })
      .populate('parentCategory', 'name')
      .sort({ sortOrder: 1, name: 1 });
    } else {
      // Get all categories (flat)
      categories = await Category.find({ isActive: true })
        .populate('parentCategory', 'name')
        .populate('productsCount')
        .sort({ sortOrder: 1, name: 1 });
    }

    res.json({
      success: true,
      categories
    });

  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get categories'
    });
  }
};

// @desc    Get category by ID
// @route   GET /api/categories/:id
// @access  Public
const getCategoryById = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id)
      .populate('parentCategory', 'name')
      .populate('subcategories')
      .populate('productsCount');

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Get category path
    const fullPath = await category.getFullPath();

    // Get recent products in this category
    const recentProducts = await Product.find({
      categoryId: category._id,
      isActive: true,
      status: 'in_stock'
    })
    .populate('shopId', 'name rating')
    .sort({ createdAt: -1 })
    .limit(10);

    res.json({
      success: true,
      category: {
        ...category.toObject(),
        fullPath,
        recentProducts
      }
    });

  } catch (error) {
    console.error('Get category by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get category'
    });
  }
};

// @desc    Create new category
// @route   POST /api/categories
// @access  Private (Admin)
const createCategory = async (req, res) => {
  try {
    const { name, description, parentCategory, sortOrder, metadata } = req.body;

    // Check if category name already exists at the same level
    const existingCategory = await Category.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      parentCategory: parentCategory || null
    });

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Category name already exists at this level'
      });
    }

    // Verify parent category exists if provided
    if (parentCategory) {
      const parent = await Category.findById(parentCategory);
      if (!parent) {
        return res.status(400).json({
          success: false,
          message: 'Parent category not found'
        });
      }
    }

    const categoryData = {
      name,
      description,
      parentCategory: parentCategory || null,
      sortOrder: sortOrder || 0,
      metadata: metadata || {}
    };

    // Add image if uploaded
    if (req.file) {
      categoryData.image = `/${req.file.path}`;
    }

    const category = new Category(categoryData);
    await category.save();

    await category.populate('parentCategory', 'name');

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      category
    });

  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create category',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private (Admin)
const updateCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const allowedUpdates = ['name', 'description', 'parentCategory', 'isActive', 'sortOrder', 'metadata'];
    const updates = {};

    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // Handle image update
    if (req.file) {
      updates.image = `/${req.file.path}`;
    }

    // Verify parent category if being updated
    if (updates.parentCategory) {
      const parent = await Category.findById(updates.parentCategory);
      if (!parent) {
        return res.status(400).json({
          success: false,
          message: 'Parent category not found'
        });
      }
    }

    const updatedCategory = await Category.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).populate('parentCategory', 'name');

    res.json({
      success: true,
      message: 'Category updated successfully',
      category: updatedCategory
    });

  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update category'
    });
  }
};

// @desc    Delete category
// @route   DELETE /api/categories/:id
// @access  Private (Admin)
const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check if category has products
    const productCount = await Product.countDocuments({
      categoryId: category._id,
      isActive: true
    });

    if (productCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category with ${productCount} active products`
      });
    }

    // Check if category has subcategories
    const subcategoryCount = await Category.countDocuments({
      parentCategory: category._id,
      isActive: true
    });

    if (subcategoryCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category with ${subcategoryCount} active subcategories`
      });
    }

    // Soft delete by setting isActive to false
    category.isActive = false;
    await category.save();

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });

  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete category'
    });
  }
};

// @desc    Get popular categories
// @route   GET /api/categories/popular
// @access  Public
const getPopularCategories = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    // Get categories with most products
    const popularCategories = await Category.aggregate([
      { $match: { isActive: true, parentCategory: null } }, // Only root categories
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: 'categoryId',
          as: 'products'
        }
      },
      {
        $addFields: {
          productCount: { $size: '$products' },
          activeProductCount: {
            $size: {
              $filter: {
                input: '$products',
                cond: { $eq: ['$$this.isActive', true] }
              }
            }
          }
        }
      },
      { $sort: { activeProductCount: -1, productCount: -1 } },
      { $limit: parseInt(limit) },
      {
        $project: {
          name: 1,
          description: 1,
          image: 1,
          icon: 1,
          metadata: 1,
          productCount: '$activeProductCount'
        }
      }
    ]);

    res.json({
      success: true,
      categories: popularCategories
    });

  } catch (error) {
    console.error('Get popular categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get popular categories'
    });
  }
};

// @desc    Get category statistics
// @route   GET /api/categories/:id/stats
// @access  Private (Admin)
const getCategoryStats = async (req, res) => {
  try {
    const categoryId = req.params.id;

    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Get product statistics
    const productStats = await Product.aggregate([
      { $match: { categoryId: category._id } },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          activeProducts: { $sum: { $cond: ['$isActive', 1, 0] } },
          averagePrice: { $avg: '$price' },
          totalViews: { $sum: '$viewCount' },
          totalSales: { $sum: '$salesCount' }
        }
      }
    ]);

    // Get shop count using this category
    const shopCount = await Product.distinct('shopId', {
      categoryId: category._id,
      isActive: true
    }).then(shops => shops.length);

    const stats = {
      category: {
        id: category._id,
        name: category.name,
        isActive: category.isActive
      },
      products: productStats[0] || {
        totalProducts: 0,
        activeProducts: 0,
        averagePrice: 0,
        totalViews: 0,
        totalSales: 0
      },
      shopCount,
      subcategoryCount: await Category.countDocuments({
        parentCategory: category._id,
        isActive: true
      })
    };

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('Get category stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get category statistics'
    });
  }
};

// @desc    Reorder categories
// @route   PATCH /api/categories/reorder
// @access  Private (Admin)
const reorderCategories = async (req, res) => {
  try {
    const { categories } = req.body; // Array of {id, sortOrder}

    if (!Array.isArray(categories)) {
      return res.status(400).json({
        success: false,
        message: 'Categories must be an array'
      });
    }

    // Update sort orders
    const updatePromises = categories.map(cat => 
      Category.findByIdAndUpdate(cat.id, { sortOrder: cat.sortOrder })
    );

    await Promise.all(updatePromises);

    res.json({
      success: true,
      message: 'Categories reordered successfully'
    });

  } catch (error) {
    console.error('Reorder categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reorder categories'
    });
  }
};

// Apply middleware and routes
router.get('/', getCategories);
router.get('/popular', getPopularCategories);

router.get('/:id', 
  validateObjectIdParam('id'), 
  getCategoryById
);

router.post('/', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  upload.single('image'),
  optimizeImage,
  createCategory
);

router.put('/:id', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  validateObjectIdParam('id'),
  upload.single('image'),
  optimizeImage,
  updateCategory
);

router.delete('/:id', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  validateObjectIdParam('id'), 
  deleteCategory
);

router.get('/:id/stats', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  validateObjectIdParam('id'), 
  getCategoryStats
);

router.patch('/reorder', 
  authenticate, 
  authorize('admin'), 
  requireVerification,
  reorderCategories
);

module.exports = router;
