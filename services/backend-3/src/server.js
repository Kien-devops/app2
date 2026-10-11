const http = require('node:http');
const { handleRequest, SERVICE_NAME } = require('./app');
const db = require('./db');

const PORT = parseInt(process.env.PORT || '8083', 10);
const HOST = process.env.HOST || '0.0.0.0';

const server = http.createServer(handleRequest);

server.listen(PORT, HOST, async () => {
  console.log(`[${SERVICE_NAME}] Microservice listening on http://${HOST}:${PORT}`);
  try {
    await db.initDb();
  } catch (err) {
    console.warn(`[${SERVICE_NAME}] Initial DB connection warning:`, err.message);
  }
});

process.on('SIGTERM', async () => {
  console.log(`[${SERVICE_NAME}] Received SIGTERM, shutting down gracefully...`);
  server.close(async () => {
    try {
      await db.close();
    } catch (err) {
      console.error(`[${SERVICE_NAME}] Error closing DB pool:`, err.message);
    }
    process.exit(0);
  });
});
