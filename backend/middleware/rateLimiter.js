const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('redis');

// Redis client for rate limiting (optional)
let redisClient;
if (process.env.REDIS_URL) {
  redisClient = Redis.createClient({
    url: process.env.REDIS_URL
  });
  redisClient.connect().catch(console.error);
}

// General API rate limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: redisClient ? new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }) : undefined,
});

// Strict limiter for sensitive endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    success: false,
    message: 'Too many attempts, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: redisClient ? new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }) : undefined,
});

// Auth-specific rate limiter
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 auth requests per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: redisClient ? new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }) : undefined,
  skipSuccessfulRequests: true, // Don't count successful requests
});

// OTP rate limiter
const otpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // Limit each IP to 3 OTP requests per minute
  message: {
    success: false,
    message: 'Too many OTP requests, please wait before requesting again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: redisClient ? new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }) : undefined,
});

// Upload rate limiter
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 uploads per minute
  message: {
    success: false,
    message: 'Too many upload requests, please wait before uploading again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: redisClient ? new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }) : undefined,
});

// Password reset rate limiter
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 password reset requests per hour
  message: {
    success: false,
    message: 'Too many password reset attempts, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: redisClient ? new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }) : undefined,
});

// Order creation rate limiter
const orderLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Limit each IP to 5 orders per minute
  message: {
    success: false,
    message: 'Too many orders being placed, please wait a moment.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: redisClient ? new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }) : undefined,
});

// Search rate limiter
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 searches per minute
  message: {
    success: false,
    message: 'Too many search requests, please slow down.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: redisClient ? new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }) : undefined,
});

// Admin-specific rate limiter
const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // Higher limit for admin users
  message: {
    success: false,
    message: 'Too many admin requests, please wait.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: redisClient ? new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }) : undefined,
});

// Payment processing rate limiter
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // Very strict for payment requests
  message: {
    success: false,
    message: 'Too many payment requests, please wait before trying again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: redisClient ? new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }) : undefined,
});

// Custom rate limiter creator
const createCustomLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message: message || 'Rate limit exceeded',
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: redisClient ? new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
    }) : undefined,
  });
};

// Rate limiter based on user authentication
const createAuthenticatedLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message: message || 'Rate limit exceeded',
    },
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise fall back to IP
      return req.user?.id || req.ip;
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: redisClient ? new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
    }) : undefined,
  });
};

// Skip rate limiting for certain conditions
const skipIf = (condition) => {
  return (req, res) => {
    return condition(req, res);
  };
};

// Skip for successful requests
const skipSuccessfulRequests = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: 'Too many failed requests, please try again later.',
  },
});

// Dynamic rate limiter based on user role
const dynamicRoleBasedLimiter = (req, res, next) => {
  let limiter;
  
  if (req.user) {
    switch (req.user.role) {
      case 'admin':
        limiter = adminLimiter;
        break;
      case 'shop_owner':
        limiter = createCustomLimiter(60 * 1000, 50, 'Too many requests for shop owner');
        break;
      case 'delivery_partner':
        limiter = createCustomLimiter(60 * 1000, 40, 'Too many requests for delivery partner');
        break;
      default:
        limiter = generalLimiter;
    }
  } else {
    limiter = strictLimiter;
  }
  
  return limiter(req, res, next);
};

module.exports = {
  generalLimiter,
  strictLimiter,
  authLimiter,
  otpLimiter,
  uploadLimiter,
  passwordResetLimiter,
  orderLimiter,
  searchLimiter,
  adminLimiter,
  paymentLimiter,
  createCustomLimiter,
  createAuthenticatedLimiter,
  dynamicRoleBasedLimiter,
  skipSuccessfulRequests,
  redisClient
};
