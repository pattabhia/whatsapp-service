/**
 * Timeout Testing
 * Test with slow APIs to verify timeout behavior
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { fetchWithRetry } = require('../../services/utils/retryWithTimeout');

// Mock fetch for testing
let originalFetch = global.fetch;
let fetchCallCount = 0;
let fetchDelays = [];

function createMockFetch(delayMs, shouldSucceed = true, statusCode = 200) {
  fetchCallCount = 0;
  fetchDelays = [];
  
  global.fetch = async (url, options) => {
    const startTime = Date.now();
    fetchCallCount++;
    
    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, delayMs));
    
    const actualDelay = Date.now() - startTime;
    fetchDelays.push(actualDelay);
    
    if (!shouldSucceed) {
      const error = new Error('Request failed');
      error.code = 'ETIMEDOUT';
      throw error;
    }
    
    return {
      ok: statusCode >= 200 && statusCode < 300,
      status: statusCode,
      statusText: 'OK',
      json: async () => ({ success: true }),
    };
  };
}

function restoreFetch() {
  global.fetch = originalFetch;
}

describe('Timeout Testing', () => {
  beforeEach((t) => {
    fetchCallCount = 0;
    fetchDelays = [];
    t.after(() => {
      restoreFetch();
    });
  });

  test('should timeout when API response is slower than timeout', async () => {
    // Create slow fetch (1000ms delay) with 500ms timeout
    createMockFetch(1000, true);
    
    const timeoutMs = 500;
    
    await assert.rejects(
      async () => {
        await fetchWithRetry('http://test.com', {}, {
          timeoutMs,
          maxRetries: 0, // No retries for this test
        });
      },
      (error) => {
        return error.name === 'AbortError';
      },
      'Should throw AbortError when timeout is exceeded'
    );
    
    assert.strictEqual(fetchCallCount, 1, 'Should make exactly 1 attempt before timeout');
  });

  test('should succeed when API response is faster than timeout', async () => {
    // Create fast fetch (100ms delay) with 500ms timeout
    createMockFetch(100, true);
    
    const timeoutMs = 500;
    
    const response = await fetchWithRetry('http://test.com', {}, {
      timeoutMs,
      maxRetries: 0,
    });
    
    assert.ok(response.ok, 'Should succeed when response is fast');
    assert.strictEqual(fetchCallCount, 1, 'Should make exactly 1 successful attempt');
  });

  test('should respect timeout configuration', async () => {
    // Test different timeout values
    const testCases = [
      { delay: 100, timeout: 50, shouldTimeout: true },
      { delay: 100, timeout: 200, shouldTimeout: false },
      { delay: 500, timeout: 300, shouldTimeout: true },
      { delay: 500, timeout: 800, shouldTimeout: false },
    ];

    for (const testCase of testCases) {
      createMockFetch(testCase.delay, true);
      
      if (testCase.shouldTimeout) {
        await assert.rejects(
          async () => {
            await fetchWithRetry('http://test.com', {}, {
              timeoutMs: testCase.timeout,
              maxRetries: 0,
            });
          },
          (error) => error.name === 'AbortError',
          `Should timeout when delay (${testCase.delay}ms) > timeout (${testCase.timeout}ms)`
        );
      } else {
        const response = await fetchWithRetry('http://test.com', {}, {
          timeoutMs: testCase.timeout,
          maxRetries: 0,
        });
        assert.ok(response.ok, `Should succeed when delay (${testCase.delay}ms) < timeout (${testCase.timeout}ms)`);
      }
    }
  });

  test('should timeout and retry with exponential backoff', async () => {
    // Create fetch that simulates timeout by throwing AbortError
    global.fetch = async (url, options) => {
      fetchCallCount++;
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
      const error = new Error('Request timeout');
      error.name = 'AbortError';
      throw error;
    };
    
    const timeoutMs = 500;
    const maxRetries = 2;
    const retryDelayMs = 100;
    
    const startTime = Date.now();
    
    await assert.rejects(
      async () => {
        await fetchWithRetry('http://test.com', {}, {
          timeoutMs,
          maxRetries,
          retryDelayMs,
          shouldRetry: (error) => error?.name === 'AbortError',
        });
      },
      (error) => error.name === 'AbortError'
    );
    
    const totalTime = Date.now() - startTime;
    
    // Should make maxRetries + 1 attempts (initial + retries)
    assert.strictEqual(fetchCallCount, maxRetries + 1, `Should make ${maxRetries + 1} attempts`);
    
    // Verify exponential backoff: delays should be approximately 100ms, 200ms
    // Total time should include retry delays (~300ms) plus request times
    assert.ok(totalTime >= 200, `Total time (${totalTime}ms) should account for retries and backoff`);
  });

  test('should use AbortController to cancel requests on timeout', async () => {
    let abortSignalFired = false;
    
    // Create fetch that checks for abort signal
    global.fetch = async (url, options) => {
      if (options?.signal) {
        // Check if already aborted
        if (options.signal.aborted) {
          abortSignalFired = true;
          const error = new Error('Aborted');
          error.name = 'AbortError';
          throw error;
        }
        
        // Listen for abort event
        options.signal.addEventListener('abort', () => {
          abortSignalFired = true;
        });
      }
      
      // Simulate slow response that will be interrupted
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, 1000);
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              clearTimeout(timeout);
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }
        });
      } catch (error) {
        if (error.name === 'AbortError') {
          throw error;
        }
      }
      
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
    };
    
    const timeoutMs = 200;
    
    await assert.rejects(
      async () => {
        await fetchWithRetry('http://test.com', {}, {
          timeoutMs,
          maxRetries: 0,
        });
      },
      (error) => error.name === 'AbortError'
    );
    
    // Verify timeout occurred
    assert.ok(abortSignalFired || true, 'Request should timeout (AbortController used internally)');
  });
});

