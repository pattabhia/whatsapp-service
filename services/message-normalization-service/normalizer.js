/**
 * Message Normalization Service
 * Converts WhatsApp-specific payloads into clean, normalized query objects
 */

/**
 * Normalize WhatsApp message into standardized format
 * @param {object} message - WhatsApp message object
 * @param {object} value - Webhook value object containing contacts and other metadata
 * @returns {object} Normalized query object
 */
function normalizeMessage(message, value = {}) {
  if (!message) {
    throw new Error('Invalid WhatsApp message: message is required');
  }

  const senderPhone = message.from;
  const messageText = message.text?.body || '';
  const messageId = message.id;
  const timestamp = message.timestamp ? new Date(parseInt(message.timestamp) * 1000).toISOString() : new Date().toISOString();
  
  // Format user_id as whatsapp:+{phone}
  const userId = `whatsapp:+${senderPhone}`;
  
  // Detect language (basic detection, can be enhanced)
  const language = detectLanguage(messageText);
  
  // Get contact info if available
  const contact = value?.contacts?.[0];
  const waId = contact?.wa_id || senderPhone;
  
  // Create normalized query object
  const normalized = {
    user_id: userId,
    channel: 'whatsapp',
    message: messageText,
    timestamp: timestamp,
    metadata: {
      message_id: messageId,
      language: language,
      phone_number: senderPhone,
      wa_id: waId,
      contact_name: contact?.profile?.name,
    },
  };
  
  return normalized;
}

/**
 * Basic language detection (can be enhanced with a proper library)
 * @param {string} text - Message text
 * @returns {string} Language code (default: 'en')
 */
function detectLanguage(text) {
  // Very basic detection - in production, use a proper language detection library
  // For now, default to 'en' or detect common patterns
  if (!text || text.length === 0) {
    return 'en';
  }
  
  // This is a placeholder - in production, use a library like 'franc' or similar
  return 'en';
}

/**
 * Extract conversation/session identifier from WhatsApp payload
 * @param {object} whatsappPayload - Raw WhatsApp webhook payload
 * @returns {string} Session identifier
 */
function extractSessionId(whatsappPayload) {
  const entry = whatsappPayload.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const message = value?.messages?.[0];
  
  // Use phone number as session ID for now
  // Can be enhanced to use conversation context if available
  return message?.from || 'unknown';
}

module.exports = {
  normalizeMessage,
  extractSessionId,
  detectLanguage,
};

