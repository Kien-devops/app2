const test = require('node:test');
const assert = require('node:assert');
const { getHealthStatus, getCatalog, handleRequest } = require('../src/app');

test('backend-2 getHealthStatus adheres to platform contract', () => {
  const health = getHealthStatus();
  assert.strictEqual(health.status, 'ok');
  assert.strictEqual(health.service, 'backend-2');
  assert.ok(health.region);
  assert.ok(health.timestamp);
  assert.strictEqual(typeof health.uptime, 'number');
});

test('backend-2 handleRequest returns 200 on /health', () => {
  let statusCode = null;
  let body = '';

  const req = { url: '/health', headers: { host: 'localhost:8082' } };
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
  assert.strictEqual(parsed.service, 'backend-2');
});

test('backend-2 handleRequest returns 200 on /api/v1/catalog with item array', () => {
  let statusCode = null;
  let body = '';

  const req = { url: '/api/v1/catalog', headers: { host: 'localhost:8082' } };
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
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.length > 0);
  assert.ok(parsed[0].id);
  assert.ok(parsed[0].name);
});

test('backend-2 handleRequest returns 200 on /api/v1/info', () => {
  let statusCode = null;
  let body = '';

  const req = { url: '/api/v1/info', headers: { host: 'localhost:8082' } };
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
  assert.strictEqual(parsed.service, 'backend-2');
  assert.strictEqual(parsed.role, 'Catalog & Inventory Read Service');
});
