const UserSettings = require('../models/UserSettings');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiResponse } = require('../utils/helpers');

// @desc    Get user settings
// @route   GET /api/settings
// @access  Private
const getSettings = asyncHandler(async (req, res) => {
  const settings = await UserSettings.getOrCreateSettings(req.user.id);
  
  res.json(apiResponse(true, 'Settings retrieved successfully', { settings }));
});

// @desc    Get specific settings category
// @route   GET /api/settings/:category
// @access  Private
const getSettingsCategory = asyncHandler(async (req, res) => {
  const { category } = req.params;
  
  const validCategories = ['notifications', 'privacy', 'preferences', 'delivery', 'payment', 'shopping', 'security', 'accessibility', 'dataUsage'];
  
  if (!validCategories.includes(category)) {
    return res.status(400).json(apiResponse(false, 'Invalid settings category'));
  }
  
  const settings = await UserSettings.getOrCreateSettings(req.user.id);
  
  res.json(apiResponse(true, `${category} settings retrieved successfully`, { 
    [category]: settings[category]
  }));
});

// @desc    Update all settings
// @route   PUT /api/settings
// @access  Private
const updateSettings = asyncHandler(async (req, res) => {
  let settings = await UserSettings.getOrCreateSettings(req.user.id);
  
  // Update allowed categories
  const allowedCategories = ['notifications', 'privacy', 'preferences', 'delivery', 'payment', 'shopping', 'security', 'accessibility', 'dataUsage'];
  
  allowedCategories.forEach(category => {
    if (req.body[category]) {
      settings[category] = { ...settings[category].toObject(), ...req.body[category] };
    }
  });
  
  await settings.save();
  
  res.json(apiResponse(true, 'Settings updated successfully', { settings }));
});

// @desc    Update notification settings
// @route   PUT /api/settings/notifications
// @access  Private
const updateNotifications = asyncHandler(async (req, res) => {
  const { type, ...settingsData } = req.body;
  
  if (!type || !['push', 'email', 'sms'].includes(type)) {
    return res.status(400).json(apiResponse(false, 'Valid notification type (push, email, sms) is required'));
  }
  
  let settings = await UserSettings.getOrCreateSettings(req.user.id);
  await settings.updateNotifications(type, settingsData);
  
  res.json(apiResponse(true, 'Notification settings updated successfully', { 
    notifications: settings.notifications 
  }));
});

// @desc    Update privacy settings
// @route   PUT /api/settings/privacy
// @access  Private
const updatePrivacy = asyncHandler(async (req, res) => {
  let settings = await UserSettings.getOrCreateSettings(req.user.id);
  await settings.updatePrivacy(req.body);
  
  res.json(apiResponse(true, 'Privacy settings updated successfully', { 
    privacy: settings.privacy 
  }));
});

// @desc    Update preferences
// @route   PUT /api/settings/preferences
// @access  Private
const updatePreferences = asyncHandler(async (req, res) => {
  let settings = await UserSettings.getOrCreateSettings(req.user.id);
  await settings.updatePreferences(req.body);
  
  res.json(apiResponse(true, 'Preferences updated successfully', { 
    preferences: settings.preferences 
  }));
});

// @desc    Update delivery settings
// @route   PUT /api/settings/delivery
// @access  Private
const updateDelivery = asyncHandler(async (req, res) => {
  let settings = await UserSettings.getOrCreateSettings(req.user.id);
  await settings.updateDelivery(req.body);
  
  res.json(apiResponse(true, 'Delivery settings updated successfully', { 
    delivery: settings.delivery 
  }));
});

// @desc    Update payment settings
// @route   PUT /api/settings/payment
// @access  Private
const updatePayment = asyncHandler(async (req, res) => {
  let settings = await UserSettings.getOrCreateSettings(req.user.id);
  await settings.updatePayment(req.body);
  
  res.json(apiResponse(true, 'Payment settings updated successfully', { 
    payment: settings.payment 
  }));
});

// @desc    Update shopping preferences
// @route   PUT /api/settings/shopping
// @access  Private
const updateShopping = asyncHandler(async (req, res) => {
  let settings = await UserSettings.getOrCreateSettings(req.user.id);
  await settings.updateShopping(req.body);
  
  res.json(apiResponse(true, 'Shopping preferences updated successfully', { 
    shopping: settings.shopping 
  }));
});

// @desc    Update security settings
// @route   PUT /api/settings/security
// @access  Private
const updateSecurity = asyncHandler(async (req, res) => {
  let settings = await UserSettings.getOrCreateSettings(req.user.id);
  await settings.updateSecurity(req.body);
  
  res.json(apiResponse(true, 'Security settings updated successfully', { 
    security: settings.security 
  }));
});

// @desc    Update accessibility settings
// @route   PUT /api/settings/accessibility
// @access  Private
const updateAccessibility = asyncHandler(async (req, res) => {
  let settings = await UserSettings.getOrCreateSettings(req.user.id);
  
  settings.accessibility = { ...settings.accessibility.toObject(), ...req.body };
  await settings.save();
  
  res.json(apiResponse(true, 'Accessibility settings updated successfully', { 
    accessibility: settings.accessibility 
  }));
});

// @desc    Update data usage settings
// @route   PUT /api/settings/data-usage
// @access  Private
const updateDataUsage = asyncHandler(async (req, res) => {
  let settings = await UserSettings.getOrCreateSettings(req.user.id);
  
  settings.dataUsage = { ...settings.dataUsage.toObject(), ...req.body };
  await settings.save();
  
  res.json(apiResponse(true, 'Data usage settings updated successfully', { 
    dataUsage: settings.dataUsage 
  }));
});

// @desc    Toggle specific setting
// @route   PUT /api/settings/toggle
// @access  Private
const toggleSetting = asyncHandler(async (req, res) => {
  const { category, setting } = req.body;
  
  if (!category || !setting) {
    return res.status(400).json(apiResponse(false, 'Category and setting are required'));
  }
  
  let settings = await UserSettings.getOrCreateSettings(req.user.id);
  
  try {
    await settings.toggleSetting(category, setting);
    
    res.json(apiResponse(true, 'Setting toggled successfully', { 
      category,
      setting,
      value: settings[category][setting]
    }));
  } catch (error) {
    return res.status(400).json(apiResponse(false, error.message));
  }
});

// @desc    Reset settings to defaults
// @route   POST /api/settings/reset
// @access  Private
const resetSettings = asyncHandler(async (req, res) => {
  let settings = await UserSettings.getOrCreateSettings(req.user.id);
  await settings.resetToDefaults();
  
  res.json(apiResponse(true, 'Settings reset to defaults successfully', { settings }));
});

// @desc    Get notification preferences
// @route   GET /api/settings/notifications/preferences
// @access  Private
const getNotificationPreferences = asyncHandler(async (req, res) => {
  const preferences = await UserSettings.getNotificationPreferences(req.user.id);
  
  res.json(apiResponse(true, 'Notification preferences retrieved successfully', { 
    preferences 
  }));
});

module.exports = {
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
};
