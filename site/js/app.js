/* The page: search fields, date and time, preferences, results, route sheet and map.
   It uses the engine only through planTrip(query) (see engine.js), so the engine can later move to a server. */
import { Timetable, createEngine, clock, pad } from './engine.js';
import { StrideRealtime, NoRealtime, israelDate, israelMinutes } from './realtime.js';
import { searchAddresses } from './geocode.js';
import { createMap } from './map.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY_NAMES = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];
const dayName = ds => { const [y, m, d] = ds.split('-').map(Number); return DAY_NAMES[new Date(y, m - 1, d).getDay()]; };
const shortDate = ds => { const [, m, d] = ds.split('-').map(Number); return `${d}.${m}`; };

const ICON = {
  walk: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="13" cy="4" r="2"/><path d="M10.5 8.5 8 21h2.2l1.6-7 2.2 2.2V21h2v-6.3l-2.3-2.3.7-3.2A6 6 0 0 0 19 12v-2a4 4 0 0 1-3.3-1.8l-1-1.6A2 2 0 0 0 13 6h-.5a2 2 0 0 0-1.4.6L7 10.6V15h2v-3.6z"/></svg>',
  wait: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
  bus: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v13a1 1 0 0 1-1 1v2h-2.5v-2h-7v2H6v-2a1 1 0 0 1-1-1zm2 2v5h10V6zm1.5 7.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4m7 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4"/></svg>',
  lrt: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 1h6v2h-2v2h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2l1.5 3h-2.2l-1.5-3H10.2l-1.5 3H6.5L8 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3V3H9zM8 8v4h8V8zm1 6.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4m6 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4"/></svg>',
  rail: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c4 0 7 .5 7 4v10a3 3 0 0 1-2 2.8l1.5 2.2h-2.3l-1.4-2H9.2l-1.4 2H5.5L7 18.8A3 3 0 0 1 5 16V6c0-3.5 3-4 7-4m-5 5v4h10V7zm2 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7m0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5"/></svg>',
  me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11 2h2v4h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-5v7h-2v-7H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5z"/></svg>',
  recent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>'
};
ICON.taxi = ICON.bus;
const modeVar = mode => `var(--${mode})`;
const lineName = ln => ln.mode === 'bus' ? `קו ${ln.label}` : ln.mode === 'lrt' ? `רכבת קלה · קו ${ln.label}` : ln.mode === 'taxi' ? `מונית שירות ${ln.label}` : 'רכבת ישראל';

/* ------------------------------ state ------------------------------ */
const state = { from: null, to: null, date: null, time: 0, mode: 'depart', prefs: { walk: 'normal', transfers: '1' }, selected: 0 };
let manifest = null, result = null;
const days = new Map(); // date -> { engine, realtime } once loaded
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
};
Object.assign(state.prefs, store.get('prefs', {}));

const map = createMap($('map'), { onPick: (field, lat, lon) => setPlace(field, { name: `נקודה במפה (${lat.toFixed(4)}, ${lon.toFixed(4)})`, lat, lon, kind: 'point' }) });

/* ------------------------------ data ------------------------------ */
async function loadDay(date) {
  if (days.has(date)) return days.get(date);
  const entry = manifest.days.find(d => d.date === date);
  const r = await fetch('data/' + entry.file);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const tt = new Timetable(await r.json());
  const realtime = israelDate(Date.now()) === date ? new StrideRealtime(date) : new NoRealtime();
  const day = { tt, realtime, engine: createEngine(tt, { realtime }) };
  days.set(date, day);
  return day;
}

/* ------------------------------ search boxes ------------------------------ */
function recent() { return store.get('recent', []); }
function remember(p) {
  if (p.kind === 'me') return; // the user's location is never stored
  const list = recent().filter(x => x.name !== p.name).slice(0, 5);
  store.set('recent', [{ name: p.name, detail: p.detail || '', lat: p.lat, lon: p.lon, kind: p.kind }, ...list]);
}

function setupCombo(field) {
  const input = $(field), list = $(field + '-list');
  let items = [], active = -1, ctrl = null, timer = null;
  const open = () => { list.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; input.removeAttribute('aria-activedescendant'); };
  const icon = k => ({ me: ICON.me, stop: ICON.stop, recent: ICON.recent }[k] || ICON.pin);
  function render(extra = '') {
    list.innerHTML = items.map((it, i) => `<li role="option" id="${field}-opt-${i}" aria-selected="${i === active}" data-i="${i}">${icon(it.kind)}<div><div class="n">${esc(it.name)}</div>${it.detail ? `<div class="d">${esc(it.detail)}</div>` : ''}</div></li>`).join('') + extra;
    items.length || extra ? open() : close();
  }
  function localMatches(q) {
    const day = days.get(state.date);
    if (!day || q.length < 2) return [];
    const qq = q.replace(/["״']/g, '');
    return day.tt.stopGroups().filter(g => g.name.replace(/["״']/g, '').includes(qq)).slice(0, 5)
      .map(g => ({ kind: 'stop', name: g.name, detail: g.count > 1 ? `תחנה · ${g.count} רציפים` : 'תחנה', lat: g.lat, lon: g.lon }));
  }
  function suggest() {
    const q = input.value.trim();
    clearTimeout(timer);
    if (ctrl) ctrl.abort();
    if (!q) {
      items = [{ kind: 'me', name: 'המיקום שלי', detail: 'הדפדפן יבקש רשות. המיקום לא נשלח לשום שרת' }, ...recent().map(r => ({ ...r, kind: 'recent', orig: r.kind }))];
      render(); return;
    }
    const local = localMatches(q);
    items = local; active = -1;
    render(q.length >= 2 ? '<li class="info">מחפש כתובות…</li>' : '');
    if (q.length < 2) return;
    timer = setTimeout(async () => {
      ctrl = new AbortController();
      try {
        const addr = await searchAddresses(q, { signal: ctrl.signal });
        if (input.value.trim() !== q) return;
        items = [...addr.slice(0, 6), ...local];
        render(items.length ? '' : '<li class="info">לא נמצאו תוצאות. אפשר גם ללחוץ על המפה.</li>');
      } catch (e) {
        if (e.name === 'AbortError') return;
        items = local;
        render('<li class="info">חיפוש הכתובות לא זמין כרגע. אפשר לחפש תחנה או ללחוץ על המפה.</li>');
      }
    }, 280);
  }
  async function choose(it) {
    close();
    if (it.kind === 'me') {
      input.value = 'מאתר מיקום…';
      try {
        const pos = await new Promise((res, rej) => navigator.geolocation ? navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }) : rej(new Error('no geolocation')));
        setPlace(field, { kind: 'me', name: 'המיקום שלי', lat: pos.coords.latitude, lon: pos.coords.longitude });
      } catch (e) {
        input.value = '';
        toast(e && e.code === 1 ? 'לא ניתנה הרשאה למיקום. אפשר להקליד כתובת או ללחוץ על המפה.' : 'לא הצלחתי לאתר מיקום.');
      }
      return;
    }
    const place = { kind: it.orig || it.kind, name: it.name, detail: it.detail, lat: it.lat, lon: it.lon };
    remember(place);
    setPlace(field, place);
  }
  input.addEventListener('focus', () => { input.select(); suggest(); });
  input.addEventListener('input', suggest);
  input.addEventListener('keydown', e => {
    if (list.hidden && e.key === 'ArrowDown') { suggest(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      render(); input.setAttribute('aria-activedescendant', `${field}-opt-${active}`);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[active >= 0 ? active : 0];
      if (it) choose(it);
    } else if (e.key === 'Escape') { close(); syncInputs(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { close(); syncInputs(); }, 180));
  list.addEventListener('mousedown', e => e.preventDefault());
  list.addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) choose(items[Number(li.dataset.i)]); });
}

function setPlace(field, place) {
  state[field] = place;
  state.selected = 0;
  $(field).value = place.name;
  if (document.activeElement === $(field)) $(field).blur();
  syncInputs();
  map.setPoints(state.from, state.to);
  run();
}

function syncInputs() {
  if (document.activeElement !== $('from')) $('from').value = state.from ? state.from.name : '';
  if (document.activeElement !== $('to')) $('to').value = state.to ? state.to.name : '';
}

/* ------------------------------ controls ------------------------------ */
function initControls() {
  setupCombo('from'); setupCombo('to');
  $('swap').onclick = () => { [state.from, state.to] = [state.to, state.from]; state.selected = 0; syncInputs(); map.setPoints(state.from, state.to); run(); };
  $('mode-depart').onclick = () => { state.mode = 'depart'; syncControls(); run(); };
  $('mode-arrive').onclick = () => { state.mode = 'arrive'; syncControls(); run(); };
  $('date').onchange = e => { state.date = e.target.value; run(); };
  $('time').onchange = e => { const v = e.target.value; if (v) { const [h, m] = v.split(':').map(Number); state.time = h * 60 + m; run(); } };
  $('now-btn').onclick = () => setNow(true);
  $('share-btn').onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast('הקישור הועתק'); } catch { toast('לא הצלחתי להעתיק. אפשר להעתיק מסרגל הכתובת.'); }
  };
  for (const [id, key] of [['walk-pref', 'walk'], ['xfer-pref', 'transfers']]) {
    $(id).onclick = e => { const b = e.target.closest('button'); if (!b) return; state.prefs[key] = b.dataset.v; store.set('prefs', state.prefs); syncControls(); run(); };
  }
  $('routes').addEventListener('click', e => {
    const n = e.target.closest('[data-next]');
    if (n) { const [d, t] = n.dataset.next.split('|'); state.date = d; state.time = Number(t); syncControls(); run(); return; }
    const b = e.target.closest('.route'); if (b) { state.selected = Number(b.dataset.i); renderResults(); }
  });
}

function setNow(andRun) {
  const today = israelDate(Date.now());
  const has = manifest.days.some(d => d.date === today);
  state.date = has ? today : manifest.days[0].date;
  state.time = has ? israelMinutes(Date.now()) : 8 * 60;
  syncControls();
  if (andRun) run();
}

function syncControls() {
  $('date').innerHTML = manifest.days.map(d => `<option value="${d.date}">${d.date === israelDate(Date.now()) ? 'היום' : dayName(d.date)} · ${shortDate(d.date)}</option>`).join('');
  $('date').value = state.date;
  $('time').value = clock(state.time);
  $('mode-depart').setAttribute('aria-pressed', state.mode === 'depart');
  $('mode-arrive').setAttribute('aria-pressed', state.mode === 'arrive');
  [...$('walk-pref').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.v === state.prefs.walk));
  [...$('xfer-pref').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.v === state.prefs.transfers));
  const bits = [];
  if (state.prefs.walk !== 'normal') bits.push(state.prefs.walk === 'less' ? 'מעט הליכה' : 'הליכה חופשית');
  if (state.prefs.transfers !== '1') bits.push(state.prefs.transfers === '0' ? 'החלפות לא משנות' : 'כמה שפחות החלפות');
  $('pref-hint').textContent = bits.join(' · ');
}

/* ------------------------------ address bar ------------------------------ */
// the trip lives after "#", which the browser never sends to a server; the user's own location is not written
function writeHash() {
  const enc = p => p && p.kind !== 'me' ? `${p.lat.toFixed(5)},${p.lon.toFixed(5)},${encodeURIComponent(p.name)}` : '';
  const parts = [];
  if (enc(state.from)) parts.push('from=' + enc(state.from));
  if (enc(state.to)) parts.push('to=' + enc(state.to));
  if (state.from || state.to) parts.push(`d=${state.date}`, `t=${clock(state.time)}`, `m=${state.mode}`);
  history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search);
  $('share-btn').hidden = !(enc(state.from) && enc(state.to));
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const dec = v => { if (!v) return null; const [lat, lon, ...name] = v.split(','); const p = { lat: Number(lat), lon: Number(lon), name: decodeURIComponent(name.join(',')) || 'נקודה', kind: 'point' }; return Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : null; };
  state.from = dec(h.get('from')); state.to = dec(h.get('to'));
  if (h.get('d') && manifest.days.some(d => d.date === h.get('d'))) state.date = h.get('d');
  if (/^\d\d:\d\d$/.test(h.get('t') || '')) { const [hh, mm] = h.get('t').split(':').map(Number); state.time = hh * 60 + mm; }
  if (h.get('m') === 'arrive') state.mode = 'arrive';
}

/* ------------------------------ planning ------------------------------ */
let runSeq = 0;
async function run() {
  writeHash();
  if (!state.from || !state.to) { result = null; renderResults(); return; }
  const seq = ++runSeq;
  $('routes').innerHTML = '<p class="loading">מחשב מסלולים…</p>';
  let day;
  try { day = await loadDay(state.date); } catch { if (seq === runSeq) { $('routes').innerHTML = '<div class="notice"><h3>לא הצלחתי לטעון את לוח הזמנים</h3><p>בדוק את החיבור לאינטרנט ונסה שוב.</p></div>'; } return; }
  if (seq !== runSeq) return;
  await new Promise(r => setTimeout(r, 0)); // let the "calculating" text paint
  result = await day.engine.planTrip(query());
  if (seq !== runSeq) return;
  renderResults();
  refreshLive(day, seq);
}
const query = () => ({ from: state.from, to: state.to, date: state.date, time: state.time, mode: state.mode, prefs: state.prefs });

async function refreshLive(day, seq) {
  if (!result || !result.journeys.length || !day.realtime.refresh) return;
  const before = day.realtime.status.text;
  let fetched = false;
  try { fetched = await day.realtime.refresh(day.engine.liveLines(result)); } catch { /* status set by the source */ }
  if (seq !== runSeq) return;
  if (fetched || day.realtime.status.text !== before) {
    const sel = state.selected;
    result = await day.engine.planTrip(query());
    state.selected = sel;
    renderResults();
  }
}
setInterval(() => { const day = days.get(state.date); if (day && result) refreshLive(day, runSeq); }, 60000);

/* ------------------------------ rendering ------------------------------ */
function renderResults() {
  const box = $('routes');
  const r = result;
  $('results-meta').textContent = r && r.journeys.length ? `${dayName(state.date)} · ${state.mode === 'depart' ? 'יציאה' : 'הגעה עד'} ${clock(state.time)}` : '';
  if (!state.from || !state.to) {
    box.innerHTML = `<p class="empty">${!state.from && !state.to ? 'בחר מוצא ויעד: כתובת, מקום, תחנה, המיקום שלך, או לחיצה על המפה.' : !state.from ? 'בחר מוצא.' : 'בחר יעד.'}</p>`;
    renderSheet(null); map.show(null); return;
  }
  if (!r) return;
  const notice = (title, body, btn) => `<div class="notice"><h3>${title}</h3><p>${body}</p>${btn || ''}</div>`;
  const nextBtn = nx => nx ? `<button type="button" class="btn" data-next="${nx.date}|${nx.time}">חפש ליציאה ב־${clock(nx.time)}</button>` : '';
  let html = '';
  if (r.status === 'same') html = notice('המוצא והיעד זהים', 'בחר יעד אחר.');
  else if (r.status === 'outside') html = notice(r.which === 'from' ? 'המוצא מחוץ לאזור הכיסוי' : 'היעד מחוץ לאזור הכיסוי', 'אוטובוסים מכוסים כרגע רק בתוך ערי גוש דן, ורכבת ישראל בכל הארץ. אפשר לבחור תחנת רכבת או נקודה בגוש דן.');
  else if (r.status === 'nocoverage') html = notice('אין לוח זמנים ליום הזה', `יש נתונים ל${manifest.days.map(d => dayName(d.date)).join(' ול')}.`);
  else if (r.status === 'noservice') html = notice('אין שירות בשעה הזו', r.next ? `השירות הבא ב${dayName(state.date)} מתחיל ב־${clock(r.next.time)}.` : 'אין עוד נסיעות ביום הזה לפי לוח הזמנים.', nextBtn(r.next));
  else if (r.status === 'nopath') html = notice('לא נמצא מסלול סביר', 'אין חיבור בתחבורה ציבורית בטווח הזמן וההליכה שנבחרו. אפשר לנסות שעה אחרת, או לבחור "הרבה" תחת כמה ללכת ברגל.', nextBtn(r.next));
  if (html) { box.innerHTML = html; renderSheet(null); map.show(null); return; }
  if (state.selected >= r.journeys.length) state.selected = 0;
  box.innerHTML = r.journeys.map(routeCard).join('');
  renderSheet(r.journeys[state.selected]);
  map.show(r.journeys[state.selected]);
}

const LEVEL = { high: 'ודאות גבוהה', medium: 'ודאות בינונית', low: 'ודאות נמוכה' };
function routeCard(j, i) {
  const total = Math.max(1, j.total);
  const bar = j.legs.map(l => `<i class="${l.type}" style="flex:${((l.t1 - l.t0) / total * 100).toFixed(2)} 1 0${l.type === 'ride' ? `;background:${modeVar(l.line.mode)}` : ''}"></i>`).join('');
  const rides = j.legs.filter(l => l.type === 'ride');
  const lines = rides.length
    ? rides.map(l => `<span class="line-chip" style="background:${modeVar(l.line.mode)}">${ICON[l.line.mode]}${esc(l.line.label)}</span>`).join('<span aria-hidden="true">‹</span>')
    : `<span class="line-chip" style="background:var(--walk)">${ICON.walk}ברגל</span>`;
  const xf = j.rides ? (j.transfers === 0 ? 'ללא החלפות' : j.transfers === 1 ? 'החלפה אחת' : `${j.transfers} החלפות`) : '';
  const first = rides[0];
  const live = !first || !first.live ? '' : first.live.passed
    ? `<span class="live-note warn">זמן אמת: ${esc(lineName(first.line))} כבר עבר את התחנה</span>`
    : `<span class="live-note">זמן אמת: ${esc(lineName(first.line))} צפוי ב־${clock(first.live.expected)}</span>`;
  return `<button type="button" class="route" data-i="${i}" aria-pressed="${state.selected === i}">
    <div class="row1">
      <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
        <div class="tags">${j.tags.map(t => `<span class="tag${t === 'מומלץ' ? ' rec' : ''}">${t}</span>`).join('')}</div>
        <div class="times">יציאה <b class="num">${clock(j.start)}</b> · הגעה <b class="num">${clock(j.end)}</b></div>
      </div>
      <div class="total"><span class="big">${j.total}</span><span class="unit">דק׳</span></div>
    </div>
    <div class="bar" aria-hidden="true">${bar}</div>
    <div class="lines">${lines}${xf ? `<span>· ${xf}</span>` : ''}<span>· הליכה <span class="num">${j.walk}</span> דק׳</span></div>
    ${j.why ? `<div class="why">${esc(j.why)}</div>` : ''}
    <div class="conf"><span class="lvl ${j.confidence.level}">${LEVEL[j.confidence.level]}</span><span>${esc(j.confidence.text)}</span>${live}</div>
  </button>`;
}

function stepRow(clockText, icon, color, stemCls, stemColor, title, sub, dur, srcs, extra = '') {
  return `<li class="step">
    <div class="clock">${clockText}</div>
    <div class="rail"><span class="dot" style="background:${color}">${icon}</span><span class="stem ${stemCls}" style="${stemColor ? 'background:' + stemColor : ''}"></span></div>
    <div class="body"><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}
      <div class="meta"><span class="dur">${dur} דק׳</span>${[].concat(srcs || []).map(x => `<span class="src ${x.kind}">${esc(x.text)}</span>`).join('')}</div>${extra}</div>
  </li>`;
}

function renderSheet(j) {
  const sheet = $('sheet');
  if (!j) { sheet.innerHTML = '<h2>פירוט המסלול</h2><p class="empty">כשיימצא מסלול, יופיע כאן הפירוט שלו: הליכה, המתנה, נסיעה והחלפה, כל אחד עם מקור הזמן שלו.</p>'; return; }
  const meters = d => `<span class="num">${Math.round(d / 10) * 10}</span> מ׳ בערך`;
  const late = d => d > 0 ? `איחור ${d} דק׳` : d < 0 ? `מקדים ב־${-d} דק׳` : 'בזמן';
  const rows = j.legs.map(l => {
    const d = l.t1 - l.t0;
    if (l.type === 'walk') {
      const t = l.role === 'access' ? `הליכה לתחנה ${esc(l.to.name)}` : l.role === 'only' ? `הליכה אל ${esc(state.to.name)}` : `הליכה אל ${esc(state.to.name)}`;
      return stepRow(clock(l.t0), ICON.walk, 'var(--walk)', 'walk', '', t, meters(l.distance), d, l.source);
    }
    if (l.type === 'wait') {
      const t = l.role === 'transfer' ? `החלפה ב${esc(l.from.name)}` : `המתנה בתחנה ${esc(l.from.name)}`;
      return stepRow(clock(l.t0), ICON.wait, 'var(--wait)', 'wait', '', t, l.role === 'transfer' ? 'כולל 2 דק׳ מרווח לירידה ולמעבר' : 'כולל 2 דק׳ מרווח ביטחון', d, l.source);
    }
    if (l.type === 'transfer') return stepRow(clock(l.t0), ICON.walk, 'var(--walk)', 'walk', '', `מעבר ברגל ל${esc(l.to.name)}`, `מ${esc(l.from.name)} · ${meters(l.distance)}`, d, l.source);
    const ln = l.line, n = l.stops.length - 1;
    const live = l.live && (l.live.passed
      ? { kind: 'warn', text: `זמן אמת · כבר עבר את התחנה (${late(l.live.delay)}, נכון ל־${clock(l.live.at)})` }
      : { kind: 'live', text: `זמן אמת · צפוי ${clock(l.live.expected)} (${late(l.live.delay)}, נכון ל־${clock(l.live.at)})` });
    const stopsList = `<details><summary>${n} ${n === 1 ? 'תחנה' : 'תחנות'}</summary><ol>${l.stops.map(s => `<li>${esc(s.name)} · <span class="num">${clock(s.t)}</span></li>`).join('')}</ol></details>`;
    return stepRow(clock(l.t0), ICON[ln.mode], modeVar(ln.mode), '', modeVar(ln.mode), `${lineName(ln)} לכיוון ${esc(ln.headsign)}`,
      `${ln.agency ? esc(ln.agency) + ' · ' : ''}עלייה ב${esc(l.from.name)} · ירידה ב${esc(l.to.name)} ב־<span class="num">${clock(l.t1)}</span>`, d, live ? [l.source, live] : l.source, stopsList);
  }).join('');
  const sum = j.legs.reduce((a, l) => a + (l.t1 - l.t0), 0);
  const rt = days.get(state.date)?.realtime;
  sheet.innerHTML = `<div class="sheet-head"><h2>פירוט המסלול</h2>
      <div class="leave">צא ב־<b>${clock(j.start)}</b> · תגיע ב־<b>${clock(j.end)}</b></div></div>
    <ol class="steps">${rows}
      <li class="step"><div class="clock">${clock(j.end)}</div><div class="rail"><span class="dot" style="background:var(--ink);color:var(--surface)"><b style="font-size:11px">ל</b></span></div>
      <div class="body"><div class="t">הגעה אל ${esc(state.to.name)}</div></div></li>
    </ol>
    <div class="sumcheck">סכום המקטעים <span class="num">${sum}</span> דק׳ = זמן כולל <span class="num">${j.total}</span> דק׳</div>
    <div class="legend"><span class="src plan">לוח זמנים</span>זמן מתוכנן
      <span class="src live">זמן אמת</span>${rt ? esc(rt.status.text.replace(/^זמן אמת:? ?/, '')) : 'לא זמין'}
      <span class="src est">הערכה</span>הליכה בקו ישר, עד שיהיו נתוני רחובות
      <span class="src calc">מחושב</span>נגזר מהשאר</div>`;
}

let toastTimer = null;
function toast(text) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

/* ------------------------------ start ------------------------------ */
async function start() {
  try {
    const r = await fetch('data/manifest.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    manifest = await r.json();
  } catch {
    $('badge').textContent = 'הנתונים לא נטענו'; $('badge').classList.add('warn');
    $('routes').innerHTML = '<div class="notice"><h3>לא הצלחתי לטעון את לוחות הזמנים</h3><p>נסה לרענן את הדף.</p></div>';
    return;
  }
  const today = israelDate(Date.now());
  manifest.days = manifest.days.filter(d => d.date >= today);
  if (!manifest.days.length) { $('badge').textContent = 'הנתונים לא עודכנו'; $('badge').classList.add('warn'); return; }
  const gen = new Date(manifest.generated);
  $('badge').textContent = `לוחות זמנים עודכנו ${israelDate(gen.getTime()) === today ? 'היום' : shortDate(israelDate(gen.getTime()))} ב־${pad(gen.getHours())}:${pad(gen.getMinutes())}`;
  $('data-note').textContent = `אזור: ${manifest.region} (${manifest.cities.join(', ')}). ימים זמינים: ${manifest.days.map(d => shortDate(d.date)).join(', ')}.`;
  setNow(false);
  readHash();
  initControls();
  syncControls();
  syncInputs();
  map.setPoints(state.from, state.to);
  loadDay(state.date).catch(() => {});
  run();
}
start();
