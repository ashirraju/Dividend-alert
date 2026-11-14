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

  describe('Alert Manager - Paused Yield Filter (Notify ALL Dividend Alerts)', () => {

    test('should notify all dividend alerts when yield filter is paused', async () => {
      alertManager.clearAlerts();
      alertManager.setPauseYieldFilter(true);
      priceService.cache.set('MRF', { ltp: 120000, currency: 'INR', timestamp: Date.now() });

      const sampleActions = [
        {
          id: 'test_mrf_div',
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
      // Yield filter is paused -> notification triggered for ALL dividends
      assert.strictEqual(evalRes.newAlertsCount, 1);
      assert.strictEqual(evalRes.newAlerts[0].stockSymbol, 'MRF');
      assert.strictEqual(evalRes.newAlerts[0].meetsThreshold, true);
      assert.ok(evalRes.newAlerts[0].yieldQ !== null);
    });

    test('should not notify for non-dividend corporate actions', async () => {
      alertManager.clearAlerts();
      alertManager.setPauseYieldFilter(true);

      const nonDivActions = [
        {
          id: 'test_buyback',
          companyName: 'FDC Limited',
          rawTitle: 'FDC Limited - Ex-Date: 13-Nov-2026',
          rawDescription: 'SERIES:EQ |PURPOSE:BUY BACK |FACE VALUE:1',
          isDividend: false,
          dividendAmount: null,
          divPerShare: null,
          purpose: 'BUY BACK',
          exDate: '13-Nov-2026',
          series: 'EQ',
          link: 'https://example.com'
        }
      ];

      const evalRes = await alertManager.evaluateActions(nonDivActions);
      assert.strictEqual(evalRes.newAlertsCount, 0);
    });

    test('should respect yield filter when pause is toggled off', async () => {
      alertManager.clearAlerts();
      alertManager.setPauseYieldFilter(false); // Enable filter > 3%
      priceService.cache.set('MRF', { ltp: 120000, currency: 'INR', timestamp: Date.now() });

      const sampleActions = [
        {
          id: 'test_mrf_low_yield',
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
      // Yield = 0.0025% <= 3%, notification skipped
      assert.strictEqual(evalRes.newAlertsCount, 0);

      // Restore paused state
      alertManager.setPauseYieldFilter(true);
    });
  });
});
