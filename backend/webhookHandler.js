const messageParser = require('../services/message-parser-service/messageParser');
const haiindexerService = require('../services/haiindexer-service/haiindexerService');
const whatsappService = require('../services/whatsapp-api-service/whatsappService');
const messageNormalizer = require('../services/message-normalization-service/normalizer');
const { createLogger, createTimer } = require('../services/logging-service/logger');
const { verifySignature } = require('./middleware/signatureValidator');
const { processWithIdempotency } = require('../services/idempotency-service/idempotencyService');

const { WHATSAPP_MESSAGE_MAX_LENGTH } = whatsappService;

const { getEnvVar } = require('../services/utils/envHelper');

// Support both old and new variable names for backward compatibility
const VERIFY_TOKEN = getEnvVar('WEBHOOK_VERIFY_TOKEN', 'VERIFY_TOKEN');

/**
 * Handle WhatsApp webhook verification
 */
async function verify(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    const logger = createLogger();
    logger.info('Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
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

  // Skip non-text messages for now
  if (!messageText) {
    logger.debug('Ignoring non-text message', { message_id: messageId, type: message.type });
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
    const parsed = messageParser.parse(messageText);

    if (parsed.type === 'greeting') {
      // Send help message
      const helpText = 'Hello! Send me any question and I will search HaiIndexer for the answer.';
      await whatsappService.sendTextMessage(senderPhone, helpText);
      logger.info('Sent greeting response', { sender_phone: senderPhone });
    } else {
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
      
      // Use message splitting instead of truncation
      await whatsappService.sendTextMessageWithSplitting(senderPhone, responseText);
      
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
