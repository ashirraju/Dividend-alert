# NSE Dividend Alert App 🔔💰

A real-time Node.js application that continuously monitors the official National Stock Exchange of India (NSE) Corporate Actions RSS feed (`https://nsearchives.nseindia.com/content/RSS/Corporate_action.xml`), tracks your custom stock watchlist, and delivers instant alerts when dividend announcements or corporate actions are published for your stocks.

---

## 🌟 Key Features

- **Official NSE RSS Integration**: Fetches and parses corporate actions and dividends from `https://nsearchives.nseindia.com/content/RSS/Corporate_action.xml`.
- **Real-Time Stock LTP & Yield Filter**:
  - Automatically fetches the live **LTP** (Last Traded Price) for monitored NSE equities.
  - Computes dividend yield:
    $$\text{yieldQ} = \left(\frac{\text{divPerShare}}{\text{price}}\right) \times 100$$
  - **Yield Filtering Rule**: Only notifies users if $\text{yieldQ} > 3\%$ (configurable via `MIN_DIVIDEND_YIELD`). Announcements with yield $\le 3\%$ are recorded in dashboard history but notifications (Telegram, audio chime, push notifications) are suppressed to eliminate low-yield noise.
- **Intelligent Stock Resolution**:
  - Automatically loads and cross-references 2,600+ NSE listed equities (`EQUITY_L.csv`).
  - Supports NSE symbols (e.g., `MRF`, `EMAMILTD`, `ASTRAL`, `COCHINSHIP`, `TCS`) or full/partial company names (e.g., `Dynamatic Technologies`, `Emami`, `Cochin Shipyard`).
- **REST API to Add & Manage Stock Watchlist**:
  - `POST /api/stocks`: Add stocks as JSON array, comma-separated string, or single stock.
  - Automatically triggers an immediate feed check upon adding stocks.
- **Multi-Channel Alert System**:
  - ✈️ **Telegram Bot Notifications**: Sends formatted HTML dividend alerts and a server startup notification ("*Server started and waiting for dividend updates...*") to your Telegram bot or group (matching the pattern used in `global-trader-news`).
  - 🖥️ **Console / Terminal Banner**: High-visibility styled terminal alerts showing Company, Purpose, Dividend Amount, Ex-Date, and Record Date.
  - ⚡ **Real-time Live Stream (SSE)**: Instant browser alert streaming via Server-Sent Events (`/api/stream`).
  - 🔊 **Audio Chimes**: Instant synthesizer alert chime via Web Audio API.
  - 🔔 **Desktop Notifications**: Native browser push notifications.
  - 💾 **Persistent Alert History**: Persisted in `data/alerts.json` with deduplication to avoid repetitive alert spam.
- **Interactive Web Dashboard**:
  - Beautiful, dark-themed responsive UI at `http://localhost:3000`.
  - Add stocks with quick-add chips, manage watchlist, see triggered alerts, and browse the live NSE feed with search & dividend-only filter.
- **Automated Background Poller**:
  - Periodically polls the NSE feed (configurable interval, default every 5 minutes).
  - Can be manually triggered at any time via `POST /api/feed/check` or the "Check Feed Now" UI button.

---

## ✈️ Telegram Bot Notification Setup

The Telegram notification system follows the exact same structure as `global-trader-news`.

### 1. Create a Bot
1. Open Telegram and search for [@BotFather](https://t.me/BotFather).
2. Send `/newbot`, choose a name, and copy the **HTTP API Token**.
3. Start a chat with your new bot (send `/start` or any text).
4. Get your Chat ID from [@userinfobot](https://t.me/userinfobot) (or use your group/channel chat ID).

### 2. Configure Credentials

Add them to your `.env` file:
```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRstuVWXyz
TELEGRAM_CHAT_ID=987654321
TIME_ZONE=Asia/Kolkata
DRY_RUN=false
```

*Or configure them directly from the web dashboard by clicking **✈️ Telegram: Setup**.*

### 3. Telegram Message Format
When a dividend is announced for a monitored stock, a notification is sent:
```
🔔💰 NSE Dividend Alert

MRF — MRF Limited

💰 Dividend: RS 3 PER SHARE
📅 Ex-Date: 17-Nov-2026
📋 Record Date: 17-Nov-2026
🏷️ Series: EQ

Purpose:
INTERIM DIVIDEND - RS 3 PER SHARE

Detected: 13 Nov 2026, 3:15 pm IST
------

🔗 Official NSE Filing
```

### 4. Test Telegram via API
```bash
curl -X POST http://localhost:3000/api/telegram/test
```

---

## 📁 Project Structure

```
divident alert app/
├── data/
│   ├── EQUITY_L.csv          # Official NSE symbol <-> company name master database
│   ├── watchlist.json         # Persisted user-monitored stocks
│   └── alerts.json            # Persisted history of triggered alerts
├── public/                    # Frontend Web Dashboard
│   ├── index.html             # Dashboard markup
│   ├── style.css              # Custom styling (dark theme, responsive)
│   └── app.js                 # Frontend logic, SSE stream listener, audio chimes
├── src/
│   ├── server.js              # Express HTTP server & SSE endpoints
│   ├── rssService.js          # XML RSS feed fetcher and parser
│   ├── stockResolver.js       # NSE symbol & company name matching engine
│   ├── alertManager.js        # Watchlist, alert evaluation & deduplication
│   └── poller.js              # Automated background periodic RSS checker
├── test/
│   ├── app.test.js            # Unit tests for resolver, RSS parser & alert manager
│   └── api.test.js            # Integration tests for REST API endpoints
├── .env                       # Environment configuration
├── package.json               # Node.js project manifest & scripts
└── README.md                  # Complete documentation
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
By default, the server runs on **`http://localhost:3000`**.

For development with automatic file watching:
```bash
npm run dev
```

### 3. Run Automated Tests
```bash
npm test
```

---

## 📡 REST API Reference

### 1. Get High-Yield Dividend Alerts
- **Endpoint**: `GET /api/alerts?limit=50`
Returns detected dividend alerts that met the `yieldQ > 3%` threshold.
```bash
curl http://localhost:3000/api/alerts
```

---

### 2. Clear Alerts History
- **Endpoint**: `POST /api/alerts/clear`
```bash
curl -X POST http://localhost:3000/api/alerts/clear
```

---

### 3. Trigger Immediate Feed Check
- **Endpoint**: `POST /api/feed/check`
Fetches fresh data from NSE RSS right now, calculates yield for all dividend announcements, and alerts if any yield > 3%.
```bash
curl -X POST http://localhost:3000/api/feed/check
```

---

### 4. View Parsed NSE Feed
- **Endpoint**: `GET /api/feed`
- Query parameters:
  - `dividendsOnly=true` (optional): Filter to only dividend announcements.
  - `force=true` (optional): Force a live fetch bypassing cache.
```bash
curl http://localhost:3000/api/feed?dividendsOnly=true
```

---

### 5. System Status
- **Endpoint**: `GET /api/status`
```bash
curl http://localhost:3000/api/status
```

---

### 6. Telegram Bot Testing
- **Endpoint**: `POST /api/telegram/test`
```bash
curl -X POST http://localhost:3000/api/telegram/test
```

---

### 10. Live Real-Time Event Stream (SSE)
- **Endpoint**: `GET /api/stream`
Connects a persistent EventSource stream that automatically pushes new alerts to clients the moment they are detected.

---

## 🔔 How Alerts Look

### In Terminal / Console:
```
============================================================
🔔💰 [DIVIDEND ALERT] 💰🔔
Company:       MRF Limited (MRF)
Purpose:       INTERIM DIVIDEND - RS 3 PER SHARE
Dividend:      RS 3 PER SHARE
Ex-Date:       17-Nov-2026
Record Date:   17-Nov-2026
Pub Date:      13-Nov-2026 12:11:45
Detected At:   2026-11-13T09:23:14.986Z
============================================================
```

### In Web Dashboard:
- Instant animated notification card with:
  - Stock symbol badge & company name
  - Dividend amount highlighted in green (e.g. `💰 RS 5 PER SHARE`)
  - Ex-Date badge (e.g. `📅 Ex-Date: 13-Nov-2026`)
  - Record Date badge
  - Official NSE filing link
- Audio chime plays
- Desktop browser notification fires (if permitted)

---

## ⚙️ Configuration (`.env`)

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP Server port | `3000` |
| `NSE_RSS_URL` | Official NSE RSS URL | `https://nsearchives.nseindia.com/content/RSS/Corporate_action.xml` |
| `POLL_INTERVAL_MS` | Auto-poll interval in milliseconds | `300000` (5 minutes) |
| `MIN_DIVIDEND_YIELD` | Minimum dividend yield percentage to trigger notification | `3` (only notify if yield > 3%) |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | (Optional) |
| `TELEGRAM_CHAT_ID` | Telegram chat/channel ID | (Optional) |
| `TIME_ZONE` | Timezone for notifications | `Asia/Kolkata` |
| `DRY_RUN` | Test mode without sending actual Telegram messages | `false` |
# Dividend-alert
# Dividend-alert
