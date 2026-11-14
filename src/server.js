require('dotenv').config();
const express = require('express');
const path = require('path');
const alertManager = require('./alertManager');
const rssService = require('./rssService');
const poller = require('./poller');
const stockResolver = require('./stockResolver');
const telegramService = require('./telegramService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// List of connected Server-Sent Event (SSE) clients
const sseClients = new Set();

// Forward alertManager events to SSE clients
alertManager.on('alert', (alertData) => {
  const payload = `data: ${JSON.stringify({ type: 'alert', data: alertData })}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
});

alertManager.on('watchlistUpdated', (watchlist) => {
  const payload = `data: ${JSON.stringify({ type: 'watchlist', data: watchlist })}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
});

// SSE endpoint for live dashboard updates
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send initial keepalive
  res.write(`data: ${JSON.stringify({ type: 'connected', time: new Date().toISOString() })}\n\n`);

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

/**
 * GET /api/alerts
 * Get all detected alerts
 */
app.get('/api/alerts', (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  const alerts = alertManager.getAlerts(limit);
  res.json({
    success: true,
    count: alerts.length,
    alerts
  });
});

/**
 * POST /api/alerts/clear
 * Clear all alert history
 */
app.post('/api/alerts/clear', (req, res) => {
  alertManager.clearAlerts();
  res.json({
    success: true,
    message: 'Alert history cleared.'
  });
});

/**
 * GET /api/feed
 * Fetch and return parsed RSS corporate actions from NSE
 */
app.get('/api/feed', async (req, res) => {
  try {
    const forceRefresh = req.query.force === 'true';
    let feed = (!forceRefresh && poller.getCachedFeed()) || null;

    if (!feed) {
      feed = await rssService.getLatestActions();
    }

    // Filter by dividend if requested
    let actions = feed.actions;
    if (req.query.dividendsOnly === 'true') {
      actions = actions.filter(a => a.isDividend);
    }

    res.json({
      success: true,
      channelTitle: feed.channelTitle,
      lastBuildDate: feed.lastBuildDate,
      totalCount: feed.itemCount,
      filteredCount: actions.length,
      actions
    });
  } catch (err) {
    console.error('[API] Error fetching RSS feed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/feed/check
 * Trigger manual feed fetch and evaluate alerts right now
 */
app.post('/api/feed/check', async (req, res) => {
  try {
    const pollResult = await poller.poll();
    res.json({
      success: true,
      message: 'Feed checked successfully.',
      ...pollResult
    });
  } catch (err) {
    console.error('[API] Error checking feed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/status
 * Get status of poller, yield filter, and alerts
 */
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    poller: poller.getStatus(),
    yieldFilterPaused: alertManager.isYieldFilterPaused(),
    yieldThreshold: alertManager.getYieldThreshold(),
    alertsCount: alertManager.getAlerts().length,
    systemTime: new Date().toISOString()
  });
});

/**
 * GET /api/search?q=tcs
 * Helper endpoint to autocomplete/search NSE symbols & companies
 */
app.get('/api/search', (req, res) => {
  const query = req.query.q;
  if (!query || query.length < 1) {
    return res.json({ success: true, results: [] });
  }
  const resolved = stockResolver.resolve(query);
  return res.json({
    success: true,
    results: resolved ? [resolved] : []
  });
});

/**
 * GET /api/telegram/status
 * Get Telegram integration status
 */
app.get('/api/telegram/status', (req, res) => {
  res.json({
    success: true,
    ...telegramService.getStatus()
  });
});

/**
 * POST /api/telegram/config
 * Update Telegram botToken and chatId
 */
app.post('/api/telegram/config', (req, res) => {
  const { botToken, chatId, dryRun } = req.body;
  telegramService.updateConfig({ botToken, chatId, dryRun });
  res.json({
    success: true,
    message: 'Telegram configuration updated.',
    ...telegramService.getStatus()
  });
});

/**
 * GET /api/telegram/updates
 * Fetch bot updates to discover chat IDs
 */
app.get('/api/telegram/updates', async (req, res) => {
  try {
    const updates = await telegramService.getLatestUpdates();
    res.json({
      success: true,
      count: updates.length,
      updates
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/telegram/test
 * Send a test notification to Telegram bot
 */
app.post('/api/telegram/test', async (req, res) => {
  try {
    const sampleAlert = {
      stockSymbol: 'VEDL',
      stockName: 'Vedanta Limited',
      isDividend: true,
      yieldQ: 5.25,
      yieldThreshold: alertManager.getYieldThreshold(),
      price: 380.95,
      divPerShare: 20,
      dividendAmount: 'RS 20 PER SHARE',
      purpose: 'INTERIM DIVIDEND - RS 20 PER SHARE',
      exDate: '25-Nov-2026',
      recordDate: '25-Nov-2026',
      series: 'EQ',
      link: 'https://www.nseindia.com/companies-listing/corporate-filings-actions',
      pubDate: new Date().toISOString(),
      detectedAt: new Date().toISOString()
    };

    const result = await telegramService.sendDividendAlert(sampleAlert);
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }
    res.json({
      success: true,
      message: 'Test alert sent to Telegram successfully.',
      result
    });
  } catch (err) {
    console.error('[API] Telegram test error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start poller and server when executed directly
let server = null;
if (require.main === module) {
  poller.start();
  server = app.listen(PORT, () => {
    console.log(`\n============================================================`);
    console.log(`🚀 NSE Dividend Alert App is running on http://localhost:${PORT}`);
    console.log(`📡 RSS Feed: https://nsearchives.nseindia.com/content/RSS/Corporate_action.xml`);
    const modeDesc = alertManager.isYieldFilterPaused()
      ? '🔔 Filter: PAUSED (Notifying on ALL Dividend Announcements)'
      : `🎯 Filter: Yield > ${alertManager.getYieldThreshold()}%`;
    console.log(`${modeDesc}`);
    console.log(`============================================================\n`);

    // Notify Telegram group that server has started
    telegramService.sendStartupNotification({
      yieldFilterPaused: alertManager.isYieldFilterPaused(),
      yieldThreshold: alertManager.getYieldThreshold()
    }).catch(err => {
      console.warn('[Telegram] Startup notification notice:', err.message);
    });
  });
}

module.exports = { app, server };
