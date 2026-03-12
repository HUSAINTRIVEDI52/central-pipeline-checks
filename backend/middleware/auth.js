const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verify JWT token
const authenticate = async (req, res, next) => {
  try {
    let token;
    
    // Get token from header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from token
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token is invalid - user not found'
      });
    }
    
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account has been deactivated'
      });
    }
    
    // Add user to request
    req.user = user;
    next();
    
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Server error during authentication'
    });
  }
};

// Check if user has required role(s)
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}`
      });
    }
    
    next();
  };
};

// Check if user is verified
const requireVerification = (req, res, next) => {
  if (!req.user.isVerified) {
    return res.status(403).json({
      success: false,
      message: 'Account verification required'
    });
  }
  
  next();
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    let token;
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      
      if (user && user.isActive) {
        req.user = user;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

// Check if user owns the resource or is admin
const checkOwnership = (resourceUserIdField = 'userId') => {
  return (req, res, next) => {
    // Admin can access any resource
    if (req.user.role === 'admin') {
      return next();
    }
    
    // Check if user owns the resource
    const resourceUserId = req.body[resourceUserIdField] || 
                          req.params[resourceUserIdField] || 
                          req.query[resourceUserIdField];
    
    if (resourceUserId && resourceUserId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only access your own resources.'
      });
    }
    
    next();
  };
};

// Rate limiting for specific actions
const createActionLimiter = (windowMs, max, message) => {
  const attempts = new Map();
  
  return (req, res, next) => {
    const key = `${req.ip}:${req.user?._id || 'anonymous'}`;
    const now = Date.now();
    
    // Clean old entries
    for (const [k, v] of attempts) {
      if (now - v.firstAttempt > windowMs) {
        attempts.delete(k);
      }
    }
    
    // Check current attempts
    const userAttempts = attempts.get(key);
    
    if (!userAttempts) {
      attempts.set(key, { count: 1, firstAttempt: now });
      return next();
    }
    
    if (userAttempts.count >= max) {
      return res.status(429).json({
        success: false,
        message: message || 'Too many requests, please try again later',
        retryAfter: Math.ceil((windowMs - (now - userAttempts.firstAttempt)) / 1000)
      });
    }
    
    userAttempts.count++;
    next();
  };
};

// Middleware to log user activity
const logActivity = (action) => {
  return (req, res, next) => {
    // Store activity info for potential logging
    req.activityLog = {
      action,
      userId: req.user?._id,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date()
    };
    
    // Log successful responses
    const originalSend = res.send;
    res.send = function(data) {
      if (res.statusCode < 400 && req.user) {
        // Update user's last login if this is a login action
        if (action === 'login') {
          User.findByIdAndUpdate(req.user._id, { lastLogin: new Date() }).exec();
        }
        
        // Here you could save to an audit log collection
        console.log(`Activity: ${action} by user ${req.user._id} from ${req.ip}`);
      }
      
      originalSend.call(this, data);
    };
    
    next();
  };
};

module.exports = {
  authenticate,
  authorize,
  requireVerification,
  optionalAuth,
  checkOwnership,
  createActionLimiter,
  logActivity
};
