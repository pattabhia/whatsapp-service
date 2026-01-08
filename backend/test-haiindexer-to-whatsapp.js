/**
 * Test Script: Send Message from HaiIndexer to WhatsApp
 * 
 * This script demonstrates the full flow of:
 * 1. Sending a query to HaiIndexer
 * 2. Receiving the response
 * 3. Sending it to WhatsApp
 * 
 * Usage:
 *   node backend/test-haiindexer-to-whatsapp.js <phone_number> <query>
 * 
 * Example:
 *   node backend/test-haiindexer-to-whatsapp.js 919876543210 "What is machine learning?"
 */

// Load environment variables
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
  } catch (error) {
    // dotenv is optional
  }
}

const haiindexerService = require('../services/haiindexer-service/haiindexerService');
const whatsappService = require('../services/whatsapp-api-service/whatsappService');
const { createLogger } = require('../services/logging-service/logger');

const logger = createLogger();

// Get command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('❌ Usage: node backend/test-haiindexer-to-whatsapp.js <phone_number> <query>');
  console.error('');
  console.error('Example:');
  console.error('  node backend/test-haiindexer-to-whatsapp.js 919876543210 "What is machine learning?"');
  process.exit(1);
}

const phoneNumber = args[0];
const query = args.slice(1).join(' ');

// Validate phone number format (basic check)
if (!/^\d{10,15}$/.test(phoneNumber.replace(/^\+/, ''))) {
  console.error(`❌ Invalid phone number format: ${phoneNumber}`);
  console.error('   Phone number should be 10-15 digits (with or without country code)');
  process.exit(1);
}

// Remove leading + if present (WhatsApp API expects numbers without +)
const normalizedPhoneNumber = phoneNumber.replace(/^\+/, '');

async function testHaiIndexerToWhatsApp() {
  console.log('\n🧪 Testing HaiIndexer → WhatsApp Flow\n');
  console.log('=' .repeat(60));
  console.log(`📱 Phone Number: ${normalizedPhoneNumber}`);
  console.log(`💬 Query: "${query}"`);
  console.log('=' .repeat(60));
  console.log('');

  try {
    // Step 1: Create normalized query (simulating WhatsApp message)
    console.log('📝 Step 1: Creating normalized query...');
    const normalizedQuery = {
      user_id: `whatsapp:+${normalizedPhoneNumber}`,
      channel: 'whatsapp',
      message: query,
      timestamp: new Date().toISOString(),
      conversation_id: `whatsapp-${normalizedPhoneNumber}`,
      metadata: {
        message_id: `test-${Date.now()}`,
        language: 'en',
        phone_number: normalizedPhoneNumber,
        wa_id: normalizedPhoneNumber,
      },
    };

    console.log('   ✅ Normalized query created');
    console.log(`   User ID: ${normalizedQuery.user_id}`);
    console.log(`   Conversation ID: ${normalizedQuery.conversation_id}`);
    console.log('');

    // Step 2: Query HaiIndexer
    console.log('🧠 Step 2: Sending query to HaiIndexer...');
    console.log(`   API URL: ${process.env.HAIINDEXER_API_URL || 'Not configured'}`);
    console.log(`   Query: "${query}"`);
    console.log('');

    const startTime = Date.now();
    const response = await haiindexerService.queryHaiIndexer(normalizedQuery);
    const duration = Date.now() - startTime;

    if (!response || !response.answer) {
      throw new Error('HaiIndexer returned invalid response (no answer field)');
    }

    console.log('   ✅ HaiIndexer response received');
    console.log(`   Response length: ${response.answer.length} characters`);
    console.log(`   Duration: ${duration}ms`);
    console.log('');
    console.log('📄 HaiIndexer Response:');
    console.log('-'.repeat(60));
    console.log(response.answer);
    console.log('-'.repeat(60));
    console.log('');

    // Step 3: Check circuit breaker state
    const circuitState = haiindexerService.getCircuitBreakerState();
    console.log('⚡ Circuit Breaker State:');
    console.log(`   State: ${circuitState.state}`);
    console.log(`   Failures: ${circuitState.failureCount}`);
    console.log(`   Successes: ${circuitState.successCount}`);
    console.log('');

    // Step 4: Send to WhatsApp
    console.log('📤 Step 3: Sending response to WhatsApp...');
    console.log(`   Recipient: ${normalizedPhoneNumber}`);
    console.log(`   Message length: ${response.answer.length} characters`);
    
    if (response.answer.length > whatsappService.WHATSAPP_MESSAGE_MAX_LENGTH) {
      console.log('   ℹ️  Message will be split into multiple parts');
    }
    console.log('');

    const whatsappStartTime = Date.now();
    await whatsappService.sendTextMessageWithSplitting(normalizedPhoneNumber, response.answer);
    const whatsappDuration = Date.now() - whatsappStartTime;

    console.log('   ✅ Message sent to WhatsApp successfully');
    console.log(`   Duration: ${whatsappDuration}ms`);
    console.log('');

    // Summary
    console.log('=' .repeat(60));
    console.log('✅ SUCCESS: Full flow completed');
    console.log('=' .repeat(60));
    console.log(`⏱️  Total HaiIndexer processing time: ${duration}ms`);
    console.log(`⏱️  Total WhatsApp delivery time: ${whatsappDuration}ms`);
    console.log(`⏱️  Total time: ${duration + whatsappDuration}ms`);
    console.log('');
    console.log(`📱 Check WhatsApp number ${normalizedPhoneNumber} for the response`);
    console.log('');

  } catch (error) {
    console.error('\n❌ ERROR: Test failed\n');
    console.error('Error details:');
    console.error('-'.repeat(60));
    console.error(`Message: ${error.message}`);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    console.error('-'.repeat(60));
    console.error('');

    // Check for common issues
    if (error.message.includes('HAIINDEXER_API_URL')) {
      console.error('💡 Tip: Make sure HAIINDEXER_API_URL is set in your .env file');
    }
    if (error.message.includes('WhatsApp credentials')) {
      console.error('💡 Tip: Make sure WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set');
    }
    if (error.message.includes('not configured')) {
      console.error('💡 Tip: Check your environment variables using: node backend/test-setup.js');
    }

    logger.error('Test failed', error, {
      phone_number: normalizedPhoneNumber,
      query: query,
    });

    process.exit(1);
  }
}

// Run the test
testHaiIndexerToWhatsApp()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });

