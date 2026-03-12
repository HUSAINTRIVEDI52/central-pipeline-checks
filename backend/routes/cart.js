const express = require('express');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Shop = require('../models/Shop');
const Coupon = require('../models/Coupon');
const { authenticate, authorize, requireVerification } = require('../middleware/auth');
const { validateCartOperation, validateObjectIdParam } = require('../middleware/validation');

const router = express.Router();

// @desc    Get user's cart
// @route   GET /api/cart
// @access  Private (Customer)
const getCart = async (req, res) => {
  try {
    let cart = await Cart.getOrCreateCart(req.user._id);
    
    // Populate cart with product details
    await cart.getCartWithProducts();
    
    // Calculate totals
    const totals = await cart.calculateTotals();

    res.json({
      success: true,
      cart: {
        ...cart.toObject(),
        totals
      }
    });

  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cart'
    });
  }
};

// @desc    Add item to cart
// @route   POST /api/cart/items
// @access  Private (Customer)
const addToCart = async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;

    // Strict quantity validation
    if (quantity < 1) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be at least 1'
      });
    }

    // Verify product exists and is available
    const product = await Product.findById(productId).populate('shopId');
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (!product.isActive || product.status !== 'in_stock') {
      return res.status(400).json({
        success: false,
        message: 'Product is not available'
      });
    }

    if (product.stock.available < quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.stock.available} items available`
      });
    }

    // Check if shop exists and is populated
    if (!product.shopId) {
      return res.status(400).json({
        success: false,
        message: 'Product shop information is missing'
      });
    }

    // Check if shop is open (only if shop data is populated)
    if (product.shopId.isOpen !== undefined && product.shopId.isActive !== undefined) {
      if (!product.shopId.isOpen || !product.shopId.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Shop is currently closed'
        });
      }
    }

    // Get or create cart
    let cart = await Cart.getOrCreateCart(req.user._id);

    // Add item to cart
    try {
      // Get shopId - handle both populated and non-populated cases
      const shopId = product.shopId._id || product.shopId;
      await cart.addItem(productId, quantity, shopId);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    // Get updated cart with totals
    await cart.getCartWithProducts();
    const totals = await cart.calculateTotals();

    // Emit real-time update (if socket.io is available)
    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(`user_${req.user._id}`).emit('cart_updated', { 
          action: 'item_added',
          productId,
          quantity,
          totalItems: cart.totalItems
        });
      }
    } catch (socketError) {
      // Socket.io not available, continue without real-time updates
      console.log('Socket.io not available for cart update');
    }

    res.json({
      success: true,
      message: 'Item added to cart successfully',
      cart: {
        ...cart.toObject(),
        totals
      }
    });

  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add item to cart'
    });
  }
};

// @desc    Update item quantity in cart
// @route   PUT /api/cart/items/:productId
// @access  Private (Customer)
const updateCartItem = async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity } = req.body;

    // Strict quantity validation - require explicit delete for removal
    if (quantity < 1) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be at least 1. Use DELETE to remove item.'
      });
    }

    // Get user's cart
    const cart = await Cart.findOne({ userId: req.user._id });
    
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    // Check if item exists in cart
    const itemExists = cart.items.some(
      item => item.productId.toString() === productId
    );

    if (!itemExists) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in cart'
      });
    }

    // Check product availability
    const product = await Product.findById(productId);
    
    if (!product || !product.isActive || product.status !== 'in_stock') {
      return res.status(400).json({
        success: false,
        message: 'Product is not available'
      });
    }

    if (product.stock.available < quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.stock.available} items available`
      });
    }

    // Update item quantity
    await cart.updateItemQuantity(productId, quantity);
    
    // Get updated cart with totals
    await cart.getCartWithProducts();
    const totals = await cart.calculateTotals();

    // Emit real-time update (if socket.io is available)
    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(`user_${req.user._id}`).emit('cart_updated', { 
          action: 'item_updated',
          productId,
          quantity,
          totalItems: cart.totalItems
        });
      }
    } catch (socketError) {
      // Socket.io not available, continue without real-time updates
      console.log('Socket.io not available for cart update');
    }

    res.json({
      success: true,
      message: 'Cart updated successfully',
      cart: {
        ...cart.toObject(),
        totals
      }
    });

  } catch (error) {
    console.error('Update cart item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update cart item'
    });
  }
};

// @desc    Remove item from cart
// @route   DELETE /api/cart/items/:productId
// @access  Private (Customer)
const removeFromCart = async (req, res) => {
  try {
    const { productId } = req.params;

    const cart = await Cart.findOne({ userId: req.user._id });
    
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    // Check if item exists in cart
    const itemExists = cart.items.some(
      item => item.productId.toString() === productId
    );

    if (!itemExists) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in cart'
      });
    }

    // Remove item
    await cart.removeItem(productId);
    
    // Get updated cart with totals
    await cart.getCartWithProducts();
    const totals = await cart.calculateTotals();

    // Emit real-time update (if socket.io is available)
    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(`user_${req.user._id}`).emit('cart_updated', { 
          action: 'item_removed',
          productId,
          totalItems: cart.totalItems
        });
      }
    } catch (socketError) {
      // Socket.io not available, continue without real-time updates
      console.log('Socket.io not available for cart update');
    }

    res.json({
      success: true,
      message: 'Item removed from cart successfully',
      cart: {
        ...cart.toObject(),
        totals
      }
    });

  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove item from cart'
    });
  }
};

// @desc    Clear entire cart
// @route   DELETE /api/cart
// @access  Private (Customer)
const clearCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user._id });
    
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    await cart.clearCart();

    // Emit real-time update (if socket.io is available)
    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(`user_${req.user._id}`).emit('cart_updated', { 
          action: 'cart_cleared',
          totalItems: 0
        });
      }
    } catch (socketError) {
      // Socket.io not available, continue without real-time updates
      console.log('Socket.io not available for cart update');
    }

    res.json({
      success: true,
      message: 'Cart cleared successfully',
      cart: {
        userId: req.user._id,
        items: [],
        totalItems: 0,
        totals: {
          subtotal: 0,
          deliveryFee: 0,
          tax: 0,
          total: 0,
          totalItems: 0,
          itemsCount: 0
        }
      }
    });

  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear cart'
    });
  }
};

// @desc    Apply coupon to cart
// @route   POST /api/cart/coupon
// @access  Private (Customer)
const applyCoupon = async (req, res) => {
  try {
    const { couponCode } = req.body;

    if (!couponCode) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code is required'
      });
    }

    const cart = await Cart.findOne({ userId: req.user._id });
    
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty'
      });
    }

    // Calculate current cart totals
    await cart.getCartWithProducts();
    const totals = await cart.calculateTotals();

    // Validate coupon
    const validation = await Coupon.validateCouponCode(
      couponCode,
      req.user._id,
      totals.subtotal,
      cart.shopId
    );

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.error
      });
    }

    const coupon = validation.coupon;

    // Calculate discount
    const discountResult = coupon.calculateDiscount(totals.subtotal, totals.deliveryFee);

    // Apply coupon to cart
    await cart.applyCoupon(couponCode);

    // Recalculate totals with discount
    const updatedTotals = {
      ...totals,
      discount: discountResult.discount,
      total: totals.total - discountResult.discount,
      coupon: {
        code: couponCode,
        name: coupon.name,
        discount: discountResult.discount,
        discountType: coupon.discountType
      }
    };

    res.json({
      success: true,
      message: 'Coupon applied successfully',
      cart: {
        ...cart.toObject(),
        totals: updatedTotals
      }
    });

  } catch (error) {
    console.error('Apply coupon error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to apply coupon'
    });
  }
};

// @desc    Remove coupon from cart
// @route   DELETE /api/cart/coupon
// @access  Private (Customer)
const removeCoupon = async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user._id });
    
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    if (!cart.couponCode) {
      return res.status(400).json({
        success: false,
        message: 'No coupon applied to cart'
      });
    }

    // Remove coupon
    await cart.removeCoupon();
    
    // Get updated cart with totals
    await cart.getCartWithProducts();
    const totals = await cart.calculateTotals();

    res.json({
      success: true,
      message: 'Coupon removed successfully',
      cart: {
        ...cart.toObject(),
        totals
      }
    });

  } catch (error) {
    console.error('Remove coupon error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove coupon'
    });
  }
};

// @desc    Validate cart for checkout
// @route   POST /api/cart/validate
// @access  Private (Customer)
const validateCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user._id });
    
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    await cart.getCartWithProducts();
    const validation = await cart.validateForCheckout();

    if (validation.isValid) {
      res.json({
        success: true,
        message: 'Cart is valid for checkout',
        totals: validation.totals
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Cart validation failed',
        errors: validation.errors,
        totals: validation.totals
      });
    }

  } catch (error) {
    console.error('Validate cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate cart'
    });
  }
};

// @desc    Get cart summary (lightweight version)
// @route   GET /api/cart/summary
// @access  Private (Customer)
const getCartSummary = async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user._id });
    
    if (!cart) {
      return res.json({
        success: true,
        summary: {
          itemsCount: 0,
          totalItems: 0,
          hasItems: false
        }
      });
    }

    res.json({
      success: true,
      summary: {
        itemsCount: cart.itemsCount,
        totalItems: cart.totalItems,
        hasItems: cart.items.length > 0,
        shopId: cart.shopId,
        lastUpdated: cart.lastUpdated
      }
    });

  } catch (error) {
    console.error('Get cart summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cart summary'
    });
  }
};

// Apply middleware and routes
router.get('/',
  authenticate,
  authorize('customer', 'delivery_partner'),
  getCart
);

router.get('/summary',
  authenticate,
  authorize('customer', 'delivery_partner'),
  getCartSummary
);

router.post('/items',
  authenticate,
  authorize('customer', 'delivery_partner'),
  validateCartOperation,
  addToCart
);

router.put('/items/:productId',
  authenticate,
  authorize('customer', 'delivery_partner'),
  validateObjectIdParam('productId'),
  updateCartItem
);

router.delete('/items/:productId',
  authenticate,
  authorize('customer', 'delivery_partner'),
  validateObjectIdParam('productId'),
  removeFromCart
);

router.delete('/',
  authenticate,
  authorize('customer', 'delivery_partner'),
  clearCart
);

router.post('/coupon',
  authenticate,
  authorize('customer', 'delivery_partner'),
  applyCoupon
);

router.delete('/coupon',
  authenticate,
  authorize('customer', 'delivery_partner'),
  removeCoupon
);

router.post('/validate',
  authenticate,
  authorize('customer', 'delivery_partner'),
  validateCart
);

module.exports = router;
