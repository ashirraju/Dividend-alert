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

  test('POST /api/stocks - add array of stocks', async () => {
    const res = await fetch(`${baseUrl}/api/stocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stocks: ['TCS', 'INFY'] })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.success, true);
    assert.ok(data.watchlistCount >= 2);
  });

  test('POST /api/stocks - add comma-separated string', async () => {
    const res = await fetch(`${baseUrl}/api/stocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stocks: 'HDFCBANK, RELIANCE' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.success, true);
  });

  test('GET /api/stocks - retrieve watchlist', async () => {
    const res = await fetch(`${baseUrl}/api/stocks`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.stocks));
    assert.ok(data.stocks.some(s => s.symbol === 'TCS'));
  });

  test('DELETE /api/stocks/:symbol - remove stock', async () => {
    const res = await fetch(`${baseUrl}/api/stocks/TCS`, { method: 'DELETE' });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);

    const getRes = await fetch(`${baseUrl}/api/stocks`);
    const getData = await getRes.json();
    assert.strictEqual(getData.stocks.some(s => s.symbol === 'TCS'), false);
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
    assert.strictEqual(typeof data.watchlistCount, 'number');
  });
});
