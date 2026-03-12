const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
  ticketId: {
    type: String,
    unique: true,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    enum: ['order', 'payment', 'account', 'technical', 'delivery', 'product', 'other'],
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['open', 'in_progress', 'resolved', 'closed'],
    default: 'open',
    index: true
  },
  description: {
    type: String,
    required: true
  },
  messages: [{
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    senderRole: {
      type: String,
      enum: ['customer', 'admin', 'support'],
      required: true
    },
    message: {
      type: String,
      required: true
    },
    attachments: [{
      url: String,
      type: String
    }],
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  attachments: [{
    url: String,
    type: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  relatedOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  resolvedAt: Date,
  closedAt: Date,
  resolution: String,
  rating: {
    value: {
      type: Number,
      min: 1,
      max: 5
    },
    comment: String,
    ratedAt: Date
  }
}, {
  timestamps: true
});

// Generate unique ticket ID
supportTicketSchema.pre('save', async function(next) {
  if (this.isNew && !this.ticketId) {
    const count = await this.constructor.countDocuments();
    this.ticketId = `TKT${String(count + 1).padStart(6, '0')}`;
  }
  next();
});

// Instance methods
supportTicketSchema.methods.addMessage = function(senderId, senderRole, message, attachments = []) {
  this.messages.push({
    sender: senderId,
    senderRole,
    message,
    attachments
  });
  return this.save();
};

supportTicketSchema.methods.updateStatus = function(status, resolution = null) {
  this.status = status;
  
  if (status === 'resolved') {
    this.resolvedAt = new Date();
    if (resolution) {
      this.resolution = resolution;
    }
  } else if (status === 'closed') {
    this.closedAt = new Date();
  }
  
  return this.save();
};

supportTicketSchema.methods.addRating = function(rating, comment) {
  this.rating = {
    value: rating,
    comment,
    ratedAt: new Date()
  };
  return this.save();
};

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
