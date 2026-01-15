/**
 * Retry Testing
 * Test with intermittent failures to verify retry logic
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { fetchWithRetry } = require('../../services/utils/retryWithTimeout');

let originalFetch = global.fetch;
let fetchCallCount = 0;
let fetchResponses = [];
let currentAttempt = 0;

function createMockFetch(responses) {
  fetchCallCount = 0;
  fetchResponses = responses;
  currentAttempt = 0;
  
  global.fetch = async (url, options) => {
    fetchCallCount++;
    const response = fetchResponses[currentAttempt] || fetchResponses[fetchResponses.length - 1];
    currentAttempt++;
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 10));
    
    if (response.type === 'error') {
      const error = new Error(response.message || 'Request failed');
      error.name = response.errorName || 'Error';
      error.code = response.errorCode;
      throw error;
    }
    
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status || 200,
      statusText: response.statusText || 'OK',
      json: async () => ({ success: true }),
    };
  };
}

function restoreFetch() {
  global.fetch = originalFetch;
  fetchCallCount = 0;
  fetchResponses = [];
  currentAttempt = 0;
}

describe('Retry Testing', () => {
  beforeEach(() => {
    restoreFetch();
  });

  afterEach(() => {
    restoreFetch();
  });

  test('should retry on network errors (ECONNREFUSED)', async () => {
    createMockFetch([
      { type: 'error', errorName: 'Error', errorCode: 'ECONNREFUSED' },
      { type: 'error', errorName: 'Error', errorCode: 'ECONNREFUSED' },
      { type: 'success', status: 200 },
    ]);
    
    const response = await fetchWithRetry('http://test.com', {}, {
      timeoutMs: 5000,
      maxRetries: 3,
      retryDelayMs: 50,
    });
    
    assert.ok(response.ok, 'Should succeed after retries');
    assert.strictEqual(fetchCallCount, 3, 'Should retry 2 times (3 total attempts)');
  });

  test('should retry on timeout errors (AbortError)', async () => {
    createMockFetch([
      { type: 'error', errorName: 'AbortError' },
      { type: 'error', errorName: 'AbortError' },
      { type: 'success', status: 200 },
    ]);
    
    // Use short timeout to trigger AbortError
    global.fetch = async () => {
      fetchCallCount++;
      if (fetchCallCount <= 2) {
        const error = new Error('Timeout');
        error.name = 'AbortError';
        throw error;
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    };
    
    const response = await fetchWithRetry('http://test.com', {}, {
      timeoutMs: 100,
      maxRetries: 2,
      retryDelayMs: 50,
    });
    
    assert.ok(response.ok, 'Should succeed after retries');
    assert.strictEqual(fetchCallCount, 3, 'Should retry 2 times (3 total attempts)');
  });

  test('should retry on 5xx server errors', async () => {
    createMockFetch([
      { type: 'success', status: 500 },
      { type: 'success', status: 502 },
      { type: 'success', status: 200 },
    ]);
    
    const response = await fetchWithRetry('http://test.com', {}, {
      timeoutMs: 5000,
      maxRetries: 3,
      retryDelayMs: 50,
    });
    
    assert.ok(response.ok, 'Should succeed after retries');
    assert.strictEqual(fetchCallCount, 3, 'Should retry on 5xx errors');
  });

  test('should NOT retry on 4xx client errors', async () => {
    createMockFetch([
      { type: 'success', status: 400 },
    ]);
    
    const response = await fetchWithRetry('http://test.com', {}, {
      timeoutMs: 5000,
      maxRetries: 3,
      retryDelayMs: 50,
    });
    
    assert.strictEqual(response.status, 400, 'Should not retry 4xx errors');
    assert.strictEqual(fetchCallCount, 1, 'Should make only 1 attempt for 4xx');
  });

  test('should use exponential backoff for retries', async () => {
    const retryDelays = [];
    const startTime = Date.now();
    
    createMockFetch([
      { type: 'error', errorName: 'Error', errorCode: 'ECONNREFUSED' },
      { type: 'error', errorName: 'Error', errorCode: 'ECONNREFUSED' },
      { type: 'success', status: 200 },
    ]);
    
    // Track delays
    const originalSleep = require('../../services/utils/retryWithTimeout').sleep;
    let sleepCount = 0;
    
    // Mock sleep to track delays
    const mockSleep = async (ms) => {
      sleepCount++;
      retryDelays.push(ms);
      await originalSleep(ms);
    };
    
    // We can't easily mock the internal sleep, so we'll verify by timing
    const retryDelayMs = 100;
    const maxRetries = 2;
    
    const response = await fetchWithRetry('http://test.com', {}, {
      timeoutMs: 5000,
      maxRetries,
      retryDelayMs,
    });
    
    const totalTime = Date.now() - startTime;
    
    assert.ok(response.ok, 'Should succeed after retries');
    // With exponential backoff: 100ms * 2^0 = 100ms, 100ms * 2^1 = 200ms
    // Total should be at least 300ms (plus request times)
    assert.ok(totalTime >= 300, `Total time (${totalTime}ms) should include exponential backoff delays`);
    assert.strictEqual(fetchCallCount, 3, 'Should make 3 attempts');
  });

  test('should fail after max retries exceeded', async () => {
    createMockFetch([
      { type: 'error', errorName: 'Error', errorCode: 'ECONNREFUSED' },
      { type: 'error', errorName: 'Error', errorCode: 'ECONNREFUSED' },
      { type: 'error', errorName: 'Error', errorCode: 'ECONNREFUSED' },
      { type: 'error', errorName: 'Error', errorCode: 'ECONNREFUSED' },
    ]);
    
    const maxRetries = 3;
    
    await assert.rejects(
      async () => {
        await fetchWithRetry('http://test.com', {}, {
          timeoutMs: 5000,
          maxRetries,
          retryDelayMs: 50,
        });
      },
      (error) => {
        return error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED');
      },
      'Should throw error after max retries'
    );
    
    assert.strictEqual(fetchCallCount, maxRetries + 1, `Should make ${maxRetries + 1} attempts`);
  });

  test('should succeed on first attempt (no retries needed)', async () => {
    createMockFetch([
      { type: 'success', status: 200 },
    ]);
    
    const response = await fetchWithRetry('http://test.com', {}, {
      timeoutMs: 5000,
      maxRetries: 3,
      retryDelayMs: 50,
    });
    
    assert.ok(response.ok, 'Should succeed on first attempt');
    assert.strictEqual(fetchCallCount, 1, 'Should make only 1 attempt');
  });

  test('should respect custom shouldRetry function', async () => {
    createMockFetch([
      { type: 'success', status: 429 }, // Rate limit
      { type: 'success', status: 429 },
      { type: 'success', status: 200 },
    ]);
    
    // Custom retry function that retries on 429
    const shouldRetry = (error, response) => {
      if (response && response.status === 429) {
        return true;
      }
      return false;
    };
    
    const response = await fetchWithRetry('http://test.com', {}, {
      timeoutMs: 5000,
      maxRetries: 3,
      retryDelayMs: 50,
      shouldRetry,
    });
    
    assert.ok(response.ok, 'Should succeed after retrying on 429');
    assert.strictEqual(fetchCallCount, 3, 'Should retry on 429 errors');
  });
});

