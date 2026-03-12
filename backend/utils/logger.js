const winston = require('winston');
const path = require('path');

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Create logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'localit-backend' },
  transports: [
    // Write all logs with level 'error' and below to error.log
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write all logs with level 'info' and below to combined.log
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/exceptions.log'),
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/rejections.log'),
    }),
  ],
});

// If not in production, log to console as well
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        return `${timestamp} [${level}]: ${message} ${
          Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
        }`;
      })
    )
  }));
}

// Create request logger middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    };

    if (req.user) {
      logData.userId = req.user.id;
      logData.userRole = req.user.role;
    }

    if (res.statusCode >= 400) {
      logger.error('HTTP Request Error', logData);
    } else {
      logger.info('HTTP Request', logData);
    }
  });

  next();
};

// Log authentication events
const logAuth = (event, userId, details = {}) => {
  logger.info('Authentication Event', {
    event,
    userId,
    timestamp: new Date().toISOString(),
    ...details
  });
};

// Log order events
const logOrder = (event, orderId, userId, details = {}) => {
  logger.info('Order Event', {
    event,
    orderId,
    userId,
    timestamp: new Date().toISOString(),
    ...details
  });
};

// Log payment events
const logPayment = (event, paymentId, orderId, amount, details = {}) => {
  logger.info('Payment Event', {
    event,
    paymentId,
    orderId,
    amount,
    timestamp: new Date().toISOString(),
    ...details
  });
};

// Log security events
const logSecurity = (event, details = {}) => {
  logger.warn('Security Event', {
    event,
    timestamp: new Date().toISOString(),
    ...details
  });
};

// Log system events
const logSystem = (event, level = 'info', details = {}) => {
  logger.log(level, 'System Event', {
    event,
    timestamp: new Date().toISOString(),
    ...details
  });
};

// Log database events
const logDatabase = (event, details = {}) => {
  logger.info('Database Event', {
    event,
    timestamp: new Date().toISOString(),
    ...details
  });
};

// Log notification events
const logNotification = (event, recipientId, type, details = {}) => {
  logger.info('Notification Event', {
    event,
    recipientId,
    type,
    timestamp: new Date().toISOString(),
    ...details
  });
};

// Log delivery events
const logDelivery = (event, orderId, partnerId, details = {}) => {
  logger.info('Delivery Event', {
    event,
    orderId,
    partnerId,
    timestamp: new Date().toISOString(),
    ...details
  });
};

// Log API events
const logAPI = (event, endpoint, method, details = {}) => {
  logger.info('API Event', {
    event,
    endpoint,
    method,
    timestamp: new Date().toISOString(),
    ...details
  });
};

// Log file operations
const logFile = (event, filename, details = {}) => {
  logger.info('File Operation', {
    event,
    filename,
    timestamp: new Date().toISOString(),
    ...details
  });
};

// Performance logging
const logPerformance = (operation, duration, details = {}) => {
  const level = duration > 5000 ? 'warn' : 'info'; // Warn if operation takes more than 5 seconds
  
  logger.log(level, 'Performance', {
    operation,
    duration: `${duration}ms`,
    timestamp: new Date().toISOString(),
    ...details
  });
};

// Error logging with context
const logError = (error, context = {}) => {
  logger.error('Application Error', {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    ...context
  });
};

// Structured logging for different components
const createComponentLogger = (component) => {
  return {
    info: (message, data = {}) => logger.info(message, { component, ...data }),
    warn: (message, data = {}) => logger.warn(message, { component, ...data }),
    error: (message, data = {}) => logger.error(message, { component, ...data }),
    debug: (message, data = {}) => logger.debug(message, { component, ...data }),
  };
};

// Audit logging for sensitive operations
const logAudit = (action, userId, resource, details = {}) => {
  logger.info('Audit Log', {
    action,
    userId,
    resource,
    timestamp: new Date().toISOString(),
    ...details
  });
};

module.exports = {
  logger,
  requestLogger,
  logAuth,
  logOrder,
  logPayment,
  logSecurity,
  logSystem,
  logDatabase,
  logNotification,
  logDelivery,
  logAPI,
  logFile,
  logPerformance,
  logError,
  logAudit,
  createComponentLogger
};
