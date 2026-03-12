const express = require('express');
const Coupon = require('../models/Coupon');
const Shop = require('../models/Shop');
const { authenticate, authorize, requireVerification } = require('../middleware/auth');
const { 
  validateCouponCreation, 
  validateObjectIdParam, 
  validatePagination 
} = require('../middleware/validation');

const router = express.Router();

// @desc    Create new coupon
// @route   POST /api/coupons
// @access  Private (Shop Owner/Admin)
const createCoupon = async (req, res) => {
  try {
    const couponData = {
      ...req.body,
      createdBy: req.user._id
    };

    // Set shopId for shop owners
    if (req.user.role === 'shop_owner') {
      const shop = await Shop.findOne({ ownerId: req.user._id });
      if (!shop) {
        return res.status(400).json({
          success: false,
          message: 'You need to register a shop first to create coupons'
        });
      }
      couponData.shopId = shop._id;
    } else if (req.user.role === 'admin') {
      // Admin can create platform-wide coupons (shopId = null) or shop-specific
      couponData.shopId = req.body.shopId || null;
    }

    // Check if coupon code already exists
    const existingCoupon = await Coupon.findOne({
      code: couponData.code.toUpperCase(),
      isActive: true
    });

    if (existingCoupon) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code already exists'
      });
    }

    const coupon = new Coupon(couponData);
    await coupon.save();

    await coupon.populate('shopId createdBy', 'name fullName');

    res.status(201).json({
      success: true,
      message: 'Coupon created successfully',
      coupon
    });

  } catch (error) {
    console.error('Create coupon error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create coupon',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get available coupons for user
// @route   GET /api/coupons/available
// @access  Private (Customer)
const getAvailableCoupons = async (req, res) => {
  try {
    const { shopId, orderAmount = 0 } = req.query;

    const coupons = await Coupon.getAvailableCoupons(
      req.user._id,
      shopId,
      parseFloat(orderAmount)
    );

    // Filter coupons that user can actually use
    const validCoupons = [];
    
    for (const coupon of coupons) {
      const canUse = coupon.canUserUse(req.user._id, parseFloat(orderAmount));
      if (canUse.canUse) {
        const discount = coupon.calculateDiscount(parseFloat(orderAmount));
        validCoupons.push({
          ...coupon.toObject(),
          estimatedDiscount: discount.discount
        });
      }
    }

    res.json({
      success: true,
      coupons: validCoupons
    });

  } catch (error) {
    console.error('Get available coupons error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get available coupons'
    });
  }
};

// @desc    Validate coupon code
// @route   POST /api/coupons/validate
// @access  Private (Customer)
const validateCouponCode = async (req, res) => {
  try {
    const { code, orderAmount, shopId } = req.body;

    if (!code || orderAmount === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code and order amount are required'
      });
    }

    const validation = await Coupon.validateCouponCode(
      code,
      req.user._id,
      parseFloat(orderAmount),
      shopId
    );

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.error
      });
    }

    const coupon = validation.coupon;
    const discount = coupon.calculateDiscount(parseFloat(orderAmount));

    res.json({
      success: true,
      message: 'Coupon is valid',
      coupon: {
        id: coupon._id,
        code: coupon.code,
        name: coupon.name,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discount: discount.discount,
        minimumOrderAmount: coupon.minimumOrderAmount,
        terms: coupon.terms
      }
    });

  } catch (error) {
    console.error('Validate coupon error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate coupon'
    });
  }
};

// @desc    Get all coupons (filtered by role)
// @route   GET /api/coupons
// @access  Private
const getCoupons = async (req, res) => {
  try {
    const {
      shopId,
      discountType,
      isActive,
      search,
      sortBy = 'createdAt',
      sortOrder = -1,
      page = 1,
      limit = 20
    } = req.query;

    // Build filter based on user role
    let filter = {};

    if (req.user.role === 'shop_owner') {
      // Shop owners can only see their own coupons
      const shop = await Shop.findOne({ ownerId: req.user._id });
      if (shop) {
        filter.shopId = shop._id;
      } else {
        return res.json({
          success: true,
          data: { coupons: [], pagination: { total: 0, pages: 0, page: 1, limit } }
        });
      }
    } else if (req.user.role === 'admin') {
      // Admin can filter by shopId
      if (shopId) {
        filter.shopId = shopId;
      }
    } else {
      // Other roles cannot access this endpoint
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view coupons'
      });
    }

    // Apply additional filters
    if (discountType) filter.discountType = discountType;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    if (search) {
      filter.$or = [
        { code: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const coupons = await Coupon.find(filter)
      .populate('shopId', 'name')
      .populate('createdBy', 'fullName')
      .sort({ [sortBy]: parseInt(sortOrder) })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Coupon.countDocuments(filter);

    res.json({
      success: true,
      data: {
        coupons,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Get coupons error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get coupons'
    });
  }
};

// @desc    Get coupon by ID
// @route   GET /api/coupons/:id
// @access  Private (Admin/Shop Owner)
const getCouponById = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id)
      .populate('shopId', 'name address')
      .populate('createdBy', 'fullName email')
      .populate('applicableCategories', 'name')
      .populate('applicableProducts', 'name price')
      .populate('applicableUsers', 'fullName email');

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    // Check if user can access this coupon
    const canAccess = 
      req.user.role === 'admin' ||
      (req.user.role === 'shop_owner' && coupon.createdBy._id.toString() === req.user._id.toString());

    if (!canAccess) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this coupon'
      });
    }

    res.json({
      success: true,
      coupon
    });

  } catch (error) {
    console.error('Get coupon by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get coupon'
    });
  }
};

// @desc    Update coupon
// @route   PUT /api/coupons/:id
// @access  Private (Admin/Shop Owner)
const updateCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    // Check if user can update this coupon
    const canUpdate = 
      req.user.role === 'admin' ||
      (req.user.role === 'shop_owner' && coupon.createdBy.toString() === req.user._id.toString());

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this coupon'
      });
    }

    const allowedUpdates = [
      'name', 'description', 'discountValue', 'maxDiscountAmount',
      'minimumOrderAmount', 'usageLimit', 'validFrom', 'validUntil',
      'isActive', 'isVisible', 'terms', 'applicableCategories',
      'applicableProducts', 'applicableUsers', 'metadata'
    ];

    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const updatedCoupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).populate('shopId createdBy', 'name fullName');

    res.json({
      success: true,
      message: 'Coupon updated successfully',
      coupon: updatedCoupon
    });

  } catch (error) {
    console.error('Update coupon error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update coupon'
    });
  }
};

// @desc    Delete/Deactivate coupon
// @route   DELETE /api/coupons/:id
// @access  Private (Admin/Shop Owner)
const deleteCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    // Check if user can delete this coupon
    const canDelete = 
      req.user.role === 'admin' ||
      (req.user.role === 'shop_owner' && coupon.createdBy.toString() === req.user._id.toString());

    if (!canDelete) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this coupon'
      });
    }

    // Soft delete by deactivating
    coupon.isActive = false;
    await coupon.save();

    res.json({
      success: true,
      message: 'Coupon deactivated successfully'
    });

  } catch (error) {
    console.error('Delete coupon error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete coupon'
    });
  }
};

// @desc    Get coupon usage analytics
// @route   GET /api/coupons/:id/analytics
// @access  Private (Admin/Shop Owner)
const getCouponAnalytics = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    // Check authorization
    const canAccess = 
      req.user.role === 'admin' ||
      (req.user.role === 'shop_owner' && coupon.createdBy.toString() === req.user._id.toString());

    if (!canAccess) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view coupon analytics'
      });
    }

    const analytics = {
      coupon: {
        id: coupon._id,
        code: coupon.code,
        name: coupon.name,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue
      },
      usage: {
        totalUses: coupon.usageCount.total,
        usageLimit: coupon.usageLimit.total,
        usagePercentage: coupon.usagePercentage,
        uniqueUsers: coupon.usageCount.users.length,
        averageUsesPerUser: coupon.usageCount.users.length > 0 
          ? Math.round(coupon.usageCount.total / coupon.usageCount.users.length * 100) / 100 
          : 0
      },
      topUsers: coupon.usageCount.users
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map(user => ({
          userId: user.userId,
          usageCount: user.count,
          lastUsed: user.lastUsed
        })),
      dateRange: {
        validFrom: coupon.validFrom,
        validUntil: coupon.validUntil,
        daysRemaining: Math.max(0, Math.ceil((coupon.validUntil - new Date()) / (1000 * 60 * 60 * 24)))
      },
      status: {
        isActive: coupon.isActive,
        isVisible: coupon.isVisible,
        isCurrentlyValid: coupon.isCurrentlyValid
      }
    };

    res.json({
      success: true,
      analytics
    });

  } catch (error) {
    console.error('Get coupon analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get coupon analytics'
    });
  }
};

// @desc    Use coupon (internal endpoint)
// @route   POST /api/coupons/:id/use
// @access  Private (System use only)
const useCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    // This endpoint is typically called internally during order processing
    await coupon.useCoupon(req.user._id);

    res.json({
      success: true,
      message: 'Coupon usage recorded',
      newUsageCount: coupon.usageCount.total
    });

  } catch (error) {
    console.error('Use coupon error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record coupon usage'
    });
  }
};

// Apply middleware and routes
router.post('/', 
  authenticate, 
  authorize('shop_owner', 'admin'), 
  requireVerification,
  validateCouponCreation,
  createCoupon
);

router.get('/available', 
  authenticate, 
  authorize('customer'), 
  requireVerification,
  getAvailableCoupons
);

router.post('/validate', 
  authenticate, 
  authorize('customer'), 
  requireVerification,
  validateCouponCode
);

router.get('/', 
  authenticate, 
  authorize('shop_owner', 'admin'), 
  requireVerification,
  validatePagination,
  getCoupons
);

router.get('/:id', 
  authenticate, 
  authorize('shop_owner', 'admin'), 
  requireVerification,
  validateObjectIdParam('id'),
  getCouponById
);

router.put('/:id', 
  authenticate, 
  authorize('shop_owner', 'admin'), 
  requireVerification,
  validateObjectIdParam('id'),
  updateCoupon
);

router.delete('/:id', 
  authenticate, 
  authorize('shop_owner', 'admin'), 
  requireVerification,
  validateObjectIdParam('id'),
  deleteCoupon
);

router.get('/:id/analytics', 
  authenticate, 
  authorize('shop_owner', 'admin'), 
  requireVerification,
  validateObjectIdParam('id'),
  getCouponAnalytics
);

router.post('/:id/use', 
  authenticate, 
  requireVerification,
  validateObjectIdParam('id'),
  useCoupon
);

module.exports = router;
