const express = require('express');
const {
  getFavorites,
  addFavorite,
  removeFavorite,
  toggleFavorite,
  checkFavorite,
  updateFavoriteNotes,
  clearFavorites
} = require('../controllers/favoriteController');
const { authenticate, requireVerification } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authenticate);
router.use(requireVerification);

// @route   GET /api/favorites
// @desc    Get user favorites (with optional type filter)
// @access  Private
router.get('/', getFavorites);

// @route   GET /api/favorites/check/:itemType/:itemId
// @desc    Check if item is favorited
// @access  Private
router.get('/check/:itemType/:itemId', checkFavorite);

// @route   POST /api/favorites
// @desc    Add item to favorites
// @access  Private
router.post('/', addFavorite);

// @route   POST /api/favorites/toggle
// @desc    Toggle favorite status
// @access  Private
router.post('/toggle', toggleFavorite);

// @route   PUT /api/favorites/:itemType/:itemId/notes
// @desc    Update favorite notes
// @access  Private
router.put('/:itemType/:itemId/notes', updateFavoriteNotes);

// @route   DELETE /api/favorites/:itemType/:itemId
// @desc    Remove item from favorites
// @access  Private
router.delete('/:itemType/:itemId', removeFavorite);

// @route   DELETE /api/favorites/clear
// @desc    Clear all favorites (or by type with ?type=product|shop)
// @access  Private
router.delete('/clear', clearFavorites);

module.exports = router;
