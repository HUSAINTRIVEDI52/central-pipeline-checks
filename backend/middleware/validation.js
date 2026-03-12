const { body, param, query, validationResult } = require('express-validator');
const mongoose = require('mongoose');

// Middleware to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(error => ({
      field: error.path || error.param,
      message: error.msg,
      value: error.value
    }));
    
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: formattedErrors
    });
  }
  
  next();
};

// Custom validators
const isValidObjectId = (value) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new Error('Invalid ID format');
  }
  return true;
};

const isValidCoordinate = (value, { req }) => {
  const lat = parseFloat(value);
  if (isNaN(lat) || lat < -90 || lat > 90) {
    throw new Error('Invalid coordinate value');
  }
  return true;
};

const isValidPhoneNumber = (value) => {
  const phoneRegex = /^[6-9]\d{9}$/;
  if (!phoneRegex.test(value)) {
    throw new Error('Invalid phone number format');
  }
  return true;
};

const isValidPincode = (value) => {
  const pincodeRegex = /^[1-9][0-9]{5}$/;
  if (!pincodeRegex.test(value)) {
    throw new Error('Invalid pincode format');
  }
  return true;
};

const isStrongPassword = (value) => {
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/;
  if (!passwordRegex.test(value)) {
    throw new Error('Password must be at least 8 characters with uppercase, lowercase, and number');
  }
  return true;
};

// Validation rules for different endpoints

// User registration validation
const validateUserRegistration = [
  body('fullName')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2-100 characters'),
  
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  
  body('phone')
    .custom(isValidPhoneNumber),
  
  body('password')
    .custom(isStrongPassword),
  
  body('role')
    .optional()
    .isIn(['customer', 'shop_owner', 'delivery_partner'])
    .withMessage('Invalid role'),
  
  handleValidationErrors
];

// User login validation
const validateUserLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  
  body('password')
    .isLength({ min: 1 })
    .withMessage('Password is required'),
  
  handleValidationErrors
];

// OTP validation
const validateOTP = [
  body('otp')
    .isLength({ min: 6, max: 6 })
    .isNumeric()
    .withMessage('OTP must be a 6-digit number'),
  
  handleValidationErrors
];

// Shop creation validation
const validateShopCreation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Shop name must be between 2-100 characters'),
  
  body('category')
    .isIn(['grocery', 'pharmacy', 'restaurant', 'electronics', 'clothing', 'books', 'other'])
    .withMessage('Invalid shop category'),
  
  body('address.street')
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Street address is required'),
  
  body('address.city')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('City is required'),
  
  body('address.state')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('State is required'),
  
  body('address.pincode')
    .custom(isValidPincode),
  
  body('address.coordinates.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Invalid latitude'),
  
  body('address.coordinates.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Invalid longitude'),
  
  body('contact.phone')
    .custom(isValidPhoneNumber),
  
  body('deliveryRadius')
    .isFloat({ min: 0.5, max: 50 })
    .withMessage('Delivery radius must be between 0.5-50 km'),
  
  handleValidationErrors
];

// Product creation validation
const validateProductCreation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Product name must be between 2-100 characters'),
  
  body('categoryId')
    .custom(isValidObjectId),
  
  body('price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  
  body('discountPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Discount price must be a positive number'),
  
  body('unit')
    .isIn(['kg', 'gram', 'liter', 'ml', 'piece', 'packet', 'box', 'bottle', 'dozen'])
    .withMessage('Invalid unit'),
  
  body('stock.available')
    .isInt({ min: 0 })
    .withMessage('Stock must be a non-negative integer'),
  
  handleValidationErrors
];

// Order creation validation
const validateOrderCreation = [
  // Support both old format (items + deliveryAddress) and new format (addressId)
  body('addressId')
    .optional()
    .custom(isValidObjectId),
  
  body('items')
    .optional()
    .isArray({ min: 1 })
    .withMessage('Order must contain at least one item'),
  
  body('items.*.productId')
    .optional()
    .custom(isValidObjectId),
  
  body('items.*.quantity')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Quantity must be between 1-50'),
  
  body('deliveryAddress.street')
    .optional()
    .trim()
    .isLength({ min: 5 })
    .withMessage('Delivery address is required'),
  
  body('deliveryAddress.coordinates.latitude')
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage('Invalid delivery latitude'),
  
  body('deliveryAddress.coordinates.longitude')
    .optional()
    .isFloat({ min: -180, max: 180 })
    .withMessage('Invalid delivery longitude'),
  
  body('paymentMethod')
    .isIn(['cod', 'razorpay', 'stripe', 'card', 'upi', 'wallet'])
    .withMessage('Invalid payment method'),
  
  handleValidationErrors
];

// Cart operations validation
const validateCartOperation = [
  body('productId')
    .custom(isValidObjectId),
  
  body('quantity')
    .isInt({ min: 1, max: 50 })
    .withMessage('Quantity must be between 1-50'),
  
  handleValidationErrors
];

// Coupon validation
const validateCouponCreation = [
  body('code')
    .trim()
    .isLength({ min: 3, max: 20 })
    .isAlphanumeric()
    .withMessage('Coupon code must be 3-20 alphanumeric characters'),
  
  body('name')
    .trim()
    .isLength({ min: 5, max: 100 })
    .withMessage('Coupon name must be between 5-100 characters'),
  
  body('discountType')
    .isIn(['percentage', 'fixed_amount', 'free_delivery'])
    .withMessage('Invalid discount type'),
  
  body('discountValue')
    .isFloat({ min: 0 })
    .withMessage('Discount value must be positive'),
  
  body('minimumOrderAmount')
    .isFloat({ min: 0 })
    .withMessage('Minimum order amount must be positive'),
  
  body('validFrom')
    .isISO8601()
    .withMessage('Invalid valid from date'),
  
  body('validUntil')
    .isISO8601()
    .withMessage('Invalid valid until date'),
  
  handleValidationErrors
];

// Location update validation
const validateLocationUpdate = [
  body('latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Invalid latitude'),
  
  body('longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Invalid longitude'),
  
  body('accuracy')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Accuracy must be a positive number'),
  
  handleValidationErrors
];

// Query parameter validation
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1-100'),
  
  handleValidationErrors
];

// Object ID parameter validation
const validateObjectIdParam = (paramName = 'id') => [
  param(paramName)
    .custom(isValidObjectId),
  
  handleValidationErrors
];

// Search validation
const validateSearch = [
  query('q')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Search query must be between 2-100 characters'),
  
  query('category')
    .optional()
    .custom(isValidObjectId),
  
  query('minPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Min price must be positive'),
  
  query('maxPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Max price must be positive'),
  
  handleValidationErrors
];

module.exports = {
  handleValidationErrors,
  validateUserRegistration,
  validateUserLogin,
  validateOTP,
  validateShopCreation,
  validateProductCreation,
  validateOrderCreation,
  validateCartOperation,
  validateCouponCreation,
  validateLocationUpdate,
  validatePagination,
  validateObjectIdParam,
  validateSearch,
  isValidObjectId,
  isValidCoordinate,
  isValidPhoneNumber,
  isValidPincode,
  isStrongPassword
};
