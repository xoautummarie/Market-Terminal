# Market Terminal — Pro Edition

An upgraded day-trader dashboard built on Finnhub.

## New Features vs v1
- **Fear & Greed Index** — live market sentiment gauge in the header
- **Social Sentiment tab** — Reddit + Twitter buzz & positive/negative ratio per ticker
- **Unusual Volume Scanner** — flags your watchlist for big price moves + top movers grid
- **Earnings Calendar** — 30-day lookahead for your watchlist + major names
- **Congressional Trades** — STOCK Act disclosures (requires Finnhub Premium)
- **Shareable cards** — tap 📤 SHARE on any price card to copy a tweet/Discord-ready card
- **PRO badge** — looks legit

## How to Deploy (replace your existing GitHub Pages files)

1. Go to **github.com/xoautummarie/market-terminal**
2. Click each existing file → Edit → replace content → Commit
   OR: Delete old files and re-upload the new ones
3. Upload these 3 files: `index.html`, `style.css`, `app.js`
4. GitHub Pages auto-rebuilds in ~1 minute
5. Visit **https://xoautummarie.github.io/market-terminal**

## Notes on features
- **Congressional Trades** — Finnhub free tier may return empty. Upgrade at finnhub.io/pricing (~$50/mo) to unlock.
- **Social Sentiment** — some symbols require Finnhub Premium. Works on major stocks (AAPL, TSLA, etc.).
- **Fear & Greed** — calculated from SPY's daily % change as a proxy. Not CNN's index.
- **Scanner** — uses price % change from close as the volume proxy (free tier doesn't expose intraday volume).
