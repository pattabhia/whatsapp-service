/**
 * Utility for API calls with timeout and retry logic
 */

const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000; // 1 second initial delay

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create an AbortController with timeout
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {object} { controller, timeoutId }
 */
function createTimeoutController(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
}

/**
 * Execute a fetch request with timeout and retry logic
 * @param {string|URL} url - Request URL
 * @param {RequestInit} options - Fetch options
 * @param {object} config - Retry configuration
 * @param {number} config.timeoutMs - Request timeout in milliseconds (default: 30000)
 * @param {number} config.maxRetries - Maximum number of retries (default: 3)
 * @param {number} config.retryDelayMs - Initial retry delay in milliseconds (default: 1000)
 * @param {function} config.shouldRetry - Function to determine if error should be retried (default: retry on network errors and 5xx)
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options = {}, config = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    shouldRetry = (error, response) => {
      // Retry on network errors, timeouts, and 5xx server errors
      if (error) {
        return error.name === 'AbortError' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT';
      }
      if (response) {
        return response.status >= 500 && response.status < 600;
      }
      return false;
    },
  } = config;

  let lastError;
  let lastResponse;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Create timeout controller for this attempt
      const { controller, timeoutId } = createTimeoutController(timeoutMs);

      try {
        // Execute fetch with abort signal
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Check if response indicates retry should happen
        if (response.ok || !shouldRetry(null, response)) {
          return response;
        }

        lastResponse = response;

        // If this is not the last attempt, wait and retry
        if (attempt < maxRetries) {
          const delay = retryDelayMs * Math.pow(2, attempt); // Exponential backoff
          await sleep(delay);
          continue;
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);

        // Check if error should be retried
        if (shouldRetry(fetchError, null) && attempt < maxRetries) {
          lastError = fetchError;
          const delay = retryDelayMs * Math.pow(2, attempt); // Exponential backoff
          await sleep(delay);
          continue;
        }

        throw fetchError;
      }
    } catch (error) {
      lastError = error;

      // If this is the last attempt, throw the error
      if (attempt >= maxRetries) {
        throw error;
      }

      // Wait before retrying
      const delay = retryDelayMs * Math.pow(2, attempt); // Exponential backoff
      await sleep(delay);
    }
  }

  // If we get here, all retries failed
  if (lastResponse) {
    return lastResponse;
  }
  throw lastError || new Error('Request failed after all retries');
}

module.exports = {
  fetchWithRetry,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
};

