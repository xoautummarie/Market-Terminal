// ═══════════════════════════════════════════════════
//  FLOWDESK — app.js  (All free, no paywall)
// ═══════════════════════════════════════════════════

const BASE        = 'https://finnhub.io/api/v1';
const REFRESH_MS  = 90_000;
const NEWS_MS     = 120_000; // news refreshes every 2 min
const DEFAULT_WL  = ['AAPL','TSLA','NVDA','SPY','MSFT','AMZN','META','GOOGL','AMD','QQQ'];
const REPUTABLE   = ['Reuters','Associated Press','AP','Bloomberg','MarketWatch','Wall Street Journal','WSJ','CNBC','Financial Times','Barron\'s','Investopedia','Seeking Alpha','The Motley Fool','Yahoo Finance','Forbes'];

// ── State ─────────────────────────────────────────
let API_KEY     = localStorage.getItem('fd_key') || '';
let watchlist   = _load('fd_wl') || [...DEFAULT_WL];
let cache       = {};
let profiles    = {};
let refreshTmr  = null;
let newsTmr     = null;
let allNews     = [];
let newsFilter  = 'all';
let tvWidget    = null;
let tvInterval  = '1';
let playsTab    = 'calls';
let chatHistory = [];
let chatBusy    = false;

// ── Storage ────────────────────────────────────────
function _load(k)    { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function _save(k,v)  { localStorage.setItem(k, JSON.stringify(v)); }
function saveWL()    { _save('fd_wl', watchlist); }

// ── API ────────────────────────────────────────────
async function fh(path, key) {
  const k = key || API_KEY;
  const r = await fetch(`${BASE}${path}&token=${k}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function claude(prompt, maxTok = 900) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTok,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: prompt
    })
  });
  const d = await r.json();
  return (d.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
}

// ── Gate ──────────────────────────────────────────
async function submitKey() {
  const val = document.getElementById('keyInput').value.trim();
  if (!val) return;
  const err = document.getElementById('keyError');
  const btn = document.querySelector('.gate-row button');
  err.textContent = ''; btn.textContent = 'CHECKING...'; btn.disabled = true;
  try {
    const t = await fh('/quote?symbol=AAPL', val);
    if (!t || t.c == null) throw new Error();
    API_KEY = val; localStorage.setItem('fd_key', val);
    launchApp();
  } catch { err.textContent = '✗ Invalid key. Get yours free at finnhub.io — no card needed.'; }
  finally   { btn.textContent = 'LAUNCH →'; btn.disabled = false; }
}
function changeKey() {
  localStorage.removeItem('fd_key'); API_KEY = '';
  clearInterval(refreshTmr); clearInterval(newsTmr);
  document.getElementById('app').style.display  = 'none';
  document.getElementById('gate').style.display = 'flex';
}
document.getElementById('keyInput').addEventListener('keydown', e => { if(e.key==='Enter') submitKey(); });

// ── Market Status ──────────────────────────────────
function updateMarketStatus() {
  const ny   = new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
  const day  = ny.getDay(), m = ny.getHours()*60+ny.getMinutes();
  const el   = document.getElementById('mktBadge');
  if (day===0||day===6)         { el.textContent='● WEEKEND';   el.className='mkt-badge closed'; return; }
  if (m>=570  && m<930)         { el.textContent='◐ PRE-MKT';   el.className='mkt-badge pre';    return; }
  if (m>=930  && m<960)         { el.textContent='● OPEN';      el.className='mkt-badge open';   return; }
  if (m>=960  && m<1200)        { el.textContent='◑ AFTER-HRS'; el.className='mkt-badge pre';    return; }
  el.textContent='● CLOSED'; el.className='mkt-badge closed';
}

// ── Fear & Greed ───────────────────────────────────
async function updateFG() {
  try {
    const q = await fh('/quote?symbol=SPY');
    if (!q||!q.c) return;
    const c=q.dp||0;
    let score,label,cls;
    if      (c>1.5) { score=80;label='EXTREME GREED';cls='extreme-greed'; }
    else if (c>0.5) { score=65;label='GREED';         cls='greed'; }
    else if (c>-0.5){ score=50;label='NEUTRAL';       cls='neutral'; }
    else if (c>-1.5){ score=35;label='FEAR';          cls='fear'; }
    else            { score=20;label='EXTREME FEAR';  cls='extreme-fear'; }
    const el = document.getElementById('fgValue');
    el.textContent = `${score} · ${label}`;
    el.className   = `fg-value ${cls}`;
  } catch {}
}

// ── Prices ────────────────────────────────────────
async function refreshAll() {
  await Promise.allSettled(watchlist.map(async s => {
    try {
      cache[s] = await fh(`/quote?symbol=${s}`);
      if (!profiles[s]) profiles[s] = await fh(`/stock/profile2?symbol=${s}`).then(d=>d.name||s).catch(()=>s);
    } catch {}
  }));
  renderCards(); renderTicker(); updateMarketStatus(); updateFG();
  document.getElementById('lastUpdate').textContent = 'Updated '+new Date().toLocaleTimeString();
  saveWL();
}

async function addSymbol() {
  const inp = document.getElementById('symInput');
  const err = document.getElementById('addErr');
  const sym = inp.value.trim().toUpperCase().replace(/\s/g,'');
  if (!sym||watchlist.includes(sym)) { inp.value=''; return; }
  err.style.display='none'; watchlist.push(sym); renderCards(); inp.value='';
  try {
    cache[sym]    = await fh(`/quote?symbol=${sym}`);
    profiles[sym] = await fh(`/stock/profile2?symbol=${sym}`).then(d=>d.name||sym).catch(()=>sym);
    renderCards(); renderTicker(); saveWL();
  } catch {
    err.textContent  = `✗ "${sym}" not found. Check the ticker symbol.`;
    err.style.display = 'block';
    watchlist = watchlist.filter(s=>s!==sym); delete cache[sym]; renderCards();
  }
}
function removeSymbol(sym) {
  watchlist=watchlist.filter(s=>s!==sym); delete cache[sym]; delete profiles[sym];
  renderCards(); renderTicker(); saveWL();
}
document.getElementById('symInput').addEventListener('keydown',e=>{ if(e.key==='Enter') addSymbol(); });

// ── Formatting ─────────────────────────────────────
function fmtP(n) {
  if(n==null) return '—';
  if(n>=10000) return '$'+n.toLocaleString('en-US',{maximumFractionDigits:0});
  if(n>=100)   return '$'+n.toFixed(2);
  if(n>=1)     return '$'+n.toFixed(3);
  return '$'+n.toFixed(5);
}
function timeAgo(ts) {
  if(!ts) return '';
  const m=Math.floor((Date.now()-ts*1000)/60000);
  if(m<1) return 'just now'; if(m<60) return m+'m ago';
  const h=Math.floor(m/60); if(h<24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}
function stateLabel(sym) {
  const ny=new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
  const m=ny.getHours()*60+ny.getMinutes(),d=ny.getDay();
  if(d===0||d===6) return {text:'○ CLOSED',cls:'closed'};
  if(m>=930&&m<960) return {text:'● OPEN',cls:'open'};
  if(m>=570&&m<930) return {text:'◐ PRE',cls:'pre'};
  if(m>=960&&m<1200) return {text:'◑ POST',cls:'pre'};
  return {text:'○ CLOSED',cls:'closed'};
}

// ── Render Cards ──────────────────────────────────
function renderCards() {
  const g = document.getElementById('cardGrid');
  g.innerHTML = '';
  watchlist.forEach(sym => {
    const q=cache[sym], el=document.createElement('div');
    if (!q) {
      el.className='s-card';
      el.innerHTML=`
        <div class="s-top">
          <div class="s-sym">${sym}</div>
          <div class="s-price"><span class="skel" style="width:80px;height:18px"></span></div>
          <div class="s-name"><span class="skel" style="width:130px;height:9px"></span></div>
          <div class="s-chg"></div>
        </div>
        <div class="s-meta"><span class="spinner"></span>&nbsp;Fetching...</div>
        <button class="rm-btn" onclick="removeSymbol('${sym}')">✕</button>`;
    } else {
      const up=q.dp>=0,dir=up?'up':'dn',arr=up?'▲':'▼',sgn=up?'+':'';
      const st=stateLabel(sym);
      el.className=`s-card ${dir}`;
      el.innerHTML=`
        <span class="s-card-click-hint">📊 TAP TO CHART</span>
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
          <span class="s-state ${st.cls}">${st.text}</span>
        </div>
        <button class="rm-btn" onclick="event.stopPropagation();removeSymbol('${sym}')">✕</button>`;
      el.onclick = () => openChartFor(sym);
    }
    g.appendChild(el);
  });
}

// ── Render Ticker ──────────────────────────────────
function renderTicker() {
  const ready=watchlist.filter(s=>cache[s]);
  if(!ready.length) return;
  const html=[...ready,...ready].map(sym=>{
    const q=cache[sym],up=q.dp>=0;
    return `<span class="tick-item" onclick="openChartFor('${sym}')">
      <span class="tick-sym">${sym}</span>
      <span>${fmtP(q.c)}</span>
      <span class="tick-ch ${up?'up':'dn'}">${up?'▲':'▼'} ${Math.abs(q.dp).toFixed(2)}%</span>
    </span>`;
  }).join('');
  document.getElementById('tickerTrack').innerHTML=html;
}

// ── Chart ──────────────────────────────────────────
function openChartFor(sym) {
  document.getElementById('chartSym').value = sym;
  switchTab('chart', document.querySelector('.tab:nth-child(2)'));
  loadChart();
}

function loadChart() {
  const sym  = (document.getElementById('chartSym').value||'SPY').trim().toUpperCase();
  const cont = document.getElementById('tvChart');
  cont.innerHTML = '';
  if (tvWidget) { try { tvWidget.remove(); } catch {} tvWidget=null; }
  tvWidget = new TradingView.widget({
    container_id: 'tvChart',
    symbol:       sym,
    interval:     tvInterval,
    timezone:     'America/New_York',
    theme:        'dark',
    style:        '1',
    locale:       'en',
    toolbar_bg:   '#0c0c18',
    enable_publishing: false,
    allow_symbol_change: true,
    hide_top_toolbar: false,
    hide_legend:  false,
    withdateranges: true,
    save_image:   true,
    studies:      ['MACD@tv-basicstudies','RSI@tv-basicstudies','Volume@tv-basicstudies'],
    width:  '100%',
    height: '100%',
    autosize: true,
    overrides: {
      'paneProperties.background':            '#0c0c18',
      'paneProperties.backgroundType':        'solid',
      'scalesProperties.textColor':           '#8888bb',
      'mainSeriesProperties.candleStyle.upColor':       '#00ff88',
      'mainSeriesProperties.candleStyle.downColor':     '#ff3355',
      'mainSeriesProperties.candleStyle.borderUpColor': '#00ff88',
      'mainSeriesProperties.candleStyle.borderDownColor':'#ff3355',
      'mainSeriesProperties.candleStyle.wickUpColor':   '#00ff88',
      'mainSeriesProperties.candleStyle.wickDownColor': '#ff3355',
    }
  });
}

function setInterval(val, btn) {
  tvInterval = val;
  document.querySelectorAll('.interval-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  loadChart();
}

// ── Pulse (Sentiment) ──────────────────────────────
async function loadPulse() {
  // Overall mood from SPY
  const moodEl = document.getElementById('overallMood');
  moodEl.innerHTML = '<span class="spinner"></span>';
  const wsbEl  = document.getElementById('wsbTrending');
  wsbEl.innerHTML  = '<div class="empty-state"><span class="spinner"></span></div>';
  const sentEl = document.getElementById('sentGrid');
  sentEl.innerHTML = '<div class="empty-state"><span class="spinner"></span></div>';

  // Get SPY move for overall mood
  try {
    const spy = cache['SPY'] || await fh('/quote?symbol=SPY');
    const c = spy.dp || 0;
    let emoji, label, color, pct;
    if      (c>2)    { emoji='🚀'; label='MARKET RIPPING'; color=`var(--green)`;  pct=90; }
    else if (c>0.5)  { emoji='📈'; label='BULLISH MOMENTUM'; color=`var(--green)`;  pct=70; }
    else if (c>-0.5) { emoji='😐'; label='SIDEWAYS / MIXED'; color=`var(--yellow)`; pct=50; }
    else if (c>-2)   { emoji='📉'; label='BEARISH PRESSURE'; color=`var(--red)`;    pct=30; }
    else             { emoji='💀'; label='MARKET BLEEDING';  color=`var(--red)`;    pct=10; }
    moodEl.innerHTML=`
      <div class="mood-emoji">${emoji}</div>
      <div class="mood-info">
        <div class="mood-label" style="color:${color}">${label}</div>
        <div class="mood-sub">SPY ${c>=0?'+':''}${c.toFixed(2)}% today · Based on price action</div>
      </div>
      <div class="mood-bar-wrap">
        <div style="font-size:9px;color:var(--muted);letter-spacing:1px;">BULLISH PRESSURE</div>
        <div class="mood-bar"><div class="mood-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      </div>`;
  } catch { moodEl.innerHTML=''; }

  // WSB trending — use news sentiment to find trending symbols
  try {
    const news = await fh('/news?category=general&minId=0');
    const symCount = {};
    const symSent  = {};
    const bull = /surge|soar|rally|gain|beat|record|rise|jump|boost|bull|breakout|high/i;
    const bear = /fall|drop|plunge|miss|crash|decline|risk|warn|cut|loss|bear|low|sell/i;
    (news||[]).slice(0,30).forEach(a => {
      const related = (a.related||'').split(',').map(s=>s.trim().toUpperCase()).filter(s=>s.length>0&&s.length<6);
      related.forEach(s => {
        symCount[s] = (symCount[s]||0)+1;
        if (!symSent[s]) symSent[s]='neu';
        if (bull.test(a.headline||'')) symSent[s]='bull';
        else if (bear.test(a.headline||'')) symSent[s]='bear';
      });
    });
    const top = Object.entries(symCount).sort((a,b)=>b[1]-a[1]).slice(0,8);
    if (top.length) {
      wsbEl.innerHTML='';
      top.forEach(([sym,count])=>{
        const sent=symSent[sym]||'neu';
        const sentLabel=sent==='bull'?'↑ BULLISH BUZZ':sent==='bear'?'↓ BEARISH BUZZ':'→ NEUTRAL';
        const el=document.createElement('div');
        el.className='wsb-card';
        el.innerHTML=`
          <div class="wsb-sym">${sym}</div>
          <div class="wsb-mentions">${count} recent article${count>1?'s':''}</div>
          <div class="wsb-sent ${sent}">${sentLabel}</div>`;
        el.onclick=()=>openChartFor(sym);
        wsbEl.appendChild(el);
      });
    } else {
      wsbEl.innerHTML='<div class="empty-state">No trending data right now.</div>';
    }
  } catch { wsbEl.innerHTML='<div class="empty-state">Could not load trending data.</div>'; }

  // Watchlist sentiment from news
  const syms = watchlist.slice(0,10);
  const sentCards = await Promise.allSettled(syms.map(async sym => {
    const news = await fh(`/company-news?symbol=${sym}&from=${daysAgo(7)}&to=${today()}`);
    return { sym, news: news||[] };
  }));
  sentEl.innerHTML='';
  let any=false;
  sentCards.forEach(r => {
    if (r.status!=='fulfilled'||!r.value.news.length) return;
    any=true;
    const {sym,news} = r.value;
    const bull=/surge|soar|rally|gain|beat|record|rise|jump|boost|bull|breakout/i;
    const bear=/fall|drop|plunge|miss|crash|decline|risk|warn|cut|loss|bear/i;
    let pos=0,neg=0;
    news.forEach(a=>{ if(bull.test(a.headline||'')) pos++; else if(bear.test(a.headline||'')) neg++; });
    const total=pos+neg||1;
    const ratio=(pos-neg)/total;
    const cls=ratio>0.1?'bull':ratio<-0.1?'bear':'neu';
    const label=ratio>0.1?'BULLISH':ratio<-0.1?'BEARISH':'NEUTRAL';
    const posPct=Math.round(pos/total*100), negPct=Math.round(neg/total*100);
    const el=document.createElement('div');
    el.className='sent-card';
    el.innerHTML=`
      <div class="sent-top">
        <div class="sent-sym">${sym}</div>
        <div class="sent-name">${profiles[sym]||sym}</div>
        <div class="sent-badge ${cls}">${label}</div>
      </div>
      <div class="sent-bar-row">
        <span class="sent-bar-label">Bullish</span>
        <div class="sent-bar-track"><div class="sent-bar-fill pos" style="width:${posPct}%"></div></div>
        <span class="sent-bar-val">${posPct}%</span>
      </div>
      <div class="sent-bar-row">
        <span class="sent-bar-label">Bearish</span>
        <div class="sent-bar-track"><div class="sent-bar-fill neg" style="width:${negPct}%"></div></div>
        <span class="sent-bar-val">${negPct}%</span>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:6px">${news.length} news articles in last 7 days</div>`;
    sentEl.appendChild(el);
  });
  if (!any) sentEl.innerHTML='<div class="empty-state">No recent news found for your watchlist.</div>';
}

// ── Scanner ────────────────────────────────────────
async function loadScanner() {
  const scanList   = document.getElementById('scanResults');
  const moversGrid = document.getElementById('moversGrid');
  scanList.innerHTML   = '<div class="empty-state"><span class="spinner"></span> Scanning...</div>';
  moversGrid.innerHTML = '<div class="empty-state"><span class="spinner"></span></div>';

  // Watchlist movers
  const alerts = watchlist
    .filter(s=>cache[s])
    .map(s=>({sym:s,q:cache[s]}))
    .filter(a=>Math.abs(a.q.dp||0)>1.0)
    .sort((a,b)=>Math.abs(b.q.dp||0)-Math.abs(a.q.dp||0));

  if (!alerts.length) {
    scanList.innerHTML='<div class="empty-state">No significant moves in your watchlist right now.<br>Alerts trigger on moves &gt;1% from prior close.</div>';
  } else {
    scanList.innerHTML='';
    alerts.forEach(({sym,q})=>{
      const up=q.dp>=0,bar=Math.min(Math.abs(q.dp)/5*100,100);
      const el=document.createElement('div');
      el.className='scan-card';
      el.innerHTML=`
        <div class="scan-sym">${sym}</div>
        <div class="scan-info">
          <div class="scan-reason">Price move from close · ${profiles[sym]||sym}</div>
          <div class="scan-bar-wrap">
            <div class="scan-bar-track"><div class="scan-bar-fill" style="width:${bar}%"></div></div>
          </div>
        </div>
        <div class="scan-mult">${Math.abs(q.dp).toFixed(2)}%</div>
        <div class="scan-price-col">
          <div class="scan-pr">${fmtP(q.c)}</div>
          <div class="scan-chg ${up?'up':'dn'}">${up?'▲':'▼'} ${q.dp?.toFixed(2)}%</div>
        </div>
        <button class="scan-open-btn" onclick="event.stopPropagation();openChartFor('${sym}')">📊 CHART</button>`;
      el.onclick=()=>openChartFor(sym);
      scanList.appendChild(el);
    });
  }

  // All watchlist as movers grid
  const sorted=[...watchlist.filter(s=>cache[s])].sort((a,b)=>Math.abs(cache[b].dp||0)-Math.abs(cache[a].dp||0)).slice(0,8);
  moversGrid.innerHTML='';
  sorted.forEach(sym=>{
    const q=cache[sym],up=q.dp>=0;
    const el=document.createElement('div');
    el.className='mover-card';
    el.innerHTML=`
      <div class="mover-sym">${sym}</div>
      <div class="mover-name">${profiles[sym]||sym}</div>
      <div class="mover-price">${fmtP(q.c)}</div>
      <div class="mover-chg ${up?'up':'dn'}">${up?'▲':'▼'} ${q.dp?.toFixed(2)}%</div>`;
    el.onclick=()=>openChartFor(sym);
    moversGrid.appendChild(el);
  });
}

// ── Calendar ───────────────────────────────────────
async function loadCalendar() {
  const earnList  = document.getElementById('earnList');
  const macroList = document.getElementById('macroList');
  const now = new Date();
  document.getElementById('calMonth').textContent = now.toLocaleString('en-US',{month:'long',year:'numeric'}).toUpperCase();

  // First day and last day of current month
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const lastDay  = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().slice(0,10);

  earnList.innerHTML='<div class="empty-state"><span class="spinner"></span> Loading earnings...</div>';

  try {
    const data = await fh(`/calendar/earnings?from=${firstDay}&to=${lastDay}`);
    const items = (data.earningsCalendar||[]).sort((a,b)=>new Date(a.date)-new Date(b.date));
    const wlSet = new Set(watchlist);

    if (!items.length) {
      earnList.innerHTML='<div class="empty-state">No earnings data found for this month.</div>';
    } else {
      earnList.innerHTML='';
      // Show all — starred ones are in watchlist
      items.forEach(e=>{
        const d=new Date(e.date);
        const day=d.getDate();
        const mon=d.toLocaleString('en-US',{month:'short'}).toUpperCase();
        const inWL=wlSet.has(e.symbol);
        const time=e.hour==='bmo'?'BMO':e.hour==='amc'?'AMC':'TBD';
        const timeCls=e.hour==='bmo'?'bmo':e.hour==='amc'?'amc':'';
        const el=document.createElement('div');
        el.className='earn-card';
        el.innerHTML=`
          <div class="earn-date"><span class="earn-day">${day}</span>${mon}</div>
          <div>
            <div class="earn-sym">${inWL?'<span class="earn-wl-star">★</span>':''}${e.symbol}</div>
            <div class="earn-name">${e.name||e.symbol}</div>
          </div>
          <div class="earn-right">
            <div class="earn-time ${timeCls}">${time}</div>
            ${e.epsEstimate?`<div class="earn-eps">EPS est: $${parseFloat(e.epsEstimate).toFixed(2)}</div>`:''}
          </div>`;
        earnList.appendChild(el);
      });
    }
  } catch {
    earnList.innerHTML='<div class="empty-state">Failed to load earnings. Click ↻ to try again.</div>';
  }

  // Macro events — hardcoded known schedule + dynamic current month
  macroList.innerHTML='';
  const macroEvents = getMacroEvents();
  if (!macroEvents.length) {
    macroList.innerHTML='<div class="empty-state">No macro events this month.</div>';
  } else {
    macroEvents.forEach(e=>{
      const el=document.createElement('div');
      el.className='macro-card';
      el.innerHTML=`
        <div class="macro-icon">${e.icon}</div>
        <div class="macro-info">
          <div class="macro-title">${e.title}</div>
          <div class="macro-date">${e.date}</div>
        </div>
        <div class="macro-impact ${e.impact}">${e.impact.toUpperCase()} IMPACT</div>`;
      macroList.appendChild(el);
    });
  }
}

function getMacroEvents() {
  const now = new Date();
  const m = now.getMonth()+1, y = now.getFullYear();
  const mon = now.toLocaleString('en-US',{month:'long'});
  // These are recurring known schedule events — updated monthly
  // Sources: Federal Reserve, BLS, CME Group
  const events = [
    { icon:'🏦', title:'FOMC Meeting / Fed Rate Decision', date:`Watch federalreserve.gov for ${mon} ${y} date`, impact:'high' },
    { icon:'📊', title:'CPI Inflation Report (BLS)', date:`Released ~2nd week of ${mon} ${y}`, impact:'high' },
    { icon:'💼', title:'Nonfarm Payrolls / Jobs Report', date:`Released 1st Friday of ${mon} ${y}`, impact:'high' },
    { icon:'📈', title:'PCE Price Index (Fed\'s preferred inflation gauge)', date:`Released last Friday of ${mon} ${y}`, impact:'high' },
    { icon:'🏭', title:'ISM Manufacturing PMI', date:`Released 1st business day of ${mon} ${y}`, impact:'medium' },
    { icon:'🛍️', title:'Retail Sales Report', date:`Released ~mid-month ${mon} ${y}`, impact:'medium' },
    { icon:'🏠', title:'Housing Starts & Building Permits', date:`Released ~3rd week of ${mon} ${y}`, impact:'medium' },
    { icon:'📉', title:'Initial Jobless Claims (Weekly)', date:'Every Thursday · 8:30 AM ET', impact:'medium' },
    { icon:'⚡', title:'Options Expiration (Monthly OpEx)', date:`3rd Friday of ${mon} ${y} · High volatility expected`, impact:'high' },
    { icon:'📋', title:'Treasury Auction (10Y Note)', date:`Multiple dates in ${mon} ${y} · Check TreasuryDirect`, impact:'medium' },
  ];
  return events;
}

// ── Congress ───────────────────────────────────────
async function loadCongress() {
  const list = document.getElementById('congList');
  list.innerHTML='<div class="empty-state"><span class="spinner"></span> Loading congressional trades...</div>';
  try {
    const from=daysAgo(60), to=today();
    const data = await fh(`/stock/congressional-trading?symbol=&from=${from}&to=${to}`);
    const trades=(data.data||[]).sort((a,b)=>new Date(b.transactionDate)-new Date(a.transactionDate)).slice(0,40);
    document.getElementById('congCount').textContent = trades.length+' RECENT DISCLOSURES';

    if (!trades.length) {
      list.innerHTML=`<div class="empty-state">
        No trades returned. Finnhub congressional data may need a premium key.<br><br>
        You can also view this data free at:<br>
        <a href="https://efts.sec.gov/LATEST/search-index?q=%22Form+4%22&dateRange=custom&startdt=${daysAgo(30)}&enddt=${today()}" target="_blank" style="color:var(--green)">SEC EDGAR (free)</a> · 
        <a href="https://disclosures.house.gov/" target="_blank" style="color:var(--green)">House Disclosures</a> · 
        <a href="https://efts.sec.gov" target="_blank" style="color:var(--green)">Senate Disclosures</a>
      </div>`;
      return;
    }

    list.innerHTML='';
    trades.forEach(t=>{
      const isBuy=/purchase|buy/i.test(t.transactionType||'');
      const isSell=/sale|sell/i.test(t.transactionType||'');
      const actCls=isBuy?'buy':isSell?'sell':'other';
      const actLbl=isBuy?'BUY':isSell?'SELL':'OTHER';
      const el=document.createElement('div');
      el.className='cong-card';
      el.innerHTML=`
        <div class="cong-top">
          <div class="cong-sym">${t.symbol||'—'}</div>
          <div class="cong-action ${actCls}">${actLbl}</div>
          <div class="cong-amount">${t.amount||'Undisclosed'}</div>
        </div>
        <div class="cong-name">${t.name||'Unknown Official'}</div>
        <div class="cong-meta">
          <span><strong>DATE</strong>${t.transactionDate||'—'}</span>
          <span><strong>TYPE</strong>${t.transactionType||'—'}</span>
          <span><strong>FILED</strong>${t.filingDate||'—'}</span>
        </div>`;
      list.appendChild(el);
    });
  } catch {
    list.innerHTML=`<div class="empty-state">
      Congressional trade data via free Finnhub endpoint is limited.<br><br>
      View 100% free official sources:<br><br>
      <a href="https://disclosures.house.gov/" target="_blank" style="color:var(--green)">🏛 House of Representatives Disclosures</a><br>
      <a href="https://efts.sec.gov/LATEST/search-index?q=%22senator%22" target="_blank" style="color:var(--green)">🏛 Senate STOCK Act Disclosures</a>
    </div>`;
  }
}

// ── News ───────────────────────────────────────────
const BULL_NEWS = /surge|soar|rally|gain|beat|record|rise|jump|boost|bull|upgrade|strong|profit/i;
const BEAR_NEWS = /fall|drop|plunge|miss|crash|decline|warn|cut|loss|bear|downgrade|weak|layoff/i;

async function loadNews() {
  const list = document.getElementById('newsList');
  if (!list.innerHTML.includes('spinner'))
    list.innerHTML='<div class="empty-state"><span class="spinner"></span> Loading news...</div>';

  try {
    const data = await fh('/news?category=general&minId=0');
    if (!Array.isArray(data)||!data.length) throw new Error();

    // Sort by recency
    allNews = data.sort((a,b)=>(b.datetime||0)-(a.datetime||0));
    renderNews();
    document.getElementById('newsCount').textContent = allNews.length+' STORIES';
  } catch {
    list.innerHTML='<div class="empty-state">Could not load news. Click ↻ to retry.</div>';
  }
}

function renderNews() {
  const list = document.getElementById('newsList');
  let items = [...allNews];
  if (newsFilter==='bullish') items=items.filter(a=>BULL_NEWS.test(a.headline||''));
  if (newsFilter==='bearish') items=items.filter(a=>BEAR_NEWS.test(a.headline||''));

  if (!items.length) { list.innerHTML='<div class="empty-state">No matching stories.</div>'; return; }

  const now = Date.now();
  list.innerHTML=items.slice(0,25).map(a=>{
    const title=a.headline||'';
    const summary=a.summary||'';
    const src=a.source||'';
    const ts=a.datetime||0;
    const ageMin=Math.floor((now-ts*1000)/60000);
    const isBreaking=ageMin<30;
    const isBull=BULL_NEWS.test(title), isBear=BEAR_NEWS.test(title);
    const sent=isBull?'bullish':isBear?'bearish':'neutral';
    const related=(a.related||'').split(',').filter(s=>watchlist.includes(s.trim().toUpperCase())).slice(0,2);
    const tags=related.map(s=>`<span class="n-tag">${s.trim().toUpperCase()}</span>`).join('');
    const sentTag=isBull?'<span class="n-tag bull">↑ BULLISH</span>':isBear?'<span class="n-tag bear">↓ BEARISH</span>':'';
    const breakTag=isBreaking?'<span class="n-tag breaking">🔴 BREAKING</span>':'';
    return `<a class="n-item" href="${a.url||'#'}" target="_blank" rel="noopener" data-sent="${sent}">
      <div class="n-top">${breakTag}${tags}${sentTag}<span class="n-source">${src}</span><span class="n-time">${timeAgo(ts)}</span></div>
      <div class="n-title">${title}</div>
      ${summary&&summary!==title?`<div class="n-summary">${summary}</div>`:''}
    </a>`;
  }).join('');
}

function setNewsFilter(f, btn) {
  newsFilter=f;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderNews();
}

// ── Plays ──────────────────────────────────────────
function setPlaysTab(tab, btn) {
  playsTab=tab;
  document.querySelectorAll('.plays-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderPlaysContent();
}

let playsData = { calls:[], puts:[], holds:[] };
let playsLoaded = false;

async function loadPlays() {
  playsLoaded=false;
  const cont=document.getElementById('playsContent');
  cont.innerHTML='<div class="play-loading"><span class="spinner"></span> &nbsp;AI is analyzing current market conditions and generating trade ideas...</div>';

  // Build price context
  const priceCtx = watchlist.filter(s=>cache[s]).map(s=>{
    const q=cache[s];
    return `${s}: $${q.c?.toFixed(2)} (${q.dp>=0?'+':''}${q.dp?.toFixed(2)}%)`;
  }).join(', ');

  const prompt = [{ role:'user', content:`You are a trading analyst. Search the web for today's current market conditions and recent news.

Current prices: ${priceCtx}

Generate AI trade ideas for these THREE categories. Return ONLY valid JSON, no markdown:
{
  "calls": [
    {"sym":"AAPL","thesis":"Why this call makes sense right now in 2-3 sentences using current data","strike":"$XXX","expiry":"e.g. Jun 20 2025","confidence":"HIGH/MEDIUM/LOW","catalyst":"Specific news or technical reason","risk":"Key risk factor"},
    ... 3 total call ideas
  ],
  "puts": [
    {"sym":"SPY","thesis":"Why this put makes sense","strike":"$XXX","expiry":"...","confidence":"...","catalyst":"...","risk":"..."},
    ... 3 total put ideas
  ],
  "holds": [
    {"sym":"NVDA","thesis":"Why this is a strong hold/buy for 3-6 months","entry":"Suggested entry zone","target":"Price target","confidence":"...","catalyst":"...","risk":"..."},
    ... 3 total hold ideas
  ]
}

Use real current data from the web. Focus on high-probability setups. Use symbols from: ${watchlist.slice(0,8).join(', ')} plus other strong opportunities.` }];

  try {
    const raw = await claude(prompt, 1200);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no json');
    playsData = JSON.parse(match[0]);
    playsLoaded=true;
    renderPlaysContent();
  } catch {
    cont.innerHTML='<div class="empty-state">Could not generate plays. Click ↻ to try again.</div>';
  }
}

function renderPlaysContent() {
  if (!playsLoaded) return;
  const cont=document.getElementById('playsContent');
  const items=playsData[playsTab]||[];
  if (!items.length) { cont.innerHTML='<div class="empty-state">No plays generated yet. Click ↻ Refresh.</div>'; return; }
  cont.innerHTML='';
  items.forEach(p=>{
    const el=document.createElement('div');
    el.className='play-card';
    const typeCls=playsTab==='calls'?'call':playsTab==='puts'?'put':'hold';
    const typeLabel=playsTab==='calls'?'📈 CALL':playsTab==='puts'?'📉 PUT':'💎 HOLD';
    const confColor=p.confidence==='HIGH'?'var(--green)':p.confidence==='MEDIUM'?'var(--yellow)':'var(--muted)';
    el.innerHTML=`
      <div class="play-header">
        <div class="play-sym">${p.sym||'—'}</div>
        <div class="play-type ${typeCls}">${typeLabel}</div>
        <div class="play-conf">Confidence: <strong style="color:${confColor}">${p.confidence||'—'}</strong></div>
      </div>
      <div class="play-thesis">${p.thesis||''}</div>
      <div class="play-details">
        ${p.strike  ? `<span><strong>STRIKE</strong>${p.strike}</span>` : ''}
        ${p.expiry  ? `<span><strong>EXPIRY</strong>${p.expiry}</span>` : ''}
        ${p.entry   ? `<span><strong>ENTRY</strong>${p.entry}</span>` : ''}
        ${p.target  ? `<span><strong>TARGET</strong>${p.target}</span>` : ''}
        ${p.catalyst? `<span><strong>CATALYST</strong>${p.catalyst}</span>` : ''}
        ${p.risk    ? `<span><strong>RISK</strong>${p.risk}</span>` : ''}
      </div>`;
    cont.appendChild(el);
  });
}

// ── Ask AI ─────────────────────────────────────────
function askSuggestion(btn) {
  document.getElementById('chatInput').value = btn.textContent;
  sendChat();
}

async function sendChat() {
  if (chatBusy) return;
  const inp  = document.getElementById('chatInput');
  const msgs = document.getElementById('chatMessages');
  const send = document.getElementById('chatSend');
  const text = inp.value.trim();
  if (!text) return;

  chatBusy=true; send.disabled=true; inp.value='';

  // User message
  const userEl=document.createElement('div');
  userEl.className='msg user';
  userEl.innerHTML=`<div class="msg-label">YOU</div>${escHtml(text)}`;
  msgs.appendChild(userEl);

  // Thinking bubble
  const thinkEl=document.createElement('div');
  thinkEl.className='msg ai';
  thinkEl.innerHTML=`<div class="msg-label">FLOWDESK AI</div><span class="msg-thinking"><span class="spinner"></span> &nbsp;Thinking...</span>`;
  msgs.appendChild(thinkEl);
  msgs.scrollTop=msgs.scrollHeight;

  // Build history
  chatHistory.push({ role:'user', content:text });
  if (chatHistory.length>20) chatHistory=chatHistory.slice(-20);

  const systemMsg = { role:'user', content:`You are FlowDesk AI, a friendly trading assistant built into the FlowDesk free trading terminal. Help users understand:
- Trading concepts (options, stocks, charts, indicators)
- How to use FlowDesk (prices tab, chart tab with TradingView, pulse/sentiment, scanner, calendar, congress trades, plays, ask AI)
- Market mechanics and terminology
- Basic trading strategies and risk management

Keep answers clear, helpful, and educational. Never give specific financial advice or tell people to buy/sell specific securities. Current watchlist: ${watchlist.join(', ')}. Use web search if asked about current events or prices.

User question: ${text}` };

  try {
    const reply = await claude([systemMsg], 800);
    thinkEl.innerHTML=`<div class="msg-label">FLOWDESK AI</div>${formatAIReply(reply)}`;
    chatHistory.push({ role:'assistant', content:reply });
  } catch {
    thinkEl.innerHTML=`<div class="msg-label">FLOWDESK AI</div>Sorry, I couldn't process that. Please try again.`;
  }

  msgs.scrollTop=msgs.scrollHeight;
  chatBusy=false; send.disabled=false;
  inp.focus();
}

function formatAIReply(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.*?)\*/g,'<em>$1</em>')
    .replace(/\n\n/g,'</p><p style="margin-top:8px">')
    .replace(/\n/g,'<br>');
}
function escHtml(t) {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

document.getElementById('chatInput').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey) sendChat(); });

// ── Tabs ───────────────────────────────────────────
function switchTab(id, btn) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.pane').forEach(p=>p.style.display='none');
  document.getElementById(`pane-${id}`).style.display='block';
  if (id==='chart'   && !tvWidget) { setTimeout(loadChart, 100); }
  if (id==='pulse')                 loadPulse();
  if (id==='scanner')               loadScanner();
  if (id==='calendar')              loadCalendar();
  if (id==='congress')              loadCongress();
  if (id==='news')                  loadNews();
}

// ── Full Refresh ───────────────────────────────────
async function fullRefresh() {
  await refreshAll();
  const activeTab = document.querySelector('.tab.active')?.textContent?.trim()?.toLowerCase();
  if (activeTab?.includes('pulse'))    loadPulse();
  if (activeTab?.includes('scanner'))  loadScanner();
  if (activeTab?.includes('calendar')) loadCalendar();
  if (activeTab?.includes('congress')) loadCongress();
  if (activeTab?.includes('news'))     loadNews();
}

// ── Date helpers ───────────────────────────────────
function today()      { return new Date().toISOString().slice(0,10); }
function daysAgo(n)   { const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); }

// ── Launch ─────────────────────────────────────────
function launchApp() {
  document.getElementById('gate').style.display='none';
  document.getElementById('app').style.display='block';
  renderCards();
  refreshAll();
  loadNews();
  clearInterval(refreshTmr); clearInterval(newsTmr);
  refreshTmr = setInterval(refreshAll, REFRESH_MS);
  newsTmr    = setInterval(loadNews,   NEWS_MS);
}

if (API_KEY) launchApp();
else document.getElementById('gate').style.display='flex';
