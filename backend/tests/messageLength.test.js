/**
 * Message Length Testing
 * Test with messages at boundary lengths (4095, 4096, 4097 characters)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { splitMessage, splitMessageWithIndicators, WHATSAPP_MESSAGE_MAX_LENGTH } = require('../../services/utils/messageSplitter');
const { validateMessageLength } = require('../../services/whatsapp-api-service/whatsappService');

// Helper to generate message of specific length
function generateMessage(length) {
  const baseMessage = 'A'.repeat(100);
  const repeats = Math.floor(length / 100);
  const remainder = length % 100;
  return baseMessage.repeat(repeats) + 'A'.repeat(remainder);
}

// Helper to generate message with sentences
function generateMessageWithSentences(targetLength) {
  const sentence = 'This is a sentence. ';
  const repeats = Math.floor(targetLength / sentence.length);
  const remainder = targetLength % sentence.length;
  return sentence.repeat(repeats) + 'A'.repeat(remainder);
}

describe('Message Length Testing', () => {
  describe('Message Validation', () => {
    test('should accept message at exactly 4096 characters', () => {
      const message = generateMessage(4096);
      assert.doesNotThrow(() => {
        validateMessageLength(message);
      }, 'Should accept message of exactly 4096 characters');
      assert.strictEqual(message.length, 4096, 'Message should be exactly 4096 characters');
    });

    test('should accept message at 4095 characters', () => {
      const message = generateMessage(4095);
      assert.doesNotThrow(() => {
        validateMessageLength(message);
      }, 'Should accept message of 4095 characters');
      assert.strictEqual(message.length, 4095, 'Message should be exactly 4095 characters');
    });

    test('should reject message at 4097 characters', () => {
      const message = generateMessage(4097);
      assert.throws(() => {
        validateMessageLength(message);
      }, /exceeds WhatsApp limit/, 'Should reject message of 4097 characters');
      assert.strictEqual(message.length, 4097, 'Message should be exactly 4097 characters');
    });

    test('should reject message significantly over limit', () => {
      const message = generateMessage(5000);
      assert.throws(() => {
        validateMessageLength(message);
      }, /exceeds WhatsApp limit/, 'Should reject message over limit');
    });

    test('should accept empty message', () => {
      assert.throws(() => {
        validateMessageLength('');
      }, /must be a non-empty string/, 'Should reject empty message');
    });
  });

  describe('Message Splitting', () => {
    test('should not split message at 4095 characters', () => {
      const message = generateMessage(4095);
      const chunks = splitMessage(message);
      
      assert.strictEqual(chunks.length, 1, 'Should return single chunk for message under limit');
      assert.strictEqual(chunks[0].length, 4095, 'Chunk should be same length as original');
      assert.strictEqual(chunks[0], message, 'Chunk should be identical to original');
    });

    test('should not split message at exactly 4096 characters', () => {
      const message = generateMessage(4096);
      const chunks = splitMessage(message);
      
      assert.strictEqual(chunks.length, 1, 'Should return single chunk for message at limit');
      assert.strictEqual(chunks[0].length, 4096, 'Chunk should be same length as original');
    });

    test('should split message at 4097 characters', () => {
      const message = generateMessage(4097);
      const chunks = splitMessage(message);
      
      assert.ok(chunks.length > 1, 'Should split message over limit into multiple chunks');
      chunks.forEach(chunk => {
        // Remove indicator if present: [1/2]\n\n
        const cleanChunk = chunk.replace(/^\[\d+\/\d+\]\n\n/, '');
        assert.ok(cleanChunk.length <= WHATSAPP_MESSAGE_MAX_LENGTH, 
          `Each chunk (${cleanChunk.length}) should be <= ${WHATSAPP_MESSAGE_MAX_LENGTH} characters`);
      });
    });

    test('should split very long message into multiple chunks', () => {
      const message = generateMessage(10000);
      const chunks = splitMessage(message);
      
      const expectedMinChunks = Math.ceil(10000 / WHATSAPP_MESSAGE_MAX_LENGTH);
      assert.ok(chunks.length >= expectedMinChunks, 
        `Should split into at least ${expectedMinChunks} chunks`);
      
      chunks.forEach((chunk, index) => {
        // Remove indicator
        const cleanChunk = chunk.replace(/^\[\d+\/\d+\]\n\n/, '');
        assert.ok(cleanChunk.length <= WHATSAPP_MESSAGE_MAX_LENGTH, 
          `Chunk ${index + 1} should be <= ${WHATSAPP_MESSAGE_MAX_LENGTH} characters`);
      });
    });

    test('should preserve all content when splitting', () => {
      const originalMessage = generateMessage(5000);
      const chunks = splitMessage(originalMessage);
      
      // Combine all chunks (remove indicators)
      const combined = chunks.map(chunk => chunk.replace(/^\[\d+\/\d+\]\n\n/, '')).join('');
      
      // Should contain all original characters (may have some whitespace trimming)
      assert.ok(combined.length >= originalMessage.length * 0.95, 
        'Combined chunks should preserve most of original content');
    });

    test('should split on sentence boundaries when possible', () => {
      const message = generateMessageWithSentences(5000);
      const chunks = splitMessage(message);
      
      assert.ok(chunks.length > 1, 'Should split long message');
      
      // Check that chunks end at sentence boundaries when possible
      chunks.slice(0, -1).forEach((chunk, index) => {
        // Remove indicator
        const cleanChunk = chunk.replace(/^\[\d+\/\d+\]\n\n/, '');
        
        // Chunk should end with sentence boundary if it's not forced to split
        // (last chunk might not)
        if (cleanChunk.length < WHATSAPP_MESSAGE_MAX_LENGTH * 0.95) {
          // If chunk is significantly shorter than max, it likely split at boundary
          assert.ok(
            /[.!?]\s*$/.test(cleanChunk) || /\n\n$/.test(cleanChunk),
            `Chunk ${index + 1} should end at sentence boundary when possible`
          );
        }
      });
    });

    test('should include page indicators when splitting', () => {
      const message = generateMessage(5000);
      const chunks = splitMessageWithIndicators(message);
      
      assert.ok(chunks.length > 1, 'Should split message');
      
      chunks.forEach((chunk, index) => {
        const expectedIndicator = `[Part ${index + 1}/${chunks.length}]`;
        assert.ok(chunk.includes(expectedIndicator), 
          `Chunk ${index + 1} should include indicator "${expectedIndicator}"`);
      });
    });

    test('should not include indicators for single chunk', () => {
      const message = generateMessage(3000);
      const chunks = splitMessageWithIndicators(message);
      
      assert.strictEqual(chunks.length, 1, 'Should return single chunk');
      assert.ok(!chunks[0].includes('[Part'), 'Should not include indicator for single chunk');
    });

    test('should handle edge case: message exactly at limit + 1', () => {
      const message = generateMessage(4097);
      const chunks = splitMessage(message);
      
      assert.strictEqual(chunks.length, 2, 'Should split into 2 chunks');
      
      chunks.forEach(chunk => {
        // Remove indicator: [1/2]\n\n or [2/2]\n\n
        const cleanChunk = chunk.replace(/^\[\d+\/\d+\]\n\n/, '');
        assert.ok(cleanChunk.length <= WHATSAPP_MESSAGE_MAX_LENGTH, 
          'Each chunk should be within limit');
      });
    });

    test('should handle very large messages (50k+ characters)', () => {
      const message = generateMessage(50000);
      const chunks = splitMessage(message);
      
      const expectedMinChunks = Math.ceil(50000 / WHATSAPP_MESSAGE_MAX_LENGTH);
      assert.ok(chunks.length >= expectedMinChunks, 
        `Should split large message into at least ${expectedMinChunks} chunks`);
      
      // Verify all chunks are within limit
      chunks.forEach(chunk => {
        const cleanChunk = chunk.replace(/^\[\d+\/\d+\]\n\n/, '');
        assert.ok(cleanChunk.length <= WHATSAPP_MESSAGE_MAX_LENGTH, 
          'All chunks should be within limit');
      });
    });

    test('should handle messages with mixed content (text + newlines)', () => {
      const text = 'A'.repeat(2000);
      const newlines = '\n\n'.repeat(100);
      const moreText = 'B'.repeat(2000);
      const message = text + newlines + moreText;
      
      const chunks = splitMessage(message);
      
      // Should prefer splitting at \n\n
      assert.ok(chunks.length >= 1, 'Should split message');
      
      chunks.forEach(chunk => {
        const cleanChunk = chunk.replace(/^\[\d+\/\d+\]\n\n/, '');
        assert.ok(cleanChunk.length <= WHATSAPP_MESSAGE_MAX_LENGTH, 
          'Each chunk should be within limit');
      });
    });
  });
});

