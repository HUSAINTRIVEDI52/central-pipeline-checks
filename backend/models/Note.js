const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true
  },
  title: {
    type: String,
    required: [true, 'Note title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  content: {
    type: String,
    required: [true, 'Note content is required'],
    trim: true,
    maxlength: [5000, 'Content cannot exceed 5000 characters']
  },
  category: {
    type: String,
    enum: ['shopping_list', 'order_notes', 'general', 'reminder', 'recipe', 'other'],
    default: 'general'
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [50, 'Tag cannot exceed 50 characters']
  }],
  color: {
    type: String,
    enum: ['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'],
    default: 'default'
  },
  isPinned: {
    type: Boolean,
    default: false
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  reminder: {
    date: Date,
    notified: {
      type: Boolean,
      default: false
    }
  },
  linkedItems: [{
    itemType: {
      type: String,
      enum: ['product', 'shop', 'order']
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'linkedItems.itemType'
    }
  }],
  attachments: [{
    type: {
      type: String,
      enum: ['image', 'link']
    },
    url: String,
    title: String
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
noteSchema.index({ userId: 1, isPinned: -1, createdAt: -1 });
noteSchema.index({ userId: 1, category: 1 });
noteSchema.index({ userId: 1, tags: 1 });
noteSchema.index({ userId: 1, isArchived: 1 });
noteSchema.index({ 'reminder.date': 1, 'reminder.notified': 1 });
noteSchema.index({ userId: 1, title: 'text', content: 'text' }); // Text search

// Virtual for character count
noteSchema.virtual('characterCount').get(function() {
  return this.content.length;
});

// Virtual for word count
noteSchema.virtual('wordCount').get(function() {
  return this.content.split(/\s+/).filter(word => word.length > 0).length;
});

// Virtual for has reminder
noteSchema.virtual('hasReminder').get(function() {
  return !!this.reminder && !!this.reminder.date && !this.reminder.notified;
});

// Pre-save middleware to clean up tags
noteSchema.pre('save', function(next) {
  if (this.tags && this.tags.length > 0) {
    // Remove duplicates and empty tags
    this.tags = [...new Set(this.tags.filter(tag => tag && tag.trim().length > 0))];
    // Limit to 10 tags
    this.tags = this.tags.slice(0, 10);
  }
  next();
});

// Method to pin/unpin note
noteSchema.methods.togglePin = function() {
  this.isPinned = !this.isPinned;
  return this.save();
};

// Method to archive/unarchive note
noteSchema.methods.toggleArchive = function() {
  this.isArchived = !this.isArchived;
  return this.save();
};

// Method to add tag
noteSchema.methods.addTag = function(tag) {
  const normalizedTag = tag.toLowerCase().trim();
  
  if (!this.tags.includes(normalizedTag) && this.tags.length < 10) {
    this.tags.push(normalizedTag);
  }
  
  return this.save();
};

// Method to remove tag
noteSchema.methods.removeTag = function(tag) {
  const normalizedTag = tag.toLowerCase().trim();
  this.tags = this.tags.filter(t => t !== normalizedTag);
  return this.save();
};

// Method to set reminder
noteSchema.methods.setReminder = function(date) {
  this.reminder = {
    date: new Date(date),
    notified: false
  };
  return this.save();
};

// Method to clear reminder
noteSchema.methods.clearReminder = function() {
  this.reminder = undefined;
  return this.save();
};

// Method to mark reminder as notified
noteSchema.methods.markReminderNotified = function() {
  if (this.reminder) {
    this.reminder.notified = true;
  }
  return this.save();
};

// Method to link item
noteSchema.methods.linkItem = function(itemType, itemId) {
  const exists = this.linkedItems.some(
    link => link.itemId.toString() === itemId.toString() && link.itemType === itemType
  );
  
  if (!exists) {
    this.linkedItems.push({ itemType, itemId });
  }
  
  return this.save();
};

// Method to unlink item
noteSchema.methods.unlinkItem = function(itemType, itemId) {
  this.linkedItems = this.linkedItems.filter(
    link => !(link.itemId.toString() === itemId.toString() && link.itemType === itemType)
  );
  return this.save();
};

// Method to add attachment
noteSchema.methods.addAttachment = function(type, url, title) {
  this.attachments.push({ type, url, title });
  return this.save();
};

// Static method to get user notes
noteSchema.statics.getUserNotes = function(userId, options = {}) {
  const { 
    category, 
    isArchived = false, 
    isPinned,
    tags,
    sortBy = '-isPinned -createdAt'
  } = options;
  
  const query = { userId, isArchived };
  
  if (category) query.category = category;
  if (isPinned !== undefined) query.isPinned = isPinned;
  if (tags && tags.length > 0) query.tags = { $in: tags };
  
  return this.find(query).sort(sortBy);
};

// Static method to search user notes
noteSchema.statics.searchUserNotes = function(userId, searchTerm) {
  return this.find({
    userId,
    $text: { $search: searchTerm }
  }, {
    score: { $meta: 'textScore' }
  }).sort({ score: { $meta: 'textScore' } });
};

// Static method to get due reminders
noteSchema.statics.getDueReminders = function() {
  return this.find({
    'reminder.date': { $lte: new Date() },
    'reminder.notified': false,
    isArchived: false
  }).populate('userId', 'fullName email phone');
};

// Static method to get user notes by tag
noteSchema.statics.getNotesByTag = function(userId, tag) {
  return this.find({ 
    userId, 
    tags: tag.toLowerCase().trim(),
    isArchived: false
  }).sort('-isPinned -createdAt');
};

// Static method to get all user tags
noteSchema.statics.getUserTags = async function(userId) {
  const result = await this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId), isArchived: false } },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 50 }
  ]);
  
  return result.map(r => ({ tag: r._id, count: r.count }));
};

module.exports = mongoose.model('Note', noteSchema);
