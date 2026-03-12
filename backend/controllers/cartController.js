const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiResponse } = require('../utils/helpers');

// @desc    Get user cart
// @route   GET /api/cart
// @access  Private
const getCart = asyncHandler(async (req, res) => {
  let cart = await Cart.findOne({ userId: req.user.id })
    .populate({
      path: 'items.productId',
      select: 'name price discountPrice images unit quantity stock status isActive'
    });

  if (!cart) {
    cart = await Cart.create({ userId: req.user.id, items: [] });
  }

  // Filter out inactive products and calculate totals
  cart.items = cart.items.filter(item =>
    item.productId &&
    item.productId.isActive !== false
  );

  // Calculate totals
  let subtotal = 0;
  let totalItems = 0;

  cart.items.forEach(item => {
    if (item.productId) {
      const effectivePrice = item.productId.discountPrice || item.productId.price;
      subtotal += effectivePrice * item.quantity;
      totalItems += item.quantity;
    }
  });

  await cart.save();

  res.json(apiResponse(true, 'Cart retrieved successfully', {
    cart: {
      userId: cart.userId,
      items: cart.items,
      shopId: cart.shopId,
      couponCode: cart.couponCode,
      lastUpdated: cart.lastUpdated
    },
    totals: {
      subtotal,
      totalItems,
      itemsCount: cart.items.length
    }
  }));
});

// @desc    Add item to cart
// @route   POST /api/cart/add
// @access  Private
const addToCart = asyncHandler(async (req, res) => {
  const { productId, quantity = 1 } = req.body;

  // Validate product
  const product = await Product.findById(productId).populate('shopId');
  
  if (!product || !product.isActive) {
    return res.status(404).json(apiResponse(false, 'Product not found'));
  }

  if (product.stock.available < quantity) {
    return res.status(400).json(apiResponse(false, 'Insufficient stock'));
  }

  // Get or create cart
  let cart = await Cart.findOne({ userId: req.user.id });
  
  if (!cart) {
    cart = await Cart.create({ userId: req.user.id, items: [] });
  }

  // Check if item already exists in cart
  const existingItemIndex = cart.items.findIndex(
    item => item.productId.toString() === productId
  );

  if (existingItemIndex > -1) {
    // Update existing item
    const newQuantity = cart.items[existingItemIndex].quantity + quantity;
    
    if (newQuantity > product.stock.available) {
      return res.status(400).json(apiResponse(false, 'Quantity exceeds available stock'));
    }
    
    cart.items[existingItemIndex].quantity = newQuantity;
    cart.items[existingItemIndex].updatedAt = new Date();
  } else {
    // Add new item
    cart.items.push({
      productId,
      quantity,
      addedAt: new Date()
    });
  }

  cart.updatedAt = new Date();
  await cart.save();

  // Populate cart for response
  await cart.populate({
    path: 'items.productId',
    select: 'name price discountPrice images unit quantity stock status isActive'
  });

  res.json(apiResponse(true, 'Item added to cart successfully', {
    cart: {
      userId: cart.userId,
      items: cart.items,
      shopId: cart.shopId,
      couponCode: cart.couponCode,
      lastUpdated: cart.lastUpdated
    }
  }));
});

// @desc    Update cart item quantity
// @route   PUT /api/cart/update/:itemId
// @access  Private
const updateCartItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  const itemId = req.params.itemId;

  const cart = await Cart.findOne({ userId: req.user.id });
  
  if (!cart) {
    return res.status(404).json(apiResponse(false, 'Cart not found'));
  }

  const item = cart.items.id(itemId);
  
  if (!item) {
    return res.status(404).json(apiResponse(false, 'Item not found in cart'));
  }

  // Validate quantity
  if (quantity <= 0) {
    return res.status(400).json(apiResponse(false, 'Quantity must be greater than 0'));
  }

  // Check stock availability
  const product = await Product.findById(item.productId);
  
  if (quantity > product.stock.available) {
    return res.status(400).json(apiResponse(false, 'Quantity exceeds available stock'));
  }

  item.quantity = quantity;
  item.updatedAt = new Date();
  cart.updatedAt = new Date();
  
  await cart.save();

  // Populate cart for response
  await cart.populate('items.productId', 'name price stock images');
  await cart.populate('items.shopId', 'name');

  res.json(apiResponse(true, 'Cart item updated successfully', cart));
});

// @desc    Remove item from cart
// @route   DELETE /api/cart/remove/:itemId
// @access  Private
const removeFromCart = asyncHandler(async (req, res) => {
  const itemId = req.params.itemId;

  const cart = await Cart.findOne({ userId: req.user.id });
  
  if (!cart) {
    return res.status(404).json(apiResponse(false, 'Cart not found'));
  }

  cart.items.pull(itemId);
  cart.updatedAt = new Date();
  
  await cart.save();

  // Populate cart for response
  await cart.populate('items.productId', 'name price stock images');
  await cart.populate('items.shopId', 'name');

  res.json(apiResponse(true, 'Item removed from cart successfully', cart));
});

// @desc    Clear entire cart
// @route   DELETE /api/cart/clear
// @access  Private
const clearCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ userId: req.user.id });
  
  if (!cart) {
    return res.status(404).json(apiResponse(false, 'Cart not found'));
  }

  cart.items = [];
  cart.updatedAt = new Date();
  
  await cart.save();

  res.json(apiResponse(true, 'Cart cleared successfully', cart));
});

// @desc    Clear shop items from cart
// @route   DELETE /api/cart/clear-shop/:shopId
// @access  Private
const clearShopFromCart = asyncHandler(async (req, res) => {
  const shopId = req.params.shopId;

  const cart = await Cart.findOne({ userId: req.user.id });
  
  if (!cart) {
    return res.status(404).json(apiResponse(false, 'Cart not found'));
  }

  cart.items = cart.items.filter(item => 
    item.shopId.toString() !== shopId
  );
  
  cart.updatedAt = new Date();
  await cart.save();

  // Populate cart for response
  await cart.populate('items.productId', 'name price stock images');
  await cart.populate('items.shopId', 'name');

  res.json(apiResponse(true, 'Shop items removed from cart successfully', cart));
});

// @desc    Get cart item count
// @route   GET /api/cart/count
// @access  Private
const getCartCount = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ userId: req.user.id });
  
  const count = cart ? cart.items.reduce((total, item) => total + item.quantity, 0) : 0;

  res.json(apiResponse(true, 'Cart count retrieved successfully', { count }));
});

// @desc    Validate cart before checkout
// @route   POST /api/cart/validate
// @access  Private
const validateCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ userId: req.user.id })
    .populate('items.productId', 'name price stock isActive')
    .populate('items.shopId', 'name isActive isVerified');

  if (!cart || cart.items.length === 0) {
    return res.status(400).json(apiResponse(false, 'Cart is empty'));
  }

  const issues = [];

  // Check each item
  for (let i = 0; i < cart.items.length; i++) {
    const item = cart.items[i];
    
    if (!item.productId || !item.productId.isActive) {
      issues.push({
        itemId: item._id,
        issue: 'Product no longer available',
        action: 'remove'
      });
      continue;
    }

    if (!item.shopId || !item.shopId.isActive || !item.shopId.isVerified) {
      issues.push({
        itemId: item._id,
        issue: 'Shop no longer available',
        action: 'remove'
      });
      continue;
    }

    if (item.quantity > item.productId.stock) {
      issues.push({
        itemId: item._id,
        issue: `Only ${item.productId.stock} items available, you have ${item.quantity} in cart`,
        action: 'reduce_quantity',
        maxQuantity: item.productId.stock
      });
    }
  }

  if (issues.length > 0) {
    return res.status(400).json(apiResponse(false, 'Cart validation failed', { issues }));
  }

  res.json(apiResponse(true, 'Cart is valid for checkout', cart));
});

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  clearShopFromCart,
  getCartCount,
  validateCart
};
