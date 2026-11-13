const https = require('https');

class PriceService {
  constructor() {
    this.cache = new Map(); // symbol -> { ltp, timestamp }
    this.cacheTtlMs = 5 * 60 * 1000; // 5 minutes cache
    this.inFlight = new Map(); // symbol -> Promise
  }

  /**
   * Fetch LTP (Last Traded Price) for an NSE symbol
   * @param {string} symbol - NSE equity symbol (e.g. 'MRF', 'TCS', 'EMAMILTD')
   * @returns {Promise<{ ltp: number|null, symbol: string, currency: string }>}
   */
  async getLtp(symbol) {
    if (!symbol || typeof symbol !== 'string') {
      return { symbol: '', ltp: null, currency: 'INR' };
    }

    const cleanSym = symbol.trim().toUpperCase().replace(/\.NS$/, '');

    // Check cache
    const cached = this.cache.get(cleanSym);
    if (cached && (Date.now() - cached.timestamp < this.cacheTtlMs)) {
      return { symbol: cleanSym, ltp: cached.ltp, currency: cached.currency, fromCache: true };
    }

    // Share in-flight request if one is already pending
    if (this.inFlight.has(cleanSym)) {
      return this.inFlight.get(cleanSym);
    }

    const promise = this._fetchPriceWithFallback(cleanSym)
      .then(res => {
        if (res.ltp !== null) {
          this.cache.set(cleanSym, {
            ltp: res.ltp,
            currency: res.currency,
            timestamp: Date.now()
          });
        }
        return res;
      })
      .finally(() => {
        this.inFlight.delete(cleanSym);
      });

    this.inFlight.set(cleanSym, promise);
    return promise;
  }

  async _fetchPriceWithFallback(symbol) {
    const hosts = [
      'query1.finance.yahoo.com',
      'query2.finance.yahoo.com'
    ];

    for (const host of hosts) {
      try {
        const result = await this._fetchFromHost(host, symbol);
        if (result && result.ltp !== null) {
          return result;
        }
      } catch (err) {
        // Continue to fallback host
      }
    }

    console.warn(`[PriceService] Could not retrieve LTP for ${symbol} from price providers.`);
    return { symbol, ltp: null, currency: 'INR', error: 'Price unavailable' };
  }

  _fetchFromHost(host, symbol) {
    return new Promise((resolve, reject) => {
      const path = `/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=1d`;
      const options = {
        hostname: host,
        port: 443,
        path,
        method: 'GET',
        family: 4, // IPv4 enforcement
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
          'Accept': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const data = JSON.parse(raw);
            const result = data?.chart?.result?.[0];
            const meta = result?.meta;
            if (!meta) {
              return resolve({ symbol, ltp: null, currency: 'INR' });
            }

            const ltp = meta.regularMarketPrice ?? meta.chartPreviousClose ?? meta.previousClose ?? null;
            resolve({
              symbol,
              ltp: ltp !== null ? parseFloat(ltp) : null,
              currency: meta.currency || 'INR'
            });
          } catch (parseErr) {
            reject(parseErr);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout fetching price for ${symbol} from ${host}`));
      });

      req.on('error', reject);
      req.end();
    });
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = new PriceService();
