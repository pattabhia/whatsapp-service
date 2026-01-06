/**
 * Service for querying HaiIndexer API
 */

const HAIINDEXER_API_URL = process.env.HAIINDEXER_API_URL || null;
const { fetchWithRetry } = require('../utils/retryWithTimeout');
const { createCircuitBreaker } = require('../utils/circuitBreaker');

// Configuration
const API_TIMEOUT_MS = parseInt(process.env.HAIINDEXER_API_TIMEOUT_MS || '30000', 10); // 30 seconds default
const API_MAX_RETRIES = parseInt(process.env.HAIINDEXER_API_MAX_RETRIES || '3', 10);
const API_RETRY_DELAY_MS = parseInt(process.env.HAIINDEXER_API_RETRY_DELAY_MS || '1000', 10);

// Circuit breaker configuration
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: parseInt(process.env.HAIINDEXER_CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5', 10),
  successThreshold: parseInt(process.env.HAIINDEXER_CIRCUIT_BREAKER_SUCCESS_THRESHOLD || '2', 10),
  timeoutMs: parseInt(process.env.HAIINDEXER_CIRCUIT_BREAKER_TIMEOUT_MS || '60000', 10), // 60 seconds
  resetTimeoutMs: parseInt(process.env.HAIINDEXER_CIRCUIT_BREAKER_RESET_TIMEOUT_MS || '30000', 10), // 30 seconds
};

// Create circuit breaker instance for HaiIndexer
const circuitBreaker = createCircuitBreaker('HaiIndexer', CIRCUIT_BREAKER_CONFIG);

/**
 * Query HaiIndexer API with a normalized query object
 * @param {object} normalizedQuery - Normalized query object with user_id, channel, message, timestamp, metadata
 * @returns {Promise<{answer: string}>}
 */
async function queryHaiIndexer(normalizedQuery) {
  if (!HAIINDEXER_API_URL) {
    throw new Error('HAIINDEXER_API_URL is not configured');
  }

  // Execute with circuit breaker protection
  return circuitBreaker.execute(async () => {
    // Construct the API URL - append /api/ui/query if not already present
    let apiUrl = HAIINDEXER_API_URL;
    if (!apiUrl.includes('/api/ui/query')) {
      apiUrl = apiUrl.replace(/\/$/, '') + '/api/ui/query';
    }

    // Prepare headers with Authorization if token is available
    const headers = {
      'Content-Type': 'application/json',
    };
    
    // Add Authorization header if token is configured
    const apiToken = process.env.HAIINDEXER_API_TOKEN;
    if (apiToken) {
      headers['Authorization'] = `Bearer ${apiToken}`;
    } else {
      // Log warning but don't crash
      try {
        const { createLogger } = require('../logging-service/logger');
        const logger = createLogger();
        logger.warn('HAIINDEXER_API_TOKEN is not set - requests will be sent without authentication');
      } catch (loggerError) {
        console.warn('WARNING: HAIINDEXER_API_TOKEN is not set - requests will be sent without authentication');
      }
    }

    // Prepare request body with conversation_id
    const requestBody = { ...normalizedQuery };
    
    // Derive conversation_id from WhatsApp sender ID
    const waId = normalizedQuery.metadata?.wa_id || normalizedQuery.metadata?.phone_number;
    if (waId) {
      requestBody.conversation_id = `whatsapp-${waId}`;
    }

    const response = await fetchWithRetry(
      apiUrl,
      {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
      },
      {
        timeoutMs: API_TIMEOUT_MS,
        maxRetries: API_MAX_RETRIES,
        retryDelayMs: API_RETRY_DELAY_MS,
      }
    );

    if (!response.ok) {
      throw new Error(`HaiIndexer API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Log raw HaiIndexer response
    console.log("🧠 HaiIndexer RAW response:", data);

    // Log parsed HaiIndexer response
    const hiResponse = data;
    console.log("🧠 HaiIndexer parsed response:", hiResponse);

    // Handle different response formats - extended to support multiple shapes
    const answerText =
      data.answer ||
      data.response ||
      data.data?.answer ||
      data.final_answer ||
      data.output ||
      (typeof data === 'string' ? data : null);

    if (answerText) {
      return { answer: answerText };
    }

    // Fallback if no answer found
    return { answer: "Sorry, I couldn't find an answer." };
  }, () => {
    // Fallback when circuit is open
    return {
      answer: 'Sorry, the system is currently busy. Please try again in a few moments.',
    };
  });
}

/**
 * Get circuit breaker state (for monitoring/debugging)
 * @returns {object} Circuit breaker state
 */
function getCircuitBreakerState() {
  return circuitBreaker.getState();
}

/**
 * Manually reset circuit breaker (for testing/recovery)
 */
function resetCircuitBreaker() {
  circuitBreaker.reset();
}

module.exports = {
  queryHaiIndexer,
  getCircuitBreakerState,
  resetCircuitBreaker,
};

