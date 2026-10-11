const test = require('node:test');
const assert = require('node:assert');
const { getHealthStatus, createRequestHandler, handleRequest } = require('../src/app');

// Mock DB adapter for unit tests
function createMockDb(initialOrders = []) {
  const orders = [...initialOrders];
  let nextId = orders.length + 1;
  let isAvailable = true;

  return {
    setAvailable(val) {
      isAvailable = val;
    },
    async checkHealth() {
      return isAvailable;
    },
    async createOrder({ item_id, quantity, marker }) {
      if (!isAvailable) {
        throw new Error('Database connection failed (mock)');
      }
      const order = {
        id: nextId++,
        item_id,
        quantity,
        marker: marker || null,
        created_at: new Date().toISOString()
      };
      orders.push(order);
      return order;
    },
    async getOrders({ marker, limit } = {}) {
      if (!isAvailable) {
        throw new Error('Database connection failed (mock)');
      }
      if (marker) {
        return orders.filter((o) => o.marker === marker);
      }
      return orders.slice(0, limit || 50);
    }
  };
}

function mockRes() {
  let statusCode = 200;
  let headers = {};
  let body = '';
  return {
    writeHead(code, h = {}) {
      statusCode = code;
      headers = h;
    },
    end(data = '') {
      body = data;
    },
    get statusCode() { return statusCode; },
    get headers() { return headers; },
    get body() { return body; },
    get json() { return body ? JSON.parse(body) : null; }
  };
}

test('backend-3 getHealthStatus adheres to platform contract', () => {
  const health = getHealthStatus();
  assert.strictEqual(health.status, 'ok');
  assert.strictEqual(health.service, 'backend-3');
  assert.ok(health.region);
  assert.ok(health.timestamp);
  assert.strictEqual(typeof health.uptime, 'number');
});

test('backend-3 handleRequest returns 200 on /health even without DB', async () => {
  const req = { url: '/health', method: 'GET', headers: { host: 'localhost:8083' } };
  const res = mockRes();
  await handleRequest(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json.status, 'ok');
  assert.strictEqual(res.json.service, 'backend-3');
});

test('backend-3 handleRequest returns 200 on /api/v1/info', async () => {
  const req = { url: '/api/v1/info', method: 'GET', headers: { host: 'localhost:8083' } };
  const res = mockRes();
  await handleRequest(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json.service, 'backend-3');
  assert.ok(res.json.role.includes('PostgreSQL'));
});

test('backend-3 POST /api/v1/orders validates item_id', async () => {
  const mockDb = createMockDb();
  const handler = createRequestHandler(mockDb);

  const req = {
    url: '/api/v1/orders',
    method: 'POST',
    headers: { host: 'localhost:8083' },
    on(event, cb) {
      if (event === 'data') cb(Buffer.from(JSON.stringify({ quantity: 5 })));
      if (event === 'end') cb();
      return req;
    }
  };
  const res = mockRes();
  await handler(req, res);

  assert.strictEqual(res.statusCode, 400);
  assert.ok(res.json.error.includes('item_id'));
});

test('backend-3 POST /api/v1/orders validates quantity (must be positive integer)', async () => {
  const mockDb = createMockDb();
  const handler = createRequestHandler(mockDb);

  const req = {
    url: '/api/v1/orders',
    method: 'POST',
    headers: { host: 'localhost:8083' },
    on(event, cb) {
      if (event === 'data') cb(Buffer.from(JSON.stringify({ item_id: 'item-001', quantity: -1 })));
      if (event === 'end') cb();
      return req;
    }
  };
  const res = mockRes();
  await handler(req, res);

  assert.strictEqual(res.statusCode, 400);
  assert.ok(res.json.error.includes('quantity'));
});

test('backend-3 POST /api/v1/orders successfully creates order with 201', async () => {
  const mockDb = createMockDb();
  const handler = createRequestHandler(mockDb);

  const req = {
    url: '/api/v1/orders',
    method: 'POST',
    headers: { host: 'localhost:8083' },
    on(event, cb) {
      if (event === 'data') cb(Buffer.from(JSON.stringify({ item_id: 'item-001', quantity: 2, marker: 'RPO_TEST_001' })));
      if (event === 'end') cb();
      return req;
    }
  };
  const res = mockRes();
  await handler(req, res);

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.json.item_id, 'item-001');
  assert.strictEqual(res.json.quantity, 2);
  assert.strictEqual(res.json.marker, 'RPO_TEST_001');
  assert.ok(res.json.id);
  assert.ok(res.json.created_at);
});

test('backend-3 supports RPO sequence marker in POST /api/v1/orders', async () => {
  const mockDb = createMockDb();
  const handler = createRequestHandler(mockDb);

  for (let i = 1; i <= 3; i++) {
    const seqMarker = `SEQ-00000${i}`;
    const req = {
      url: '/api/v1/orders',
      method: 'POST',
      headers: { host: 'localhost:8083' },
      on(event, cb) {
        if (event === 'data') cb(Buffer.from(JSON.stringify({ item_id: 'dr-sequence', quantity: 1, marker: seqMarker })));
        if (event === 'end') cb();
        return req;
      }
    };
    const res = mockRes();
    await handler(req, res);
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.json.marker, seqMarker);
  }

  // Query by marker
  const queryReq = {
    url: '/api/v1/orders?marker=SEQ-000002',
    method: 'GET',
    headers: { host: 'localhost:8083' }
  };
  const queryRes = mockRes();
  await handler(queryReq, queryRes);

  assert.strictEqual(queryRes.statusCode, 200);
  assert.strictEqual(queryRes.json.length, 1);
  assert.strictEqual(queryRes.json[0].marker, 'SEQ-000002');
});

test('backend-3 returns 503 on POST /api/v1/orders when DB is unavailable', async () => {
  const mockDb = createMockDb();
  mockDb.setAvailable(false);
  const handler = createRequestHandler(mockDb);

  const req = {
    url: '/api/v1/orders',
    method: 'POST',
    headers: { host: 'localhost:8083' },
    on(event, cb) {
      if (event === 'data') cb(Buffer.from(JSON.stringify({ item_id: 'item-001', quantity: 1 })));
      if (event === 'end') cb();
      return req;
    }
  };
  const res = mockRes();
  await handler(req, res);

  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.json.error, 'Database unavailable');
});

test('backend-3 returns 503 on GET /api/v1/orders when DB is unavailable without crashing', async () => {
  const mockDb = createMockDb();
  mockDb.setAvailable(false);
  const handler = createRequestHandler(mockDb);

  const req = {
    url: '/api/v1/orders',
    method: 'GET',
    headers: { host: 'localhost:8083' }
  };
  const res = mockRes();
  await handler(req, res);

  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.json.error, 'Database unavailable');
});
