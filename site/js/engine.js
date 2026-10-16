/* Trip planning engine that runs in the browser (and in Node for tests).

   The site talks to it only through planTrip(query) -> result, described below. The result is shaped like a
   trip planner's API answer (legs with times, places, line and source), so that this file can later be swapped
   for a client of a server-side engine such as OpenTripPlanner or MOTIS without touching the interface.
   See docs/SITE.md.

   query  = { from: Place, to: Place, date: 'YYYY-MM-DD', time: minutes after midnight, mode: 'depart' | 'arrive',
              prefs: { walk: 'less' | 'normal' | 'more', transfers: '0' | '1' | '2', preferredStop: stop name or '' } }
   Place  = { lat, lon, name }
   result = { status: 'ok' | 'same' | 'outside' | 'nocoverage' | 'noservice' | 'nopath', journeys: [Journey], ... }
   Journey = { start, end, total, walk, wait, inVehicle, transfers, rides, tags, why, confidence, live, missed, legs }
   Leg    = { type: 'walk' | 'wait' | 'ride' | 'transfer', role, t0, t1, from: Stop|Place, to: Stop|Place,
              distance (metres, walking legs), line (rides), stops (rides: [{ name, lat, lon, t }]),
              source: { kind, text }, live }
   Times are minutes after midnight of the service date (they can pass 1440 after midnight). */

const B36 = x => parseInt(x, 36);
const DETOUR = 1.3; // walking distance vs. straight line, until there is real street routing
const MODES = { '0': 'lrt', '2': 'rail', '3': 'bus', '8': 'taxi' };

/* ------------------------------ timetable ------------------------------ */
/* One day of the Ministry of Transport GTFS, in the compact format of scripts/build_gtfs_data.py (docs/DATA_FORMAT.md). */
export class Timetable {
  constructor(data) {
    this.data = data;
    this.date = data.date;
    this.region = data.city;
    const [a, b] = data.window.split('-').map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; });
    this.coverage = { date: data.date, from: a, to: b, last: b >= 1440 ? 1439 : b - 30 };
    const lat0 = data.stops.reduce((s, x) => s + x[2], 0) / data.stops.length;
    const lon0 = data.stops.reduce((s, x) => s + x[3], 0) / data.stops.length;
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    this.project = (lat, lon) => ({ x: (lon - lon0) * kx, y: (lat - lat0) * ky });
    this.stops = data.stops.map(s => ({ code: s[0], name: s[1].replace(/''/g, '״'), lat: s[2], lon: s[3], x: (s[3] - lon0) * kx, y: (s[2] - lat0) * ky }));
    const lines = data.routes.map((r, i) => ({ id: 'r' + i, label: r[0], mode: MODES[r[1]] || 'bus', agency: r[2], headsign: r[3].replace(/''/g, '״'), routeId: r[4] || null }));
    this.patterns = data.patterns.map((p, pi) => {
      const stops = p.s.split('.').map(B36);
      // one base-36 digit per hop, or dot-separated numbers after a leading dot when a hop is 36 minutes or more
      const deltas = p.d[0] === '.' ? p.d.slice(1).split('.').map(B36) : [...p.d].map(B36);
      const trips = p.t.split(' ').map((tok, ti) => {
        const m = tok.match(/^(\d+)(?:@(\d+)-(\d+))?$/);
        const t0 = Number(m[1]), i0 = m[2] ? Number(m[2]) : 0, i1 = m[3] ? Number(m[3]) : stops.length - 1;
        const times = new Array(stops.length).fill(Infinity);
        let t = t0;
        for (let i = i0; i <= i1; i++) { times[i] = t; if (i < i1) t += deltas[i]; }
        return { id: `p${pi}-${ti}`, times };
      });
      // full trips with the same running times never overtake, so sorted by start they are sorted at every stop
      const sorted = !p.t.includes('@');
      if (sorted) trips.sort((x, y) => x.times[0] - y.times[0]);
      const dists = p.m ? p.m.split('.').map(x => B36(x) * 10) : null;
      return { line: lines[p.r], stops, trips, sorted, originOffset: p.o || 0, dists };
    });
    this.grid = new Grid(this.stops, 400);
  }
  stopsNear(p, radius) { return this.grid.near(p, radius); }
  /* stops grouped by name, for searching stops by name */
  stopGroups() {
    if (this._groups) return this._groups;
    const by = new Map();
    this.stops.forEach(s => { const g = by.get(s.name) || []; g.push(s); by.set(s.name, g); });
    this._groups = [...by.entries()].map(([name, g]) => ({ name, lat: g.reduce((a, s) => a + s.lat, 0) / g.length, lon: g.reduce((a, s) => a + s.lon, 0) / g.length, count: g.length }));
    return this._groups;
  }
}

/* Square cells over the projected plane: finds nearby stops without comparing every pair. */
class Grid {
  constructor(points, cell) {
    this.points = points; this.cell = cell; this.cells = new Map();
    points.forEach((p, i) => { const k = this.key(Math.floor(p.x / cell), Math.floor(p.y / cell)); const c = this.cells.get(k); c ? c.push(i) : this.cells.set(k, [i]); });
  }
  key(cx, cy) { return cx * 100003 + cy; }
  near(p, radius) {
    const out = [], c = this.cell, r = Math.ceil(radius / c), cx = Math.floor(p.x / c), cy = Math.floor(p.y / c);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const list = this.cells.get(this.key(cx + dx, cy + dy)); if (!list) continue;
      for (const i of list) { const q = this.points[i], d = Math.hypot(q.x - p.x, q.y - p.y); if (d <= radius) out.push({ i, d }); }
    }
    return out;
  }
}

/* ------------------------------ network ------------------------------ */
const FOOTPATH_MAX = 400;
function buildNetwork(tt) {
  if (tt._net) return tt._net;
  const n = tt.stops.length;
  const stopPats = Array.from({ length: n }, () => []);
  tt.patterns.forEach((p, pi) => p.stops.forEach((s, pos) => stopPats[s].push([pi, pos])));
  const foot = tt.stops.map((s, i) => tt.stopsNear(s, FOOTPATH_MAX).filter(x => x.i !== i).map(x => ({ to: x.i, dist: x.d })));
  tt._net = { stops: tt.stops, patterns: tt.patterns, stopPats, foot };
  return tt._net;
}

const walkMin = (d, speed) => Math.max(1, Math.ceil(d * DETOUR / speed));
const firstTime = t => { for (const v of t.times) if (v < Infinity) return v; return Infinity; };

function earliestTrip(trips, pos, need, sorted) {
  if (sorted) {
    let lo = 0, hi = trips.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (trips[mid].times[pos] < need) lo = mid + 1; else hi = mid; }
    return lo < trips.length ? trips[lo] : null;
  }
  let best = null;
  for (const t of trips) { const v = t.times[pos]; if (v >= need && v < Infinity && (!best || v < best.times[pos])) best = t; }
  return best;
}

/* RAPTOR: round k finds the earliest arrival at every stop using at most k rides.
   Returns one leg list per number of rides that improves the arrival at the destination. */
function raptor(net, cfg, dep) {
  const n = net.stops.length, INF = 1e9, K = cfg.maxRides;
  const arr = [new Float64Array(n).fill(INF)], lab = [new Array(n).fill(null)];
  const best = new Float64Array(n).fill(INF);
  let marked = new Set();
  for (const a of cfg.access) {
    if (a.d > cfg.maxWalk) continue;
    const w = walkMin(a.d, cfg.speed);
    arr[0][a.i] = best[a.i] = dep + w;
    lab[0][a.i] = { kind: 'access', to: a.i, walk: w, dist: a.d };
    marked.add(a.i);
  }
  for (let k = 1; k <= K; k++) {
    arr[k] = arr[k - 1].slice();
    lab[k] = lab[k - 1].slice();
    const queue = new Map();
    for (const s of marked) for (const [pi, pos] of net.stopPats[s]) if (!queue.has(pi) || pos < queue.get(pi)) queue.set(pi, pos);
    const improved = new Set();
    for (const [pi, pos0] of queue) {
      const p = net.patterns[pi];
      if (cfg.banned && cfg.banned.has(p.line.id)) continue;
      let trip = null, bStop = -1, bIdx = -1;
      for (let i = pos0; i < p.stops.length; i++) {
        const s = p.stops[i];
        if (trip) {
          const a = trip.times[i];
          if (a < arr[k][s] && a < best[s]) {
            arr[k][s] = best[s] = a;
            lab[k][s] = { kind: 'ride', pat: pi, trip, from: bStop, bi: bIdx, ai: i, prevK: k - 1 };
            improved.add(s);
          }
        }
        const pa = arr[k - 1][s];
        if (pa < INF) {
          const pl = lab[k - 1][s];
          const need = pa + (pl && pl.kind !== 'access' ? cfg.buffer : 0);
          if (!trip || need <= trip.times[i]) {
            const t = earliestTrip(p.trips, i, need, p.sorted);
            if (t && (!trip || t.times[i] < trip.times[i])) { trip = t; bStop = s; bIdx = i; }
          }
        }
      }
    }
    const walked = new Set();
    for (const s of improved) {
      const L = lab[k][s];
      for (const f of net.foot[s]) {
        const a = arr[k][s] + walkMin(f.dist, cfg.speed);
        if (a < arr[k][f.to] && a < best[f.to]) {
          arr[k][f.to] = best[f.to] = a;
          lab[k][f.to] = { kind: 'walk', from: s, to: f.to, walk: walkMin(f.dist, cfg.speed), dist: f.dist, prev: L };
          walked.add(f.to);
        }
      }
    }
    marked = new Set([...improved, ...walked]);
    if (!marked.size) break;
  }
  const rec = L => {
    if (L.kind === 'access') return [{ type: 'access', stop: L.to, walk: L.walk, dist: L.dist }];
    if (L.kind === 'ride') return [...rec(lab[L.prevK][L.from]), { type: 'ride', pat: net.patterns[L.pat], trip: L.trip, bi: L.bi, ai: L.ai }];
    return [...rec(L.prev), { type: 'xfer', from: L.from, to: L.to, walk: L.walk, dist: L.dist }];
  };
  const out = [];
  let prevBest = INF;
  for (let k = 1; k < arr.length; k++) {
    let bestA = INF, bestLegs = null;
    for (const e of cfg.egress) {
      if (e.d > cfg.maxWalk) continue;
      const i = e.i;
      if (arr[k][i] >= INF || !lab[k][i] || lab[k][i].kind === 'access') continue;
      const w = walkMin(e.d, cfg.speed);
      if (arr[k][i] + w < bestA) { bestA = arr[k][i] + w; bestLegs = [...rec(lab[k][i]), { type: 'egress', stop: i, walk: w, dist: e.d }]; }
    }
    if (bestLegs && bestA < prevBest) { out.push(bestLegs); prevBest = bestA; }
  }
  return out;
}

/* ------------------------------ journeys ------------------------------ */
const SRC = {
  walk: { kind: 'est', text: 'הערכה · 4.8 קמ״ש בקו ישר' },
  calc: { kind: 'calc', text: 'מחושב' },
  plan: { kind: 'plan', text: 'לוח זמנים · משרד התחבורה' }
};

function buildJourney(legs, floor, cfg) {
  const S = cfg.stops;
  // a transfer walk straight into the final walk becomes one walk to the destination
  const xi = legs.length - 2;
  if (legs[xi] && legs[xi].type === 'xfer' && legs[xi + 1].type === 'egress') {
    const d = Math.hypot(S[legs[xi].from].x - cfg.to.x, S[legs[xi].from].y - cfg.to.y);
    legs = [...legs.slice(0, xi), { type: 'egress', stop: legs[xi].from, walk: walkMin(d, cfg.speed), dist: d }];
  }
  const firstRide = legs.find(l => l.type === 'ride');
  const access = legs[0];
  const margin = 2;
  const start = Math.max(floor, firstRide.trip.times[firstRide.bi] - access.walk - margin);
  const out = [];
  let t = start, rides = 0;
  out.push({ type: 'walk', role: 'access', t0: t, t1: t + access.walk, from: cfg.from, to: S[access.stop], distance: access.dist * DETOUR, source: SRC.walk });
  t += access.walk;
  for (const l of legs.slice(1)) {
    if (l.type === 'ride') {
      const s = S[l.pat.stops[l.bi]];
      const board = l.trip.times[l.bi], alight = l.trip.times[l.ai];
      if (board > t) out.push({ type: 'wait', role: rides ? 'transfer' : 'first', t0: t, t1: board, from: s, to: s, source: SRC.calc });
      const leg = {
        type: 'ride', t0: board, t1: alight, from: s, to: S[l.pat.stops[l.ai]], line: l.pat.line,
        stops: l.pat.stops.slice(l.bi, l.ai + 1).map((si, k) => ({ name: S[si].name, lat: S[si].lat, lon: S[si].lon, t: l.trip.times[l.bi + k] })),
        source: SRC.plan, _pat: l.pat, _trip: l.trip, _bi: l.bi
      };
      if (cfg.realtime && l.pat.line.routeId) {
        const v = cfg.realtime.vehicle({ routeId: l.pat.line.routeId, originDeparture: firstTime(l.trip) - l.pat.originOffset });
        const e = v && estimateLive(l.pat, l.trip, l.bi, v, cfg);
        if (e) leg.live = e;
      }
      out.push(leg);
      t = alight; rides++;
    } else if (l.type === 'xfer') {
      out.push({ type: 'transfer', t0: t, t1: t + l.walk, from: S[l.from], to: S[l.to], distance: l.dist * DETOUR, source: SRC.walk });
      t += l.walk;
    } else if (l.type === 'egress') {
      out.push({ type: 'walk', role: 'egress', t0: t, t1: t + l.walk, from: S[l.stop], to: cfg.toPlace, distance: l.dist * DETOUR, source: SRC.walk });
      t += l.walk;
    }
  }
  return finish(out, start, t);
}

function walkOnly(cfg, dep) {
  const d = Math.hypot(cfg.from.x - cfg.to.x, cfg.from.y - cfg.to.y), w = walkMin(d, cfg.speed);
  return finish([{ type: 'walk', role: 'only', t0: dep, t1: dep + w, from: cfg.from, to: cfg.toPlace, distance: d * DETOUR, source: SRC.walk }], dep, dep + w);
}

function finish(legs, start, end) {
  const rides = legs.filter(l => l.type === 'ride');
  const sum = types => legs.filter(l => types.includes(l.type)).reduce((a, l) => a + (l.t1 - l.t0), 0);
  const transfers = Math.max(0, rides.length - 1);
  const live = rides.some(l => l.live);
  const j = {
    legs, start, end, total: end - start, rides: rides.length, transfers,
    walk: sum(['walk', 'transfer']), wait: sum(['wait']), inVehicle: sum(['ride']),
    live, missed: rides.length > 0 && !!(rides[0].live && rides[0].live.passed),
    sig: rides.map(l => l.line.id + ':' + l.from.name + '>' + l.to.name).join('|') || 'walk',
    xferNames: legs.filter(l => l.type === 'wait' && l.role === 'transfer').map(l => l.from.name)
      .concat(legs.filter(l => l.type === 'transfer').flatMap(l => [l.from.name, l.to.name]))
  };
  // decision 16: a label with a reason, not a percentage, until there is a calibrated model
  j.confidence = !rides.length ? { level: 'medium', text: 'הליכה בלבד, לפי הערכה' }
    : transfers === 0 ? { level: 'high', text: live ? 'נסיעה אחת, עם זמן אמת' : 'נסיעה אחת, לפי לוח הזמנים' }
    : transfers === 1 ? { level: 'medium', text: 'החלפה אחת: עיכוב בנסיעה הראשונה יכול להשפיע' }
    : { level: 'low', text: `${transfers} החלפות: כל עיכוב מצטבר` };
  return j;
}

/* Where the vehicle is on its trip, against where the schedule says it should be when it was seen.
   Distance along the route when the data has it (buses), else the position projected onto the line
   between stops (rail). { expected, delay, at } at the boarding stop, { passed, delay, at } when it is
   already past it, or null when the position cannot be placed on the trip. */
export function estimateLive(pat, trip, bi, v, cfg) {
  const T = trip.times, n = pat.stops.length;
  const origin = firstTime(trip) - pat.originOffset;
  let prog = null, schedAt = null;
  if (v.dist === 0 && pat.dists) {
    const late = Math.max(0, Math.round(v.at - origin));
    return { expected: T[bi] + late, delay: late, at: v.at };
  }
  if (pat.dists && Number.isFinite(v.dist)) {
    const D = pat.dists;
    if (v.dist <= D[0]) {
      const f = D[0] > 0 ? v.dist / D[0] : 1;
      schedAt = origin + f * (T[0] - origin); prog = f - 1;
    } else {
      let i = 0;
      while (i < n - 2 && v.dist > D[i + 1]) i++;
      const f = Math.min(1, (v.dist - D[i]) / Math.max(1, D[i + 1] - D[i]));
      schedAt = T[i] + f * (T[i + 1] - T[i]); prog = i + f;
    }
  } else if (Number.isFinite(v.lat) && cfg.project) {
    const P = cfg.project(v.lat, v.lon), S = cfg.stops;
    let best = null;
    for (let i = 0; i < n - 1; i++) {
      const a = S[pat.stops[i]], b = S[pat.stops[i + 1]];
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const f = L2 ? Math.max(0, Math.min(1, ((P.x - a.x) * dx + (P.y - a.y) * dy) / L2)) : 0;
      const d = Math.hypot(a.x + f * dx - P.x, a.y + f * dy - P.y);
      if (d > 600) continue;
      const sAt = T[i] + f * (T[i + 1] - T[i]);
      const score = Math.abs(sAt - v.at) + d / 100; // a route can pass the same place twice: prefer the plausible time
      if (!best || score < best.score) best = { score, prog: i + f, schedAt: sAt };
    }
    if (!best) return null;
    prog = best.prog; schedAt = best.schedAt;
  } else return null;
  const delay = Math.round(v.at - schedAt);
  if (Math.abs(delay) > 90) return null; // not this trip, or bad data
  if (prog > bi + 0.05) return { passed: true, delay, at: v.at };
  return { expected: T[bi] + delay, delay, at: v.at };
}

/* ------------------------------ planTrip ------------------------------ */
const WALK_PREFS = { less: { weight: 1.0, maxWalk: 500 }, normal: { weight: 0.3, maxWalk: 800 }, more: { weight: 0, maxWalk: 1200 } };
const XFER_PENALTY = { 0: 0, 1: 5, 2: 12 };
const MAX_SHIFT = 180; // minutes between the requested time and the journey
const MAX_TOTAL = 300, MAX_WAIT = 90;
const range = (a, b, step) => { const r = []; for (let x = a; x <= b; x += step) r.push(x); return r; };

export function createEngine(tt, { realtime = null } = {}) {
  return {
    timetable: tt,
    planTrip: async query => planTrip(tt, query, realtime),
    planTripSync: query => planTrip(tt, query, realtime),
    /* GTFS route_ids of the rides in a result, for fetching live positions */
    liveLines: result => [...new Set(result.journeys.flatMap(j => j.legs.filter(l => l.type === 'ride' && l.line.routeId).map(l => l.line.routeId)))]
  };
}

function planTrip(tt, q, realtime) {
  const prefs = { walk: 'normal', transfers: '1', preferredStop: '', ...(q.prefs || {}) };
  const W = WALK_PREFS[prefs.walk] || WALK_PREFS.normal;
  const from = { ...q.from, ...tt.project(q.from.lat, q.from.lon) }, to = { ...q.to, ...tt.project(q.to.lat, q.to.lon) };
  if (Math.hypot(from.x - to.x, from.y - to.y) < 30) return { status: 'same', journeys: [] };
  const cov = tt.coverage;
  if (q.date !== cov.date || q.time < cov.from || q.time > cov.last) return { status: 'nocoverage', journeys: [], coverage: cov };
  const net = buildNetwork(tt);
  const access = tt.stopsNear(from, WALK_PREFS.more.maxWalk), egress = tt.stopsNear(to, WALK_PREFS.more.maxWalk);
  const speed = 80; // metres per minute, 4.8 km/h
  const dWalk = Math.hypot(from.x - to.x, from.y - to.y);
  const walkable = walkMin(dWalk, speed) <= 35;
  if ((!access.length || !egress.length) && !walkable) return { status: 'outside', journeys: [], which: !access.length ? 'from' : 'to' };
  const cfg = {
    stops: tt.stops, project: tt.project, speed, buffer: 2, maxRides: 4, maxWalk: W.maxWalk,
    from: { name: q.from.name, lat: q.from.lat, lon: q.from.lon, x: from.x, y: from.y }, to, toPlace: { name: q.to.name, lat: q.to.lat, lon: q.to.lon },
    access, egress, realtime
  };
  const target = q.time, depart = q.mode !== 'arrive';
  const lo = depart ? target : target - 150, hi = depart ? target + 120 : target;
  const hasService = net.patterns.some(p => p.trips.some(t => { const f = firstTime(t); return f >= lo - 30 && f <= hi; }));
  if (!hasService && !walkable) return { status: 'noservice', journeys: [], next: nextService(tt, target) };
  const deps = depart ? [target, target + 8, target + 16] : range(Math.max(target - 150, cov.from), target, 10);
  const found = new Map();
  const better = (a, b) => depart ? (a.end < b.end || (a.end === b.end && a.start > b.start)) : (a.start > b.start || (a.start === b.start && a.end < b.end));
  const add = j => {
    if (!depart && j.end > target) return;
    const prev = found.get(j.sig);
    if (!prev || better(j, prev)) found.set(j.sig, j);
  };
  if (hasService) for (const dep of deps) {
    for (const maxWalk of [cfg.maxWalk, Math.min(cfg.maxWalk, 400)]) {
      const c = { ...cfg, maxWalk };
      const floor = depart ? target : -Infinity;
      const legsList = raptor(net, c, dep);
      legsList.forEach(legs => add(buildJourney(legs, floor, c)));
      if (depart || dep === deps[deps.length - 1]) {
        const top = legsList[legsList.length - 1];
        if (top) for (const l of top.filter(x => x.type === 'ride')) {
          const cb = { ...c, banned: new Set([l.pat.line.id]) };
          raptor(net, cb, dep).forEach(legs => add(buildJourney(legs, floor, cb)));
        }
      }
    }
  }
  if (walkable) {
    const j = walkOnly(cfg, depart ? target : target - walkMin(dWalk, speed));
    found.set(j.sig, j);
  }
  // a trip that leaves hours after the requested time is not an answer to the question
  // nor one that waits hours somewhere on the way
  let list = [...found.values()].filter(j => (depart ? j.start - target <= MAX_SHIFT : target - j.end <= MAX_SHIFT)
    && j.total <= MAX_TOTAL && j.legs.every(l => l.type !== 'wait' || l.t1 - l.t0 <= MAX_WAIT));
  list = list.filter(a => !list.some(b => b !== a &&
    b.end <= a.end && b.transfers <= a.transfers && b.walk <= a.walk && b.start >= a.start &&
    (b.end < a.end || b.transfers < a.transfers || b.walk < a.walk || b.start > a.start)));
  if (!list.length) return hasService ? { status: 'nopath', journeys: [], next: depart ? nextService(tt, target + MAX_SHIFT) : null } : { status: 'noservice', journeys: [], next: nextService(tt, target) };
  list.forEach(j => {
    const base = depart ? j.end - target : target - j.start;
    j.prefHit = prefs.preferredStop !== '' && j.xferNames.includes(prefs.preferredStop);
    j.score = base + W.weight * j.walk + (XFER_PENALTY[prefs.transfers] ?? 5) * j.transfers + 0.3 * j.wait - (j.prefHit ? 6 : 0);
  });
  list.sort((a, b) => a.score - b.score);
  list = list.slice(0, 5);
  tag(list, depart);
  return { status: 'ok', journeys: list };
}

function tag(list, depart) {
  const by = f => list.reduce((m, j) => (f(j) < f(m) ? j : m), list[0]);
  const fastest = depart ? by(j => j.end * 100 + j.transfers) : by(j => -j.start * 100 + j.transfers);
  const fewest = by(j => j.transfers * 10000 + j.end);
  const leastWalk = by(j => j.walk * 10000 + j.end);
  list.forEach(j => j.tags = []);
  list[0].tags.push('מומלץ');
  fastest.tags.push(depart ? 'הכי מהיר' : 'יציאה הכי מאוחרת');
  if (fewest.transfers < fastest.transfers) fewest.tags.push('פחות החלפות');
  if (leastWalk.walk < fastest.walk) leastWalk.tags.push('פחות הליכה');
  list[0].why = explain(list[0], fastest, depart);
}

function explain(rec, fastest, depart) {
  const parts = [];
  if (rec === fastest) {
    parts.push(depart ? 'זה גם המסלול המהיר ביותר' : 'זו גם היציאה המאוחרת ביותר');
    if (rec.transfers === 0 && rec.rides) parts.push('בלי החלפות');
  } else {
    const late = depart ? rec.end - fastest.end : fastest.start - rec.start;
    parts.push(depart ? `מגיע ${late} דק׳ אחרי המהיר ביותר` : `יוצא ${late} דק׳ מוקדם יותר`);
    if (rec.transfers < fastest.transfers) parts.push(rec.transfers === 0 ? 'אבל בלי החלפות' : fastest.transfers - rec.transfers === 1 ? 'אבל עם החלפה אחת פחות' : `אבל עם ${fastest.transfers - rec.transfers} החלפות פחות`);
    if (rec.walk < fastest.walk) parts.push(`ועם ${fastest.walk - rec.walk} דק׳ הליכה פחות`);
  }
  if (rec.prefHit) parts.push('ומחליף בתחנה המועדפת עליך');
  return parts.join(', ') + '.';
}

function nextService(tt, minute) {
  let best = Infinity;
  for (const p of tt.patterns) for (const t of p.trips) { const f = firstTime(t); if (f > minute && f < best) best = f; }
  return best <= tt.coverage.last ? { date: tt.date, time: best } : null;
}

/* ------------------------------ helpers for the page ------------------------------ */
export const pad = n => String(n).padStart(2, '0');
export const clock = m => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; };
