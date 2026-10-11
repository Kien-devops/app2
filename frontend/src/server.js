const http = require('node:http');
const { handleRequest, SERVICE_NAME } = require('./app');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.log(`[${SERVICE_NAME}] Server listening on http://${HOST}:${PORT}`);
});

process.on('SIGTERM', () => {
  console.log(`[${SERVICE_NAME}] Received SIGTERM, shutting down gracefully...`);
  server.close(() => {
    process.exit(0);
  });
});
