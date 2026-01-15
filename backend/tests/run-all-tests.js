/**
 * Test Runner
 * Run all tests in sequence
 */

const { test } = require('node:test');
const { spawn } = require('child_process');
const path = require('path');

const testFiles = [
  'timeout.test.js',
  'retry.test.js',
  'rateLimiting.test.js',
  'messageLength.test.js',
];

async function runTests() {
  console.log('🧪 Running all tests...\n');
  
  let totalPassed = 0;
  let totalFailed = 0;
  
  for (const testFile of testFiles) {
    console.log(`\n📝 Running ${testFile}...`);
    console.log('─'.repeat(60));
    
    const testPath = path.join(__dirname, testFile);
    
    try {
      const result = await runTestFile(testPath);
      if (result.success) {
        console.log(`✅ ${testFile} passed\n`);
        totalPassed++;
      } else {
        console.log(`❌ ${testFile} failed\n`);
        totalFailed++;
      }
    } catch (error) {
      console.error(`❌ Error running ${testFile}:`, error.message);
      totalFailed++;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`📊 Test Summary:`);
  console.log(`   ✅ Passed: ${totalPassed}`);
  console.log(`   ❌ Failed: ${totalFailed}`);
  console.log(`   📁 Total:  ${testFiles.length}`);
  console.log('='.repeat(60));
  
  process.exit(totalFailed > 0 ? 1 : 0);
}

function runTestFile(testPath) {
  return new Promise((resolve) => {
    const proc = spawn('node', ['--test', testPath], {
      cwd: __dirname,
      stdio: 'inherit',
    });
    
    proc.on('close', (code) => {
      resolve({ success: code === 0 });
    });
    
    proc.on('error', (error) => {
      resolve({ success: false, error });
    });
  });
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

