// ── CONFIG ──────────────────────────────────────────────────────────
const BASE = 'https://finnhub.io/api/v1';
const DEFAULT_WATCHLIST = ['AAPL','TSLA','NVDA','SPY','MSFT','AMZN','META','GOOGL','BTC-USD','ETH-USD'];
const REFRESH_INTERVAL  = 90 * 1000; // 90 seconds

// ── STATE ────────────────────────────────────────────────────────────
let API_KEY   = localStorage.getItem('fh_key') || '';
let watchlist = loadWatchlist();
let cache     = {};          // sym → quote data
let profiles  = {};          // sym → {name}
let refreshTimer = null;
let newsLoaded   = false;

// ── STORAGE ──────────────────────────────────────────────────────────
function loadWatchlist() {
  try { return JSON.parse(localStorage.getItem('fh_wl')) || [...DEFAULT_WATCHLIST]; }
  catch { return [...DEFAULT_WATCHLIST]; }
}
function saveWatchlist() { localStorage.setItem('fh_wl', JSON.stringify(watchlist)); }

// ── KEY GATE ──────────────────────────────────────────────────────────
async function submitKey() {
  const val = document.getElementById('keyInput').value.trim();
  if (!val) return;
  const errEl = document.getElementById('keyError');
  errEl.textContent = '';
  const btn = document.querySelector('.gate-row button');
  btn.textContent = 'CHECKING...'; btn.disabled = true;

  try {
    const test = await fhGet('/quote?symbol=AAPL', val);
    if (!test || test.c == null) throw new Error('bad');
    API_KEY = val;
    localStorage.setItem('fh_key', API_KEY);
    launchApp();
  } catch {
    errEl.textContent = '✗ Invalid key or network error. Check and try again.';
  } finally {
    btn.textContent = 'LAUNCH →'; btn.disabled = false;
  }
}

function changeKey() {
  localStorage.removeItem('fh_key');
  API_KEY = '';
  clearInterval(refreshTimer);
  document.getElementById('app').style.display  = 'none';
  document.getElementById('gate').style.display = 'flex';
}

document.getElementById('keyInput')
  .addEventListener('keydown', e => { if (e.key === 'Enter') submitKey(); });

// ── API HELPER ────────────────────────────────────────────────────────
async function fhGet(path, key) {
  const k = key || API_KEY;
  const res = await fetch(`${BASE}${path}&token=${k}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── MARKET STATUS ─────────────────────────────────────────────────────
function updateMarketStatus() {
  const ny   = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day  = ny.getDay();
  const mins = ny.getHours() * 60 + ny.getMinutes();
  const el   = document.getElementById('mktBadge');

  if (day === 0 || day === 6) {
    el.textContent = '● WEEKEND'; el.className = 'mkt-badge closed'; return;
  }
  if (mins >= 570  && mins < 930)  { el.textContent = '◐ PRE-MARKET';  el.className = 'mkt-badge pre';    return; }
  if (mins >= 930  && mins < 960)  { el.textContent = '● NYSE OPEN';   el.className = 'mkt-badge open';   return; }
  if (mins >= 960  && mins < 1200) { el.textContent = '◑ AFTER-HOURS'; el.className = 'mkt-badge pre';    return; }
  el.textContent = '● CLOSED'; el.className = 'mkt-badge closed';
}

// ── QUOTE FETCH ───────────────────────────────────────────────────────
async function fetchQuote(sym) {
  const data = await fhGet(`/quote?symbol=${sym}`);
  if (!data || data.c == null || data.c === 0) throw new Error('no data');
  return {
    c:  data.c,   // current price
    d:  data.d,   // change
    dp: data.dp,  // change %
    h:  data.h,   // high
    l:  data.l,   // low
    o:  data.o,   // open
    pc: data.pc,  // prev close
    t:  data.t,   // timestamp
  };
}

async function fetchProfile(sym) {
  try {
    const data = await fhGet(`/stock/profile2?symbol=${sym}`);
    return data.name || sym;
  } catch { return sym; }
}

// ── REFRESH ALL ───────────────────────────────────────────────────────
async function refreshAll() {
  const results = await Promise.allSettled(watchlist.map(async sym => {
    const q = await fetchQuote(sym);
    if (!profiles[sym]) profiles[sym] = await fetchProfile(sym);
    cache[sym] = q;
  }));

  // count failures quietly
  const failed = results.filter(r => r.status === 'rejected').length;

  renderCards();
  renderTicker();
  updateMarketStatus();
  document.getElementById('lastUpdate').textContent = 'Updated ' + new Date().toLocaleTimeString();
  saveWatchlist();
}

async function fullRefresh() {
  await refreshAll();
  if (newsLoaded) loadNews();
}

// ── ADD / REMOVE SYMBOL ───────────────────────────────────────────────
async function addSymbol() {
  const input = document.getElementById('symInput');
  const errEl = document.getElementById('addErr');
  const sym   = input.value.trim().toUpperCase().replace(/\s/g,'');
  if (!sym || watchlist.includes(sym)) { input.value = ''; return; }

  errEl.style.display = 'none';
  watchlist.push(sym);
  renderCards();    // show skeleton
  input.value = '';

  try {
    const q = await fetchQuote(sym);
    const n = await fetchProfile(sym);
    cache[sym]    = q;
    profiles[sym] = n;
    renderCards();
    renderTicker();
    saveWatchlist();
  } catch {
    errEl.textContent  = `✗ "${sym}" not found. Check the ticker symbol.`;
    errEl.style.display = 'block';
    watchlist = watchlist.filter(s => s !== sym);
    delete cache[sym];
    renderCards();
  }
}

function removeSymbol(sym) {
  watchlist = watchlist.filter(s => s !== sym);
  delete cache[sym];
  delete profiles[sym];
  renderCards();
  renderTicker();
  saveWatchlist();
}

document.getElementById('symInput')
  .addEventListener('keydown', e => { if (e.key === 'Enter') addSymbol(); });

// ── FORMATTING ────────────────────────────────────────────────────────
function fmtPrice(n) {
  if (n == null) return '—';
  if (n >= 10000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100)   return '$' + n.toFixed(2);
  if (n >= 1)     return '$' + n.toFixed(3);
  return '$' + n.toFixed(5);
}
function fmtVol(v) {
  if (!v) return '—';
  if (v >= 1e9) return (v/1e9).toFixed(1)+'B';
  if (v >= 1e6) return (v/1e6).toFixed(1)+'M';
  if (v >= 1e3) return (v/1e3).toFixed(0)+'K';
  return v;
}
function timeAgo(ts) {
  if (!ts) return '';
  const m = Math.floor((Date.now() - ts * 1000) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h/24) + 'd ago';
}
function stateLabel(sym, q) {
  if (!q) return { text:'', cls:'' };
  // Crypto trades 24/7
  if (sym.includes('-USD') || sym.includes('USD')) return { text:'● 24/7', cls:'open' };
  // Stock market hours (NY)
  const ny   = new Date(new Date().toLocaleString('en-US', { timeZone:'America/New_York' }));
  const mins = ny.getHours()*60 + ny.getMinutes();
  const day  = ny.getDay();
  if (day===0||day===6)            return { text:'○ CLOSED', cls:'closed' };
  if (mins>=930 && mins<960)       return { text:'● OPEN',   cls:'open'   };
  if (mins>=570 && mins<930)       return { text:'◐ PRE',    cls:'pre'    };
  if (mins>=960 && mins<1200)      return { text:'◑ POST',   cls:'pre'    };
  return { text:'○ CLOSED', cls:'closed' };
}

// ── RENDER CARDS ──────────────────────────────────────────────────────
function renderCards() {
  const grid = document.getElementById('cardGrid');
  grid.innerHTML = '';

  watchlist.forEach(sym => {
    const q   = cache[sym];
    const div = document.createElement('div');

    if (!q) {
      div.className = 's-card';
      div.innerHTML = `
        <div class="s-top">
          <div class="s-sym">${sym}</div>
          <div class="s-price"><span class="skel" style="width:80px;height:18px"></span></div>
          <div class="s-name"><span class="skel" style="width:130px;height:9px"></span></div>
          <div class="s-chg"></div>
        </div>
        <div class="s-meta"><span style="color:var(--muted)"><span class="spinner"></span> Fetching...</span></div>
        <button class="rm-btn" onclick="removeSymbol('${sym}')">✕</button>`;
    } else {
      const up   = q.dp >= 0;
      const dir  = up ? 'up' : 'dn';
      const arr  = up ? '▲' : '▼';
      const sign = up ? '+' : '';
      const st   = stateLabel(sym, q);
      div.className = `s-card ${dir}`;
      div.innerHTML = `
        <div class="s-top">
          <div class="s-sym">${sym}</div>
          <div class="s-price">${fmtPrice(q.c)}</div>
          <div class="s-name">${profiles[sym] || sym}</div>
          <div class="s-chg ${dir}">${arr} ${sign}${q.d?.toFixed(2)} (${sign}${q.dp?.toFixed(2)}%)</div>
        </div>
        <div class="s-meta">
          <span><strong>O</strong>${fmtPrice(q.o)}</span>
          <span><strong>H</strong>${fmtPrice(q.h)}</span>
          <span><strong>L</strong>${fmtPrice(q.l)}</span>
          <span><strong>PC</strong>${fmtPrice(q.pc)}</span>
          <span class="s-state ${st.cls}" style="margin-left:auto">${st.text}</span>
        </div>
        <button class="rm-btn" onclick="removeSymbol('${sym}')">✕</button>`;
    }
    grid.appendChild(div);
  });
}

// ── RENDER TICKER ─────────────────────────────────────────────────────
function renderTicker() {
  const ready = watchlist.filter(s => cache[s]);
  if (!ready.length) return;

  const items = [...ready, ...ready].map(sym => {
    const q  = cache[sym];
    const up = q.dp >= 0;
    return `<span class="tick-item">
      <span class="tick-sym">${sym}</span>
      <span class="tick-pr">${fmtPrice(q.c)}</span>
      <span class="tick-ch ${up?'up':'dn'}">${up?'▲':'▼'} ${Math.abs(q.dp).toFixed(2)}%</span>
    </span>`;
  }).join('');

  document.getElementById('tickerTrack').innerHTML = items;
}

// ── NEWS ──────────────────────────────────────────────────────────────
const BULLISH = /surge|soar|rally|gain|beat|record|rise|jump|boost|strong|profit|bull|high|top/i;
const BEARISH  = /fall|drop|plunge|miss|lose|crash|decline|risk|warn|cut|weak|loss|bear|low|sell/i;

async function loadNews() {
  const list = document.getElementById('newsList');
  list.innerHTML = '<div class="empty-state"><span class="spinner"></span> Loading news...</div>';

  try {
    const data = await fhGet('/news?category=general&minId=0');
    if (!Array.isArray(data) || !data.length) throw new Error('empty');

    newsLoaded = true;
    document.getElementById('newsCount').textContent = data.slice(0,15).length + ' ARTICLES';

    list.innerHTML = data.slice(0, 15).map(a => {
      const title   = a.headline || '';
      const summary = a.summary  || '';
      const source  = a.source   || '';
      const ts      = a.datetime || 0;
      const url     = a.url      || '#';

      const related  = (a.related || '').split(',').filter(s => watchlist.includes(s.trim().toUpperCase())).slice(0,2);
      const tags     = related.map(s => `<span class="n-tag">${s.trim().toUpperCase()}</span>`).join('');
      const sentTag  = BULLISH.test(title) ? '<span class="n-tag bull">↑ BULLISH</span>'
                     : BEARISH.test(title) ? '<span class="n-tag bear">↓ BEARISH</span>' : '';

      return `<a class="n-item" href="${url}" target="_blank" rel="noopener noreferrer">
        <div class="n-top">
          ${tags}${sentTag}
          <span class="n-source">${source}</span>
          <span class="n-time">${timeAgo(ts)}</span>
        </div>
        <div class="n-title">${title}</div>
        ${summary && summary !== title ? `<div class="n-summary">${summary}</div>` : ''}
      </a>`;
    }).join('');
  } catch {
    list.innerHTML = '<div class="empty-state">Failed to load news. Click ↻ Refresh to try again.</div>';
  }
}

// ── TABS ──────────────────────────────────────────────────────────────
function switchTab(id, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  document.querySelectorAll('.pane').forEach(p => p.style.display = 'none');
  document.getElementById(`pane-${id}`).style.display = 'block';

  if (id === 'news' && !newsLoaded) loadNews();
}

// ── LAUNCH APP ────────────────────────────────────────────────────────
function launchApp() {
  document.getElementById('gate').style.display = 'none';
  document.getElementById('app').style.display  = 'block';

  renderCards();        // show skeletons immediately
  refreshAll();         // fetch real data
  updateMarketStatus();

  clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshAll, REFRESH_INTERVAL);
}

// ── AUTO-LAUNCH IF KEY SAVED ──────────────────────────────────────────
if (API_KEY) {
  launchApp();
} else {
  document.getElementById('gate').style.display = 'flex';
}
