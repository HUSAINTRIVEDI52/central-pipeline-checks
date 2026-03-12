const express = require('express');
const {
  getNotes,
  getNote,
  getNotesByCategory,
  getNotesByTag,
  getUserTags,
  createNote,
  updateNote,
  togglePin,
  toggleArchive,
  addTag,
  removeTag,
  setReminder,
  clearReminder,
  linkItem,
  unlinkItem,
  deleteNote
} = require('../controllers/noteController');
const { authenticate, requireVerification } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authenticate);
router.use(requireVerification);

// @route   GET /api/notes
// @desc    Get all user notes (with optional filters)
// @access  Private
router.get('/', getNotes);

// @route   GET /api/notes/tags/all
// @desc    Get all user tags
// @access  Private
router.get('/tags/all', getUserTags);

// @route   GET /api/notes/category/:category
// @desc    Get notes by category
// @access  Private
router.get('/category/:category', getNotesByCategory);

// @route   GET /api/notes/tag/:tag
// @desc    Get notes by tag
// @access  Private
router.get('/tag/:tag', getNotesByTag);

// @route   GET /api/notes/:id
// @desc    Get single note
// @access  Private
router.get('/:id', getNote);

// @route   POST /api/notes
// @desc    Create new note
// @access  Private
router.post('/', createNote);

// @route   PUT /api/notes/:id
// @desc    Update note
// @access  Private
router.put('/:id', updateNote);

// @route   PUT /api/notes/:id/pin
// @desc    Toggle pin status
// @access  Private
router.put('/:id/pin', togglePin);

// @route   PUT /api/notes/:id/archive
// @desc    Toggle archive status
// @access  Private
router.put('/:id/archive', toggleArchive);

// @route   POST /api/notes/:id/tags
// @desc    Add tag to note
// @access  Private
router.post('/:id/tags', addTag);

// @route   DELETE /api/notes/:id/tags/:tag
// @desc    Remove tag from note
// @access  Private
router.delete('/:id/tags/:tag', removeTag);

// @route   PUT /api/notes/:id/reminder
// @desc    Set reminder for note
// @access  Private
router.put('/:id/reminder', setReminder);

// @route   DELETE /api/notes/:id/reminder
// @desc    Clear reminder
// @access  Private
router.delete('/:id/reminder', clearReminder);

// @route   POST /api/notes/:id/link
// @desc    Link item to note
// @access  Private
router.post('/:id/link', linkItem);

// @route   DELETE /api/notes/:id/link/:itemType/:itemId
// @desc    Unlink item from note
// @access  Private
router.delete('/:id/link/:itemType/:itemId', unlinkItem);

// @route   DELETE /api/notes/:id
// @desc    Delete note
// @access  Private
router.delete('/:id', deleteNote);

module.exports = router;
