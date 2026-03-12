const express = require('express');
const {
  getSettings,
  getSettingsCategory,
  updateSettings,
  updateNotifications,
  updatePrivacy,
  updatePreferences,
  updateDelivery,
  updatePayment,
  updateShopping,
  updateSecurity,
  updateAccessibility,
  updateDataUsage,
  toggleSetting,
  resetSettings,
  getNotificationPreferences
} = require('../controllers/settingsController');
const { authenticate, requireVerification } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authenticate);
router.use(requireVerification);

// @route   GET /api/settings
// @desc    Get all user settings
// @access  Private
router.get('/', getSettings);

// @route   GET /api/settings/notifications/preferences
// @desc    Get notification preferences
// @access  Private
router.get('/notifications/preferences', getNotificationPreferences);

// @route   GET /api/settings/:category
// @desc    Get specific settings category
// @access  Private
router.get('/:category', getSettingsCategory);

// @route   PUT /api/settings
// @desc    Update all settings
// @access  Private
router.put('/', updateSettings);

// @route   PUT /api/settings/notifications
// @desc    Update notification settings
// @access  Private
router.put('/notifications', updateNotifications);

// @route   PUT /api/settings/privacy
// @desc    Update privacy settings
// @access  Private
router.put('/privacy', updatePrivacy);

// @route   PUT /api/settings/preferences
// @desc    Update preferences
// @access  Private
router.put('/preferences', updatePreferences);

// @route   PUT /api/settings/delivery
// @desc    Update delivery settings
// @access  Private
router.put('/delivery', updateDelivery);

// @route   PUT /api/settings/payment
// @desc    Update payment settings
// @access  Private
router.put('/payment', updatePayment);

// @route   PUT /api/settings/shopping
// @desc    Update shopping preferences
// @access  Private
router.put('/shopping', updateShopping);

// @route   PUT /api/settings/security
// @desc    Update security settings
// @access  Private
router.put('/security', updateSecurity);

// @route   PUT /api/settings/accessibility
// @desc    Update accessibility settings
// @access  Private
router.put('/accessibility', updateAccessibility);

// @route   PUT /api/settings/data-usage
// @desc    Update data usage settings
// @access  Private
router.put('/data-usage', updateDataUsage);

// @route   PUT /api/settings/toggle
// @desc    Toggle specific setting
// @access  Private
router.put('/toggle', toggleSetting);

// @route   POST /api/settings/reset
// @desc    Reset settings to defaults
// @access  Private
router.post('/reset', resetSettings);

module.exports = router;
