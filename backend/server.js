// Load environment variables from .env file (for local development)
// Vercel and other platforms inject env vars automatically, so this is optional
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  try {
    require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
  } catch (error) {
    // dotenv is optional - continue without it if not installed
  }
}

// Validate critical environment variables before requiring modules that depend on them
// Check WEBHOOK_VERIFY_TOKEN (supports both WEBHOOK_VERIFY_TOKEN and legacy VERIFY_TOKEN)
const webhookVerifyToken = process.env.WEBHOOK_VERIFY_TOKEN || process.env.VERIFY_TOKEN;
if (!webhookVerifyToken || webhookVerifyToken.trim() === '') {
  console.error('❌ ERROR: WEBHOOK_VERIFY_TOKEN environment variable is required but not set.');
  console.error('   Checked for: WEBHOOK_VERIFY_TOKEN or VERIFY_TOKEN');
  console.error('   Please set WEBHOOK_VERIFY_TOKEN in your .env file or environment variables.');
  console.error('   This token is used for WhatsApp webhook verification.');
  process.exit(1);
}

const express = require('express');
const webhookHandler = require('./webhookHandler');
const healthChecks = require('./health');
// Use Redis-based rate limiter if Redis is available, otherwise fall back to in-memory
const { webhookRateLimiter, perPhoneNumberRateLimiter } = require('./middleware/rateLimiterRedis');

const app = express();

// Trust proxy for accurate IP addresses (important for rate limiting)
app.set('trust proxy', 1);

// Middleware
// Only parse URL-encoded bodies for POST requests (not needed for GET)
app.use(express.urlencoded({ extended: true, type: 'application/x-www-form-urlencoded' }));

// Health check endpoints
app.get('/', (req, res) => {
  try {
    res.json({ status: 'ok', service: 'whatsapp-middleware' });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Simple reminder route
app.get('/reminder', (req, res) => {
  try {
    res.status(200).send('OK');
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Kubernetes-style health checks
// Define /live first with minimal error handling
app.get('/live', (req, res) => {
  try {
    res.status(200).json({
      status: 'alive',
      service: 'whatsapp-middleware',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // If JSON fails, send plain text
    if (!res.headersSent) {
      res.status(200).send('alive');
    }
  }
});

app.get('/health', healthChecks.health);
app.get('/ready', healthChecks.readiness);

// WhatsApp webhook endpoints with rate limiting
app.get('/webhook', webhookRateLimiter, webhookHandler.verify);

// For webhook POST, we need raw body for signature verification
// Parse JSON after storing raw body
// Apply both IP-based and phone-number-based rate limiting
app.post('/webhook', webhookRateLimiter, express.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    // Store raw body for signature verification
    req.rawBody = req.body;
    // Parse JSON body for processing
    try {
      if (!req.body || !Buffer.isBuffer(req.body)) {
        if (!res.headersSent) {
          return res.status(400).json({ error: 'Invalid request body' });
        }
        return;
      }
      req.body = JSON.parse(req.body.toString());
    } catch (error) {
      if (!res.headersSent) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }
      return;
    }
    next();
  } catch (error) {
    // Log error for debugging
    try {
      const { createLogger } = require('../services/logging-service/logger');
      const logger = createLogger();
      logger.error('Error in webhook POST middleware', error);
    } catch (loggerError) {
      console.error('Error in webhook POST middleware:', error);
    }
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}, perPhoneNumberRateLimiter, webhookHandler.handleMessage);

// JSON parser for other routes (if any)
app.use(express.json());

// Global error handler middleware (must be last)
app.use((err, req, res, next) => {
  try {
    const { createLogger } = require('../services/logging-service/logger');
    const logger = createLogger();
    logger.error('Unhandled Express error', err, {
      path: req.path,
      method: req.method,
    });
  } catch (loggerError) {
    // Fallback to console if logger fails
    console.error('Unhandled Express error (logger failed):', err);
    console.error('Request path:', req.path, 'Method:', req.method);
  }
  
  // Don't send error response if headers already sent
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 404 handler
app.use((req, res) => {
  try {
    res.status(404).json({ error: 'Not found' });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Export for Vercel
module.exports = app;

// Run server locally if not in Vercel
if (require.main === module) {
  // Global error handlers to prevent server crashes
  process.on('uncaughtException', (error) => {
    try {
      const { createLogger } = require('../services/logging-service/logger');
      const logger = createLogger();
      logger.error('Uncaught exception - server will continue running', error);
    } catch (loggerError) {
      // Fallback to console if logger fails
      console.error('Uncaught exception (logger failed):', error);
      console.error('Logger error:', loggerError);
    }
    // Don't exit - log and continue
    console.error('Uncaught exception:', error);
  });

  process.on('unhandledRejection', (reason, promise) => {
    try {
      const { createLogger } = require('../services/logging-service/logger');
      const logger = createLogger();
      logger.error('Unhandled promise rejection - server will continue running', {
        reason: reason instanceof Error ? reason : String(reason),
        promise: promise,
      });
    } catch (loggerError) {
      // Fallback to console if logger fails
      console.error('Unhandled promise rejection (logger failed):', reason);
      console.error('Logger error:', loggerError);
    }
    // Don't exit - log and continue
    console.error('Unhandled promise rejection:', reason);
  });

  // Validate environment variables
  require('./test-setup').validateEnv();
  
  // Validate configuration values
  try {
    require('./config-validator').validateConfig();
  } catch (error) {
    console.error('Configuration validation failed:', error.message);
    process.exit(1);
  }
  
  const PORT = process.env.PORT || 3000;
  let server;
  
  try {
    server = app.listen(PORT, () => {
      const { createLogger } = require('../services/logging-service/logger');
      const logger = createLogger();
      logger.info('WhatsApp middleware server started', { port: PORT });
      console.log(`WhatsApp middleware running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }

  // Handle server errors (e.g., port already in use, connection errors)
  server.on('error', (error) => {
    const currentPort = PORT; // Capture PORT in closure to avoid scope issues
    try {
      const { createLogger } = require('../services/logging-service/logger');
      const logger = createLogger();
      logger.error('Server error occurred', error, { port: currentPort });
    } catch (loggerError) {
      // Fallback to console if logger fails
      console.error('Server error (logger failed):', error);
    }
    console.error('Server error:', error);
    
    // Only exit if it's a critical error like port already in use
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${currentPort} is already in use. Please use a different port.`);
      process.exit(1);
    }
    // For other errors, log but continue running
  });

  // Graceful shutdown handlers
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    if (server) {
      server.close(() => {
        const { closeRedisClient } = require('../services/redis-service/redisClient');
        closeRedisClient()
          .then(() => {
            console.log('Server closed');
            process.exit(0);
          })
          .catch((error) => {
            console.error('Error closing Redis client:', error);
            process.exit(0); // Exit anyway
          });
      });
    } else {
      process.exit(0);
    }
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...');
    if (server) {
      server.close(() => {
        const { closeRedisClient } = require('../services/redis-service/redisClient');
        closeRedisClient()
          .then(() => {
            console.log('Server closed');
            process.exit(0);
          })
          .catch((error) => {
            console.error('Error closing Redis client:', error);
            process.exit(0); // Exit anyway
          });
      });
    } else {
      process.exit(0);
    }
  });
}

