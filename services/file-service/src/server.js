const http = require('node:http');
const { handleRequest, SERVICE_NAME } = require('./app');

const PORT = Number.parseInt(process.env.PORT || '8084', 10);
const HOST = process.env.HOST || '0.0.0.0';
const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.log(`[${SERVICE_NAME}] Service listening on http://${HOST}:${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
