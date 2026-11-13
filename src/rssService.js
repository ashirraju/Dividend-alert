const { XMLParser } = require('fast-xml-parser');
const crypto = require('crypto');

const DEFAULT_RSS_URL = 'https://nsearchives.nseindia.com/content/RSS/Corporate_action.xml';

class RssService {
  constructor(rssUrl = DEFAULT_RSS_URL) {
    this.rssUrl = process.env.NSE_RSS_URL || rssUrl;
    this.parser = new XMLParser({
      ignoreAttributes: false,
      trimValues: true,
      parseTagValue: false
    });
  }

  /**
   * Fetch raw XML feed from NSE
   */
  async fetchFeedXml() {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/xml, text/xml, */*; q=0.01',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.nseindia.com/',
      'Cache-Control': 'no-cache'
    };

    const response = await fetch(this.rssUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch NSE RSS feed: HTTP ${response.status} ${response.statusText}`);
    }

    const xml = await response.text();
    return xml;
  }

  /**
   * Parse XML string into structured corporate action objects
   */
  parseXml(xmlText) {
    const parsed = this.parser.parse(xmlText);
    const channel = parsed?.rss?.channel;

    if (!channel) {
      throw new Error('Invalid RSS structure: missing <channel>');
    }

    const rawItems = channel.item || [];
    const itemsArray = Array.isArray(rawItems) ? rawItems : [rawItems];

    const actions = itemsArray.map(item => this.normalizeItem(item)).filter(Boolean);

    return {
      channelTitle: channel.title || 'NSE Corporate Actions',
      lastBuildDate: channel.lastBuildDate || new Date().toISOString(),
      itemCount: actions.length,
      actions
    };
  }

  /**
   * Normalize an individual RSS item
   */
  normalizeItem(item) {
    if (!item || !item.title) return null;

    const rawTitle = (item.title || '').trim();
    const rawDesc = (item.description || '').trim();
    const link = item.link || 'https://www.nseindia.com/companies-listing/corporate-filings-actions';
    const pubDate = item.pubDate || '';

    // Title format: "Dynamatic Technologies Limited - Ex-Date: 13-Nov-2026"
    let companyName = rawTitle;
    let exDate = '';

    const exDateMatch = rawTitle.match(/^(.*?)\s*-\s*Ex-Date:\s*([^\n\r]+)/i);
    if (exDateMatch) {
      companyName = exDateMatch[1].trim();
      exDate = exDateMatch[2].trim();
    }

    // Description format:
    // "SERIES:EQ |PURPOSE:INTERIM DIVIDEND - RS 2 PER SHARE |FACE VALUE:10 |RECORD DATE:13-Nov-2026 |..."
    const parsedDesc = this.parseDescription(rawDesc);

    const purpose = parsedDesc.purpose || rawDesc;
    const isDividend = /dividend/i.test(purpose);

    // Extract dividend amount if available (e.g. "RS 2 PER SHARE" or "RE 0.30 PER SHARE")
    let dividendAmount = null;
    let divPerShare = null;

    const divMatch = purpose.match(/(R[es]\.?\s*[\d.]+(?:\s*PER\s*SHARE)?|\d+%\s*DIVIDEND)/i);
    if (divMatch) {
      dividendAmount = divMatch[1].trim();
    }

    // Parse numeric dividend per share
    const numMatch = purpose.match(/R[es]\.?\s*([\d.]+)/i);
    if (numMatch) {
      const parsedNum = parseFloat(numMatch[1]);
      if (!isNaN(parsedNum)) {
        divPerShare = parsedNum;
      }
    } else {
      // Check for percentage dividend (e.g. 50% DIVIDEND on FACE VALUE: 10)
      const pctMatch = purpose.match(/(\d+(?:\.\d+)?)%\s*DIVIDEND/i);
      const faceValNum = parseFloat(parsedDesc.faceValue || '');
      if (pctMatch && !isNaN(faceValNum) && faceValNum > 0) {
        divPerShare = (parseFloat(pctMatch[1]) / 100) * faceValNum;
        if (!dividendAmount) {
          dividendAmount = `RS ${divPerShare.toFixed(2)} PER SHARE (${pctMatch[1]}%)`;
        }
      }
    }

    // Generate unique ID for deduplication
    const id = crypto
      .createHash('md5')
      .update(`${companyName}|${exDate}|${purpose}|${pubDate}`)
      .digest('hex');

    return {
      id,
      companyName,
      exDate,
      purpose,
      isDividend,
      dividendAmount,
      divPerShare,
      series: parsedDesc.series || 'EQ',
      faceValue: parsedDesc.faceValue || '',
      recordDate: parsedDesc.recordDate || '',
      bookClosureStart: parsedDesc.bookClosureStart || '',
      bookClosureEnd: parsedDesc.bookClosureEnd || '',
      rawTitle,
      rawDescription: rawDesc,
      link,
      pubDate,
      fetchedAt: new Date().toISOString()
    };
  }

  /**
   * Parse key-value pipe separated fields from description
   */
  parseDescription(desc) {
    const result = {};
    if (!desc) return result;

    const tokens = desc.split('|');
    for (const token of tokens) {
      const idx = token.indexOf(':');
      if (idx > -1) {
        const key = token.slice(0, idx).trim().toUpperCase();
        const value = token.slice(idx + 1).trim();

        if (key === 'SERIES') result.series = value;
        else if (key === 'PURPOSE') result.purpose = value;
        else if (key === 'FACE VALUE') result.faceValue = value;
        else if (key === 'RECORD DATE') result.recordDate = value;
        else if (key.includes('BOOK CLOSURE START')) result.bookClosureStart = value;
        else if (key.includes('BOOK CLOSURE END')) result.bookClosureEnd = value;
      }
    }
    return result;
  }

  /**
   * Fetch and parse feed in one step
   */
  async getLatestActions() {
    const xml = await this.fetchFeedXml();
    return this.parseXml(xml);
  }
}

module.exports = new RssService();
