const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { sha256File } = require('./checksum');

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function storageError(code, statusCode, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function validateId(id) {
  if (!ID_PATTERN.test(id)) {
    throw storageError('INVALID_FILE_ID', 400, 'Invalid file id');
  }
}

function sanitizeFileName(value) {
  const base = path.basename(String(value || 'file.bin'))
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .trim();
  return (base || 'file.bin').slice(0, 180);
}

class Storage {
  constructor(options = {}) {
    this.root = options.root || process.env.STORAGE_PATH || path.join(os.tmpdir(), 'app2-file-service');
    this.createRoot = options.createRoot ?? !process.env.STORAGE_PATH;
    this.region = options.region || process.env.AWS_REGION || process.env.REGION || 'unknown';
    this.hostname = options.hostname || os.hostname();
    this.initialized = false;
    this.uploadsPath = path.join(this.root, 'uploads');
    this.metadataPath = path.join(this.root, 'metadata');
    this.eventsPath = path.join(this.root, 'events');
  }

  async init() {
    if (this.initialized) return;
    if (this.createRoot) {
      await fsp.mkdir(this.root, { recursive: true });
    } else {
      await fsp.access(this.root, fs.constants.R_OK);
    }
    await Promise.all([
      fsp.mkdir(this.uploadsPath, { recursive: true }),
      fsp.mkdir(this.metadataPath, { recursive: true }),
      fsp.mkdir(this.eventsPath, { recursive: true })
    ]);
    this.initialized = true;
  }

  async writeJsonAtomic(target, payload) {
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      await fsp.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' });
      await fsp.rename(temporary, target);
    } catch (error) {
      await fsp.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async saveUpload({ stream, originalName, contentType, isTruncated = () => false }) {
    await this.init();
    const id = crypto.randomUUID();
    const safeName = sanitizeFileName(originalName);
    const storedName = `${id}-${safeName}`;
    const finalPath = path.join(this.uploadsPath, storedName);
    const temporaryPath = path.join(this.uploadsPath, `.${id}.uploading`);
    const hash = crypto.createHash('sha256');
    let size = 0;
    const checksumStream = new Transform({
      transform(chunk, encoding, callback) {
        size += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      }
    });

    try {
      await pipeline(stream, checksumStream, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
      if (isTruncated()) {
        throw storageError('UPLOAD_TOO_LARGE', 413, 'Upload exceeds configured size limit');
      }
      await fsp.rename(temporaryPath, finalPath);
      const metadata = {
        id,
        originalName: safeName,
        storedName,
        contentType: contentType || 'application/octet-stream',
        size,
        sha256: hash.digest('hex'),
        region: this.region,
        hostname: this.hostname,
        uploadedAt: new Date().toISOString()
      };
      try {
        await this.writeJsonAtomic(path.join(this.metadataPath, `${id}.json`), metadata);
      } catch (error) {
        await fsp.rm(finalPath, { force: true }).catch(() => {});
        throw error;
      }
      return metadata;
    } catch (error) {
      await fsp.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async getMetadata(id) {
    validateId(id);
    await this.init();
    try {
      const metadata = JSON.parse(await fsp.readFile(path.join(this.metadataPath, `${id}.json`), 'utf8'));
      if (metadata.id !== id) {
        throw storageError('INVALID_METADATA', 500, 'Stored file metadata is invalid');
      }
      return metadata;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw storageError('FILE_NOT_FOUND', 404, 'File not found');
      }
      throw error;
    }
  }

  resolveStoredFile(metadata) {
    if (path.basename(metadata.storedName) !== metadata.storedName || !metadata.storedName.startsWith(`${metadata.id}-`)) {
      throw storageError('INVALID_METADATA', 500, 'Stored file metadata is invalid');
    }
    return path.join(this.uploadsPath, metadata.storedName);
  }

  async listFiles() {
    await this.init();
    const entries = (await fsp.readdir(this.metadataPath)).filter((name) => name.endsWith('.json'));
    const files = await Promise.all(entries.map(async (name) => JSON.parse(
      await fsp.readFile(path.join(this.metadataPath, name), 'utf8')
    )));
    return files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  async getDownload(id) {
    const metadata = await this.getMetadata(id);
    const filePath = this.resolveStoredFile(metadata);
    try {
      await fsp.access(filePath, fs.constants.R_OK);
    } catch (error) {
      if (error.code === 'ENOENT') throw storageError('FILE_NOT_FOUND', 404, 'File data not found');
      throw error;
    }
    return { metadata, filePath };
  }

  async verify(id) {
    const { metadata, filePath } = await this.getDownload(id);
    const actualSha256 = await sha256File(filePath);
    return {
      id,
      integrity: actualSha256 === metadata.sha256 ? 'PASS' : 'FAIL',
      expectedSha256: metadata.sha256,
      actualSha256
    };
  }

  async deleteFile(id, operations = fsp) {
    const metadata = await this.getMetadata(id);
    const metadataFile = path.join(this.metadataPath, `${id}.json`);
    const tombstone = path.join(this.metadataPath, `.${id}.deleting`);
    await operations.rename(metadataFile, tombstone);
    try {
      await operations.rm(this.resolveStoredFile(metadata), { force: true });
    } catch (error) {
      await operations.rename(tombstone, metadataFile).catch(() => {});
      throw error;
    }
    await operations.rm(tombstone, { force: true }).catch(() => {});
  }

  async writeEvent({ sequence, marker }) {
    await this.init();
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw storageError('INVALID_SEQUENCE', 400, 'sequence must be a positive integer');
    }
    if (typeof marker !== 'string' || !marker.trim() || marker.length > 128) {
      throw storageError('INVALID_MARKER', 400, 'marker must be a non-empty string up to 128 characters');
    }
    const event = {
      sequence,
      marker: marker.trim(),
      region: this.region,
      hostname: this.hostname,
      timestamp: new Date().toISOString()
    };
    const eventPath = path.join(this.eventsPath, `${String(sequence).padStart(6, '0')}.json`);
    try {
      await fsp.writeFile(eventPath, `${JSON.stringify(event, null, 2)}\n`, { flag: 'wx' });
      return event;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = JSON.parse(await fsp.readFile(eventPath, 'utf8'));
      if (existing.marker !== event.marker) {
        throw storageError('EVENT_CONFLICT', 409, 'sequence already exists with a different marker');
      }
      return existing;
    }
  }

  async latestEvent() {
    await this.init();
    const entries = await fsp.readdir(this.eventsPath);
    const candidates = entries
      .filter((name) => /^\d+\.json$/.test(name))
      .map((name) => ({ name, sequence: Number.parseInt(name, 10) }))
      .filter(({ sequence }) => Number.isSafeInteger(sequence))
      .sort((a, b) => b.sequence - a.sequence);
    if (!candidates.length) return null;
    return JSON.parse(await fsp.readFile(path.join(this.eventsPath, candidates[0].name), 'utf8'));
  }

  async checkReadiness() {
    let readable = false;
    let writable = false;
    try {
      await this.init();
    } catch (error) {
      return {
        ready: false,
        readable,
        writable,
        reason: ['EROFS', 'EACCES', 'EPERM'].includes(error.code) ? 'filesystem_read_only' : 'storage_unavailable'
      };
    }
    try {
      await fsp.access(this.uploadsPath, fs.constants.R_OK);
      readable = true;
    } catch (error) {
      return { ready: false, readable, writable, reason: 'storage_unavailable' };
    }

    const probe = path.join(this.uploadsPath, `.ready-${crypto.randomUUID()}`);
    try {
      await fsp.writeFile(probe, 'ready', { flag: 'wx' });
      writable = true;
    } catch (error) {
      return {
        ready: false,
        readable,
        writable,
        reason: ['EROFS', 'EACCES', 'EPERM'].includes(error.code) ? 'filesystem_read_only' : 'storage_unavailable'
      };
    } finally {
      await fsp.rm(probe, { force: true }).catch(() => {});
    }
    return { ready: true, readable, writable };
  }
}

module.exports = { Storage, sanitizeFileName, validateId };
