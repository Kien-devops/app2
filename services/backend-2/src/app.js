const http = require('node:http');
const { createHealthResponse } = require('../../../shared/src/health');

const SERVICE_NAME = 'backend-2';

const CATALOG_ITEMS = [
  { id: 'item-001', name: 'Cloud Server Instance', category: 'compute', price: 49.99, stock: 100 },
  { id: 'item-002', name: 'Managed Data Plan', category: 'data', price: 199.99, stock: 50 },
  { id: 'item-003', name: 'Compute Capacity', category: 'compute', price: 89.99, stock: 250 },
  { id: 'item-004', name: 'Connectivity Plan', category: 'networking', price: 120.00, stock: 20 }
];

function getHealthStatus() {
  return createHealthResponse(SERVICE_NAME);
}

function getCatalog() {
  return CATALOG_ITEMS;
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    const health = getHealthStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
    return;
  }

  if (url.pathname === '/api/v1/catalog') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getCatalog(), null, 2));
    return;
  }

  if (url.pathname === '/api/v1/info') {
    const health = getHealthStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      service: SERVICE_NAME,
      role: 'Catalog & Inventory Read Service',
      region: health.region,
      items_count: CATALOG_ITEMS.length,
      version: '1.0.0'
    }, null, 2));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found', service: SERVICE_NAME }));
}

module.exports = {
  SERVICE_NAME,
  CATALOG_ITEMS,
  getHealthStatus,
  getCatalog,
  handleRequest
};
