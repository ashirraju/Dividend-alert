const https = require('https');

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function formatTimestamp(rawValue, timeZone = 'Asia/Kolkata') {
  if (!rawValue) return '';
  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) return rawValue;

  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone,
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  }
}

class TelegramService {
  constructor() {
    this.botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    this.chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
    this.timeZone = process.env.TIME_ZONE || 'Asia/Kolkata';
    this.dryRun = process.env.DRY_RUN === 'true';
  }

  isConfigured() {
    return !!(this.botToken && this.chatId);
  }

  updateConfig({ botToken, chatId, dryRun }) {
    if (botToken !== undefined) this.botToken = botToken.trim();
    if (chatId !== undefined) this.chatId = chatId.trim();
    if (dryRun !== undefined) this.dryRun = !!dryRun;
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      dryRun: this.dryRun,
      hasBotToken: !!this.botToken,
      chatId: this.chatId ? `${this.chatId.slice(0, 4)}***${this.chatId.slice(-3)}` : null,
      timeZone: this.timeZone
    };
  }

  buildDividendMessage(alert) {
    const symbol = normalizeText(alert.stockSymbol);
    const company = normalizeText(alert.stockName || alert.companyFromFeed);
    const hasYield = alert.yieldQ !== null && alert.yieldQ !== undefined;
    const header = hasYield
      ? `🔔💰 <b>NSE Dividend Alert (${alert.yieldQ}% Yield)</b>`
      : (alert.isDividend ? '🔔💰 <b>NSE Dividend Alert</b>' : '🔔📢 <b>NSE Corporate Action Alert</b>');
    const publishedAt = formatTimestamp(alert.pubDate || alert.detectedAt, this.timeZone);

    const parts = [header];

    if (symbol && company) {
      parts.push(`<b>${escapeHtml(symbol)}</b> — ${escapeHtml(company)}`);
    } else if (company) {
      parts.push(`<b>${escapeHtml(company)}</b>`);
    }

    const details = [];
    if (alert.divPerShare !== null && alert.divPerShare !== undefined) {
      details.push(`💰 <b>Dividend:</b> ₹${escapeHtml(String(alert.divPerShare))} per share`);
    } else if (alert.dividendAmount) {
      details.push(`💰 <b>Dividend:</b> ${escapeHtml(alert.dividendAmount)}`);
    }
    if (alert.price !== null && alert.price !== undefined) {
      details.push(`🏷️ <b>Stock LTP:</b> ₹${escapeHtml(String(alert.price))}`);
    }
    if (hasYield) {
      const yieldSuffix = alert.yieldThreshold && !alert.yieldFilterPaused ? ` (> ${alert.yieldThreshold}% threshold)` : '';
      details.push(`📈 <b>Dividend Yield:</b> <b>${escapeHtml(String(alert.yieldQ))}%</b>${yieldSuffix}`);
    }
    if (alert.exDate) {
      details.push(`📅 <b>Ex-Date:</b> ${escapeHtml(alert.exDate)}`);
    }
    if (alert.recordDate) {
      details.push(`📋 <b>Record Date:</b> ${escapeHtml(alert.recordDate)}`);
    }
    if (alert.series) {
      details.push(`🏷️ <b>Series:</b> ${escapeHtml(alert.series)}`);
    }

    if (details.length > 0) {
      parts.push(details.join('\n'));
    }

    if (alert.purpose) {
      parts.push(`<b>Purpose:</b>\n${escapeHtml(alert.purpose)}`);
    }

    if (publishedAt) {
      parts.push(`<i>Detected: ${escapeHtml(publishedAt)}</i>`);
    }

    parts.push('------');

    let message = parts.join('\n\n');

    if (alert.link) {
      message += `\n\n<a href="${escapeHtml(alert.link)}">🔗 Official NSE Filing</a>`;
    }

    return message;
  }

  /**
   * Robust HTTPS request with IPv4 enforcement (prevents IPv6 hang on local networks)
   */
  async makeTelegramRequest(method, payload = {}) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(payload);
      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${this.botToken}/${method}`,
        method: 'POST',
        family: 4, // Enforce IPv4 to avoid IPv6 timeout issues on macOS/ISPs
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let rawData = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          rawData += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(rawData);
            if (res.statusCode >= 200 && res.statusCode < 300 && parsed.ok) {
              resolve(parsed);
            } else {
              const desc = parsed.description || `HTTP ${res.statusCode}`;
              reject(new Error(desc));
            }
          } catch (e) {
            reject(new Error(`Failed to parse Telegram response: ${rawData.slice(0, 100)}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection to Telegram timed out after 15 seconds. Check internet connection.'));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(postData);
      req.end();
    });
  }

  async sendTelegramMessage(text, { disableWebPagePreview = true } = {}) {
    if (this.dryRun) {
      console.log('\n[Telegram dry-run] Would send message:');
      console.log(text);
      console.log('--------------------------------------\n');
      return { ok: true, dryRun: true };
    }

    if (!this.isConfigured()) {
      console.warn('[Telegram] Skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured in .env');
      return { ok: false, error: 'Telegram credentials not configured' };
    }

    try {
      const result = await this.makeTelegramRequest('sendMessage', {
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: disableWebPagePreview
      });
      console.log('[Telegram] Alert successfully delivered to Telegram chat.');
      return result;
    } catch (err) {
      let friendlyError = err.message;
      if (err.message.includes('chat not found')) {
        friendlyError = `Chat ID (${this.chatId}) not found. If this is a Channel or Group, ensure your bot @NseDividendAlert_bot is added to the channel/group as an administrator. If it is a personal chat, send /start to @NseDividendAlert_bot first.`;
      } else if (err.message.includes('Unauthorized')) {
        friendlyError = 'Invalid Telegram Bot Token. Please check TELEGRAM_BOT_TOKEN from @BotFather.';
      }
      console.error(`[Telegram] ${friendlyError}`);
      throw new Error(friendlyError);
    }
  }

  /**
   * Check bot's latest messages to help user find chat ID
   */
  async getLatestUpdates() {
    if (!this.botToken) return [];
    try {
      const result = await this.makeTelegramRequest('getUpdates', { limit: 10 });
      return result.result || [];
    } catch (err) {
      console.error('[Telegram] Failed to get updates:', err.message);
      return [];
    }
  }

  async sendDividendAlert(alert) {
    try {
      const message = this.buildDividendMessage(alert);
      return await this.sendTelegramMessage(message, { disableWebPagePreview: true });
    } catch (err) {
      console.error('[Telegram] Failed to send dividend alert:', err.message);
      return { ok: false, error: err.message };
    }
  }

  async sendStartupNotification({ yieldThreshold = 3 } = {}) {
    if (!this.isConfigured() && !this.dryRun) return;

    const startedAt = formatTimestamp(new Date().toISOString(), this.timeZone);
    const message = [
      '🚀 <b>NSE Dividend Alert Server Started</b>',
      `🕒 <i>${escapeHtml(startedAt)}</i>`,
      '',
      '📡 <b>Feed:</b> NSE Corporate Actions RSS',
      `🎯 <b>Filter:</b> Dividend Yield &gt; ${yieldThreshold}% (LTP based)`,
      '⏳ <b>Status:</b> Scanning ALL NSE stocks, waiting for dividend updates...',
      '------'
    ].join('\n');

    return await this.sendTelegramMessage(message);
  }
}

module.exports = new TelegramService();
