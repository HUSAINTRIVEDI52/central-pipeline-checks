const Product = require('../models/Product');
const User = require('../models/User');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiResponse } = require('../utils/helpers');

// @desc    Get search suggestions
// @route   GET /api/products/search/suggestions
// @access  Public
const getSuggestions = asyncHandler(async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.json(apiResponse(true, 'Suggestions retrieved', []));
  }

  // Find products starting with the query (case-insensitive)
  const products = await Product.find({
    name: { $regex: `^${query}`, $options: 'i' },
    isActive: true
  })
  .select('name category')
  .limit(10);

  const suggestions = products.map(p => p.name);
  
  // Also look for categories if needed, but for now just products
  
  res.json(apiResponse(true, 'Suggestions retrieved', suggestions));
});

// @desc    Get user search history
// @route   GET /api/users/search-history
// @access  Private
const getSearchHistory = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('searchHistory');
  
  // Sort by timestamp desc
  const history = user.searchHistory
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10) // Limit to last 10
    .map(h => h.query);

  res.json(apiResponse(true, 'Search history retrieved', history));
});

// @desc    Add to search history
// @route   POST /api/users/search-history
// @access  Private
const addToSearchHistory = asyncHandler(async (req, res) => {
  const { query } = req.body;
  
  if (!query) {
    return res.status(400).json(apiResponse(false, 'Query is required'));
  }

  const user = await User.findById(req.user.id);

  // Remove existing entry if present (to move it to top)
  user.searchHistory = user.searchHistory.filter(h => h.query.toLowerCase() !== query.toLowerCase());

  // Add new entry
  user.searchHistory.unshift({ query, timestamp: new Date() });

  // Limit to 20 items
  if (user.searchHistory.length > 20) {
    user.searchHistory = user.searchHistory.slice(0, 20);
  }

  await user.save();

  res.json(apiResponse(true, 'Search history updated'));
});

// @desc    Clear search history
// @route   DELETE /api/users/search-history
// @access  Private
const clearSearchHistory = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user.id, { $set: { searchHistory: [] } });
  
  res.json(apiResponse(true, 'Search history cleared'));
});

// @desc    Reindex all products in Elasticsearch
// @route   POST /api/admin/reindex
// @access  Private (Admin)
const reindex = asyncHandler(async (req, res) => {
  const searchService = require('../services/meiliSearchService');
  
  try {
    const result = await searchService.reindexAll();
    res.json(apiResponse(true, 'Reindexing completed', result));
  } catch (error) {
    res.status(500).json(apiResponse(false, 'Reindexing failed', { error: error.message }));
  }
});

module.exports = {
  getSuggestions,
  getSearchHistory,
  addToSearchHistory,
  clearSearchHistory,
  reindex
};
