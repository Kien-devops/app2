const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Storage, sanitizeFileName } = require('../src/storage');
const { createRequestHandler } = require('../src/app');

async function createFixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app2-file-service-'));
  const storage = new Storage({ root, createRoot: false, region: 'ap-southeast-1', hostname: 'test-host' });
  const server = http.createServer(createRequestHandler({ storage, maxUploadBytes: options.maxUploadBytes || 1024 * 1024 }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    root,
    storage,
    baseUrl,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}

async function upload(baseUrl, content = 'disaster-recovery-data', name = 'network-report.txt') {
  const form = new FormData();
  form.set('file', new Blob([content], { type: 'text/plain' }), name);
  return fetch(`${baseUrl}/api/v1/files`, { method: 'POST', body: form });
}

test('upload filenames cannot select a filesystem path', () => {
  assert.equal(sanitizeFileName('../../secret.txt'), 'secret.txt');
  assert.equal(sanitizeFileName('report<script>.txt'), 'report_script_.txt');
});

test('health and readiness expose process and writable storage state', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());

  const health = await fetch(`${fixture.baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, 'file-service');

  const ready = await fetch(`${fixture.baseUrl}/ready`);
  assert.equal(ready.status, 200);
  const payload = await ready.json();
  assert.equal(payload.ready, true);
  assert.equal(payload.storage.readable, true);
  assert.equal(payload.storage.writable, true);
});

test('upload, list, metadata, download and delete use filesystem state', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());

  const uploaded = await upload(fixture.baseUrl);
  assert.equal(uploaded.status, 201);
  const metadata = await uploaded.json();
  assert.match(metadata.id, /^[0-9a-f-]{36}$/);
  assert.equal(metadata.originalName, 'network-report.txt');
  assert.equal(metadata.size, Buffer.byteLength('disaster-recovery-data'));
  assert.equal(metadata.region, 'ap-southeast-1');
  assert.equal(metadata.sha256, crypto.createHash('sha256').update('disaster-recovery-data').digest('hex'));

  const listed = await fetch(`${fixture.baseUrl}/api/v1/files`);
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).files.length, 1);

  const fetchedMetadata = await fetch(`${fixture.baseUrl}/api/v1/files/${metadata.id}`);
  assert.equal(fetchedMetadata.status, 200);
  assert.equal((await fetchedMetadata.json()).storedName, metadata.storedName);

  const downloaded = await fetch(`${fixture.baseUrl}/api/v1/files/${metadata.id}/download`);
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), 'disaster-recovery-data');

  const deleted = await fetch(`${fixture.baseUrl}/api/v1/files/${metadata.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 204);
  assert.equal((await (await fetch(`${fixture.baseUrl}/api/v1/files`)).json()).files.length, 0);
});

test('multipart upload accepts the first file and ignores extra files', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  const form = new FormData();
  form.append('file', new Blob(['first']), 'first.txt');
  form.append('file', new Blob(['second']), 'second.txt');

  const response = await fetch(`${fixture.baseUrl}/api/v1/files`, { method: 'POST', body: form });
  assert.equal(response.status, 201);
  const metadata = await response.json();
  assert.equal(metadata.originalName, 'first.txt');
  assert.equal(await fs.readFile(path.join(fixture.root, 'uploads', metadata.storedName), 'utf8'), 'first');
  assert.equal((await fixture.storage.listFiles()).length, 1);
});

test('checksum verification reports PASS and detects changed file data', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  const metadata = await (await upload(fixture.baseUrl, 'original')).json();

  const pass = await fetch(`${fixture.baseUrl}/api/v1/files/${metadata.id}/verify`);
  assert.equal((await pass.json()).integrity, 'PASS');

  await fs.writeFile(path.join(fixture.root, 'uploads', metadata.storedName), 'tampered');
  const fail = await fetch(`${fixture.baseUrl}/api/v1/files/${metadata.id}/verify`);
  const payload = await fail.json();
  assert.equal(payload.integrity, 'FAIL');
  assert.notEqual(payload.actualSha256, payload.expectedSha256);
});

test('invalid file id is rejected without accessing arbitrary paths', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  const response = await fetch(`${fixture.baseUrl}/api/v1/files/..%2F..%2Fsecret`);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Invalid file id');
});

test('unavailable storage makes readiness fail safely', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  fixture.storage.root = path.join(fixture.root, 'missing');
  fixture.storage.initialized = false;

  const response = await fetch(`${fixture.baseUrl}/ready`);
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.ready, false);
  assert.equal(payload.reason, 'storage_unavailable');
});

test('readiness probes the uploads directory, not only the mount root', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  await fixture.storage.init();
  await fs.rm(path.join(fixture.root, 'uploads'), { recursive: true });

  const response = await fetch(`${fixture.baseUrl}/ready`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, 'storage_unavailable');
});

test('read-only readiness result is exposed without claiming writable storage', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  fixture.storage.checkReadiness = async () => ({
    ready: false,
    readable: true,
    writable: false,
    reason: 'filesystem_read_only'
  });

  const response = await fetch(`${fixture.baseUrl}/ready`);
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.storage.readable, true);
  assert.equal(payload.storage.writable, false);
  assert.equal(payload.reason, 'filesystem_read_only');
});

test('storage events isolate runs and latest honors the pre-failure maxSequence', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  for (const sequence of [1, 98, 99, 101, 120]) {
    const response = await fetch(`${fixture.baseUrl}/api/v1/storage/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'run-A', sequence, marker: `DR-run-A-SEQ-${String(sequence).padStart(6, '0')}` })
    });
    assert.equal(response.status, 201);
  }

  for (const sequence of [1, 999]) {
    const secondRun = await fetch(`${fixture.baseUrl}/api/v1/storage/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'run-B', sequence, marker: `DR-run-B-SEQ-${String(sequence).padStart(6, '0')}` })
    });
    assert.equal(secondRun.status, 201);
  }

  assert.equal(await fs.readFile(path.join(fixture.root, 'events', 'run-A', '000001.json'), 'utf8').then(Boolean), true);
  assert.equal(await fs.readFile(path.join(fixture.root, 'events', 'run-B', '000001.json'), 'utf8').then(Boolean), true);
  const latest = await fetch(`${fixture.baseUrl}/api/v1/storage/events/latest?runId=run-A`);
  assert.equal(latest.status, 200);
  const latestPayload = await latest.json();
  assert.equal(latestPayload.runId, 'run-A');
  assert.equal(latestPayload.sequence, 120);

  const latestAtFailure = await fetch(`${fixture.baseUrl}/api/v1/storage/events/latest?runId=run-A&maxSequence=100`);
  assert.equal(latestAtFailure.status, 200);
  assert.equal((await latestAtFailure.json()).sequence, 99);

  const latestSecondRun = await fetch(`${fixture.baseUrl}/api/v1/storage/events/latest?runId=run-B`);
  assert.equal((await latestSecondRun.json()).sequence, 999);
});

test('storage latest returns 404 when no event is at or below maxSequence', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  await fixture.storage.writeEvent({ runId: 'run-C', sequence: 101, marker: 'DR-run-C-SEQ-000101' });

  const response = await fetch(`${fixture.baseUrl}/api/v1/storage/events/latest?runId=run-C&maxSequence=100`);
  assert.equal(response.status, 404);
});

test('storage latest rejects invalid maxSequence values', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  for (const value of ['0', '-1', 'abc', '1.5', '9007199254740992']) {
    const response = await fetch(`${fixture.baseUrl}/api/v1/storage/events/latest?runId=run-A&maxSequence=${encodeURIComponent(value)}`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /maxSequence/);
  }
});

test('storage events reject sequence zero', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  const response = await fetch(`${fixture.baseUrl}/api/v1/storage/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId: 'run-A', sequence: 0, marker: 'DR-run-A-SEQ-000000' })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /positive integer/);
});

test('storage events require a safe runId for writes and latest reads', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());

  const write = await fetch(`${fixture.baseUrl}/api/v1/storage/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sequence: 1, marker: 'DR-run-A-SEQ-000001' })
  });
  assert.equal(write.status, 400);
  assert.match((await write.json()).error, /runId/);

  const latest = await fetch(`${fixture.baseUrl}/api/v1/storage/events/latest`);
  assert.equal(latest.status, 400);
  assert.match((await latest.json()).error, /runId/);
});

test('storage events reject a marker that disagrees with runId or sequence', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  const response = await fetch(`${fixture.baseUrl}/api/v1/storage/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId: 'run-A', sequence: 1, marker: 'DR-run-B-SEQ-000001' })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /DR-run-A-SEQ-000001/);
});

test('failed data deletion restores metadata instead of leaving a dangling record', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  const metadata = await (await upload(fixture.baseUrl, 'keep-me')).json();
  const operations = {
    rename: fs.rename,
    async rm(target, options) {
      if (target.includes(`${path.sep}uploads${path.sep}`)) throw Object.assign(new Error('simulated delete failure'), { code: 'EIO' });
      return fs.rm(target, options);
    }
  };

  await assert.rejects(fixture.storage.deleteFile(metadata.id, operations), /simulated delete failure/);
  assert.equal((await fixture.storage.getMetadata(metadata.id)).id, metadata.id);
  assert.equal(await fs.readFile(path.join(fixture.root, 'uploads', metadata.storedName), 'utf8'), 'keep-me');
});

test('tombstone cleanup failure does not report delete failure after data is gone', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  const metadata = await (await upload(fixture.baseUrl, 'delete-me')).json();
  const operations = {
    rename: fs.rename,
    async rm(target, options) {
      if (target.endsWith('.deleting')) throw Object.assign(new Error('simulated tombstone cleanup failure'), { code: 'EIO' });
      return fs.rm(target, options);
    }
  };

  await fixture.storage.deleteFile(metadata.id, operations);
  await assert.rejects(fixture.storage.getMetadata(metadata.id), /File not found/);
  await assert.rejects(fs.access(path.join(fixture.root, 'uploads', metadata.storedName)));
});

test('upload size limit rejects and removes partial data', async (t) => {
  const fixture = await createFixture({ maxUploadBytes: 4 });
  t.after(() => fixture.close());
  const response = await upload(fixture.baseUrl, 'too-large');
  assert.equal(response.status, 413);
  const uploads = await fs.readdir(path.join(fixture.root, 'uploads'));
  assert.deepEqual(uploads, []);
});
