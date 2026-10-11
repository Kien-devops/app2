const test = require('node:test');
const assert = require('node:assert');
const { createHealthResponse } = require('../src/health');

test('shared createHealthResponse generates required contract fields', () => {
  const payload = createHealthResponse('test-service');
  assert.strictEqual(payload.status, 'ok');
  assert.strictEqual(payload.service, 'test-service');
  assert.ok(payload.timestamp);
  assert.strictEqual(typeof payload.uptime, 'number');
});

test('shared createHealthResponse falls back to unknown if region env vars missing', () => {
  const origAws = process.env.AWS_REGION;
  const origReg = process.env.REGION;
  delete process.env.AWS_REGION;
  delete process.env.REGION;

  try {
    const payload = createHealthResponse('test-service');
    assert.strictEqual(payload.region, 'unknown');
  } finally {
    if (origAws !== undefined) process.env.AWS_REGION = origAws;
    if (origReg !== undefined) process.env.REGION = origReg;
  }
});

test('shared createHealthResponse respects AWS_REGION env var', () => {
  const origAws = process.env.AWS_REGION;
  process.env.AWS_REGION = 'ap-northeast-1';
  try {
    const payload = createHealthResponse('test-service');
    assert.strictEqual(payload.region, 'ap-northeast-1');
  } finally {
    if (origAws !== undefined) {
      process.env.AWS_REGION = origAws;
    } else {
      delete process.env.AWS_REGION;
    }
  }
});

test('shared createHealthResponse respects REGION env var if AWS_REGION not set', () => {
  const origAws = process.env.AWS_REGION;
  const origReg = process.env.REGION;
  delete process.env.AWS_REGION;
  process.env.REGION = 'ap-southeast-1';
  try {
    const payload = createHealthResponse('test-service');
    assert.strictEqual(payload.region, 'ap-southeast-1');
  } finally {
    if (origAws !== undefined) process.env.AWS_REGION = origAws;
    if (origReg !== undefined) {
      process.env.REGION = origReg;
    } else {
      delete process.env.REGION;
    }
  }
});
