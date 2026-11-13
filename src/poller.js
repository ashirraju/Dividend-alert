const rssService = require('./rssService');
const alertManager = require('./alertManager');

class Poller {
  constructor() {
    this.intervalId = null;
    this.intervalMs = parseInt(process.env.POLL_INTERVAL_MS || '300000', 10); // default 5 mins
    this.isPolling = false;
    this.lastPollTime = null;
    this.lastError = null;
    this.pollCount = 0;
    this.cachedFeed = null;
  }

  start(intervalMs = null) {
    if (intervalMs) {
      this.intervalMs = intervalMs;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    console.log(`[Poller] Starting automated background poller (every ${Math.round(this.intervalMs / 1000)}s)...`);
    
    // Run an initial poll immediately
    this.poll();

    this.intervalId = setInterval(() => {
      this.poll();
    }, this.intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[Poller] Poller stopped.');
    }
  }

  async poll() {
    if (this.isPolling) {
      console.log('[Poller] Poll already in progress, skipping tick.');
      return { skipped: true, reason: 'Already in progress' };
    }

    this.isPolling = true;
    this.pollCount++;
    const startTime = Date.now();

    try {
      console.log(`[Poller] Fetching RSS feed (poll #${this.pollCount})...`);
      const parsedFeed = await rssService.getLatestActions();
      this.cachedFeed = parsedFeed;
      this.lastPollTime = new Date().toISOString();
      this.lastError = null;

      const { newAlertsCount, newAlerts } = await alertManager.evaluateActions(parsedFeed.actions);

      const elapsed = Date.now() - startTime;
      console.log(`[Poller] Poll completed in ${elapsed}ms: ${parsedFeed.itemCount} items parsed, ${newAlertsCount} new alerts triggered.`);

      return {
        success: true,
        itemCount: parsedFeed.itemCount,
        newAlertsCount,
        newAlerts,
        elapsedMs: elapsed,
        timestamp: this.lastPollTime
      };
    } catch (err) {
      this.lastError = err.message;
      console.error(`[Poller] Error during poll #${this.pollCount}:`, err.message);
      return {
        success: false,
        error: err.message,
        timestamp: new Date().toISOString()
      };
    } finally {
      this.isPolling = false;
    }
  }

  getStatus() {
    return {
      isRunning: !!this.intervalId,
      intervalMs: this.intervalMs,
      intervalSeconds: Math.round(this.intervalMs / 1000),
      isPolling: this.isPolling,
      lastPollTime: this.lastPollTime,
      lastError: this.lastError,
      pollCount: this.pollCount,
      cachedItemCount: this.cachedFeed?.itemCount || 0
    };
  }

  getCachedFeed() {
    return this.cachedFeed;
  }
}

module.exports = new Poller();
