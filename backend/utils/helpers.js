const crypto = require('crypto');
const moment = require('moment');

// Generate random string
const generateRandomString = (length = 10) => {
  return crypto.randomBytes(length).toString('hex').substring(0, length);
};

// Generate order ID
const generateOrderId = () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `ORD${timestamp}${random}`.toUpperCase();
};

// Generate coupon code
const generateCouponCode = (prefix = 'LOCALIT', length = 8) => {
  const random = crypto.randomBytes(length).toString('hex').substring(0, length);
  return `${prefix}${random}`.toUpperCase();
};

// Calculate distance between two coordinates using Haversine formula
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in kilometers
};

// Calculate delivery fee based on distance
const calculateDeliveryFee = (distance, baseRate = 20, perKmRate = 5) => {
  if (distance <= 2) return baseRate;
  return baseRate + Math.ceil((distance - 2) * perKmRate);
};

// Format phone number to international format
const formatPhoneNumber = (phone, countryCode = '91') => {
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  // If it's already international format, return as is
  if (cleaned.startsWith(countryCode) && cleaned.length === 12) {
    return `+${cleaned}`;
  }
  
  // If it's a 10-digit number, add country code
  if (cleaned.length === 10) {
    return `+${countryCode}${cleaned}`;
  }
  
  return phone; // Return original if can't format
};

// Validate email format
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Validate phone number format (Indian)
const isValidPhoneNumber = (phone) => {
  const phoneRegex = /^(\+91|91)?[6-9]\d{9}$/;
  return phoneRegex.test(phone.replace(/\s/g, ''));
};

// Generate slug from text
const generateSlug = (text) => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

// Sanitize input text
const sanitizeText = (text) => {
  return text
    .replace(/[<>]/g, '')
    .trim();
};

// Format currency
const formatCurrency = (amount, currency = 'INR') => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(amount);
};

// Calculate percentage
const calculatePercentage = (value, total) => {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
};

// Calculate discount amount
const calculateDiscount = (originalPrice, discountPercentage) => {
  return Math.round(originalPrice * (discountPercentage / 100));
};

// Calculate final price after discount
const calculateDiscountedPrice = (originalPrice, discountPercentage) => {
  const discount = calculateDiscount(originalPrice, discountPercentage);
  return originalPrice - discount;
};

// Get time difference in human readable format
const getTimeDifference = (date) => {
  return moment(date).fromNow();
};

// Format date
const formatDate = (date, format = 'DD/MM/YYYY') => {
  return moment(date).format(format);
};

// Get day of week
const getDayOfWeek = (date) => {
  return moment(date).format('dddd');
};

// Check if date is today
const isToday = (date) => {
  return moment(date).isSame(moment(), 'day');
};

// Check if time is within business hours
const isWithinBusinessHours = (time, openTime, closeTime) => {
  const current = moment(time, 'HH:mm');
  const open = moment(openTime, 'HH:mm');
  const close = moment(closeTime, 'HH:mm');
  
  return current.isBetween(open, close);
};

// Generate pagination metadata
const getPaginationMeta = (page, limit, total) => {
  const pages = Math.ceil(total / limit);
  return {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages,
    hasNext: page < pages,
    hasPrev: page > 1
  };
};

// Filter object by allowed keys
const filterObject = (obj, allowedKeys) => {
  const filtered = {};
  allowedKeys.forEach(key => {
    if (obj.hasOwnProperty(key)) {
      filtered[key] = obj[key];
    }
  });
  return filtered;
};

// Remove empty values from object
const removeEmptyValues = (obj) => {
  const cleaned = {};
  Object.keys(obj).forEach(key => {
    if (obj[key] !== null && obj[key] !== undefined && obj[key] !== '') {
      cleaned[key] = obj[key];
    }
  });
  return cleaned;
};

// Deep clone object
const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

// Capitalize first letter
const capitalizeFirst = (str) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

// Convert to title case
const toTitleCase = (str) => {
  return str.replace(/\w\S*/g, (txt) => {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
};

// Generate random color
const generateRandomColor = () => {
  return '#' + Math.floor(Math.random()*16777215).toString(16);
};

// Validate coordinates
const isValidCoordinate = (lat, lng) => {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
};

// Calculate ETA based on distance and speed
const calculateETA = (distance, speedKmh = 30) => {
  const hours = distance / speedKmh;
  const minutes = Math.ceil(hours * 60);
  return minutes;
};

// Generate file name with timestamp
const generateFileName = (originalName) => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const extension = originalName.split('.').pop();
  const nameWithoutExt = originalName.replace(/\.[^/.]+$/, '');
  return `${generateSlug(nameWithoutExt)}_${timestamp}_${random}.${extension}`;
};

// Get file extension
const getFileExtension = (filename) => {
  return filename.split('.').pop().toLowerCase();
};

// Check if file is image
const isImageFile = (filename) => {
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
  const extension = getFileExtension(filename);
  return imageExtensions.includes(extension);
};

// Format file size
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Mask sensitive data
const maskEmail = (email) => {
  const [local, domain] = email.split('@');
  const maskedLocal = local.length > 2 
    ? local.substring(0, 2) + '*'.repeat(local.length - 2)
    : local;
  return `${maskedLocal}@${domain}`;
};

const maskPhoneNumber = (phone) => {
  if (phone.length <= 4) return phone;
  const start = phone.substring(0, 2);
  const end = phone.substring(phone.length - 2);
  const middle = '*'.repeat(phone.length - 4);
  return `${start}${middle}${end}`;
};

// Generate API response
const apiResponse = (success, message, data = null, meta = null) => {
  const response = { success, message };
  if (data !== null) response.data = data;
  if (meta !== null) response.meta = meta;
  return response;
};

// Error response
const errorResponse = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// Sleep function
const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

module.exports = {
  generateRandomString,
  generateOrderId,
  generateCouponCode,
  calculateDistance,
  calculateDeliveryFee,
  formatPhoneNumber,
  isValidEmail,
  isValidPhoneNumber,
  generateSlug,
  sanitizeText,
  formatCurrency,
  calculatePercentage,
  calculateDiscount,
  calculateDiscountedPrice,
  getTimeDifference,
  formatDate,
  getDayOfWeek,
  isToday,
  isWithinBusinessHours,
  getPaginationMeta,
  filterObject,
  removeEmptyValues,
  deepClone,
  capitalizeFirst,
  toTitleCase,
  generateRandomColor,
  isValidCoordinate,
  calculateETA,
  generateFileName,
  getFileExtension,
  isImageFile,
  formatFileSize,
  maskEmail,
  maskPhoneNumber,
  apiResponse,
  errorResponse,
  sleep
};
