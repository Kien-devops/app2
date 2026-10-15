const fs = require('node:fs');
const Busboy = require('busboy');
const { createHealthResponse } = require('../../../shared/src/health');
const { Storage } = require('./storage');

const SERVICE_NAME = 'file-service';
const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(payload, null, 2));
}

function getHealthStatus() {
  return createHealthResponse(SERVICE_NAME);
}

function parseMaxSequence(value) {
  if (value === null) return null;
  if (!/^[0-9]+$/.test(value)) return NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : NaN;
}

function readJson(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function parseAllowedOrigins() {
  return new Set((process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean));
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  const allowed = parseAllowedOrigins();
  if (!allowed.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  };
}

function parseUpload(req, storage, maxUploadBytes) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fields: 4, fileSize: maxUploadBytes }
      });
    } catch (error) {
      reject(Object.assign(new Error(`Invalid multipart request: ${error.message}`), { statusCode: 400 }));
      return;
    }

    let uploadPromise = null;
    let fileSeen = false;
    parser.on('file', (fieldName, stream, info) => {
      if (fieldName !== 'file' || fileSeen) {
        stream.resume();
        return;
      }
      fileSeen = true;
      uploadPromise = storage.saveUpload({
        stream,
        originalName: info.filename,
        contentType: info.mimeType,
        isTruncated: () => stream.truncated
      });
    });
    // The first `file` field is authoritative; Busboy drains and ignores extras.
    parser.on('filesLimit', () => {});
    parser.on('error', reject);
    parser.on('close', async () => {
      if (!fileSeen || !uploadPromise) {
        reject(Object.assign(new Error('multipart field "file" is required'), { statusCode: 400 }));
        return;
      }
      try {
        resolve(await uploadPromise);
      } catch (error) {
        reject(error);
      }
    });
    req.pipe(parser);
  });
}

function mapError(error) {
  if (error.statusCode) return error.statusCode;
  if (['EROFS', 'EACCES', 'EPERM', 'ENOENT'].includes(error.code)) return 503;
  return 500;
}

function createRequestHandler(options = {}) {
  const storage = options.storage || new Storage();
  const configuredMax = options.maxUploadBytes || Number.parseInt(process.env.MAX_UPLOAD_BYTES || '', 10);
  const maxUploadBytes = Number.isSafeInteger(configuredMax) && configuredMax > 0 ? configuredMax : DEFAULT_MAX_UPLOAD_BYTES;

  return async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const cors = corsHeaders(req);

    if (req.method === 'OPTIONS') {
      res.writeHead(Object.keys(cors).length ? 204 : 403, cors);
      res.end();
      return;
    }

    try {
      if (url.pathname === '/health' && req.method === 'GET') {
        sendJson(res, 200, getHealthStatus(), cors);
        return;
      }

      if (url.pathname === '/ready' && req.method === 'GET') {
        const status = await storage.checkReadiness();
        sendJson(res, status.ready ? 200 : 503, {
          ready: status.ready,
          region: storage.region,
          storage: { path: storage.root, readable: status.readable, writable: status.writable },
          ...(status.reason ? { reason: status.reason } : {})
        }, cors);
        return;
      }

      if (url.pathname === '/api/v1/files' && req.method === 'GET') {
        sendJson(res, 200, { region: storage.region, files: await storage.listFiles() }, cors);
        return;
      }

      if (url.pathname === '/api/v1/files' && req.method === 'POST') {
        const metadata = await parseUpload(req, storage, maxUploadBytes);
        sendJson(res, 201, metadata, cors);
        return;
      }

      if (url.pathname === '/api/v1/storage/events' && req.method === 'POST') {
        const body = await readJson(req);
        sendJson(res, 201, await storage.writeEvent(body), cors);
        return;
      }

      if (url.pathname === '/api/v1/storage/events/latest' && req.method === 'GET') {
        const maxSequence = parseMaxSequence(url.searchParams.get('maxSequence'));
        if (Number.isNaN(maxSequence)) {
          sendJson(res, 400, { error: 'maxSequence must be a positive safe integer' }, cors);
          return;
        }
        const event = await storage.latestEvent(url.searchParams.get('runId'), maxSequence);
        sendJson(res, event ? 200 : 404, event || { error: 'No storage events found' }, cors);
        return;
      }

      const match = url.pathname.match(/^\/api\/v1\/files\/([^/]+)(\/download|\/verify)?$/);
      if (match) {
        let id;
        try {
          id = decodeURIComponent(match[1]);
        } catch {
          throw Object.assign(new Error('Invalid file id'), { statusCode: 400 });
        }
        const action = match[2] || '';

        if (req.method === 'GET' && action === '') {
          sendJson(res, 200, await storage.getMetadata(id), cors);
          return;
        }
        if (req.method === 'GET' && action === '/verify') {
          sendJson(res, 200, await storage.verify(id), cors);
          return;
        }
        if (req.method === 'GET' && action === '/download') {
          const { metadata, filePath } = await storage.getDownload(id);
          const asciiName = metadata.originalName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
          const contentType = String(metadata.contentType || 'application/octet-stream').replace(/[\r\n]/g, '');
          const stat = await fs.promises.stat(filePath);
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stat.size,
            'Content-Disposition': `attachment; filename="${asciiName}"`,
            ...cors
          });
          const stream = fs.createReadStream(filePath);
          stream.on('error', () => res.destroy());
          stream.pipe(res);
          return;
        }
        if (req.method === 'DELETE' && action === '') {
          await storage.deleteFile(id);
          res.writeHead(204, cors);
          res.end();
          return;
        }
      }

      sendJson(res, 404, { error: 'Not Found', service: SERVICE_NAME }, cors);
    } catch (error) {
      sendJson(res, mapError(error), { error: error.message || 'Internal server error' }, cors);
    }
  };
}

const defaultHandler = createRequestHandler();

module.exports = { SERVICE_NAME, DEFAULT_MAX_UPLOAD_BYTES, getHealthStatus, createRequestHandler, handleRequest: defaultHandler };
