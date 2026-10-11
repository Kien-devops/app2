const test = require('node:test');
const assert = require('node:assert');
const { getHealthStatus, handleRequest } = require('../src/app');

test('frontend getHealthStatus returns ok and service name', () => {
  const health = getHealthStatus();
  assert.strictEqual(health.status, 'ok');
  assert.strictEqual(health.service, 'frontend');
  assert.ok(health.region);
  assert.ok(health.timestamp);
});

test('frontend handleRequest responds 200 on /health', () => {
  let statusCode = null;
  let headers = {};
  let body = '';

  const req = { url: '/health', headers: { host: 'localhost:3000' } };
  const res = {
    writeHead(code, h) {
      statusCode = code;
      headers = h;
    },
    end(data) {
      body = data;
    }
  };

  handleRequest(req, res);
  assert.strictEqual(statusCode, 200);
  assert.strictEqual(headers['Content-Type'], 'application/json');
  const parsed = JSON.parse(body);
  assert.strictEqual(parsed.status, 'ok');
  assert.strictEqual(parsed.service, 'frontend');
});

test('frontend handleRequest responds 200 on / with HTML', () => {
  let statusCode = null;
  let headers = {};
  let body = '';

  const req = { url: '/', headers: { host: 'localhost:3000' } };
  const res = {
    writeHead(code, h) {
      statusCode = code;
      headers = h;
    },
    end(data) {
      body = data;
    }
  };

  handleRequest(req, res);
  assert.strictEqual(statusCode, 200);
  assert.ok(headers['Content-Type'].includes('text/html'));
  assert.ok(body.includes('App2 Multi-Region DR Dashboard'));
});
