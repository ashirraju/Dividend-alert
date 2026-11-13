const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const stockResolver = require('./stockResolver');
const telegramService = require('./telegramService');
const priceService = require('./priceService');

class AlertManager extends EventEmitter {
  constructor() {
    super();
    this.alertsFile = path.join(__dirname, '../data/alerts.json');
    this.alerts = [];    // Array of triggered alerts
    this.seenActionIds = new Set();
    this.minYieldThreshold = parseFloat(process.env.MIN_DIVIDEND_YIELD || '3');

    this.init();
  }

  setYieldThreshold(threshold) {
    if (typeof threshold === 'number' && !isNaN(threshold) && threshold >= 0) {
      this.minYieldThreshold = threshold;
    }
  }

  getYieldThreshold() {
    return this.minYieldThreshold;
  }

  init() {
    stockResolver.loadCsv();
    this.loadAlerts();
  }

  loadAlerts() {
    try {
      if (fs.existsSync(this.alertsFile)) {
        const raw = fs.readFileSync(this.alertsFile, 'utf8');
        this.alerts = JSON.parse(raw);
        for (const alert of this.alerts) {
          if (alert.actionId) this.seenActionIds.add(alert.actionId);
        }
        console.log(`[AlertManager] Loaded ${this.alerts.length} historical alerts.`);
      }
    } catch (err) {
      console.error('[AlertManager] Error reading alerts history:', err.message);
      this.alerts = [];
    }
  }

  saveAlerts() {
    try {
      fs.writeFileSync(this.alertsFile, JSON.stringify(this.alerts, null, 2), 'utf8');
    } catch (err) {
      console.error('[AlertManager] Failed to persist alerts:', err.message);
    }
  }

  getAlerts(limit = 100) {
    return this.alerts.slice(-limit).reverse();
  }

  clearAlerts() {
    this.alerts = [];
    this.seenActionIds.clear();
    this.saveAlerts();
    return true;
  }

  /**
   * Check all corporate actions directly from RSS feed and generate alerts.
   * Yield rule: const yieldQ = (divPerShare / price) * 100;
   * If yieldQ > 3 then only notify users (price is ltp of the stock).
   */
  async evaluateActions(actions) {
    if (!Array.isArray(actions) || actions.length === 0) {
      return { newAlertsCount: 0, newAlerts: [] };
    }

    const newAlerts = [];

    for (const action of actions) {
      // Automatically resolve company name from action to NSE symbol
      const resolvedStock = stockResolver.resolve(action.companyName);
      const symbol = resolvedStock?.symbol || null;
      const companyName = resolvedStock?.companyName || action.companyName;

      const alertKey = `${symbol || companyName}_${action.id}`;

      // Check if already alerted
      if (!this.seenActionIds.has(alertKey)) {
        this.seenActionIds.add(alertKey);

        // Fetch real-time LTP (price) for the stock
        let price = null;
        if (symbol) {
          try {
            const priceData = await priceService.getLtp(symbol);
            price = priceData?.ltp ?? null;
          } catch (priceErr) {
            console.warn(`[AlertManager] Could not fetch LTP for ${symbol}:`, priceErr.message);
          }
        }

        const divPerShare = action.divPerShare ?? null;
        let yieldQ = null;
        let shouldNotify = false;

        if (action.isDividend && divPerShare !== null && price !== null && price > 0) {
          // Formula: const yieldQ = (divPerShare / price) * 100;
          yieldQ = (divPerShare / price) * 100;

          // Rule: if yieldQ > 3 then only notify users
          if (yieldQ > this.minYieldThreshold) {
            shouldNotify = true;
          }
        }

        const alertObj = {
          id: `alt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          actionId: alertKey,
          stockSymbol: symbol,
          stockName: companyName,
          isDividend: action.isDividend,
          dividendAmount: action.dividendAmount,
          divPerShare,
          price, // LTP of the stock
          yieldQ: yieldQ !== null ? parseFloat(yieldQ.toFixed(2)) : null,
          yieldThreshold: this.minYieldThreshold,
          meetsThreshold: shouldNotify,
          purpose: action.purpose,
          exDate: action.exDate,
          recordDate: action.recordDate,
          series: action.series,
          faceValue: action.faceValue,
          companyFromFeed: action.companyName,
          link: action.link,
          pubDate: action.pubDate,
          detectedAt: new Date().toISOString()
        };

        this.alerts.push(alertObj);

        if (shouldNotify) {
          newAlerts.push(alertObj);

          // Trigger Console Alert with high visibility
          this.logConsoleAlert(alertObj);

          // Broadcast alert event for real-time SSE stream
          this.emit('alert', alertObj);

          // Dispatch Telegram notification
          telegramService.sendDividendAlert(alertObj).catch(err => {
            console.error('[AlertManager] Telegram notification error:', err.message);
          });
        } else if (action.isDividend) {
          const yieldStr = yieldQ !== null ? `${yieldQ.toFixed(2)}%` : 'N/A';
          const priceStr = price !== null ? `₹${price}` : 'N/A';
          const divStr = divPerShare !== null ? `₹${divPerShare}` : (action.dividendAmount || 'N/A');
          console.log(`[AlertManager] ℹ️ Alert notification skipped for ${companyName} (${symbol || 'N/A'}): Yield ${yieldStr} <= ${this.minYieldThreshold}% threshold (LTP: ${priceStr}, Div: ${divStr}).`);
        }
      }
    }

    if (newAlerts.length > 0) {
      this.saveAlerts();
    }

    return {
      newAlertsCount: newAlerts.length,
      newAlerts
    };
  }

  /**
   * Formatted visual console alert banner
   */
  logConsoleAlert(alert) {
    const divider = '============================================================';
    const tag = '🔔💰 [HIGH YIELD DIVIDEND ALERT] 💰🔔';
    
    console.log('\n' + divider);
    console.log(`\x1b[1m\x1b[32m${tag}\x1b[0m`);
    console.log(`Company:        \x1b[1m${alert.stockName} (${alert.stockSymbol || 'N/A'})\x1b[0m`);
    if (alert.yieldQ !== null) {
      console.log(`Dividend Yield: \x1b[1m\x1b[32m${alert.yieldQ}%\x1b[0m (> ${alert.yieldThreshold}% threshold met)`);
    }
    if (alert.price !== null) {
      console.log(`Stock LTP:      \x1b[1m\x1b[36m₹${alert.price}\x1b[0m`);
    }
    if (alert.divPerShare !== null) {
      console.log(`Div Per Share:  \x1b[1m\x1b[36m₹${alert.divPerShare}\x1b[0m`);
    }
    console.log(`Purpose:        \x1b[33m${alert.purpose}\x1b[0m`);
    console.log(`Ex-Date:        \x1b[35m${alert.exDate || 'N/A'}\x1b[0m`);
    console.log(`Record Date:    ${alert.recordDate || 'N/A'}`);
    console.log(`Pub Date:       ${alert.pubDate || 'N/A'}`);
    console.log(`Detected At:    ${alert.detectedAt}`);
    console.log(divider + '\n');
  }
}

module.exports = new AlertManager();
