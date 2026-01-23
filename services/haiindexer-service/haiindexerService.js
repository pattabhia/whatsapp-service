/**
 * Service for querying HaiIndexer API
 */

const HAIINDEXER_API_URL = process.env.HAIINDEXER_API_URL || null;
const HAIINDEXER_API_TOKEN = process.env.HAIINDEXER_API_TOKEN || null;
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

// In-memory token cache (module-level variables)
let cachedToken = null;
let cachedTokenFetchedAt = null;

// Token cache TTL: 30 minutes in milliseconds
const TOKEN_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Get HaiIndexer bearer token from cache or fetch from test-token endpoint
 * @returns {Promise<string|null>} Bearer token or null on failure
 */
async function getHaiIndexerBearerToken() {
  // If permanent token is configured, use it directly (production)
  if (HAIINDEXER_API_TOKEN) {
    return HAIINDEXER_API_TOKEN;
  }

  // Check if cached token exists and is less than 30 minutes old
  const now = Date.now();
  if (cachedToken && cachedTokenFetchedAt && (now - cachedTokenFetchedAt) < TOKEN_CACHE_TTL_MS) {
    return cachedToken;
  }

  // Need to fetch new token (development only)
  if (!HAIINDEXER_API_URL) {
    return null;
  }

  try {
    // Construct test-token endpoint URL
    let testTokenUrl = HAIINDEXER_API_URL;
    // Remove trailing slash and any existing path
    testTokenUrl = testTokenUrl.replace(/\/$/, '');
    // Remove /api/ui/query if present to get base URL
    testTokenUrl = testTokenUrl.replace(/\/api\/ui\/query$/, '');
    // Append test-token endpoint
    testTokenUrl = testTokenUrl + '/api/ui/auth/test-token';

    // Log the URL being used for debugging
    try {
      const { createLogger } = require('../logging-service/logger');
      const logger = createLogger();
      logger.debug('Fetching HaiIndexer test token', { test_token_url: testTokenUrl });
    } catch (loggerError) {
      console.log('Fetching HaiIndexer test token from:', testTokenUrl);
    }

    // Fetch token with a short timeout (5 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(testTokenUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`Failed to fetch test token: ${response.status} ${response.statusText}. Response: ${errorBody}`);
      }

      // Handle both JSON and plain text responses
      const contentType = response.headers.get('content-type') || '';
      let token = null;
      
      if (contentType.includes('application/json')) {
        const data = await response.json();
        // Extract token from JSON response (handle different possible formats)
        token = data.token || data.access_token || data.jwt || data;
        
        // Log the response structure for debugging
        try {
          const { createLogger } = require('../logging-service/logger');
          const logger = createLogger();
          logger.debug('HaiIndexer test token response', { 
            has_token: !!data.token,
            has_access_token: !!data.access_token,
            has_jwt: !!data.jwt,
            response_keys: Object.keys(data)
          });
        } catch (loggerError) {
          console.log('Token response keys:', Object.keys(data));
        }
      } else {
        // Plain text response - token is the response body
        token = await response.text();
      }
      
      // Validate token is a non-empty string
      if (!token || typeof token !== 'string' || token.trim().length === 0) {
        throw new Error('Token not found in test-token response. Response type: ' + contentType);
      }
      
      token = token.trim();

      // Cache the token
      cachedToken = token;
      cachedTokenFetchedAt = now;

      // Log success (without logging token value)
      try {
        const { createLogger } = require('../logging-service/logger');
        const logger = createLogger();
        logger.info('Fetched new HaiIndexer test token', { token_length: token.length });
      } catch (loggerError) {
        console.log('Fetched new HaiIndexer test token (length:', token.length, ')');
      }

      return token;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    // Log error with full details but don't throw - return null to allow fallback handling
    try {
      const { createLogger } = require('../logging-service/logger');
      const logger = createLogger();
      logger.error('Failed to fetch HaiIndexer test token', error, {
        haiindexer_api_url: HAIINDEXER_API_URL,
        error_message: error.message,
        error_name: error.name
      });
    } catch (loggerError) {
      console.error('Failed to fetch HaiIndexer test token:', error.message);
      console.error('HAIINDEXER_API_URL:', HAIINDEXER_API_URL);
      if (error.stack) {
        console.error('Stack:', error.stack);
      }
    }
    return null;
  }
}

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

    // Get bearer token (permanent token from env or auto-fetched test token)
    const apiToken = await getHaiIndexerBearerToken();
    if (apiToken) {
      headers['Authorization'] = `Bearer ${apiToken}`;
    }
    // If token is not available, continue without auth header (fallback behavior)

    // Prepare request body - HaiIndexer expects 'query' field instead of 'message'
    const requestBody = {
      query: normalizedQuery.message || normalizedQuery.query,
      tenant_id: "default",
      top_k: 5
    };

    // Derive conversation_id from WhatsApp sender ID
    const waId = normalizedQuery.metadata?.wa_id || normalizedQuery.metadata?.phone_number;
    if (waId) {
      requestBody.conversation_id = `whatsapp-${waId}`;
    }

    // Include user_id if available
    if (normalizedQuery.user_id) {
      requestBody.user_id = normalizedQuery.user_id;
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
      // Try to get error details from response body
      let errorDetails = response.statusText;
      try {
        const errorBody = await response.text();
        if (errorBody) {
          try {
            const parsedError = JSON.parse(errorBody);
            errorDetails = JSON.stringify(parsedError, null, 2);
          } catch {
            errorDetails = errorBody;
          }
        }
      } catch (e) {
        // Ignore errors when reading error body
      }
      throw new Error(`HaiIndexer API error: ${response.status} ${response.statusText}\n${errorDetails}`);
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

