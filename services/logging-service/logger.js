/**
 * Structured logging service for observability and monitoring
 * Emits JSON-formatted logs with request IDs, timestamps, and metrics
 */

// Generate a simple request ID
function generateRequestId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a logger instance with a request ID
 * @param {string} requestId - Optional request ID, generates one if not provided
 * @returns {object} Logger instance with structured logging methods
 */
function createLogger(requestId = null) {
  const reqId = requestId || generateRequestId();
  
  const log = (level, message, data = {}) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      request_id: reqId,
      message,
      ...data,
    };
    
    // Output as JSON for easy parsing by log aggregation tools
    console.log(JSON.stringify(logEntry));
  };

  return {
    requestId: reqId,
    
    info(message, data) {
      log('INFO', message, data);
    },
    
    error(message, error = null, data = {}) {
      const errorData = {
        ...data,
        error_message: error?.message,
        error_stack: error?.stack,
      };
      log('ERROR', message, errorData);
    },
    
    warn(message, data) {
      log('WARN', message, data);
    },
    
    debug(message, data) {
      log('DEBUG', message, data);
    },
    
    // Helper for logging API requests
    apiRequest(service, method, url, data = {}) {
      this.info(`API Request: ${service}`, {
        service,
        method,
        url,
        ...data,
      });
    },
    
    // Helper for logging API responses
    apiResponse(service, statusCode, latencyMs, data = {}) {
      this.info(`API Response: ${service}`, {
        service,
        status_code: statusCode,
        latency_ms: latencyMs,
        ...data,
      });
    },
    
    // Helper for logging webhook events
    webhookEvent(eventType, data = {}) {
      this.info(`Webhook Event: ${eventType}`, {
        event_type: eventType,
        ...data,
      });
    },
  };
}

/**
 * Create a performance timer
 * @returns {object} Timer with start/end methods
 */
function createTimer() {
  const startTime = process.hrtime.bigint();
  
  return {
    elapsedMs() {
      const endTime = process.hrtime.bigint();
      return Number(endTime - startTime) / 1000000; // Convert nanoseconds to milliseconds
    },
  };
}

module.exports = {
  createLogger,
  createTimer,
  generateRequestId,
};

