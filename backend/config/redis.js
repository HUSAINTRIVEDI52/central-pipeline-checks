const { createClient } = require('redis');

let redisClient;

const connectRedis = async () => {
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        connectTimeout: 5000, // 5 seconds timeout
        reconnectStrategy: false // Don't retry if connection fails
      }
    });

    redisClient.on('error', (err) => {
      // Only log if it's not a connection refused error (which we expect if Redis is missing)
      if (err.code !== 'ECONNREFUSED') {
        console.error('Redis Client Error', err);
      }
    });
    redisClient.on('connect', () => console.log('Redis Client Connected'));

    await redisClient.connect();
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.log('Redis not found. Running without cache.');
    } else {
      console.error('Redis Connection Failed:', error);
    }
    // Continue without Redis if connection fails (graceful degradation)
    redisClient = null;
  }
};

const getRedisClient = () => redisClient;

module.exports = {
  connectRedis,
  getRedisClient
};
