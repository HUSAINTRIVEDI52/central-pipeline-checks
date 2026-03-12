const SupportTicket = require('../models/SupportTicket');
const Notification = require('../models/Notification');

// @desc    Get user support tickets
// @route   GET /api/support
// @access  Private
exports.getUserTickets = async (req, res) => {
  try {
    const { status, category, page = 1, limit = 20 } = req.query;

    const filter = { userId: req.user._id };

    if (status) filter.status = status;
    if (category) filter.category = category;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const tickets = await SupportTicket.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('assignedTo', 'fullName')
      .populate('relatedOrder', 'orderId');

    const total = await SupportTicket.countDocuments(filter);

    res.json({
      success: true,
      data: {
        tickets,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get user tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get support tickets'
    });
  }
};

// @desc    Get single support ticket
// @route   GET /api/support/:id
// @access  Private
exports.getTicketById = async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id)
      .populate('userId', 'fullName email phone')
      .populate('assignedTo', 'fullName')
      .populate('relatedOrder', 'orderId status')
      .populate('messages.sender', 'fullName');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    // Check if user owns this ticket or is admin
    if (ticket.userId._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this ticket'
      });
    }

    res.json({
      success: true,
      ticket
    });
  } catch (error) {
    console.error('Get ticket by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get support ticket'
    });
  }
};

// @desc    Create support ticket
// @route   POST /api/support
// @access  Private
exports.createTicket = async (req, res) => {
  try {
    const { subject, category, priority, description, relatedOrder, attachments } = req.body;

    const ticket = new SupportTicket({
      userId: req.user._id,
      subject,
      category,
      priority: priority || 'medium',
      description,
      relatedOrder,
      attachments: attachments || []
    });

    await ticket.save();

    // Notify admins about new support ticket
    try {
      const User = require('../models/User');
      const admins = await User.find({ role: 'admin', isActive: true });
      
      for (const admin of admins) {
        await Notification.createNotification({
          recipientId: admin._id,
          title: 'New Support Ticket',
          message: `New ${priority || 'medium'} priority ticket: ${subject}`,
          type: 'support',
          priority: priority === 'urgent' ? 'high' : 'medium',
          data: { ticketId: ticket._id },
          relatedId: ticket._id,
          relatedType: 'support_ticket',
          actionRequired: true,
          channels: {
            push: { status: 'pending' }
          }
        });
      }
    } catch (notificationError) {
      console.error('Failed to notify admins:', notificationError);
    }

    res.status(201).json({
      success: true,
      message: 'Support ticket created successfully',
      ticket
    });
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create support ticket'
    });
  }
};

// @desc    Add message to ticket
// @route   POST /api/support/:id/message
// @access  Private
exports.addMessage = async (req, res) => {
  try {
    const { message, attachments } = req.body;

    const ticket = await SupportTicket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    // Check if user owns this ticket or is admin
    if (ticket.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to add message to this ticket'
      });
    }

    await ticket.addMessage(
      req.user._id,
      req.user.role === 'admin' ? 'support' : 'customer',
      message,
      attachments || []
    );

    // Notify the other party
    try {
      const recipientId = req.user.role === 'admin' ? ticket.userId : ticket.assignedTo;
      
      if (recipientId) {
        await Notification.createNotification({
          recipientId,
          title: 'New Message on Support Ticket',
          message: `New message on ticket ${ticket.ticketId}`,
          type: 'support',
          data: { ticketId: ticket._id },
          relatedId: ticket._id,
          relatedType: 'support_ticket',
          channels: {
            push: { status: 'pending' }
          }
        });
      }
    } catch (notificationError) {
      console.error('Failed to send notification:', notificationError);
    }

    res.json({
      success: true,
      message: 'Message added successfully',
      ticket
    });
  } catch (error) {
    console.error('Add message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add message'
    });
  }
};

// @desc    Update ticket status
// @route   PATCH /api/support/:id/status
// @access  Private (Admin or ticket owner for closing)
exports.updateTicketStatus = async (req, res) => {
  try {
    const { status, resolution } = req.body;

    const ticket = await SupportTicket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    // Check permissions
    const isOwner = ticket.userId.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this ticket'
      });
    }

    // Owners can only close their own tickets
    if (isOwner && !isAdmin && status !== 'closed') {
      return res.status(403).json({
        success: false,
        message: 'You can only close your own tickets'
      });
    }

    await ticket.updateStatus(status, resolution);

    // Notify user if admin resolved/closed the ticket
    if (isAdmin && ['resolved', 'closed'].includes(status)) {
      try {
        await Notification.createNotification({
          recipientId: ticket.userId,
          title: `Support Ticket ${status === 'resolved' ? 'Resolved' : 'Closed'}`,
          message: `Your support ticket ${ticket.ticketId} has been ${status}`,
          type: 'support',
          data: { ticketId: ticket._id },
          relatedId: ticket._id,
          relatedType: 'support_ticket',
          channels: {
            push: { status: 'pending' }
          }
        });
      } catch (notificationError) {
        console.error('Failed to send notification:', notificationError);
      }
    }

    res.json({
      success: true,
      message: 'Ticket status updated successfully',
      ticket
    });
  } catch (error) {
    console.error('Update ticket status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update ticket status'
    });
  }
};

// @desc    Rate resolved ticket
// @route   POST /api/support/:id/rate
// @access  Private
exports.rateTicket = async (req, res) => {
  try {
    const { rating, comment } = req.body;

    const ticket = await SupportTicket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    // Check if user owns this ticket
    if (ticket.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to rate this ticket'
      });
    }

    // Check if ticket is resolved or closed
    if (!['resolved', 'closed'].includes(ticket.status)) {
      return res.status(400).json({
        success: false,
        message: 'Can only rate resolved or closed tickets'
      });
    }

    // Check if already rated
    if (ticket.rating && ticket.rating.value) {
      return res.status(400).json({
        success: false,
        message: 'Ticket has already been rated'
      });
    }

    await ticket.addRating(rating, comment);

    res.json({
      success: true,
      message: 'Rating added successfully',
      ticket
    });
  } catch (error) {
    console.error('Rate ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to rate ticket'
    });
  }
};

// @desc    Delete ticket
// @route   DELETE /api/support/:id
// @access  Private (Admin only)
exports.deleteTicket = async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    await SupportTicket.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Support ticket deleted successfully'
    });
  } catch (error) {
    console.error('Delete ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete ticket'
    });
  }
};
