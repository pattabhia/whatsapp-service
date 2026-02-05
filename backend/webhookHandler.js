const messageParser = require('../services/message-parser-service/messageParser');
const haiindexerService = require('../services/haiindexer-service/haiindexerService');
const whatsappService = require('../services/whatsapp-api-service/whatsappService');
const messageNormalizer = require('../services/message-normalization-service/normalizer');
const { createLogger, createTimer } = require('../services/logging-service/logger');
const { verifySignature } = require('./middleware/signatureValidator');
const { processWithIdempotency } = require('../services/idempotency-service/idempotencyService');
const { formatForWhatsApp } = require('../services/utils/whatsappFormatter');

const { WHATSAPP_MESSAGE_MAX_LENGTH } = whatsappService;

// Input validation limits
const MAX_INPUT_MESSAGE_LENGTH = parseInt(process.env.MAX_INPUT_MESSAGE_LENGTH || '4000', 10); // 4k characters default

// Load webhook verification token directly from environment
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

// Common placeholder values that should be rejected
const PLACEHOLDER_VALUES = [
  'your_webhook_verify_token_here',
  'your webhook verify token here',
  'WEBHOOK_VERIFY_TOKEN',
  'VERIFY_TOKEN',
  'placeholder',
  'changeme',
  'replace_me',
];

// Validate token at module load time - fail fast if missing or placeholder
const normalizedToken = VERIFY_TOKEN ? VERIFY_TOKEN.trim() : '';
if (!normalizedToken) {
  const error = new Error('WEBHOOK_VERIFY_TOKEN environment variable is required but not set or empty');
  console.error('❌ ERROR: WEBHOOK_VERIFY_TOKEN environment variable is required but not set.');
  console.error('   Please set WEBHOOK_VERIFY_TOKEN in your .env file or environment variables.');
  console.error('   This token is used for WhatsApp webhook verification.');
  throw error;
}

if (PLACEHOLDER_VALUES.some(placeholder => normalizedToken.toLowerCase() === placeholder.toLowerCase())) {
  const error = new Error(`WEBHOOK_VERIFY_TOKEN appears to be a placeholder value: "${VERIFY_TOKEN}"`);
  console.error(`❌ ERROR: WEBHOOK_VERIFY_TOKEN appears to be a placeholder value: "${VERIFY_TOKEN}"`);
  console.error('   Please set WEBHOOK_VERIFY_TOKEN to your actual webhook verification token.');
  console.error('   This token must match the value configured in Meta\'s WhatsApp Business API settings.');
  throw error;
}

// Store the validated token (use the normalized version to ensure consistency)
const VALIDATED_VERIFY_TOKEN = normalizedToken;

/**
 * Handle WhatsApp webhook verification
 */
async function verify(req, res) {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Debug logging for webhook verification
    const logger = createLogger();
    logger.debug('Webhook verification attempt', {
      mode: mode || '(not provided)',
      incoming_hub_verify_token: token || '(not provided)',
      expected_verify_token: VALIDATED_VERIFY_TOKEN,
    });

    // Verify: hub.mode === 'subscribe' AND hub.verify_token === VALIDATED_VERIFY_TOKEN
    if (mode === 'subscribe' && token === VALIDATED_VERIFY_TOKEN) {
      logger.info('Webhook verified successfully');
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  } catch (error) {
    const logger = createLogger();
    logger.error('Error in webhook verification', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

/**
 * Handle incoming WhatsApp messages
 */
async function handleMessage(req, res) {
  const timer = createTimer();
  const logger = createLogger();
  
  try {
    // Always return 200 immediately to acknowledge receipt
    res.status(200).send('OK');

    const body = req.body;

    // Validate webhook signature if raw body is available
    if (Buffer.isBuffer(req.rawBody)) {
      const signature = req.get('X-Hub-Signature-256');
      const isValid = verifySignature(req.rawBody, signature);
      if (!isValid) {
        logger.warn('Invalid webhook signature', { signature: signature ? 'present' : 'missing' });
        return; // Already sent 200, so just return
      }
    }

    // Check if this is a WhatsApp message
    if (body.object !== 'whatsapp_business_account') {
      logger.debug('Ignoring non-WhatsApp message', { object: body.object });
      return;
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Check if this is a message
    if (!value?.messages) {
      logger.debug('Ignoring non-message webhook event');
      return;
    }

    // Process all messages in the array with idempotency
    const messages = value.messages || [];
    
    for (const message of messages) {
      const messageId = message.id;
      
      // Process with idempotency check
      const result = await processWithIdempotency(messageId, async () => {
        return await processMessage(message, value, logger);
      });
      
      if (result.isDuplicate) {
        logger.info('Skipped duplicate message', { message_id: messageId });
      }
    }
  } catch (error) {
    const latencyMs = timer.elapsedMs();
    logger.error('Error handling webhook message', error, { latency_ms: latencyMs });
    
    // Ensure response was sent (should already be sent, but double-check)
    if (!res.headersSent) {
      res.status(200).send('OK');
    }
    
    // Try to send error message to user if we have sender info
    try {
      const body = req.body;
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];
      
      if (message?.from) {
        await whatsappService.sendTextMessage(
          message.from,
          'Sorry, I encountered an error processing your message. Please try again later.'
        );
      }
    } catch (errorMsgError) {
      logger.error('Failed to send error message to user', errorMsgError);
    }
  }
}

/**
 * Process a single WhatsApp message
 * @param {object} message - WhatsApp message object
 * @param {object} value - Webhook value object
 * @param {object} logger - Logger instance
 */
async function processMessage(message, value, logger) {
  const messageTimer = createTimer();
  const senderPhone = message.from;
  const messageText = message.text?.body || '';
  const messageId = message.id;

  logger.webhookEvent('message_received', {
    message_id: messageId,
    sender_phone: senderPhone,
    message_length: messageText.length,
  });

  // Strict validation: Only process text messages with valid text body
  // Ensure message type is "text" and message.text.body exists
  if (message.type !== 'text' || !message.text || !messageText || messageText.trim().length === 0) {
    logger.debug('Ignoring non-text or empty message', {
      message_id: messageId,
      type: message.type,
      has_text: !!message.text,
      has_body: !!messageText
    });

    // Send user-friendly feedback for non-text messages
    if (message.type !== 'text' && message.type) {
      try {
        const messageTypeMap = {
          'image': 'images',
          'audio': 'audio messages',
          'video': 'videos',
          'document': 'documents',
          'sticker': 'stickers',
          'location': 'location messages',
          'contacts': 'contact cards',
        };
        const messageTypeName = messageTypeMap[message.type] || 'this type of message';
        await whatsappService.sendTextMessage(
          senderPhone,
          `I can only process text messages. I cannot handle ${messageTypeName} yet. Please send your question as text.`
        );
        logger.info('Sent non-text message feedback', {
          sender_phone: senderPhone,
          message_type: message.type
        });
      } catch (feedbackError) {
        logger.warn('Failed to send non-text message feedback', feedbackError);
      }
    }

    return;
  }

  // Validate message length (prevent very long messages from reaching HaiIndexer)
  const trimmedText = messageText.trim();
  if (trimmedText.length > MAX_INPUT_MESSAGE_LENGTH) {
    logger.warn('Message exceeds maximum length', {
      message_id: messageId,
      sender_phone: senderPhone,
      message_length: trimmedText.length,
      max_length: MAX_INPUT_MESSAGE_LENGTH,
    });

    try {
      await whatsappService.sendTextMessage(
        senderPhone,
        `Your message is too long (${trimmedText.length} characters). Please keep your questions under ${MAX_INPUT_MESSAGE_LENGTH} characters and try again.`
      );
      logger.info('Sent message too long feedback', { sender_phone: senderPhone });
    } catch (feedbackError) {
      logger.warn('Failed to send message too long feedback', feedbackError);
    }

    return;
  }

  try {
    // Normalize the message
    const normalizedQuery = messageNormalizer.normalizeMessage(message, value);
    
    logger.info('Message normalized', {
      user_id: normalizedQuery.user_id,
      message_id: normalizedQuery.metadata.message_id,
    });

    // Parse message type (greeting vs query)
    // Only parse if we have a valid text message
    const parsed = messageParser.parse(messageText);

    // Send greeting ONLY if explicitly detected as greeting
    if (parsed.type === 'greeting') {
      // Send help message
      const helpText = 'Hello! Send me any question and I will search HaiIndexer for the answer.';
      await whatsappService.sendTextMessage(senderPhone, helpText);
      logger.info('Sent greeting response', { sender_phone: senderPhone });
    } else {
      // Send wait message before querying HaiIndexer
      try {
        await whatsappService.sendTextMessage(senderPhone, 'Haiindexer is thinking...');
      } catch (waitMessageError) {
        // Log but don't block if wait message fails
        logger.warn('Failed to send wait message', waitMessageError, { sender_phone: senderPhone });
      }
      
      // Forward normalized query to HaiIndexer
      const apiTimer = createTimer();
      logger.apiRequest('HaiIndexer', 'POST', '/api/ui/query', {
        user_id: normalizedQuery.user_id,
        message_id: normalizedQuery.metadata.message_id,
      });
      
      const response = await haiindexerService.queryHaiIndexer(normalizedQuery);
      const apiLatency = apiTimer.elapsedMs();
      
      logger.apiResponse('HaiIndexer', 200, apiLatency, {
        user_id: normalizedQuery.user_id,
        response_length: response.answer?.length || 0,
      });

      // Send response back to user (with message splitting if enabled)
      const responseText = response.answer || '';
      
      // Format response for WhatsApp safety
      const formattedResponse = formatForWhatsApp(responseText);
      
      // Use message splitting instead of truncation
      await whatsappService.sendTextMessageWithSplitting(senderPhone, formattedResponse);
      
      logger.info('Sent HaiIndexer response to user', {
        sender_phone: senderPhone,
        response_length: responseText.length,
      });
    }

    const totalLatency = messageTimer.elapsedMs();
    logger.info('Message processed successfully', {
      message_id: messageId,
      latency_ms: totalLatency,
    });
  } catch (error) {
    logger.error('Error processing message', error, {
      message_id: messageId,
      sender_phone: senderPhone,
    });
    
    // Send user-friendly error message
    try {
      await whatsappService.sendTextMessage(
        senderPhone,
        'Sorry, I encountered an error processing your message. Please try again later.'
      );
    } catch (sendError) {
      logger.error('Failed to send error message to user', sendError);
    }
  }
}

module.exports = {
  verify,
  handleMessage,
};
