/**
 * Health check endpoints
 * Provides liveness and readiness probes for Kubernetes/orchestration
 */

const { getRedisClient, isRedisAvailable } = require('../services/redis-service/redisClient');
const { getCircuitBreakerState } = require('../services/haiindexer-service/haiindexerService');
const { createLogger } = require('../services/logging-service/logger');

const logger = createLogger();

/**
 * Liveness probe - checks if service is running
 * Returns 200 if service is alive
 */
function liveness(req, res) {
  try {
    res.json({
      status: 'alive',
      service: 'whatsapp-middleware',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error in liveness check', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

/**
 * Readiness probe - checks if service is ready to handle requests
 * Checks Redis connectivity and critical dependencies
 */
async function readiness(req, res) {
  try {
    const checks = {
      service: 'whatsapp-middleware',
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: {},
    };

    let overallHealthy = true;

    // Check Redis (optional but recommended)
    try {
      const redisAvailable = isRedisAvailable();
      checks.checks.redis = {
        status: redisAvailable ? 'connected' : 'not_configured',
        available: redisAvailable,
      };
      // Redis is optional, so not a failure condition
    } catch (error) {
      checks.checks.redis = {
        status: 'error',
        error: error.message,
      };
      // Redis errors don't fail readiness (has fallback)
    }

    // Check circuit breaker state
    try {
      const circuitState = getCircuitBreakerState();
      const isCircuitOpen = circuitState.state === 'OPEN';
      checks.checks.circuit_breaker = {
        status: circuitState.state,
        failure_count: circuitState.failureCount,
        healthy: !isCircuitOpen,
      };
      
      // If circuit is open, mark as degraded but still ready
      if (isCircuitOpen) {
        checks.status = 'degraded';
      }
    } catch (error) {
      checks.checks.circuit_breaker = {
        status: 'error',
        error: error.message,
      };
      overallHealthy = false;
    }

    // Check environment variables
    const requiredEnvVars = [
      'WHATSAPP_API_TOKEN',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WEBHOOK_VERIFY_TOKEN',
      'HAIINDEXER_API_URL',
    ];
    
    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
    checks.checks.environment = {
      status: missingEnvVars.length === 0 ? 'ok' : 'missing_vars',
      missing_vars: missingEnvVars,
      healthy: missingEnvVars.length === 0,
    };
    
    if (missingEnvVars.length > 0) {
      overallHealthy = false;
      checks.status = 'not_ready';
    }

    // Determine HTTP status
    const statusCode = overallHealthy ? (checks.status === 'degraded' ? 200 : 200) : 503;
    
    res.status(statusCode).json(checks);
  } catch (error) {
    logger.error('Error in readiness check', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

/**
 * Health check endpoint - simple status check
 */
async function health(req, res) {
  try {
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    logger.error('Error in health check', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = {
  liveness,
  readiness,
  health,
};

