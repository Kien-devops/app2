const test = require('node:test');
const assert = require('node:assert');
const { getHealthStatus, handleRequest, renderFilesPage } = require('../src/app');

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

test('frontend /files renders file storage controls and API configuration', () => {
  const previous = process.env.FILE_SERVICE_BASE_URL;
  process.env.FILE_SERVICE_BASE_URL = 'https://files.example.test/';
  try {
    const html = renderFilesPage();
    assert.ok(html.includes('File Storage'));
    assert.ok(html.includes('type="file"'));
    assert.ok(html.includes('Upload'));
    assert.ok(html.includes('Verify'));
    assert.ok(html.includes('Delete'));
    assert.ok(html.includes('https://files.example.test'));
  } finally {
    if (previous === undefined) delete process.env.FILE_SERVICE_BASE_URL;
    else process.env.FILE_SERVICE_BASE_URL = previous;
  }
});

test('frontend handleRequest responds 200 on /files', () => {
  let statusCode = null;
  let body = '';
  const req = { url: '/files', headers: { host: 'localhost:3000' } };
  const res = { writeHead(code) { statusCode = code; }, end(data) { body = data; } };
  handleRequest(req, res);
  assert.equal(statusCode, 200);
  assert.ok(body.includes('Filesystem disaster recovery'));
});

test('frontend handleRequest serves the orders database test page', () => {
  let statusCode = null;
  let body = '';
  const req = { url: '/orders', headers: { host: 'localhost:3000' } };
  const res = { writeHead(code) { statusCode = code; }, end(data) { body = data; } };
  handleRequest(req, res);
  assert.equal(statusCode, 200);
  assert.ok(body.includes('Orders / Database Test'));
  assert.ok(body.includes('/api/v1/orders/health'));
  assert.ok(body.includes('Create DR Marker'));
});
