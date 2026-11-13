const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { app } = require('../src/server');

describe('API Endpoints Test Suite', () => {
  let serverInstance;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      serverInstance = http.createServer(app);
      serverInstance.listen(0, '127.0.0.1', () => {
        const port = serverInstance.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (serverInstance) {
      await new Promise((resolve) => serverInstance.close(resolve));
    }
  });

  test('POST /api/stocks - should return 404 since add stock API was removed', async () => {
    const res = await fetch(`${baseUrl}/api/stocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stocks: ['TCS'] })
    });
    assert.strictEqual(res.status, 404);
  });

  test('GET /api/alerts - retrieve alerts', async () => {
    const res = await fetch(`${baseUrl}/api/alerts`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.alerts));
  });

  test('GET /api/status - retrieve poller & system status', async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.ok(data.poller);
    assert.strictEqual(typeof data.yieldThreshold, 'number');
    assert.strictEqual(typeof data.alertsCount, 'number');
  });

  test('GET /api/telegram/status - retrieve telegram status', async () => {
    const res = await fetch(`${baseUrl}/api/telegram/status`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(typeof data.configured, 'boolean');
  });
});
