/**
 * Configuration validator
 * Validates configuration values on startup
 */

const { createLogger } = require('../services/logging-service/logger');

const logger = createLogger();

/**
 * Validate configuration values
 * @throws {Error} If validation fails
 */
function validateConfig() {
  const errors = [];

  // Validate HaiIndexer API configuration
  const haiindexerTimeout = parseInt(process.env.HAIINDEXER_API_TIMEOUT_MS || '30000', 10);
  if (isNaN(haiindexerTimeout) || haiindexerTimeout <= 0 || haiindexerTimeout > 300000) {
    errors.push(`HAIINDEXER_API_TIMEOUT_MS must be between 1 and 300000 (got: ${process.env.HAIINDEXER_API_TIMEOUT_MS})`);
  }

  const haiindexerRetries = parseInt(process.env.HAIINDEXER_API_MAX_RETRIES || '3', 10);
  if (isNaN(haiindexerRetries) || haiindexerRetries < 0 || haiindexerRetries > 10) {
    errors.push(`HAIINDEXER_API_MAX_RETRIES must be between 0 and 10 (got: ${process.env.HAIINDEXER_API_MAX_RETRIES})`);
  }

  // Validate WhatsApp API configuration
  const whatsappTimeout = parseInt(process.env.WHATSAPP_API_TIMEOUT_MS || '15000', 10);
  if (isNaN(whatsappTimeout) || whatsappTimeout <= 0 || whatsappTimeout > 60000) {
    errors.push(`WHATSAPP_API_TIMEOUT_MS must be between 1 and 60000 (got: ${process.env.WHATSAPP_API_TIMEOUT_MS})`);
  }

  const whatsappRetries = parseInt(process.env.WHATSAPP_API_MAX_RETRIES || '2', 10);
  if (isNaN(whatsappRetries) || whatsappRetries < 0 || whatsappRetries > 5) {
    errors.push(`WHATSAPP_API_MAX_RETRIES must be between 0 and 5 (got: ${process.env.WHATSAPP_API_MAX_RETRIES})`);
  }

  // Validate circuit breaker configuration
  const cbFailureThreshold = parseInt(process.env.HAIINDEXER_CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5', 10);
  if (isNaN(cbFailureThreshold) || cbFailureThreshold <= 0 || cbFailureThreshold > 50) {
    errors.push(`HAIINDEXER_CIRCUIT_BREAKER_FAILURE_THRESHOLD must be between 1 and 50 (got: ${process.env.HAIINDEXER_CIRCUIT_BREAKER_FAILURE_THRESHOLD})`);
  }

  const cbSuccessThreshold = parseInt(process.env.HAIINDEXER_CIRCUIT_BREAKER_SUCCESS_THRESHOLD || '2', 10);
  if (isNaN(cbSuccessThreshold) || cbSuccessThreshold <= 0 || cbSuccessThreshold > 10) {
    errors.push(`HAIINDEXER_CIRCUIT_BREAKER_SUCCESS_THRESHOLD must be between 1 and 10 (got: ${process.env.HAIINDEXER_CIRCUIT_BREAKER_SUCCESS_THRESHOLD})`);
  }

  // If errors found, log and throw
  if (errors.length > 0) {
    logger.error('Configuration validation failed', { errors });
    console.error('❌ Configuration validation errors:');
    errors.forEach(error => console.error(`   - ${error}`));
    throw new Error('Configuration validation failed');
  }

  logger.info('Configuration validation passed');
}

module.exports = {
  validateConfig,
};

