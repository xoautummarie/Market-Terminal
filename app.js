// ═══════════════════════════════════════════════════
//  MARKET TERMINAL PRO — app.js
// ═══════════════════════════════════════════════════

const BASE = 'https://finnhub.io/api/v1';
const REFRESH_MS = 90_000;
const DEFAULT_WL  = ['AAPL','TSLA','NVDA','SPY','MSFT','AMZN','META','GOOGL','BTC-USD','ETH-USD'];

// ── State ────────────────────────────────────────────
let API_KEY    = localStorage.getItem('fh_key') || '';
let watchlist  = load('fh_wl') || [...DEFAULT_WL];
let cache      = {};      // sym → quote
let profiles   = {};      // sym → name
let refreshTmr = null;
let newsReady  = false;
let sentReady  = false;
let congReady  = false;
let earnReady  = false;
let scanReady  = false;

// ── Utilities ────────────────────────────────────────
function load(k)      { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function save(k, v)   { localStorage.setItem(k, JSON.stringify(v)); }
function saveWL()     { save('fh_wl', watchlist); }
async function fhGet(path, key) {
  const k = key || API_KEY;
  const r = await fetch(`${BASE}${path}&token=${k}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ── Key Gate ─────────────────────────────────────────
async function submitKey() {
  const val = document.getElementById('keyInput').value.trim();
  if (!val) return;
  const errEl = document.getElementById('keyError');
  const btn   = document.querySelector('.gate-row button');
  errEl.textContent = ''; btn.textContent = 'CHECKING...'; btn.disabled = true;
  try {
    const t = await fhGet('/quote?symbol=AAPL', val);
    if (!t || t.c == null) throw new Error();
    API_KEY = val; localStorage.setItem('fh_key', val);
    launchApp();
  } catch {
    errEl.textContent = '✗ Invalid key or network error. Check finnhub.io and try again.';
  } finally { btn.textContent = 'LAUNCH →'; btn.disabled = false; }
}
function changeKey() {
  localStorage.removeItem('fh_key'); API_KEY = '';
  clearInterval(refreshTmr);
  document.getElementById('app').style.display  = 'none';
  document.getElementById('gate').style.display = 'flex';
}
document.getElementById('keyInput').addEventListener('keydown', e => { if(e.key==='Enter') submitKey(); });

// ── Market Status ────────────────────────────────────
function updateMarketStatus() {
  const ny   = new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
  const day  = ny.getDay(), mins = ny.getHours()*60+ny.getMinutes();
  const el   = document.getElementById('mktBadge');
  if (day===0||day===6)           { el.textContent='● WEEKEND';    el.className='mkt-badge closed'; return; }
  if (mins>=570  && mins<930)     { el.textContent='◐ PRE-MARKET'; el.className='mkt-badge pre';    return; }
  if (mins>=930  && mins<960)     { el.textContent='● NYSE OPEN';  el.className='mkt-badge open';   return; }
  if (mins>=960  && mins<1200)    { el.textContent='◑ AFTER-HRS';  el.className='mkt-badge pre';    return; }
  el.textContent='● CLOSED'; el.className='mkt-badge closed';
}

// ── Fear & Greed (derived from VIX proxy via SPY data) ─
async function updateFearGreed() {
  try {
    // Use SPY 52-week range position as a simple proxy
    const q = await fhGet('/quote?symbol=SPY');
    if (!q || !q.c) return;
    const pos = (q.c - q.l) / (q.h - q.l); // position in today's range
    // Also check % change: >+1% = greed, <-1% = fear
    const chg = q.dp || 0;
    let score, label, cls;
    if      (chg > 1.5)  { score=80; label='EXTREME GREED'; cls='extreme-greed'; }
    else if (chg > 0.5)  { score=65; label='GREED';         cls='greed';         }
    else if (chg > -0.5) { score=50; label='NEUTRAL';       cls='neutral';       }
    else if (chg > -1.5) { score=35; label='FEAR';          cls='fear';          }
    else                 { score=20; label='EXTREME FEAR';  cls='extreme-fear';  }
    const el = document.getElementById('fgValue');
    el.textContent = `${score} · ${label}`;
    el.className   = `fg-value ${cls}`;
  } catch {}
}

// ── Quote Fetch ──────────────────────────────────────
async function fetchQuote(sym) {
  const d = await fhGet(`/quote?symbol=${sym}`);
  if (!d || d.c == null || d.c === 0) throw new Error('no data');
  return d; // {c,d,dp,h,l,o,pc}
}
async function fetchProfile(sym) {
  try { const d = await fhGet(`/stock/profile2?symbol=${sym}`); return d.name || sym; }
  catch { return sym; }
}

// ── Refresh All Prices ───────────────────────────────
async function refreshAll() {
  await Promise.allSettled(watchlist.map(async sym => {
    try {
      cache[sym] = await fetchQuote(sym);
      if (!profiles[sym]) profiles[sym] = await fetchProfile(sym);
    } catch {}
  }));
  renderCards(); renderTicker();
  updateMarketStatus(); updateFearGreed();
  document.getElementById('lastUpdate').textContent = 'Updated ' + new Date().toLocaleTimeString();
  saveWL();
}
async function fullRefresh() {
  await refreshAll();
  // Re-load whichever tab is active
  const active = document.querySelector('.tab.active')?.textContent?.toLowerCase()?.trim();
  if (active === 'news'      && newsReady) loadNews();
  if (active === 'sentiment' && sentReady) loadSentiment();
  if (active === 'congress'  && congReady) loadCongress();
  if (active === 'earnings'  && earnReady) loadEarnings();
  if (active === 'scanner'   && scanReady) loadScanner();
}

// ── Add / Remove ─────────────────────────────────────
async function addSymbol() {
  const inp = document.getElementById('symInput');
  const err = document.getElementById('addErr');
  const sym = inp.value.trim().toUpperCase().replace(/\s/g,'');
  if (!sym || watchlist.includes(sym)) { inp.value=''; return; }
  err.style.display = 'none'; watchlist.push(sym); renderCards(); inp.value='';
  try {
    cache[sym]    = await fetchQuote(sym);
    profiles[sym] = await fetchProfile(sym);
    renderCards(); renderTicker(); saveWL();
  } catch {
    err.textContent  = `✗ "${sym}" not found — check the ticker symbol.`;
    err.style.display = 'block';
    watchlist = watchlist.filter(s => s !== sym);
    delete cache[sym]; renderCards();
  }
}
function removeSymbol(sym) {
  watchlist = watchlist.filter(s => s !== sym);
  delete cache[sym]; delete profiles[sym];
  renderCards(); renderTicker(); saveWL();
}
document.getElementById('symInput').addEventListener('keydown', e => { if(e.key==='Enter') addSymbol(); });

// ── Formatting ───────────────────────────────────────
function fmtP(n) {
  if (n == null) return '—';
  if (n>=10000) return '$'+n.toLocaleString('en-US',{maximumFractionDigits:0});
  if (n>=100)   return '$'+n.toFixed(2);
  if (n>=1)     return '$'+n.toFixed(3);
  return '$'+n.toFixed(5);
}
function fmtV(v) {
  if(!v) return '—';
  if(v>=1e9) return (v/1e9).toFixed(1)+'B';
  if(v>=1e6) return (v/1e6).toFixed(1)+'M';
  if(v>=1e3) return (v/1e3).toFixed(0)+'K';
  return v;
}
function timeAgo(ts) {
  if(!ts) return '';
  const m = Math.floor((Date.now()-ts*1000)/60000);
  if(m<1) return 'just now'; if(m<60) return m+'m ago';
  const h=Math.floor(m/60); if(h<24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}
function stateLabel(sym) {
  if(sym.includes('-USD')) return {text:'● 24/7',cls:'open'};
  const ny   = new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
  const mins = ny.getHours()*60+ny.getMinutes(), day=ny.getDay();
  if(day===0||day===6)         return {text:'○ CLOSED', cls:'closed'};
  if(mins>=930&&mins<960)      return {text:'● OPEN',   cls:'open'};
  if(mins>=570&&mins<930)      return {text:'◐ PRE',    cls:'pre'};
  if(mins>=960&&mins<1200)     return {text:'◑ POST',   cls:'pre'};
  return {text:'○ CLOSED',cls:'closed'};
}

// ── Render: Cards ────────────────────────────────────
function renderCards() {
  const g = document.getElementById('cardGrid');
  g.innerHTML = '';
  watchlist.forEach(sym => {
    const q = cache[sym];
    const d = document.createElement('div');
    if (!q) {
      d.className = 's-card';
      d.innerHTML = `
        <div class="s-top">
          <div class="s-sym">${sym}</div>
          <div class="s-price"><span class="skel" style="width:80px;height:18px"></span></div>
          <div class="s-name"><span class="skel" style="width:130px;height:9px"></span></div>
          <div class="s-chg"></div>
        </div>
        <div class="s-meta"><span class="spinner"></span> <span style="color:var(--muted)">Fetching...</span></div>
        <button class="rm-btn" onclick="removeSymbol('${sym}')">✕</button>`;
    } else {
      const up=q.dp>=0, dir=up?'up':'dn', arr=up?'▲':'▼', sgn=up?'+':'';
      const st = stateLabel(sym);
      d.className = `s-card ${dir}`;
      d.innerHTML = `
        <div class="s-top">
          <div class="s-sym">${sym}</div>
          <div class="s-price">${fmtP(q.c)}</div>
          <div class="s-name">${profiles[sym]||sym}</div>
          <div class="s-chg ${dir}">${arr} ${sgn}${q.d?.toFixed(2)} (${sgn}${q.dp?.toFixed(2)}%)</div>
        </div>
        <div class="s-meta">
          <span><strong>O</strong>${fmtP(q.o)}</span>
          <span><strong>H</strong>${fmtP(q.h)}</span>
          <span><strong>L</strong>${fmtP(q.l)}</span>
          <span><strong>PC</strong>${fmtP(q.pc)}</span>
          <button class="share-btn" onclick="event.stopPropagation();openShare('${sym}')">📤 SHARE</button>
          <span class="s-state ${st.cls}">${st.text}</span>
        </div>
        <button class="rm-btn" onclick="removeSymbol('${sym}')">✕</button>`;
      d.style.cursor='pointer';
      d.onclick = e => { if(!e.target.closest('button')) window.open(`https://finance.yahoo.com/quote/${sym}`,'_blank'); };
    }
    g.appendChild(d);
  });
}

// ── Render: Ticker ───────────────────────────────────
function renderTicker() {
  const ready = watchlist.filter(s => cache[s]);
  if (!ready.length) return;
  const html = [...ready,...ready].map(sym => {
    const q=cache[sym], up=q.dp>=0;
    return `<span class="tick-item">
      <span class="tick-sym">${sym}</span>
      <span>${fmtP(q.c)}</span>
      <span class="tick-ch ${up?'up':'dn'}">${up?'▲':'▼'} ${Math.abs(q.dp).toFixed(2)}%</span>
    </span>`;
  }).join('');
  document.getElementById('tickerTrack').innerHTML = html;
}

// ── Sentiment ─────────────────────────────────────────
async function loadSentiment() {
  sentReady = true;
  const grid = document.getElementById('sentGrid');
  grid.innerHTML = `<div class="empty-state"><span class="spinner"></span> Loading sentiment data...</div>`;
  document.getElementById('sentCount').textContent = '';
  const syms = watchlist.filter(s => !s.includes('-USD')).slice(0,10); // stocks only
  if (!syms.length) { grid.innerHTML = `<div class="empty-state">Add stock symbols to see sentiment data.</div>`; return; }
  const results = await Promise.allSettled(syms.map(async sym => {
    const data = await fhGet(`/stock/social-sentiment?symbol=${sym}&from=${daysAgo(7)}&to=${today()}`);
    return { sym, data };
  }));
  const cards = results
    .filter(r => r.status==='fulfilled' && r.value.data)
    .map(r => r.value)
    .filter(({data}) => data.reddit?.length || data.twitter?.length);
  if (!cards.length) {
    grid.innerHTML = `<div class="empty-state">No sentiment data available for current watchlist.<br>Sentiment requires Finnhub Premium for some symbols.</div>`;
    return;
  }
  document.getElementById('sentCount').textContent = cards.length + ' SYMBOLS';
  grid.innerHTML = '';
  cards.forEach(({sym, data}) => {
    const reddit  = data.reddit  || [];
    const twitter = data.twitter || [];
    const rPos = reddit.reduce((a,b)=>a+(b.positiveMention||0),0);
    const rNeg = reddit.reduce((a,b)=>a+(b.negativeMention||0),0);
    const rMen = reddit.reduce((a,b)=>a+(b.mention||0),0);
    const tPos = twitter.reduce((a,b)=>a+(b.positiveMention||0),0);
    const tNeg = twitter.reduce((a,b)=>a+(b.negativeMention||0),0);
    const tMen = twitter.reduce((a,b)=>a+(b.mention||0),0);
    const totalPos = rPos+tPos, totalNeg = rNeg+tNeg, totalMen = rMen+tMen;
    const ratio = totalMen ? (totalPos-totalNeg)/totalMen : 0;
    const scoreCls = ratio>0.1?'bull':ratio<-0.1?'bear':'neu';
    const scoreLabel = ratio>0.1?'BULLISH':ratio<-0.1?'BEARISH':'NEUTRAL';
    const pct = v => totalMen ? Math.round(v/totalMen*100) : 0;
    const el = document.createElement('div');
    el.className = 'sent-card';
    el.innerHTML = `
      <div class="sent-top">
        <div class="sent-sym">${sym}</div>
        <div class="sent-name">${profiles[sym]||sym}</div>
        <div class="sent-score ${scoreCls}">${scoreLabel}</div>
      </div>
      <div class="sent-bars">
        <div class="sent-bar-row">
          <span class="sent-bar-label">Positive</span>
          <div class="sent-bar-track"><div class="sent-bar-fill pos" style="width:${pct(totalPos)}%"></div></div>
          <span class="sent-bar-val">${pct(totalPos)}%</span>
        </div>
        <div class="sent-bar-row">
          <span class="sent-bar-label">Negative</span>
          <div class="sent-bar-track"><div class="sent-bar-fill neg" style="width:${pct(totalNeg)}%"></div></div>
          <span class="sent-bar-val">${pct(totalNeg)}%</span>
        </div>
      </div>
      <div class="sent-meta" style="margin-top:8px">
        <span><strong>MENTIONS</strong>${totalMen.toLocaleString()}</span>
        <span><strong>REDDIT</strong>${rMen.toLocaleString()}</span>
        <span><strong>TWITTER</strong>${tMen.toLocaleString()}</span>
        <span><strong>7-DAY WINDOW</strong></span>
      </div>`;
    grid.appendChild(el);
  });
}

// ── Scanner ──────────────────────────────────────────
async function loadScanner() {
  scanReady = true;
  const scanList = document.getElementById('scanResults');
  const moversGrid = document.getElementById('moversGrid');
  scanList.innerHTML   = `<div class="empty-state"><span class="spinner"></span> Scanning volume...</div>`;
  moversGrid.innerHTML = `<div class="empty-state"><span class="spinner"></span> Loading movers...</div>`;

  // Unusual volume in watchlist
  const syms = watchlist.filter(s => !s.includes('-USD')).slice(0,15);
  const volData = await Promise.allSettled(syms.map(async sym => {
    const basic = await fhGet(`/stock/metric?symbol=${sym}&metric=all`);
    const quote = cache[sym] || await fetchQuote(sym).catch(()=>null);
    return { sym, basic, quote };
  }));
  const alerts = volData
    .filter(r => r.status==='fulfilled' && r.value.quote && r.value.basic?.metric)
    .map(r => {
      const {sym, basic, quote} = r.value;
      const avgVol = basic.metric['10DayAverageTradingVolume'] || 0;
      // We don't have intraday volume from free tier, so use price move as proxy
      const absMov = Math.abs(quote.dp || 0);
      return { sym, absMov, avgVol, quote };
    })
    .filter(a => a.absMov > 1.5) // >1.5% move = worth flagging
    .sort((a,b) => b.absMov - a.absMov);

  if (!alerts.length) {
    scanList.innerHTML = `<div class="empty-state">No unusual activity detected in watchlist right now.<br>Alerts trigger when a stock moves &gt;1.5% from prior close.</div>`;
  } else {
    scanList.innerHTML = '';
    alerts.forEach(a => {
      const up = a.quote.dp >= 0;
      const bar = Math.min(a.absMov / 5 * 100, 100);
      const el  = document.createElement('div');
      el.className = 'scan-card';
      el.innerHTML = `
        <div class="scan-sym">${a.sym}</div>
        <div class="scan-info">
          <div class="scan-vol-label">Price move from close</div>
          <div class="scan-vol-bar">
            <div class="scan-bar-track"><div class="scan-bar-fill" style="width:${bar}%"></div></div>
          </div>
        </div>
        <div class="scan-mult">${a.absMov.toFixed(2)}% MOVE</div>
        <div class="scan-price">
          <div class="scan-pr">${fmtP(a.quote.c)}</div>
          <div class="scan-chg ${up?'up':'dn'}">${up?'▲':'▼'} ${a.quote.dp?.toFixed(2)}%</div>
        </div>`;
      scanList.appendChild(el);
    });
  }

  // Market movers — top gainers/losers from watchlist
  const allQuotes = watchlist.filter(s => cache[s]).map(s => ({sym:s, q:cache[s]}));
  const sorted = [...allQuotes].sort((a,b) => Math.abs(b.q.dp||0)-Math.abs(a.q.dp||0)).slice(0,8);
  if (!sorted.length) { moversGrid.innerHTML = `<div class="empty-state">Add symbols to see movers.</div>`; return; }
  moversGrid.innerHTML = '';
  sorted.forEach(({sym, q}) => {
    const up = q.dp>=0;
    const el = document.createElement('div');
    el.className = 'mover-card';
    el.innerHTML = `
      <div class="mover-sym">${sym}</div>
      <div class="mover-name">${profiles[sym]||sym}</div>
      <div class="mover-price">${fmtP(q.c)}</div>
      <div class="mover-chg ${up?'up':'dn'}">${up?'▲':'▼'} ${q.dp?.toFixed(2)}%</div>`;
    moversGrid.appendChild(el);
  });
}

// ── Earnings Calendar ────────────────────────────────
async function loadEarnings() {
  earnReady = true;
  const list = document.getElementById('earnList');
  list.innerHTML = `<div class="empty-state"><span class="spinner"></span> Loading earnings calendar...</div>`;

  const from = today();
  const to   = daysAhead(30);
  try {
    const data = await fhGet(`/calendar/earnings?from=${from}&to=${to}`);
    const earnings = data.earningsCalendar || [];
    // filter to watchlist symbols + top names
    const wlSyms = new Set(watchlist);
    const items = earnings
      .filter(e => wlSyms.has(e.symbol) || ['AAPL','TSLA','NVDA','MSFT','AMZN','META','GOOGL','NFLX','AMD','INTC','CRM'].includes(e.symbol))
      .sort((a,b) => new Date(a.date)-new Date(b.date))
      .slice(0, 25);

    document.getElementById('earnCount').textContent = items.length + ' UPCOMING';
    if (!items.length) {
      list.innerHTML = `<div class="empty-state">No upcoming earnings found for your watchlist in the next 30 days.</div>`;
      return;
    }
    list.innerHTML = '';
    items.forEach(e => {
      const d     = new Date(e.date);
      const day   = d.getDate();
      const mon   = d.toLocaleString('en-US',{month:'short'}).toUpperCase();
      const time  = e.hour === 'bmo' ? 'BMO' : e.hour === 'amc' ? 'AMC' : 'TBD';
      const timeCls = e.hour==='bmo'?'bmo':e.hour==='amc'?'amc':'';
      const inWL  = wlSyms.has(e.symbol) ? '★ ' : '';
      const el    = document.createElement('div');
      el.className = 'earn-card';
      el.innerHTML = `
        <div class="earn-date">
          <span class="earn-day">${day}</span>${mon}
        </div>
        <div>
          <div class="earn-sym">${inWL}${e.symbol}</div>
          <div class="earn-name">${e.name||e.symbol}</div>
        </div>
        <div class="earn-right">
          <div class="earn-time ${timeCls}">${time}</div>
          ${e.epsEstimate ? `<div class="earn-eps">EPS est: $${e.epsEstimate}</div>` : ''}
          ${e.revenueEstimate ? `<div class="earn-eps">Rev est: ${fmtV(e.revenueEstimate)}</div>` : ''}
        </div>`;
      list.appendChild(el);
    });
  } catch {
    list.innerHTML = `<div class="empty-state">Failed to load earnings calendar. Try refreshing.</div>`;
  }
}

// ── Congressional Trades ──────────────────────────────
async function loadCongress() {
  congReady = true;
  const list = document.getElementById('congList');
  list.innerHTML = `<div class="empty-state"><span class="spinner"></span> Loading congressional trades...</div>`;
  try {
    const from = daysAgo(90);
    const to   = today();
    const data = await fhGet(`/stock/congressional-trading?symbol=&from=${from}&to=${to}`);
    const trades = (data.data || []).sort((a,b) => new Date(b.transactionDate)-new Date(a.transactionDate)).slice(0,30);
    document.getElementById('congCount').textContent = trades.length + ' RECENT TRADES';
    if (!trades.length) {
      list.innerHTML = `<div class="empty-state">No congressional trades found. This endpoint may require Finnhub Premium.</div>`;
      return;
    }
    list.innerHTML = '';
    trades.forEach(t => {
      const isBuy  = /purchase|buy/i.test(t.transactionType||'');
      const isSell = /sale|sell/i.test(t.transactionType||'');
      const actCls = isBuy?'buy':isSell?'sell':'other';
      const actLbl = isBuy?'BUY':isSell?'SELL':'OTHER';
      const el = document.createElement('div');
      el.className = 'cong-card';
      el.innerHTML = `
        <div class="cong-top">
          <div class="cong-sym">${t.symbol||'—'}</div>
          <div class="cong-action ${actCls}">${actLbl}</div>
          <div class="cong-amount">${t.amount||'—'}</div>
        </div>
        <div class="cong-name">${t.name||'Unknown'}</div>
        <div class="cong-meta" style="margin-top:6px">
          <span><strong>DATE</strong>${t.transactionDate||'—'}</span>
          <span><strong>TYPE</strong>${t.transactionType||'—'}</span>
          <span><strong>FILED</strong>${t.filingDate||'—'}</span>
          ${t.comment?`<span><strong>NOTE</strong>${t.comment}</span>`:''}
        </div>`;
      list.appendChild(el);
    });
  } catch {
    list.innerHTML = `<div class="empty-state">Congressional trading data requires Finnhub Premium tier.<br><a href="https://finnhub.io/pricing" target="_blank" style="color:var(--green)">Upgrade at finnhub.io/pricing</a></div>`;
  }
}

// ── News ──────────────────────────────────────────────
const BULL = /surge|soar|rally|gain|beat|record|rise|jump|boost|strong|profit|bull|high|top|upgrade/i;
const BEAR = /fall|drop|plunge|miss|lose|crash|decline|risk|warn|cut|weak|loss|bear|low|downgrade/i;
async function loadNews() {
  newsReady = true;
  const list = document.getElementById('newsList');
  list.innerHTML = `<div class="empty-state"><span class="spinner"></span> Loading market news...</div>`;
  try {
    const data = await fhGet('/news?category=general&minId=0');
    if (!Array.isArray(data)||!data.length) throw new Error('empty');
    document.getElementById('newsCount').textContent = Math.min(data.length,15)+' ARTICLES';
    list.innerHTML = data.slice(0,15).map(a => {
      const title   = a.headline||'';
      const summary = a.summary||'';
      const related = (a.related||'').split(',').filter(s=>watchlist.includes(s.trim().toUpperCase()));
      const tags    = related.map(s=>`<span class="n-tag">${s.trim().toUpperCase()}</span>`).join('');
      const sent    = BULL.test(title)?'<span class="n-tag bull">↑ BULLISH</span>':BEAR.test(title)?'<span class="n-tag bear">↓ BEARISH</span>':'';
      return `<a class="n-item" href="${a.url||'#'}" target="_blank" rel="noopener">
        <div class="n-top">${tags}${sent}<span class="n-source">${a.source||''}</span><span class="n-time">${timeAgo(a.datetime)}</span></div>
        <div class="n-title">${title}</div>
        ${summary&&summary!==title?`<div class="n-summary">${summary}</div>`:''}
      </a>`;
    }).join('');
  } catch {
    list.innerHTML = `<div class="empty-state">Failed to load news. Click ↻ Refresh to try again.</div>`;
  }
}

// ── Share Card ────────────────────────────────────────
function openShare(sym) {
  const q = cache[sym]; if(!q) return;
  const up = q.dp>=0, arr=up?'▲':'▼', sgn=up?'+':'';
  const text = `📊 ${sym} — ${profiles[sym]||sym}\n` +
    `Price: ${fmtP(q.c)}\n` +
    `Change: ${arr} ${sgn}${q.d?.toFixed(2)} (${sgn}${q.dp?.toFixed(2)}%)\n` +
    `High: ${fmtP(q.h)} · Low: ${fmtP(q.l)}\n` +
    `\nvia Market Terminal Pro\nhttps://xoautummarie.github.io/market-terminal`;
  document.getElementById('shareCard').textContent = text;
  document.getElementById('shareModal').style.display = 'flex';
}
function closeShare()   { document.getElementById('shareModal').style.display='none'; }
function copyShareCard() {
  const t = document.getElementById('shareCard').textContent;
  navigator.clipboard.writeText(t).then(()=>{ alert('Copied to clipboard! Paste into X, Discord, or anywhere.'); }).catch(()=>{});
}

// ── Tabs ──────────────────────────────────────────────
function switchTab(id, btn) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.pane').forEach(p=>p.style.display='none');
  document.getElementById(`pane-${id}`).style.display='block';
  if (id==='news'      && !newsReady) loadNews();
  if (id==='sentiment' && !sentReady) loadSentiment();
  if (id==='congress'  && !congReady) loadCongress();
  if (id==='earnings'  && !earnReady) loadEarnings();
  if (id==='scanner'   && !scanReady) loadScanner();
}

// ── Date helpers ──────────────────────────────────────
function today()         { return new Date().toISOString().slice(0,10); }
function daysAgo(n)      { const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); }
function daysAhead(n)    { const d=new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }

// ── Launch App ────────────────────────────────────────
function launchApp() {
  document.getElementById('gate').style.display='none';
  document.getElementById('app').style.display='block';
  renderCards();
  refreshAll();
  clearInterval(refreshTmr);
  refreshTmr = setInterval(refreshAll, REFRESH_MS);
}

// ── Auto-launch ───────────────────────────────────────
if (API_KEY) launchApp();
else { document.getElementById('gate').style.display='flex'; }
