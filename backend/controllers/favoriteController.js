const Favorite = require('../models/Favorite');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiResponse } = require('../utils/helpers');

// @desc    Get user favorites
// @route   GET /api/favorites
// @access  Private
const getFavorites = asyncHandler(async (req, res) => {
  const { type } = req.query; // 'product' or 'shop'
  
  let favorites = await Favorite.getOrCreateFavorites(req.user.id);
  
  // Populate based on type
  if (type === 'product') {
    await favorites.populate({
      path: 'items.itemId',
      match: { itemType: 'product' },
      select: 'name price discountPrice images unit stock status shopId',
      populate: { path: 'shopId', select: 'name' }
    });
    favorites.items = favorites.items.filter(item => item.itemType === 'product' && item.itemId);
  } else if (type === 'shop') {
    await favorites.populate({
      path: 'items.itemId',
      match: { itemType: 'shop' },
      select: 'name description address rating isActive isOpen deliveryFee'
    });
    favorites.items = favorites.items.filter(item => item.itemType === 'shop' && item.itemId);
  } else {
    // Get all favorites with details
    await favorites.populate({
      path: 'items.itemId'
    });
  }
  
  res.json(apiResponse(true, 'Favorites retrieved successfully', {
    favorites: favorites.items,
    totalCount: favorites.totalFavorites,
    productsCount: favorites.productsCount,
    shopsCount: favorites.shopsCount
  }));
});

// @desc    Add item to favorites
// @route   POST /api/favorites
// @access  Private
const addFavorite = asyncHandler(async (req, res) => {
  const { itemType, itemId, notes } = req.body;
  
  if (!itemType || !itemId) {
    return res.status(400).json(apiResponse(false, 'Item type and ID are required'));
  }
  
  if (!['product', 'shop'].includes(itemType)) {
    return res.status(400).json(apiResponse(false, 'Invalid item type'));
  }
  
  let favorites = await Favorite.getOrCreateFavorites(req.user.id);
  
  try {
    await favorites.addFavorite(itemType, itemId, notes);
    
    res.status(201).json(apiResponse(true, `${itemType} added to favorites`, {
      favorites: favorites.items,
      totalCount: favorites.totalFavorites
    }));
  } catch (error) {
    if (error.message === 'Item already in favorites') {
      return res.status(400).json(apiResponse(false, error.message));
    }
    throw error;
  }
});

// @desc    Remove item from favorites
// @route   DELETE /api/favorites/:itemType/:itemId
// @access  Private
const removeFavorite = asyncHandler(async (req, res) => {
  const { itemType, itemId } = req.params;
  
  if (!['product', 'shop'].includes(itemType)) {
    return res.status(400).json(apiResponse(false, 'Invalid item type'));
  }
  
  let favorites = await Favorite.getOrCreateFavorites(req.user.id);
  await favorites.removeFavorite(itemType, itemId);
  
  res.json(apiResponse(true, `${itemType} removed from favorites`, {
    totalCount: favorites.totalFavorites
  }));
});

// @desc    Toggle favorite status
// @route   POST /api/favorites/toggle
// @access  Private
const toggleFavorite = asyncHandler(async (req, res) => {
  const { itemType, itemId, notes } = req.body;
  
  if (!itemType || !itemId) {
    return res.status(400).json(apiResponse(false, 'Item type and ID are required'));
  }
  
  if (!['product', 'shop'].includes(itemType)) {
    return res.status(400).json(apiResponse(false, 'Invalid item type'));
  }
  
  let favorites = await Favorite.getOrCreateFavorites(req.user.id);
  const wasFavorite = favorites.isFavorite(itemType, itemId);
  
  await favorites.toggleFavorite(itemType, itemId, notes);
  
  res.json(apiResponse(true, wasFavorite ? 'Removed from favorites' : 'Added to favorites', {
    isFavorite: !wasFavorite,
    totalCount: favorites.totalFavorites
  }));
});

// @desc    Check if item is favorited
// @route   GET /api/favorites/check/:itemType/:itemId
// @access  Private
const checkFavorite = asyncHandler(async (req, res) => {
  const { itemType, itemId } = req.params;
  
  const isFavorite = await Favorite.isUserFavorite(req.user.id, itemType, itemId);
  
  res.json(apiResponse(true, 'Favorite status checked', { isFavorite }));
});

// @desc    Update favorite notes
// @route   PUT /api/favorites/:itemType/:itemId/notes
// @access  Private
const updateFavoriteNotes = asyncHandler(async (req, res) => {
  const { itemType, itemId } = req.params;
  const { notes } = req.body;
  
  let favorites = await Favorite.getOrCreateFavorites(req.user.id);
  
  try {
    await favorites.updateNotes(itemType, itemId, notes);
    
    res.json(apiResponse(true, 'Notes updated successfully'));
  } catch (error) {
    if (error.message === 'Item not found in favorites') {
      return res.status(404).json(apiResponse(false, error.message));
    }
    throw error;
  }
});

// @desc    Clear all favorites
// @route   DELETE /api/favorites/clear
// @access  Private
const clearFavorites = asyncHandler(async (req, res) => {
  const { type } = req.query; // Optional: 'product' or 'shop'
  
  let favorites = await Favorite.getOrCreateFavorites(req.user.id);
  
  if (type) {
    await favorites.clearByType(type);
  } else {
    await favorites.clearAll();
  }
  
  res.json(apiResponse(true, 'Favorites cleared successfully'));
});

module.exports = {
  getFavorites,
  addFavorite,
  removeFavorite,
  toggleFavorite,
  checkFavorite,
  updateFavoriteNotes,
  clearFavorites
};
