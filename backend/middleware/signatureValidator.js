/**
 * Webhook Signature Validation Middleware
 * Validates X-Hub-Signature-256 header to ensure requests come from WhatsApp
 */

const crypto = require('crypto');

const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

/**
 * Verify WhatsApp webhook signature
 * @param {Buffer} rawBody - Raw request body as buffer
 * @param {string} signature - X-Hub-Signature-256 header value
 * @returns {boolean} True if signature is valid
 */
function verifySignature(rawBody, signature) {
  if (!APP_SECRET) {
    // If APP_SECRET is not set, skip validation (for development)
    // In production, this should be required
    console.warn('WARNING: WHATSAPP_APP_SECRET not set, skipping signature validation');
    return true; // Allow in development, but log warning
  }
  
  if (!signature) {
    return false;
  }
  
  // Remove 'sha256=' prefix if present
  const signatureHash = signature.replace('sha256=', '');
  
  // Calculate expected signature
  const hash = crypto
    .createHmac('sha256', APP_SECRET)
    .update(rawBody)
    .digest('hex');
  
  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHash, 'hex'),
      Buffer.from(hash, 'hex')
    );
  } catch (error) {
    return false;
  }
}

/**
 * Express middleware to validate webhook signature
 * Must be used with raw body parser (before JSON parser)
 */
function signatureValidationMiddleware(req, res, next) {
  // Skip validation for GET requests (webhook verification)
  if (req.method === 'GET') {
    return next();
  }
  
  const signature = req.get('X-Hub-Signature-256');
  
  // Get raw body (should be available as Buffer if using raw body parser)
  const rawBody = req.body;
  
  // If body is already parsed as JSON, we need to use the raw buffer
  // This middleware should be used with express.raw() for POST /webhook
  if (Buffer.isBuffer(req.rawBody)) {
    const isValid = verifySignature(req.rawBody, signature);
    if (!isValid) {
      return res.status(403).json({ error: 'Invalid signature' });
    }
  } else if (typeof rawBody === 'object' && !Buffer.isBuffer(rawBody)) {
    // Body was already parsed - this is a limitation
    // In production, use express.raw() middleware for webhook endpoint
    // For now, log warning but allow (for backward compatibility)
    console.warn('WARNING: Request body already parsed, cannot verify signature. Use express.raw() for webhook endpoint.');
  }
  
  next();
}

module.exports = {
  verifySignature,
  signatureValidationMiddleware,
};

