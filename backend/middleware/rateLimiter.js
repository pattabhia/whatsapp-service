/**
 * Simple in-memory rate limiting middleware for Express
 * For production, consider using Redis-based rate limiting
 */

// Store for rate limit tracking (in-memory)
// In production, use Redis or similar for distributed systems
const rateLimitStore = new Map();

/**
 * Clear old entries from rate limit store (cleanup)
 */
function cleanupRateLimitStore() {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}

// Cleanup every 5 minutes
setInterval(cleanupRateLimitStore, 5 * 60 * 1000);

/**
 * Create rate limiting middleware
 * @param {object} options - Rate limit configuration
 * @param {number} options.windowMs - Time window in milliseconds (default: 15 minutes)
 * @param {number} options.maxRequests - Maximum requests per window (default: 100)
 * @param {function} options.keyGenerator - Function to generate key from request (default: uses IP)
 * @param {function} options.skipSuccessfulRequests - Skip counting successful requests (default: false)
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
    skipSuccessfulRequests = false,
  } = options;

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();

    // Cleanup old entries periodically
    if (Math.random() < 0.01) { // 1% chance on each request
      cleanupRateLimitStore();
    }

    const record = rateLimitStore.get(key);

    if (!record || record.resetTime < now) {
      // Create new record
      rateLimitStore.set(key, {
        count: 1,
        resetTime: now + windowMs,
      });
      return next();
    }

    // Increment count
    record.count++;

    // Check if limit exceeded
    if (record.count > maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
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

