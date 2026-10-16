// Tests for the site's engine (site/js/engine.js) on the Gush Dan data in public/data.
// Build the data first: python3 scripts/build_gtfs_data.py --region gushdan --days 2 --out-dir public/data
// Usage: node tests/engine_test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Timetable, createEngine, clock } from '../site/js/engine.js';
import { StrideRealtime, israelMidnight } from '../site/js/realtime.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public', 'data');
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.log('  FAIL', msg); } };

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
check(manifest.days.length >= 1, 'manifest lists days');
// the day with the most service, so the tests do not depend on the weekday they run on
const days = manifest.days.map(d => JSON.parse(fs.readFileSync(path.join(dir, d.file), 'utf8')));
const data = days.reduce((a, b) => (b.patterns.reduce((s, p) => s + p.t.split(' ').length, 0) > a.patterns.reduce((s, p) => s + p.t.split(' ').length, 0) ? b : a));
const tt = new Timetable(data);
const engine = createEngine(tt);
console.log(`== ${data.date} · ${tt.stops.length} stops · ${tt.patterns.length} patterns`);

const stopPlace = name => { const g = tt.stopGroups().find(s => s.name === name); return g && { name: g.name, lat: g.lat, lon: g.lon }; };
const P = {
  tau: { name: 'אוניברסיטת תל אביב', lat: 32.1133, lon: 34.8044 },
  carmel: { name: 'שוק הכרמל', lat: 32.0688, lon: 34.7690 },
  rishon: { name: 'מרכז ראשון לציון', lat: 31.9642, lon: 34.8044 },
  petah: { name: 'מרכז פתח תקווה', lat: 32.0889, lon: 34.8864 },
  bnei: { name: 'בני ברק', lat: 32.0840, lon: 34.8338 },
  bayam: { name: 'בת ים', lat: 32.0167, lon: 34.7500 },
  savidor: stopPlace('רכבת תל אביב מרכז'),
  haifa: stopPlace('רכבת חיפה מרכז'),
  eilat: { name: 'אילת', lat: 29.5577, lon: 34.9519 }
};
check(P.savidor && P.haifa, 'rail stations are in the data');

const times = [];
async function show(q, label) {
  const t0 = performance.now();
  const r = await engine.planTrip(q);
  const ms = performance.now() - t0; times.push(ms);
  console.log(`${label} [${r.status}] ${ms.toFixed(0)}ms`);
  for (const j of r.journeys) {
    const sum = j.legs.reduce((a, l) => a + (l.t1 - l.t0), 0);
    check(sum === j.total, 'legs sum to total');
    check(j.legs.every(l => l.t1 >= l.t0 && Number.isFinite(l.t1)), 'leg times finite and ordered');
    for (let i = 1; i < j.legs.length; i++) check(j.legs[i].t0 >= j.legs[i - 1].t1 - 0.001, 'legs contiguous');
    check(j.legs.every(l => l.from && l.to && Number.isFinite(l.from.lat) && Number.isFinite(l.to.lat)), 'every leg has places with coordinates');
    check(j.legs.filter(l => l.type === 'ride').every(l => l.line && l.stops.length >= 2 && l.source), 'rides carry line, stops and source');
    check(['high', 'medium', 'low'].includes(j.confidence.level), 'confidence is a label');
    if (q.mode === 'arrive') check(j.end <= q.time, 'arrive-by respected');
    else check(j.start >= q.time, 'depart-after respected');
    console.log('  ', clock(j.start), clock(j.end), j.total + "'", 'tr', j.transfers, 'walk', j.walk, j.confidence.level, j.tags.join('/'),
      j.legs.map(l => l.type === 'ride' ? `${l.line.mode}:${l.line.label}` : l.type).join(' > '));
  }
  return r;
}
const base = { date: data.date, time: 8 * 60, mode: 'depart', prefs: {} };
const ok = (r, msg) => check(r.status === 'ok' && r.journeys.length > 0, msg);
const uses = (r, mode) => r.journeys.some(j => j.legs.some(l => l.type === 'ride' && l.line.mode === mode));

ok(await show({ ...base, from: P.tau, to: P.carmel }, 'TAU -> Carmel market 08:00'), 'in Tel Aviv');
ok(await show({ ...base, from: P.rishon, to: P.petah }, 'Rishon LeZion -> Petah Tikva 08:00'), 'across Gush Dan');
ok(await show({ ...base, from: P.bayam, to: P.bnei, time: 12 * 60 }, 'Bat Yam -> Bnei Brak 12:00'), 'midday across cities');
ok(await show({ ...base, from: P.petah, to: P.tau, mode: 'arrive', time: 9 * 60 }, 'Petah Tikva -> TAU arrive by 09:00'), 'arrive-by');
// rail: some days have almost no trains to Haifa (works, Fridays), so test it only when the data has them
const railTo = name => tt.patterns.filter(p => p.line.mode === 'rail' && p.stops.some(x => tt.stops[x].name === 'רכבת תל אביב מרכז') && p.stops.some(x => tt.stops[x].name === name))
  .flatMap(p => p.trips.map(t => t.times[p.stops.findIndex(x => tt.stops[x].name === 'רכבת תל אביב מרכז')])).filter(t => t >= 8 * 60 && t <= 11 * 60);
const haifa = await show({ ...base, from: P.savidor, to: P.haifa, time: 9 * 60 }, 'Savidor -> Haifa center 09:00');
if (railTo('רכבת חיפה מרכז').length) { ok(haifa, 'intercity rail'); check(uses(haifa, 'rail'), 'Haifa by rail'); }
else check(['nopath', 'noservice'].includes(haifa.status) || haifa.journeys.every(j => j.start - 540 <= 180 && j.total <= 300), 'no trains that morning: no absurd journey');
const out = await show({ ...base, from: P.tau, to: P.eilat }, 'TAU -> Eilat');
check(out.status === 'outside' && out.which === 'to', 'outside the region reported');
const walk = await show({ ...base, from: P.carmel, to: { name: 'קרוב', lat: 32.0700, lon: 34.7700 } }, 'Short walk');
check(walk.journeys.some(j => !j.rides), 'walking option for short distances');
const other = await show({ ...base, date: '2030-01-01', from: P.tau, to: P.carmel }, 'Other date');
check(other.status === 'nocoverage', 'other date reported');
const same = await show({ ...base, from: P.tau, to: P.tau }, 'Same place');
check(same.status === 'same', 'same place reported');

// real time through the engine: a vehicle 3 minutes late at its first stop
{
  const fake = { status: { kind: 'test' }, vehicle: q => ({ dist: 0, at: q.originDeparture + 3 }) };
  const live = await createEngine(tt, { realtime: fake }).planTrip({ ...base, from: P.tau, to: P.carmel });
  const firsts = live.journeys.map(j => j.legs.find(l => l.type === 'ride')).filter(Boolean);
  check(firsts.length && firsts.every(l => !l._pat.dists || (l.live && l.live.delay === 3 && l.live.expected === l.t0 + 3)), 'live delay reaches the boarding stop');
  check(engine.liveLines(live).length > 0, 'liveLines lists route ids');
}

// StrideRealtime parsing with a fake fetch
{
  const mid = israelMidnight(data.date), nowMs = mid + 600 * 60000;
  const pat = tt.patterns.find(p => p.line.mode === 'bus' && p.dists);
  const origin = pat.trips[0].times[0] - pat.originOffset;
  const iso = m => new Date(mid + m * 60000).toISOString();
  const rows = [
    { siri_ride__scheduled_start_time: iso(origin), recorded_at_time: iso(598), lat: 32.08, lon: 34.78, distance_from_journey_start: 1200 },
    { siri_ride__scheduled_start_time: iso(origin), recorded_at_time: iso(599), lat: 32.08, lon: 34.78, distance_from_journey_start: 1500 },
    { siri_ride__scheduled_start_time: iso(origin + 10), recorded_at_time: '2038-01-14T17:22:21+00:00', lat: 32, lon: 34, distance_from_journey_start: 0 }
  ];
  const urls = [];
  const st = new StrideRealtime(data.date, { now: () => nowMs, fetchFn: async url => { urls.push(url); return { ok: true, json: async () => rows }; } });
  check(await st.refresh([pat.line.routeId, pat.line.routeId]) && urls.length === 1, 'one request per line');
  check(/recorded_at_time_from=.*&recorded_at_time_to=/.test(urls[0]), 'request has both time bounds');
  const v = st.vehicle({ routeId: pat.line.routeId, originDeparture: origin });
  check(v && v.dist === 1500, 'latest position kept');
  check(!st.vehicle({ routeId: pat.line.routeId, originDeparture: origin + 10 }), 'future-dated rows ignored');
  const later = new StrideRealtime(data.date, { now: () => nowMs + 3 * 86400000, fetchFn: async () => { throw new Error('no'); } });
  check(!(await later.refresh(['1'])) && later.status.kind === 'off', 'no live data when not today');
}

const slow = Math.max(...times);
console.log(`slowest search ${slow.toFixed(0)}ms`);
check(slow < 1500, 'searches finish in reasonable time');
console.log(failures ? `${failures} failures` : 'all checks passed');
process.exit(failures ? 1 : 0);
