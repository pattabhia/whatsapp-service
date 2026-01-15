/**
 * WhatsApp Message Formatter Utility
 * Formats text to be safe for WhatsApp by removing unsupported markdown
 * and ensuring content fits within WhatsApp limits
 */

const WHATSAPP_MAX_SAFE_LENGTH = 4000;

/**
 * Format text for WhatsApp by removing unsupported markdown and ensuring safe length
 * @param {string|any} text - Text to format
 * @returns {string} Formatted text safe for WhatsApp
 */
function formatForWhatsApp(text) {
  // Convert input to string
  let formatted = String(text || '');
  
  // Trim leading/trailing whitespace
  formatted = formatted.trim();
  
  // Remove unsupported markdown characters:
  // ### (headers), ** (bold), __ (underline/italic), `` (code), <>, [] (brackets)
  
  // Remove markdown headers (###, ##, #)
  formatted = formatted.replace(/^#{1,3}\s+/gm, '');
  
  // Remove bold markdown (**text** or __text__)
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '$1');
  formatted = formatted.replace(/__(.*?)__/g, '$1');
  
  // Remove inline code (``text``)
  formatted = formatted.replace(/``(.*?)``/g, '$1');
  formatted = formatted.replace(/`(.*?)`/g, '$1');
  
  // Remove angle brackets (<text>)
  formatted = formatted.replace(/<([^>]*)>/g, '$1');
  
  // Remove square brackets ([text])
  formatted = formatted.replace(/\[([^\]]*)\]/g, '$1');
  
  // Preserve line breaks (they are already preserved as \n)
  // No need to modify line breaks
  
  // Truncate to max 4000 characters
  if (formatted.length > WHATSAPP_MAX_SAFE_LENGTH) {
    formatted = formatted.substring(0, WHATSAPP_MAX_SAFE_LENGTH);
  }
  
  return formatted;
}

module.exports = {
  formatForWhatsApp,
  WHATSAPP_MAX_SAFE_LENGTH,
};

