const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const stockResolver = require('../src/stockResolver');
const rssService = require('../src/rssService');
const alertManager = require('../src/alertManager');
const priceService = require('../src/priceService');

describe('Dividend Alert App Test Suite', () => {

  describe('Stock Resolver', () => {
    before(() => {
      stockResolver.loadCsv(path.join(__dirname, '../data/EQUITY_L.csv'));
    });

    test('should resolve symbol MRF to MRF Limited', () => {
      const res = stockResolver.resolve('MRF');
      assert.ok(res);
      assert.strictEqual(res.symbol, 'MRF');
      assert.strictEqual(res.companyName, 'MRF Limited');
    });

    test('should resolve symbol EMAMILTD to Emami Limited', () => {
      const res = stockResolver.resolve('EMAMILTD');
      assert.ok(res);
      assert.strictEqual(res.symbol, 'EMAMILTD');
      assert.strictEqual(res.companyName, 'Emami Limited');
    });

    test('should match title containing company name', () => {
      const stockEntry = stockResolver.resolve('MRF');
      const match = stockResolver.matches(stockEntry, 'MRF Limited - Ex-Date: 17-Nov-2026', 'SERIES:EQ |PURPOSE:INTERIM DIVIDEND - RS 3 PER SHARE');
      assert.strictEqual(match.matched, true);
    });

    test('should not match unrelated stocks', () => {
      const stockEntry = stockResolver.resolve('TCS');
      const match = stockResolver.matches(stockEntry, 'MRF Limited - Ex-Date: 17-Nov-2026', 'SERIES:EQ |PURPOSE:INTERIM DIVIDEND - RS 3 PER SHARE');
      assert.strictEqual(match.matched, false);
    });
  });

  describe('RSS XML Parsing & Dividend Amount Extraction', () => {
    const sampleXml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <title>NSE News - Latest Corporates Action</title>
        <link>https://www.nseindia.com/companies-listing/corporate-filings-actions</link>
        <description>National Stock Exchange - Corporate Action</description>
        <lastBuildDate>13-Nov-2026 12:00:50</lastBuildDate>
        <item>
          <title>Dynamatic Technologies Limited - Ex-Date: 13-Nov-2026</title>
          <link>https://www.nseindia.com/companies-listing/corporate-filings-actions</link>
          <description>SERIES:EQ |PURPOSE:INTERIM DIVIDEND - RS 2 PER SHARE |FACE VALUE:10 |RECORD DATE:13-Nov-2026 |BOOK CLOSURE START DATE:- |BOOK CLOSURE END DATE:-</description>
          <pubDate>13-Nov-2026 12:11:45</pubDate>
        </item>
        <item>
          <title>FDC Limited - Ex-Date: 13-Nov-2026</title>
          <link>https://www.nseindia.com/companies-listing/corporate-filings-actions</link>
          <description>SERIES:EQ |PURPOSE:BUY BACK |FACE VALUE:1 |RECORD DATE:13-Nov-2026 |BOOK CLOSURE START DATE:- |BOOK CLOSURE END DATE:-</description>
          <pubDate>13-Nov-2026 12:11:45</pubDate>
        </item>
      </channel>
    </rss>`;

    test('should parse RSS feed XML and extract numeric divPerShare', () => {
      const parsed = rssService.parseXml(sampleXml);
      assert.strictEqual(parsed.itemCount, 2);
      assert.strictEqual(parsed.actions.length, 2);

      const divItem = parsed.actions[0];
      assert.strictEqual(divItem.companyName, 'Dynamatic Technologies Limited');
      assert.strictEqual(divItem.exDate, '13-Nov-2026');
      assert.strictEqual(divItem.isDividend, true);
      assert.strictEqual(divItem.dividendAmount, 'RS 2 PER SHARE');
      assert.strictEqual(divItem.divPerShare, 2);
      assert.strictEqual(divItem.recordDate, '13-Nov-2026');

      const nonDivItem = parsed.actions[1];
      assert.strictEqual(nonDivItem.companyName, 'FDC Limited');
      assert.strictEqual(nonDivItem.isDividend, false);
      assert.strictEqual(nonDivItem.divPerShare, null);
    });
  });

  describe('Alert Manager with Dividend Yield Filter (yieldQ > 3%)', () => {

    test('should calculate yield and skip notification when yield <= 3%', async () => {
      alertManager.clearAlerts();
      // Pre-seed cache with price for MRF: 120,000
      priceService.cache.set('MRF', { ltp: 120000, currency: 'INR', timestamp: Date.now() });

      const sampleActions = [
        {
          id: 'test_low_yield',
          companyName: 'MRF Limited',
          rawTitle: 'MRF Limited - Ex-Date: 17-Nov-2026',
          rawDescription: 'SERIES:EQ |PURPOSE:INTERIM DIVIDEND - RS 3 PER SHARE |FACE VALUE:10 |RECORD DATE:17-Nov-2026',
          isDividend: true,
          dividendAmount: 'RS 3 PER SHARE',
          divPerShare: 3,
          purpose: 'INTERIM DIVIDEND - RS 3 PER SHARE',
          exDate: '17-Nov-2026',
          recordDate: '17-Nov-2026',
          series: 'EQ',
          link: 'https://example.com'
        }
      ];

      const evalRes = await alertManager.evaluateActions(sampleActions);
      // Yield = (3 / 120000) * 100 = 0.0025% <= 3%, so notification is skipped
      assert.strictEqual(evalRes.newAlertsCount, 0);

      const allAlerts = alertManager.getAlerts();
      assert.strictEqual(allAlerts.length, 1);
      assert.strictEqual(allAlerts[0].meetsThreshold, false);
      assert.ok(allAlerts[0].yieldQ < 3);
    });

    test('should calculate yield and notify when yield > 3%', async () => {
      alertManager.clearAlerts();
      // Pre-seed cache with price for VEDL: 400
      priceService.cache.set('VEDL', { ltp: 400, currency: 'INR', timestamp: Date.now() });

      const sampleActions = [
        {
          id: 'test_high_yield',
          companyName: 'Vedanta Limited',
          rawTitle: 'Vedanta Limited - Ex-Date: 25-Nov-2026',
          rawDescription: 'SERIES:EQ |PURPOSE:INTERIM DIVIDEND - RS 20 PER SHARE |FACE VALUE:1 |RECORD DATE:25-Nov-2026',
          isDividend: true,
          dividendAmount: 'RS 20 PER SHARE',
          divPerShare: 20,
          purpose: 'INTERIM DIVIDEND - RS 20 PER SHARE',
          exDate: '25-Nov-2026',
          recordDate: '25-Nov-2026',
          series: 'EQ',
          link: 'https://example.com'
        }
      ];

      const evalRes = await alertManager.evaluateActions(sampleActions);
      // Yield = (20 / 400) * 100 = 5.0% > 3%, notification triggered!
      assert.strictEqual(evalRes.newAlertsCount, 1);
      assert.strictEqual(evalRes.newAlerts[0].stockSymbol, 'VEDL');
      assert.strictEqual(evalRes.newAlerts[0].yieldQ, 5.0);
      assert.strictEqual(evalRes.newAlerts[0].meetsThreshold, true);

      // Check deduplication
      const secondEval = await alertManager.evaluateActions(sampleActions);
      assert.strictEqual(secondEval.newAlertsCount, 0);
    });
  });
});
