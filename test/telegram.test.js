const { test, describe } = require('node:test');
const assert = require('node:assert');
const telegramService = require('../src/telegramService');

describe('Telegram Service Test Suite', () => {

  test('should build formatted HTML message with emojis and details', () => {
    const alert = {
      stockSymbol: 'MRF',
      stockName: 'MRF Limited',
      isDividend: true,
      dividendAmount: 'RS 3 PER SHARE',
      purpose: 'INTERIM DIVIDEND - RS 3 PER SHARE',
      exDate: '17-Nov-2026',
      recordDate: '17-Nov-2026',
      series: 'EQ',
      link: 'https://www.nseindia.com/companies-listing/corporate-filings-actions',
      pubDate: '2026-11-13T12:11:45.000Z'
    };

    const message = telegramService.buildDividendMessage(alert);
    assert.ok(message.includes('🔔💰 <b>NSE Dividend Alert</b>'));
    assert.ok(message.includes('<b>MRF</b> — MRF Limited'));
    assert.ok(message.includes('RS 3 PER SHARE'));
    assert.ok(message.includes('17-Nov-2026'));
    assert.ok(message.includes('Official NSE Filing'));
  });

  test('should build formatted HTML message with dividend yield and LTP', () => {
    const alert = {
      stockSymbol: 'VEDL',
      stockName: 'Vedanta Limited',
      isDividend: true,
      yieldQ: 5.25,
      yieldThreshold: 3,
      price: 380.95,
      divPerShare: 20,
      dividendAmount: 'RS 20 PER SHARE',
      purpose: 'INTERIM DIVIDEND - RS 20 PER SHARE',
      exDate: '25-Nov-2026',
      recordDate: '25-Nov-2026',
      series: 'EQ',
      link: 'https://example.com'
    };

    const message = telegramService.buildDividendMessage(alert);
    assert.ok(message.includes('5.25%'));
    assert.ok(message.includes('₹380.95'));
    assert.ok(message.includes('₹20 per share'));
    assert.ok(message.includes('> 3% threshold'));
  });

  test('should escape HTML characters in symbols and purposes', () => {
    const alert = {
      stockSymbol: 'TEST<>&"',
      stockName: 'Test & Co <Ltd>',
      isDividend: false,
      purpose: 'AGM & EGM <Notice>',
      exDate: '15-Nov-2026'
    };

    const message = telegramService.buildDividendMessage(alert);
    assert.ok(!message.includes('TEST<>&"'));
    assert.ok(message.includes('TEST&lt;&gt;&amp;&quot;'));
    assert.ok(message.includes('Test &amp; Co &lt;Ltd&gt;'));
  });

  test('should handle dryRun mode without sending network request', async () => {
    telegramService.updateConfig({ dryRun: true });
    const res = await telegramService.sendDividendAlert({
      stockSymbol: 'DRYRUN',
      stockName: 'Dry Run Test',
      isDividend: true,
      purpose: 'TEST DIVIDEND'
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.dryRun, true);
  });

  test('should send startup notification in dryRun mode', async () => {
    telegramService.updateConfig({ dryRun: true });
    const res = await telegramService.sendStartupNotification({ watchlistCount: 5 });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.dryRun, true);
  });
});
