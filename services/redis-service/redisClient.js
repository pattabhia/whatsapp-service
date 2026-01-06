/**
 * Redis client service
 * Provides centralized Redis connection management
 * 
 * NOTE: Redis is OPTIONAL. The service works without Redis using in-memory fallback.
 * Redis is RECOMMENDED for:
 * - Multi-instance deployments (shared rate limiting and idempotency)
 * - Production environments (better reliability)
 * 
 * To use Redis, set REDIS_URL environment variable.
 * Example: REDIS_URL=redis://localhost:6379
 */

let redisClient = null;

/**
 * Get or create Redis client
 * Falls back to in-memory store if Redis is not available
 * @returns {object} Redis client or null if not configured
 */
function getRedisClient() {
  // Return cached client if available
  if (redisClient) {
    return redisClient;
  }

  const REDIS_URL = process.env.REDIS_URL;
  
  // If Redis URL is not configured, return null (will use fallback)
  if (!REDIS_URL) {
    return null;
  }

  try {
    // Dynamic import - only load if Redis URL is configured
    const Redis = require('ioredis');
    
    // Create Redis client with connection options
    redisClient = new Redis(REDIS_URL, {
      retryStrategy: (times) => {
        // Retry with exponential backoff
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true, // Use lazy connection to prevent blocking during startup
      connectTimeout: 5000, // 5 second connection timeout
    });

    // Error handling
    redisClient.on('error', (error) => {
      // Log error but don't throw - allow fallback to in-memory store
      // Using console.error here as Redis client events occur during initialization
      console.error('Redis client error:', error.message);
      // Don't crash the server - Redis is optional
    });

    // Handle connection errors gracefully
    redisClient.on('close', () => {
      console.warn('Redis client connection closed');
    });

    // Prevent unhandled rejections from Redis
    redisClient.on('reconnecting', () => {
      console.log('Redis client reconnecting...');
    });

    redisClient.on('connect', () => {
      // Using console.log here as this is initialization logging
      console.log('Redis client connected');
    });

    redisClient.on('ready', () => {
      // Using console.log here as this is initialization logging
      console.log('Redis client ready');
    });

    return redisClient;
  } catch (error) {
    console.warn('Redis not available, falling back to in-memory store:', error.message);
    return null;
  }
}

/**
 * Check if Redis is available
 * @returns {boolean}
 */
function isRedisAvailable() {
  try {
    const client = getRedisClient();
    if (!client) {
      return false;
    }
    // With lazyConnect, status might be 'wait', 'connecting', or 'ready'
    // Only return true if actually ready, false otherwise
    return client.status === 'ready';
  } catch (error) {
    // If any error occurs, Redis is not available
    return false;
  }
}

/**
 * Close Redis connection
 */
async function closeRedisClient() {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch (error) {
      // Log error but don't throw - graceful shutdown should continue
      console.warn('Error closing Redis client:', error.message);
      // Try to disconnect forcefully if quit fails
      try {
        redisClient.disconnect();
      } catch (disconnectError) {
        // Ignore disconnect errors
      }
    } finally {
      redisClient = null;
    }
  }
}

module.exports = {
  getRedisClient,
  isRedisAvailable,
  closeRedisClient,
};

