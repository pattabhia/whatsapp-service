/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures by short-circuiting requests when service is down
 */

const { createLogger } = require('../logging-service/logger');

const logger = createLogger();

/**
 * Circuit breaker states
 */
const CIRCUIT_STATES = {
  CLOSED: 'CLOSED',      // Normal operation, requests pass through
  OPEN: 'OPEN',          // Service is failing, requests are short-circuited
  HALF_OPEN: 'HALF_OPEN', // Testing if service has recovered
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  failureThreshold: 5,        // Number of failures before opening circuit
  successThreshold: 2,        // Number of successes needed in HALF_OPEN to close
  timeoutMs: 60000,           // Time in OPEN state before transitioning to HALF_OPEN (60s)
  resetTimeoutMs: 30000,      // Time in HALF_OPEN before transitioning back to OPEN (30s)
};

/**
 * Create a circuit breaker instance
 * @param {string} name - Name of the circuit breaker (for logging)
 * @param {object} config - Configuration options
 * @returns {object} Circuit breaker instance
 */
function createCircuitBreaker(name, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  let state = CIRCUIT_STATES.CLOSED;
  let failureCount = 0;
  let successCount = 0;
  let lastFailureTime = null;
  let lastStateChangeTime = Date.now();

  /**
   * Execute a function with circuit breaker protection
   * @param {function} fn - Async function to execute
   * @param {*} fallback - Fallback value or function to return when circuit is open
   * @returns {Promise<*>}
   */
  async function execute(fn, fallback = null) {
    const now = Date.now();

    // Check if we should transition from OPEN to HALF_OPEN
    if (state === CIRCUIT_STATES.OPEN) {
      const timeInOpenState = now - lastStateChangeTime;
      if (timeInOpenState >= cfg.timeoutMs) {
        logger.info('Circuit breaker transitioning to HALF_OPEN', {
          circuit_name: name,
          time_in_open_ms: timeInOpenState,
        });
        state = CIRCUIT_STATES.HALF_OPEN;
        successCount = 0;
        lastStateChangeTime = now;
      } else {
        // Circuit is open, return fallback immediately
        const fallbackValue = typeof fallback === 'function' ? await fallback() : fallback;
        logger.warn('Circuit breaker OPEN, returning fallback', {
          circuit_name: name,
          time_until_half_open_ms: cfg.timeoutMs - timeInOpenState,
        });
        return fallbackValue;
      }
    }

    // Check if we should transition from HALF_OPEN back to OPEN (if timeout exceeded)
    if (state === CIRCUIT_STATES.HALF_OPEN) {
      const timeInHalfOpenState = now - lastStateChangeTime;
      if (timeInHalfOpenState >= cfg.resetTimeoutMs) {
        logger.warn('Circuit breaker HALF_OPEN timeout, transitioning to OPEN', {
          circuit_name: name,
        });
        state = CIRCUIT_STATES.OPEN;
        lastStateChangeTime = now;
        const fallbackValue = typeof fallback === 'function' ? await fallback() : fallback;
        return fallbackValue;
      }
    }

    // Try to execute the function
    try {
      const result = await fn();

      // Success - reset failure count and handle state transitions
      if (state === CIRCUIT_STATES.HALF_OPEN) {
        successCount++;
        if (successCount >= cfg.successThreshold) {
          logger.info('Circuit breaker transitioning to CLOSED', {
            circuit_name: name,
            success_count: successCount,
          });
          state = CIRCUIT_STATES.CLOSED;
          failureCount = 0;
          successCount = 0;
          lastStateChangeTime = now;
        }
      } else if (state === CIRCUIT_STATES.CLOSED) {
        // Reset failure count on success (gradual recovery)
        failureCount = Math.max(0, failureCount - 1);
      }

      return result;
    } catch (error) {
      // Failure - increment failure count
      failureCount++;
      lastFailureTime = now;

      logger.warn('Circuit breaker recorded failure', {
        circuit_name: name,
        failure_count: failureCount,
        state,
        error_message: error.message,
      });

      // Check if we should open the circuit
      if (state === CIRCUIT_STATES.CLOSED && failureCount >= cfg.failureThreshold) {
        logger.error('Circuit breaker opening', {
          circuit_name: name,
          failure_count: failureCount,
          failure_threshold: cfg.failureThreshold,
        });
        state = CIRCUIT_STATES.OPEN;
        lastStateChangeTime = now;
      } else if (state === CIRCUIT_STATES.HALF_OPEN) {
        // Failed in HALF_OPEN, go back to OPEN
        logger.warn('Circuit breaker HALF_OPEN failed, transitioning to OPEN', {
          circuit_name: name,
        });
        state = CIRCUIT_STATES.OPEN;
        lastStateChangeTime = now;
        successCount = 0;
      }

      // Always throw the error (caller handles it)
      throw error;
    }
  }

  /**
   * Get current circuit breaker state
   * @returns {object} State information
   */
  function getState() {
    return {
      state,
      failureCount,
      successCount,
      lastFailureTime,
      lastStateChangeTime,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  function reset() {
    logger.info('Circuit breaker manually reset', { circuit_name: name });
    state = CIRCUIT_STATES.CLOSED;
    failureCount = 0;
    successCount = 0;
    lastFailureTime = null;
    lastStateChangeTime = Date.now();
  }

  return {
    execute,
    getState,
    reset,
    name,
  };
}

module.exports = {
  createCircuitBreaker,
  CIRCUIT_STATES,
};

