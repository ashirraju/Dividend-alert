// State
let soundEnabled = true;
let desktopNotificationsEnabled = false;
let feedActions = [];

// DOM Elements
const connectionStatus = document.getElementById('connectionStatus');
const statusText = document.getElementById('statusText');
const btnCheckNow = document.getElementById('btnCheckNow');
const btnSoundToggle = document.getElementById('btnSoundToggle');
const btnNotifyPermission = document.getElementById('btnNotifyPermission');

const statYieldThreshold = document.getElementById('statYieldThreshold');
const statAlertsCount = document.getElementById('statAlertsCount');
const statFeedCount = document.getElementById('statFeedCount');
const statFeedTime = document.getElementById('statFeedTime');
const statLastPoll = document.getElementById('statLastPoll');
const statPollInterval = document.getElementById('statPollInterval');

const alertsContainer = document.getElementById('alertsContainer');
const emptyAlerts = document.getElementById('emptyAlerts');
const btnClearAlerts = document.getElementById('btnClearAlerts');

const chkDividendsOnly = document.getElementById('chkDividendsOnly');
const feedSearch = document.getElementById('feedSearch');
const feedTableBody = document.getElementById('feedTableBody');

// Telegram Modal Elements
const btnTelegramModal = document.getElementById('btnTelegramModal');
const telegramStatusLabel = document.getElementById('telegramStatusLabel');
const telegramModal = document.getElementById('telegramModal');
const btnCloseTelegramModal = document.getElementById('btnCloseTelegramModal');
const telegramForm = document.getElementById('telegramForm');
const tgBotToken = document.getElementById('tgBotToken');
const tgChatId = document.getElementById('tgChatId');
const tgDryRun = document.getElementById('tgDryRun');
const btnTestTelegram = document.getElementById('btnTestTelegram');

// Web Audio API Chime for Alerts
function playAlertChime() {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Play two-tone ascending chime
    const playTone = (freq, delay, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      gain.gain.setValueAtTime(0.15, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + dur);
    };

    playTone(587.33, 0, 0.2);     // D5
    playTone(880.00, 0.15, 0.35); // A5
  } catch (e) {
    console.warn('Audio playback error:', e);
  }
}

// Show Desktop Notification
function triggerDesktopNotification(alert) {
  if (desktopNotificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
    const yieldText = alert.yieldQ !== null ? ` (Yield: ${alert.yieldQ}%)` : '';
    new Notification(`High-Yield Alert: ${alert.stockName || alert.stockSymbol}${yieldText}`, {
      body: `${alert.purpose}\nEx-Date: ${alert.exDate || 'N/A'}\nLTP: ₹${alert.price || 'N/A'}`,
      icon: '🔔'
    });
  }
}

// Initialize SSE Stream
function initEventStream() {
  const evtSource = new EventSource('/api/stream');

  evtSource.onopen = () => {
    connectionStatus.querySelector('.status-dot').className = 'status-dot connected';
    statusText.innerText = 'Live Feed Connected';
  };

  evtSource.onerror = () => {
    connectionStatus.querySelector('.status-dot').className = 'status-dot error';
    statusText.innerText = 'Reconnecting...';
  };

  evtSource.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'alert') {
        onNewAlertReceived(msg.data);
      }
    } catch (err) {
      console.error('SSE parse error:', err);
    }
  };
}

// Handle incoming live alert
function onNewAlertReceived(alert) {
  playAlertChime();
  triggerDesktopNotification(alert);

  if (emptyAlerts) {
    emptyAlerts.style.display = 'none';
  }

  // Prepend new alert card
  const alertCard = createAlertElement(alert);
  alertsContainer.insertBefore(alertCard, alertsContainer.firstChild);

  // Update count
  const currentCount = parseInt(statAlertsCount.innerText || '0', 10);
  statAlertsCount.innerText = currentCount + 1;
}

function createAlertElement(alert) {
  const card = document.createElement('div');
  card.className = 'alert-card';

  const timeFormatted = alert.detectedAt ? new Date(alert.detectedAt).toLocaleTimeString() : 'Just now';

  card.innerHTML = `
    <div class="alert-header">
      <div class="alert-title-row">
        <span class="alert-stock-symbol">${escapeHtml(alert.stockSymbol || 'STOCK')}</span>
        <span class="alert-company-name">${escapeHtml(alert.stockName || alert.companyFromFeed)}</span>
      </div>
      <span class="alert-time">${timeFormatted}</span>
    </div>
    <div class="alert-purpose">
      ${escapeHtml(alert.purpose)}
    </div>
    <div class="alert-meta">
      ${alert.yieldQ !== null && alert.yieldQ !== undefined ? `<span class="alert-meta-tag highlight">📈 Yield: <strong>${escapeHtml(String(alert.yieldQ))}%</strong></span>` : ''}
      ${alert.price !== null && alert.price !== undefined ? `<span class="alert-meta-tag">🏷️ Stock LTP: <strong>₹${escapeHtml(String(alert.price))}</strong></span>` : ''}
      ${alert.divPerShare !== null && alert.divPerShare !== undefined ? `<span class="alert-meta-tag">💰 Div: <strong>₹${escapeHtml(String(alert.divPerShare))}</strong></span>` : (alert.dividendAmount ? `<span class="alert-meta-tag highlight">💰 ${escapeHtml(alert.dividendAmount)}</span>` : '')}
      <span class="alert-meta-tag">📅 Ex-Date: <strong>${escapeHtml(alert.exDate || 'N/A')}</strong></span>
      ${alert.recordDate ? `<span class="alert-meta-tag">📋 Record Date: ${escapeHtml(alert.recordDate)}</span>` : ''}
    </div>
    <div class="alert-footer">
      <a href="${escapeHtml(alert.link)}" target="_blank" rel="noreferrer">View Official NSE Filing &rarr;</a>
    </div>
  `;

  return card;
}

// API Requests
async function fetchAlerts() {
  try {
    const res = await fetch('/api/alerts');
    const data = await res.json();
    if (data.success) {
      // Filter to only display alerts that met the yield threshold
      const validAlerts = data.alerts.filter(a => a.meetsThreshold !== false);
      renderAlerts(validAlerts);
      statAlertsCount.innerText = validAlerts.length;
    }
  } catch (err) {
    console.error('Error fetching alerts:', err);
  }
}

async function fetchFeed(force = false) {
  try {
    const url = `/api/feed${force ? '?force=true' : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.success) {
      feedActions = data.actions;
      statFeedCount.innerText = data.totalCount;
      statFeedTime.innerText = data.lastBuildDate ? `Updated: ${data.lastBuildDate}` : 'Updated';
      renderFeedTable();
    }
  } catch (err) {
    console.error('Error fetching feed:', err);
  }
}

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.success) {
      if (statYieldThreshold) {
        statYieldThreshold.innerText = data.yieldFilterPaused ? 'All Dividends' : `> ${data.yieldThreshold}%`;
      }
      if (data.poller) {
        statPollInterval.innerText = `${Math.round(data.poller.intervalSeconds / 60)}m`;
        if (data.poller.lastPollTime) {
          statLastPoll.innerText = `Last check: ${new Date(data.poller.lastPollTime).toLocaleTimeString()}`;
        }
      }
    }
  } catch (err) {
    console.error('Error fetching status:', err);
  }
}

// Alerts Rendering
function renderAlerts(alerts) {
  alertsContainer.innerHTML = '';
  if (!alerts || alerts.length === 0) {
    alertsContainer.appendChild(emptyAlerts);
    emptyAlerts.style.display = 'flex';
    return;
  }

  emptyAlerts.style.display = 'none';
  alerts.forEach(alert => {
    alertsContainer.appendChild(createAlertElement(alert));
  });
}

// Feed Table Rendering
function renderFeedTable() {
  const searchTerm = (feedSearch.value || '').toLowerCase().trim();
  const dividendsOnly = chkDividendsOnly.checked;

  const filtered = feedActions.filter(item => {
    if (dividendsOnly && !item.isDividend) return false;
    if (searchTerm) {
      const target = `${item.companyName} ${item.purpose} ${item.rawTitle}`.toLowerCase();
      if (!target.includes(searchTerm)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    feedTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4" style="color:var(--text-muted)">No actions matching filter.</td></tr>`;
    return;
  }

  feedTableBody.innerHTML = filtered.map(item => {
    return `
      <tr>
        <td><strong>${escapeHtml(item.companyName)}</strong></td>
        <td>${escapeHtml(item.purpose)}</td>
        <td>${item.dividendAmount ? `<span class="dividend-tag">${escapeHtml(item.dividendAmount)}</span>` : '-'}</td>
        <td>${escapeHtml(item.exDate || '-')}</td>
        <td>${escapeHtml(item.recordDate || '-')}</td>
        <td>${item.isDividend ? '<span class="tag-matched">💰 DIVIDEND</span>' : '<span class="tag-unmatched">CORPORATE ACTION</span>'}</td>
      </tr>
    `;
  }).join('');
}

// Actions
btnClearAlerts.addEventListener('click', async () => {
  if (confirm('Clear all alert history?')) {
    await fetch('/api/alerts/clear', { method: 'POST' });
    await fetchAlerts();
    await fetchStatus();
  }
});

btnCheckNow.addEventListener('click', async () => {
  btnCheckNow.disabled = true;
  btnCheckNow.innerHTML = '<span class="btn-icon">⏳</span> Checking...';
  try {
    const res = await fetch('/api/feed/check', { method: 'POST' });
    const data = await res.json();
    await fetchAlerts();
    await fetchFeed(true);
    await fetchStatus();

    if (data.newAlertsCount > 0) {
      playAlertChime();
      alert(`🔔 Found ${data.newAlertsCount} new high-yield dividend alert(s)!`);
    }
  } catch (err) {
    alert('Failed to check feed: ' + err.message);
  } finally {
    btnCheckNow.disabled = false;
    btnCheckNow.innerHTML = '<span class="btn-icon">⚡</span> Check Feed Now';
  }
});

btnSoundToggle.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  btnSoundToggle.innerText = soundEnabled ? '🔊 Sound: ON' : '🔇 Sound: OFF';
});

btnNotifyPermission.addEventListener('click', async () => {
  if ('Notification' in window) {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      desktopNotificationsEnabled = true;
      btnNotifyPermission.innerText = '🔔 Desktop Alerts: ON';
      btnNotifyPermission.classList.remove('btn-secondary');
      btnNotifyPermission.classList.add('btn-primary');
      new Notification('Dividend Alert App', { body: 'Desktop notifications are active!' });
    } else {
      alert('Notification permission was not granted.');
    }
  } else {
    alert('Browser does not support notifications.');
  }
});

chkDividendsOnly.addEventListener('change', renderFeedTable);
feedSearch.addEventListener('input', renderFeedTable);

// Telegram Modal & API Handlers
async function fetchTelegramStatus() {
  try {
    const res = await fetch('/api/telegram/status');
    const data = await res.json();
    if (data.success) {
      if (data.configured) {
        telegramStatusLabel.innerText = 'Connected';
        btnTelegramModal.style.borderColor = 'var(--success)';
        btnTelegramModal.style.color = 'var(--success)';
      } else if (data.dryRun) {
        telegramStatusLabel.innerText = 'Dry Run';
        btnTelegramModal.style.borderColor = 'var(--accent-gold)';
        btnTelegramModal.style.color = 'var(--accent-gold)';
      } else {
        telegramStatusLabel.innerText = 'Setup';
        btnTelegramModal.style.borderColor = 'var(--border)';
        btnTelegramModal.style.color = 'var(--text-main)';
      }

      if (data.chatId && !tgChatId.value) {
        tgChatId.placeholder = `Current: ${data.chatId}`;
      }
      tgDryRun.checked = !!data.dryRun;
    }
  } catch (err) {
    console.error('Error fetching telegram status:', err);
  }
}

btnTelegramModal.addEventListener('click', () => {
  telegramModal.style.display = 'flex';
});

btnCloseTelegramModal.addEventListener('click', () => {
  telegramModal.style.display = 'none';
});

telegramModal.addEventListener('click', (e) => {
  if (e.target === telegramModal) {
    telegramModal.style.display = 'none';
  }
});

telegramForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const botToken = tgBotToken.value.trim();
  const chatId = tgChatId.value.trim();
  const dryRun = tgDryRun.checked;

  try {
    const res = await fetch('/api/telegram/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken, chatId, dryRun })
    });
    const data = await res.json();
    if (data.success) {
      alert('Telegram settings updated successfully!');
      telegramModal.style.display = 'none';
      await fetchTelegramStatus();
    }
  } catch (err) {
    alert('Failed to save settings: ' + err.message);
  }
});

btnTestTelegram.addEventListener('click', async () => {
  btnTestTelegram.disabled = true;
  btnTestTelegram.innerText = 'Sending...';

  try {
    const res = await fetch('/api/telegram/test', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert('Test alert sent! Check your Telegram chat or console log.');
    } else {
      alert('Telegram test failed: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Error testing Telegram: ' + err.message);
  } finally {
    btnTestTelegram.disabled = false;
    btnTestTelegram.innerText = '📨 Send Test Alert';
  }
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initial Boot
window.addEventListener('DOMContentLoaded', async () => {
  initEventStream();
  await fetchAlerts();
  await fetchFeed();
  await fetchStatus();
  await fetchTelegramStatus();

  // Periodically refresh stats and feed display
  setInterval(fetchStatus, 30000);
});
