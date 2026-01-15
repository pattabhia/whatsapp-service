/**
 * Parse incoming WhatsApp messages
 * Detects greetings vs queries
 */

const GREETING_PATTERNS = [
  /^hi\s*$/i,
  /^hello\s*$/i,
  /^hey\s*$/i,
  /^start\s*$/i,
];

/**
 * Parse a message and determine if it's a greeting or query
 * @param {string} text - The message text
 * @returns {{type: 'greeting' | 'query', text: string}}
 */
function parse(text) {
  const trimmed = text.trim();

  // Check if it matches any greeting pattern
  const isGreeting = GREETING_PATTERNS.some(pattern => pattern.test(trimmed));

  if (isGreeting) {
    return {
      type: 'greeting',
      text: trimmed,
    };
  }

  // Everything else is a query
  return {
    type: 'query',
    text: trimmed,
  };
}

module.exports = {
  parse,
};

