/**
 * Idempotency Service
 * Prevents duplicate message processing from Meta webhook deliveries
 * Stores message_id for 24 hours in Redis (or in-memory fallback)
 */

const { getRedisClient, isRedisAvailable } = require('../redis-service/redisClient');
const { createLogger } = require('../logging-service/logger');

const logger = createLogger();

// In-memory fallback store (used if Redis is not available)
// Format: { messageId: { timestamp, processed } }
const inMemoryStore = new Map();

// Cleanup interval for in-memory store (24 hours)
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Cleanup every hour

// Prefix for Redis keys
const REDIS_KEY_PREFIX = 'idempotency:message:';

/**
 * Cleanup old entries from in-memory store
 */
function cleanupInMemoryStore() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [messageId, value] of inMemoryStore.entries()) {
    const age = now - value.timestamp;
    if (age > IDEMPOTENCY_TTL_SECONDS * 1000) {
      inMemoryStore.delete(messageId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.debug('Cleaned up old idempotency entries', { cleaned });
  }
}

// Start cleanup interval for in-memory store
setInterval(cleanupInMemoryStore, CLEANUP_INTERVAL_MS);

/**
 * Check if message has already been processed
 * @param {string} messageId - WhatsApp message ID
 * @returns {Promise<boolean>} True if already processed (duplicate), false if new
 */
async function isDuplicate(messageId) {
  if (!messageId) {
    return false;
  }

  const redisClient = getRedisClient();
  const useRedis = isRedisAvailable();

  if (useRedis && redisClient) {
    try {
      // Check if key exists in Redis
      const key = `${REDIS_KEY_PREFIX}${messageId}`;
      const exists = await redisClient.exists(key);
      return exists === 1;
    } catch (error) {
      logger.warn('Redis error checking idempotency, falling back to in-memory', {
        message_id: messageId,
        error: error.message,
      });
      // Fall through to in-memory check
    }
  }

  // Fallback to in-memory store
  return inMemoryStore.has(messageId);
}

/**
 * Mark message as processed
 * @param {string} messageId - WhatsApp message ID
 * @returns {Promise<void>}
 */
async function markAsProcessed(messageId) {
  if (!messageId) {
    return;
  }

  const redisClient = getRedisClient();
  const useRedis = isRedisAvailable();

  if (useRedis && redisClient) {
    try {
      const key = `${REDIS_KEY_PREFIX}${messageId}`;
      // Store with TTL of 24 hours
      await redisClient.setex(key, IDEMPOTENCY_TTL_SECONDS, '1');
      return;
    } catch (error) {
      logger.warn('Redis error storing idempotency, falling back to in-memory', {
        message_id: messageId,
        error: error.message,
      });
      // Fall through to in-memory store
    }
  }

  // Fallback to in-memory store
  inMemoryStore.set(messageId, {
    timestamp: Date.now(),
    processed: true,
  });
}

/**
 * Process message with idempotency check
 * @param {string} messageId - WhatsApp message ID
 * @param {function} processor - Async function to process the message
 * @returns {Promise<{isDuplicate: boolean, result?: any}>}
 */
async function processWithIdempotency(messageId, processor) {
  // Check if duplicate
  const duplicate = await isDuplicate(messageId);
  
  if (duplicate) {
    logger.info('Duplicate message detected, skipping processing', {
      message_id: messageId,
    });
    return { isDuplicate: true };
  }

  // Mark as processed first (before processing, to prevent race conditions)
  await markAsProcessed(messageId);

  try {
    // Process the message
    const result = await processor();
    return { isDuplicate: false, result };
  } catch (error) {
    // On error, we could optionally remove from idempotency store
    // to allow retry, but for webhooks it's safer to keep it marked as processed
    // to prevent duplicate processing on retry
    throw error;
  }
}

module.exports = {
  isDuplicate,
  markAsProcessed,
  processWithIdempotency,
};

