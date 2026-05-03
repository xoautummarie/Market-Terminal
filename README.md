# Market Terminal

A live stock & crypto tracker built with vanilla HTML/CSS/JS, powered by the Finnhub API.

## Features
- Real-time prices for stocks AND crypto (BTC-USD, ETH-USD, etc.)
- Live scrolling ticker tape
- Market news feed
- Add/remove any symbol
- Watchlist saved in browser
- Auto-refreshes every 90 seconds

## Deploy to GitHub Pages (Free Hosting)

### Step 1 — Create the repo
1. Go to github.com → click **New repository**
2. Name it: `market-terminal`
3. Set to **Public**
4. Click **Create repository**

### Step 2 — Upload the files
1. On your new repo page, click **Add file → Upload files**
2. Drag and drop these 3 files:
   - `index.html`
   - `style.css`
   - `app.js`
3. Click **Commit changes**

### Step 3 — Enable GitHub Pages
1. Go to your repo **Settings**
2. Click **Pages** in the left sidebar
3. Under "Branch", select **main** and click **Save**
4. Wait 1-2 minutes

### Step 4 — Your live URL
Your site will be live at:
```
https://YOUR-GITHUB-USERNAME.github.io/market-terminal
```

### Step 5 — Get your Finnhub API key
1. Go to finnhub.io
2. Click "Get free API key"
3. Sign up (no credit card needed)
4. Copy your key from the dashboard
5. Open your live site and paste the key

## Adding Symbols
- **Stocks:** AAPL, TSLA, NVDA, AMZN, etc.
- **Crypto:** BTC-USD, ETH-USD, SOL-USD, DOGE-USD, etc.
- **ETFs:** SPY, QQQ, VTI, etc.

## Free Tier Limits
Finnhub free: 60 API calls/minute. This app uses ~1 call per symbol per refresh (90s interval), so a watchlist of up to 50 symbols is fine.
