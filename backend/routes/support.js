const express = require('express');
const {
  getUserTickets,
  getTicketById,
  createTicket,
  addMessage,
  updateTicketStatus,
  rateTicket,
  deleteTicket
} = require('../controllers/supportController');
const { authenticate, authorize, requireVerification } = require('../middleware/auth');
const { validateObjectIdParam, validatePagination } = require('../middleware/validation');

const router = express.Router();

// All routes require authentication
router.use(authenticate);
router.use(requireVerification);

// @route   GET /api/support
// @desc    Get user support tickets
// @access  Private
router.get('/', validatePagination, getUserTickets);

// @route   GET /api/support/:id
// @desc    Get single support ticket
// @access  Private
router.get('/:id', validateObjectIdParam('id'), getTicketById);

// @route   POST /api/support
// @desc    Create support ticket
// @access  Private
router.post('/', createTicket);

// @route   POST /api/support/:id/message
// @desc    Add message to ticket
// @access  Private
router.post('/:id/message', validateObjectIdParam('id'), addMessage);

// @route   PATCH /api/support/:id/status
// @desc    Update ticket status
// @access  Private (Admin or ticket owner)
router.patch('/:id/status', validateObjectIdParam('id'), updateTicketStatus);

// @route   POST /api/support/:id/rate
// @desc    Rate resolved ticket
// @access  Private
router.post('/:id/rate', validateObjectIdParam('id'), rateTicket);

// @route   DELETE /api/support/:id
// @desc    Delete ticket (Admin only)
// @access  Private (Admin)
router.delete('/:id', authorize('admin'), validateObjectIdParam('id'), deleteTicket);

module.exports = router;
