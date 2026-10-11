const http = require('node:http');
const { createHealthResponse } = require('../../shared/src/health');

const SERVICE_NAME = 'frontend';

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

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const health = getHealthStatus();
    const region = health.region;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>App2 Multi-Region Platform</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 2rem; background: #0f172a; color: #f8fafc; }
    .card { background: #1e293b; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; border: 1px solid #334155; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.875rem; font-weight: 600; background: #0284c7; color: white; }
    h1 { color: #38bdf8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>App2 Multi-Region DR Dashboard</h1>
    <p>Service: <strong>frontend</strong> | Active Region: <span class="badge">${region}</span></p>
    <p>Backend Topology: backend-1 (8081), backend-2 (8082 - Catalog), backend-3 (8083 - Orders / PostgreSQL)</p>
  </div>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
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
