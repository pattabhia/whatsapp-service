/**
 * Validate required environment variables
 * Print clear errors if missing
 */

const { getEnvVar } = require('../services/utils/envHelper');

// Check for required variables (supports both old and new names)
const requiredVarMappings = [
  { new: 'WHATSAPP_API_TOKEN', old: 'WHATSAPP_TOKEN' },
  { new: 'WHATSAPP_PHONE_NUMBER_ID', old: 'PHONE_NUMBER_ID' },
  { new: 'WEBHOOK_VERIFY_TOKEN', old: 'VERIFY_TOKEN' },
  { new: 'HAIINDEXER_API_URL', old: null }, // No old name for this
];

const requiredVars = requiredVarMappings.map(m => m.new);

// Optional but recommended for production
const recommendedVars = [
  'WHATSAPP_APP_SECRET', // Required for webhook signature validation
];

function validateEnv() {
  const missing = [];

  for (const mapping of requiredVarMappings) {
    const value = getEnvVar(mapping.new, mapping.old);
    if (!value) {
      missing.push(mapping.new);
    }
  }

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    console.error('\nPlease set these in your .env file or environment.');
    process.exit(1);
  }

  console.log('✅ All required environment variables are set');
  
  // Warn about missing recommended variables
  const missingRecommended = recommendedVars.filter(varName => !process.env[varName]);
  if (missingRecommended.length > 0) {
    console.warn('⚠️  Missing recommended environment variables (may affect security/features):');
    missingRecommended.forEach(varName => {
      console.warn(`   - ${varName}`);
    });
  }
}

// Run validation if called directly
if (require.main === module) {
  validateEnv();
}

module.exports = {
  validateEnv,
};

