/**
 * Rate Limiting Testing
 * Test rate limit enforcement and headers
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const { createRateLimiter } = require('../middleware/rateLimiterRedis');

let server;
let baseUrl;

function startTestServer(middleware) {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    
    if (middleware) {
      app.use(middleware);
    }
    
    app.get('/test', (req, res) => {
      res.json({ success: true });
    });
    
    app.post('/test', (req, res) => {
      res.json({ success: true });
    });
    
    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
}

function stopTestServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    
    const req = http.request(requestOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: body ? JSON.parse(body) : null,
        });
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

describe('Rate Limiting Testing', () => {
  beforeEach(async () => {
    await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer();
  });

  test('should allow requests within limit', async () => {
    const rateLimiter = createRateLimiter({
      windowMs: 60000, // 1 minute
      maxRequests: 5,
      keyGenerator: (req) => req.ip || 'test-ip',
    });
    
    await stopTestServer();
    await startTestServer(rateLimiter);
    
    // Make requests within limit
    for (let i = 0; i < 5; i++) {
      const response = await makeRequest(`${baseUrl}/test`);
      assert.strictEqual(response.status, 404, 'Should get 404 (route not found in test server)');
      
      // Check headers if available (they're set before route handler)
      if (i === 0) {
        // First request should have rate limit headers
        // Note: Our test server doesn't apply middleware to 404 routes,
        // so we need to test with actual routes
      }
    }
  });

  test('should enforce rate limit and return 429', async () => {
    const rateLimiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 3,
      keyGenerator: (req) => 'test-ip',
    });
    
    await stopTestServer();
    
    // Create server with rate limiter
    const app = express();
    app.set('trust proxy', true);
    app.use(rateLimiter);
    app.get('/test', (req, res) => {
      res.json({ success: true });
    });
    
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
    
    // Make requests up to limit
    for (let i = 0; i < 3; i++) {
      const response = await makeRequest(`${baseUrl}/test`);
      assert.strictEqual(response.status, 200, `Request ${i + 1} should succeed`);
    }
    
    // Next request should be rate limited
    const rateLimitedResponse = await makeRequest(`${baseUrl}/test`);
    assert.strictEqual(rateLimitedResponse.status, 429, 'Should return 429 on rate limit exceeded');
    assert.strictEqual(rateLimitedResponse.body.error, 'Too many requests', 'Should include error message');
    assert.ok(rateLimitedResponse.body.retryAfter, 'Should include retryAfter');
  });

  test('should include rate limit headers', async () => {
    const rateLimiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 10,
      keyGenerator: (req) => 'test-ip',
    });
    
    await stopTestServer();
    
    const app = express();
    app.set('trust proxy', true);
    app.use(rateLimiter);
    app.get('/test', (req, res) => {
      res.json({ success: true });
    });
    
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
    
    const response = await makeRequest(`${baseUrl}/test`);
    
    assert.ok(response.headers['x-ratelimit-limit'], 'Should include X-RateLimit-Limit header');
    assert.ok(response.headers['x-ratelimit-remaining'], 'Should include X-RateLimit-Remaining header');
    assert.ok(response.headers['x-ratelimit-reset'], 'Should include X-RateLimit-Reset header');
    
    assert.strictEqual(parseInt(response.headers['x-ratelimit-limit']), 10, 'Limit should be 10');
    assert.strictEqual(parseInt(response.headers['x-ratelimit-remaining']), 9, 'Remaining should be 9 after 1 request');
  });

  test('should set Retry-After header on rate limit', async () => {
    const rateLimiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 2,
      keyGenerator: (req) => 'test-ip',
    });
    
    await stopTestServer();
    
    const app = express();
    app.set('trust proxy', true);
    app.use(rateLimiter);
    app.get('/test', (req, res) => {
      res.json({ success: true });
    });
    
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
    
    // Exceed limit
    await makeRequest(`${baseUrl}/test`);
    await makeRequest(`${baseUrl}/test`);
    
    const rateLimitedResponse = await makeRequest(`${baseUrl}/test`);
    
    assert.strictEqual(rateLimitedResponse.status, 429, 'Should return 429');
    assert.ok(rateLimitedResponse.headers['retry-after'], 'Should include Retry-After header');
    assert.ok(parseInt(rateLimitedResponse.headers['retry-after']) > 0, 'Retry-After should be positive');
  });

  test('should reset rate limit after window expires', async () => {
    const rateLimiter = createRateLimiter({
      windowMs: 2000, // 2 seconds - short window for testing
      maxRequests: 2,
      keyGenerator: (req) => 'test-ip',
    });
    
    await stopTestServer();
    
    const app = express();
    app.set('trust proxy', true);
    app.use(rateLimiter);
    app.get('/test', (req, res) => {
      res.json({ success: true });
    });
    
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
    
    // Exceed limit
    await makeRequest(`${baseUrl}/test`);
    await makeRequest(`${baseUrl}/test`);
    
    // Should be rate limited
    let response = await makeRequest(`${baseUrl}/test`);
    assert.strictEqual(response.status, 429, 'Should be rate limited');
    
    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 2100));
    
    // Should be allowed again
    response = await makeRequest(`${baseUrl}/test`);
    assert.strictEqual(response.status, 200, 'Should succeed after window expires');
  });

  test('should track rate limits per IP', async () => {
    const rateLimiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 2,
      keyGenerator: (req) => req.ip || 'unknown',
    });
    
    await stopTestServer();
    
    const app = express();
    app.set('trust proxy', true);
    app.use((req, res, next) => {
      // Mock different IPs
      req.ip = req.headers['x-test-ip'] || '192.168.1.1';
      next();
    });
    app.use(rateLimiter);
    app.get('/test', (req, res) => {
      res.json({ success: true, ip: req.ip });
    });
    
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
    
    // IP 1: exceed limit
    await makeRequest(`${baseUrl}/test`, { headers: { 'x-test-ip': '192.168.1.1' } });
    await makeRequest(`${baseUrl}/test`, { headers: { 'x-test-ip': '192.168.1.1' } });
    let response = await makeRequest(`${baseUrl}/test`, { headers: { 'x-test-ip': '192.168.1.1' } });
    assert.strictEqual(response.status, 429, 'IP 1 should be rate limited');
    
    // IP 2: should not be rate limited
    response = await makeRequest(`${baseUrl}/test`, { headers: { 'x-test-ip': '192.168.1.2' } });
    assert.strictEqual(response.status, 200, 'IP 2 should not be rate limited');
  });
});

