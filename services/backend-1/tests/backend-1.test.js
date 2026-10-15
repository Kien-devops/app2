const test = require('node:test');
const assert = require('node:assert');
const { getHealthStatus, handleRequest } = require('../src/app');

test('backend-1 getHealthStatus adheres to platform contract', () => {
  const health = getHealthStatus();
  assert.strictEqual(health.status, 'ok');
  assert.strictEqual(health.service, 'backend-1');
  assert.ok(health.region);
  assert.ok(health.timestamp);
  assert.strictEqual(typeof health.uptime, 'number');
});

test('backend-1 handleRequest returns 200 on /health', () => {
  let statusCode = null;
  let body = '';

  const req = { url: '/health', headers: { host: 'localhost:8081' } };
  const res = {
    writeHead(code) {
      statusCode = code;
    },
    end(data) {
      body = data;
    }
  };

  handleRequest(req, res);
  assert.strictEqual(statusCode, 200);
  const parsed = JSON.parse(body);
  assert.strictEqual(parsed.status, 'ok');
  assert.strictEqual(parsed.service, 'backend-1');
});

test('backend-1 handleRequest returns 200 on /api/v1/info', () => {
  let statusCode = null;
  let body = '';

  const req = { url: '/api/v1/info', headers: { host: 'localhost:8081' } };
  const res = {
    writeHead(code) {
      statusCode = code;
    },
    end(data) {
      body = data;
    }
  };

  handleRequest(req, res);
  assert.strictEqual(statusCode, 200);
  const parsed = JSON.parse(body);
  assert.strictEqual(parsed.service, 'backend-1');
  assert.strictEqual(parsed.role, 'System Information Service');
});
