const Note = require('../models/Note');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiResponse } = require('../utils/helpers');

// @desc    Get all user notes
// @route   GET /api/notes
// @access  Private
const getNotes = asyncHandler(async (req, res) => {
  const { category, isArchived, isPinned, tags, search } = req.query;
  
  let notes;
  
  if (search) {
    // Text search
    notes = await Note.searchUserNotes(req.user.id, search);
  } else {
    // Filtered query
    const options = {
      category,
      isArchived: isArchived === 'true',
      sortBy: '-isPinned -updatedAt'
    };
    
    if (isPinned !== undefined) {
      options.isPinned = isPinned === 'true';
    }
    
    if (tags) {
      options.tags = tags.split(',').map(tag => tag.trim());
    }
    
    notes = await Note.getUserNotes(req.user.id, options);
  }
  
  res.json(apiResponse(true, 'Notes retrieved successfully', {
    notes,
    count: notes.length
  }));
});

// @desc    Get single note
// @route   GET /api/notes/:id
// @access  Private
const getNote = asyncHandler(async (req, res) => {
  const note = await Note.findOne({ 
    _id: req.params.id, 
    userId: req.user.id 
  }).populate('linkedItems.itemId');
  
  if (!note) {
    return res.status(404).json(apiResponse(false, 'Note not found'));
  }
  
  res.json(apiResponse(true, 'Note retrieved successfully', { note }));
});

// @desc    Get notes by category
// @route   GET /api/notes/category/:category
// @access  Private
const getNotesByCategory = asyncHandler(async (req, res) => {
  const { category } = req.params;
  
  const notes = await Note.getUserNotes(req.user.id, { 
    category,
    isArchived: false 
  });
  
  res.json(apiResponse(true, 'Notes retrieved successfully', {
    notes,
    count: notes.length,
    category
  }));
});

// @desc    Get notes by tag
// @route   GET /api/notes/tag/:tag
// @access  Private
const getNotesByTag = asyncHandler(async (req, res) => {
  const { tag } = req.params;
  
  const notes = await Note.getNotesByTag(req.user.id, tag);
  
  res.json(apiResponse(true, 'Notes retrieved successfully', {
    notes,
    count: notes.length,
    tag
  }));
});

// @desc    Get user's all tags
// @route   GET /api/notes/tags/all
// @access  Private
const getUserTags = asyncHandler(async (req, res) => {
  const tags = await Note.getUserTags(req.user.id);
  
  res.json(apiResponse(true, 'Tags retrieved successfully', {
    tags,
    count: tags.length
  }));
});

// @desc    Create new note
// @route   POST /api/notes
// @access  Private
const createNote = asyncHandler(async (req, res) => {
  const noteData = {
    ...req.body,
    userId: req.user.id
  };
  
  const note = await Note.create(noteData);
  
  res.status(201).json(apiResponse(true, 'Note created successfully', { note }));
});

// @desc    Update note
// @route   PUT /api/notes/:id
// @access  Private
const updateNote = asyncHandler(async (req, res) => {
  let note = await Note.findOne({ 
    _id: req.params.id, 
    userId: req.user.id 
  });
  
  if (!note) {
    return res.status(404).json(apiResponse(false, 'Note not found'));
  }
  
  // Update allowed fields
  const allowedFields = ['title', 'content', 'category', 'tags', 'color', 'isPinned', 'isArchived'];
  allowedFields.forEach(field => {
    if (req.body[field] !== undefined) {
      note[field] = req.body[field];
    }
  });
  
  await note.save();
  
  res.json(apiResponse(true, 'Note updated successfully', { note }));
});

// @desc    Toggle pin status
// @route   PUT /api/notes/:id/pin
// @access  Private
const togglePin = asyncHandler(async (req, res) => {
  const note = await Note.findOne({ 
    _id: req.params.id, 
    userId: req.user.id 
  });
  
  if (!note) {
    return res.status(404).json(apiResponse(false, 'Note not found'));
  }
  
  await note.togglePin();
  
  res.json(apiResponse(true, `Note ${note.isPinned ? 'pinned' : 'unpinned'} successfully`, { 
    note,
    isPinned: note.isPinned 
  }));
});

// @desc    Toggle archive status
// @route   PUT /api/notes/:id/archive
// @access  Private
const toggleArchive = asyncHandler(async (req, res) => {
  const note = await Note.findOne({ 
    _id: req.params.id, 
    userId: req.user.id 
  });
  
  if (!note) {
    return res.status(404).json(apiResponse(false, 'Note not found'));
  }
  
  await note.toggleArchive();
  
  res.json(apiResponse(true, `Note ${note.isArchived ? 'archived' : 'unarchived'} successfully`, { 
    note,
    isArchived: note.isArchived 
  }));
});

// @desc    Add tag to note
// @route   POST /api/notes/:id/tags
// @access  Private
const addTag = asyncHandler(async (req, res) => {
  const { tag } = req.body;
  
  if (!tag) {
    return res.status(400).json(apiResponse(false, 'Tag is required'));
  }
  
  const note = await Note.findOne({ 
    _id: req.params.id, 
    userId: req.user.id 
  });
  
  if (!note) {
    return res.status(404).json(apiResponse(false, 'Note not found'));
  }
  
  await note.addTag(tag);
  
  res.json(apiResponse(true, 'Tag added successfully', { 
    note,
    tags: note.tags 
  }));
});

// @desc    Remove tag from note
// @route   DELETE /api/notes/:id/tags/:tag
// @access  Private
const removeTag = asyncHandler(async (req, res) => {
  const { tag } = req.params;
  
  const note = await Note.findOne({ 
    _id: req.params.id, 
    userId: req.user.id 
  });
  
  if (!note) {
    return res.status(404).json(apiResponse(false, 'Note not found'));
  }
  
  await note.removeTag(tag);
  
  res.json(apiResponse(true, 'Tag removed successfully', { 
    note,
    tags: note.tags 
  }));
});

// @desc    Set reminder for note
// @route   PUT /api/notes/:id/reminder
// @access  Private
const setReminder = asyncHandler(async (req, res) => {
  const { date } = req.body;
  
  if (!date) {
    return res.status(400).json(apiResponse(false, 'Reminder date is required'));
  }
  
  const note = await Note.findOne({ 
    _id: req.params.id, 
    userId: req.user.id 
  });
  
  if (!note) {
    return res.status(404).json(apiResponse(false, 'Note not found'));
  }
  
  await note.setReminder(date);
  
  res.json(apiResponse(true, 'Reminder set successfully', { 
    note,
    reminder: note.reminder 
  }));
});

// @desc    Clear reminder
// @route   DELETE /api/notes/:id/reminder
// @access  Private
const clearReminder = asyncHandler(async (req, res) => {
  const note = await Note.findOne({ 
    _id: req.params.id, 
    userId: req.user.id 
  });
  
  if (!note) {
    return res.status(404).json(apiResponse(false, 'Note not found'));
  }
  
  await note.clearReminder();
  
  res.json(apiResponse(true, 'Reminder cleared successfully', { note }));
});

// @desc    Link item to note
// @route   POST /api/notes/:id/link
// @access  Private
const linkItem = asyncHandler(async (req, res) => {
  const { itemType, itemId } = req.body;
  
  if (!itemType || !itemId) {
    return res.status(400).json(apiResponse(false, 'Item type and ID are required'));
  }
  
  const note = await Note.findOne({ 
    _id: req.params.id, 
    userId: req.user.id 
  });
  
  if (!note) {
    return res.status(404).json(apiResponse(false, 'Note not found'));
  }
  
  await note.linkItem(itemType, itemId);
  
  res.json(apiResponse(true, 'Item linked successfully', { note }));
});

// @desc    Unlink item from note
// @route   DELETE /api/notes/:id/link/:itemType/:itemId
// @access  Private
const unlinkItem = asyncHandler(async (req, res) => {
  const { itemType, itemId } = req.params;
  
  const note = await Note.findOne({ 
    _id: req.params.id, 
    userId: req.user.id 
  });
  
  if (!note) {
    return res.status(404).json(apiResponse(false, 'Note not found'));
  }
  
  await note.unlinkItem(itemType, itemId);
  
  res.json(apiResponse(true, 'Item unlinked successfully', { note }));
});

// @desc    Delete note
// @route   DELETE /api/notes/:id
// @access  Private
const deleteNote = asyncHandler(async (req, res) => {
  const note = await Note.findOneAndDelete({ 
    _id: req.params.id, 
    userId: req.user.id 
  });
  
  if (!note) {
    return res.status(404).json(apiResponse(false, 'Note not found'));
  }
  
  res.json(apiResponse(true, 'Note deleted successfully'));
});

module.exports = {
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
};
