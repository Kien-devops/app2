const http = require('node:http');
const { createHealthResponse } = require('../../../shared/src/health');

const SERVICE_NAME = 'backend-1';

function getHealthStatus() {
  return createHealthResponse(SERVICE_NAME);
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    const health = getHealthStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
    return;
  }

  if (url.pathname === '/api/v1/info') {
    const health = getHealthStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      service: SERVICE_NAME,
      role: 'Authentication & Demo Service',
      region: health.region,
      version: '1.0.0'
    }, null, 2));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found', service: SERVICE_NAME }));
}

module.exports = {
  SERVICE_NAME,
  getHealthStatus,
  handleRequest
};
