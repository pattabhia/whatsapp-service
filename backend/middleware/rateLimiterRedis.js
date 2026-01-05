/**
 * Redis-based rate limiting middleware for Express
 * Supports multi-instance deployments
 * Falls back to in-memory if Redis is not available
 */

const { getRedisClient, isRedisAvailable } = require('../../services/redis-service/redisClient');

// In-memory fallback store (format: { key: { count, resetTime } })
const inMemoryStore = new Map();

// Cleanup function for in-memory store
function cleanupInMemoryStore() {
  const now = Date.now();
  for (const [key, value] of inMemoryStore.entries()) {
    if (value.resetTime < now) {
      inMemoryStore.delete(key);
    }
  }
}

// Cleanup every 5 minutes
setInterval(cleanupInMemoryStore, 5 * 60 * 1000);

/**
 * Get rate limit record from Redis or in-memory store
 * @param {string} key - Rate limit key
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Promise<{count: number, resetTime: number}>}
 */
async function getRateLimitRecord(key, windowMs) {
  const redisClient = getRedisClient();
  const useRedis = isRedisAvailable();

  if (useRedis && redisClient) {
    try {
      const redisKey = `ratelimit:${key}`;
      const count = await redisClient.get(redisKey);
      const ttl = await redisClient.ttl(redisKey);

      if (count !== null) {
        // Key exists, calculate reset time from TTL
        const resetTime = Date.now() + (ttl * 1000);
        return {
          count: parseInt(count, 10),
          resetTime,
        };
      }

      // Key doesn't exist, create new record
      const resetTime = Date.now() + windowMs;
      const ttlSeconds = Math.ceil(windowMs / 1000);
      await redisClient.setex(redisKey, ttlSeconds, '0');
      return {
        count: 0,
        resetTime,
      };
    } catch (error) {
      // Log warning but continue with fallback (middleware context)
      console.warn('Redis error in rate limiter, falling back to in-memory:', error.message);
      // Fall through to in-memory
    }
  }

  // Fallback to in-memory store
  const now = Date.now();
  const record = inMemoryStore.get(key);

  if (!record || record.resetTime < now) {
    // Create new record
    const resetTime = now + windowMs;
    inMemoryStore.set(key, {
      count: 0,
      resetTime,
    });
    return { count: 0, resetTime };
  }

  return record;
}

/**
 * Increment rate limit counter
 * @param {string} key - Rate limit key
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Promise<{count: number, resetTime: number}>}
 */
async function incrementRateLimit(key, windowMs) {
  const redisClient = getRedisClient();
  const useRedis = isRedisAvailable();

  if (useRedis && redisClient) {
    try {
      const redisKey = `ratelimit:${key}`;
      const count = await redisClient.incr(redisKey);
      const ttl = await redisClient.ttl(redisKey);

      // If this is a new key, set TTL
      if (ttl === -1) {
        const ttlSeconds = Math.ceil(windowMs / 1000);
        await redisClient.expire(redisKey, ttlSeconds);
      }

      const resetTime = Date.now() + (ttl * 1000);
      return {
        count,
        resetTime,
      };
    } catch (error) {
      console.warn('Redis error incrementing rate limit, falling back to in-memory:', error.message);
      // Fall through to in-memory
    }
  }

  // Fallback to in-memory store
  const now = Date.now();
  let record = inMemoryStore.get(key);

  if (!record || record.resetTime < now) {
    record = {
      count: 0,
      resetTime: now + windowMs,
    };
    inMemoryStore.set(key, record);
  }

  record.count++;
  return record;
}

/**
 * Create rate limiting middleware with Redis support
 * @param {object} options - Rate limit configuration
 * @param {number} options.windowMs - Time window in milliseconds (default: 15 minutes)
 * @param {number} options.maxRequests - Maximum requests per window (default: 100)
 * @param {function} options.keyGenerator - Function to generate key from request (default: uses IP)
 * @returns {function} Express middleware
 */
function createRateLimiter(options = {}) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    maxRequests = 100,
    keyGenerator = (req) => {
      // Default: use IP address
      return req.ip || req.connection.remoteAddress || 'unknown';
    },
  } = options;

  return async (req, res, next) => {
    try {
      const key = keyGenerator(req);
      const record = await incrementRateLimit(key, windowMs);

      // Check if limit exceeded
      if (record.count > maxRequests) {
        const retryAfter = Math.ceil((record.resetTime - Date.now()) / 1000);
        res.set({
          'X-RateLimit-Limit': maxRequests,
          'X-RateLimit-Remaining': 0,
          'X-RateLimit-Reset': new Date(record.resetTime).toISOString(),
          'Retry-After': retryAfter,
        });
        return res.status(429).json({
          error: 'Too many requests',
          message: `Rate limit exceeded. Try again after ${retryAfter} seconds.`,
          retryAfter,
        });
      }

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': Math.max(0, maxRequests - record.count),
        'X-RateLimit-Reset': new Date(record.resetTime).toISOString(),
      });

      next();
    } catch (error) {
      // On error, allow request to proceed (fail open)
      // In production, you might want to fail closed
      console.error('Rate limiter error:', error);
      next();
    }
  };
}

/**
 * Rate limiter for webhook endpoints
 * More lenient than general API endpoints
 */
const webhookRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 1000, // WhatsApp can send many webhooks
  keyGenerator: (req) => {
    // Use IP address for webhook rate limiting
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
});

module.exports = {
  createRateLimiter,
  webhookRateLimiter,
};

