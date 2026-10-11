const http = require('node:http');
const { createHealthResponse } = require('../../../shared/src/health');
const defaultDb = require('./db');

const SERVICE_NAME = 'backend-3';

function getHealthStatus(db = defaultDb) {
  return createHealthResponse(SERVICE_NAME, 'ok');
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function createRequestHandler(db = defaultDb) {
  return async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      const health = getHealthStatus(db);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
      return;
    }

    if (url.pathname === '/api/v1/info') {
      const health = getHealthStatus(db);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        service: SERVICE_NAME,
        role: 'Orders Processing Service (PostgreSQL / Aurora Global DB)',
        region: health.region,
        version: '1.0.0'
      }, null, 2));
      return;
    }

    if (url.pathname === '/api/v1/orders' && req.method === 'GET') {
      const marker = url.searchParams.get('marker') || null;
      const limit = url.searchParams.get('limit') || 50;

      try {
        const orders = await db.getOrders({ marker, limit });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(orders, null, 2));
      } catch (err) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Database unavailable',
          message: err.message
        }, null, 2));
      }
      return;
    }

    if (url.pathname === '/api/v1/orders' && req.method === 'POST') {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }

      const { item_id, quantity, marker } = body;

      if (!item_id || typeof item_id !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid item_id' }));
        return;
      }

      const parsedQty = parseInt(quantity, 10);
      if (isNaN(parsedQty) || parsedQty <= 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid quantity (must be positive integer)' }));
        return;
      }

      try {
        const order = await db.createOrder({
          item_id,
          quantity: parsedQty,
          marker: marker ? String(marker) : null
        });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(order, null, 2));
      } catch (err) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Database unavailable',
          message: err.message
        }, null, 2));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found', service: SERVICE_NAME }));
  };
}

const defaultHandler = createRequestHandler(defaultDb);

module.exports = {
  SERVICE_NAME,
  getHealthStatus,
  createRequestHandler,
  handleRequest: defaultHandler
};
