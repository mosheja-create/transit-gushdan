// Runs the routing core from the prototype source against real and sample data.
// Usage: node tests/routing_test.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'prototype-web', 'index.html'), 'utf8');
const js = html.slice(html.indexOf('<script>') + 8, html.indexOf('/* -------------------------------- UI'));
const api = new Function(js + '; return { SampleProvider, GtfsSliceProvider, NoRealtime, StrideRealtime, estimateLive, israelMidnight, SAMPLE_DATA, search, clock, allPlaces, netCache, placeCache };')();
const { search, clock } = api;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.log('  FAIL', msg); } };
function show(pv, st, label) {
  const t0 = Date.now();
  const r = search(pv, st);
  console.log(`${label} [${r.status}] ${Date.now() - t0}ms`);
  for (const j of r.journeys) {
    const sum = j.segs.reduce((a, s) => a + (s.t1 - s.t0), 0);
    check(sum === j.total, 'segments sum to total');
    check(j.segs.every(s => s.t1 >= s.t0 && Number.isFinite(s.t1)), 'segment times finite and ordered');
    for (let i = 1; i < j.segs.length; i++) check(j.segs[i].t0 >= j.segs[i - 1].t1 - 0.001, 'segments contiguous');
    if (st.mode === 'arrive') check(j.end <= st.time, 'arrive-by respected');
    if (st.mode === 'depart') check(j.start >= st.time, 'depart-after respected');
    console.log('  ', clock(j.start), clock(j.end), j.total + "'", 'tr', j.transfers, 'walk', j.walk, j.tags.join('/'),
      j.segs.map(s => s.type === 'ride' ? `${s.pat.line.mode}:${s.pat.line.label}${s.live ? `(live ${s.live.delay > 0 ? '+' : ''}${s.live.delay})` : ''}` : s.type).join(' > '));
  }
  return r;
}
const load = f => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
const fresh = () => { api.netCache.clear(); api.placeCache.clear(); };
const usesMode = (r, mode) => r.journeys.some(j => j.segs.some(s => s.type === 'ride' && s.pat.line.mode === mode));

// --- full-day file from scripts/build_gtfs_data.py (newest one) ---
const fullFile = fs.readdirSync(path.join(root, 'data')).filter(f => /^tlv_.*_full\.json$/.test(f)).sort().pop();
if (fullFile) {
  const data = load(fullFile);
  const tlv = new api.GtfsSliceProvider(data);
  const base = { mode: 'depart', date: data.date, time: 480, walkPref: 'normal', xferPref: '1', prefStop: '', personal: false };
  console.log(`== ${fullFile}`);
  check(tlv.coverage.fullDay && tlv.coverage.last === 1439, 'full-day coverage');
  const sorted = tlv.patterns().filter(p => p.sorted);
  check(sorted.length === tlv.patterns().length, 'all full-day patterns are sorted');
  check(sorted.every(p => p.trips.every((t, i) => i === 0 || p.trips[i - 1].times.every((v, k) => v <= t.times[k]))), 'trips do not overtake within a pattern');
  check(tlv.patterns().some(p => p.line.mode === 'rail'), 'rail is in the data');
  check(tlv.patterns().every(p => p.line.routeId), 'every line keeps its GTFS route_id');
  const ok = (r, msg) => check(r.status === 'ok' && r.journeys.length > 0, msg);
  ok(show(tlv, { ...base, from: 'p:tau', to: 'p:carmel' }, 'TLV university -> Carmel market 08:00'), 'morning route');
  ok(show(tlv, { ...base, from: 'p:cbs', to: 'p:port', time: 14 * 60 }, 'TLV central station -> port 14:00'), 'afternoon route');
  ok(show(tlv, { ...base, from: 'p:jaffa', to: 'p:azrieli', mode: 'arrive', time: 21 * 60 }, 'TLV Jaffa port -> Azrieli arrive by 21:00'), 'evening arrive-by');
  ok(show(tlv, { ...base, from: 'p:ichilov', to: 'p:habima', time: 23 * 60 + 30 }, 'TLV Ichilov -> Habima 23:30'), 'late evening');
  const haifa = show(tlv, { ...base, from: 'p:savidor', to: 'p:haifa', time: 9 * 60 }, 'Tel Aviv Savidor -> Haifa center 09:00');
  ok(haifa, 'intercity rail route'); check(usesMode(haifa, 'rail'), 'Haifa trip goes by rail');
  const jlm = show(tlv, { ...base, from: 'p:azrieli', to: 'p:jerusalem', time: 17 * 60 }, 'Azrieli -> Jerusalem Navon 17:00');
  ok(jlm, 'bus + rail route'); check(usesMode(jlm, 'rail'), 'Jerusalem trip uses rail');
  const night = show(tlv, { ...base, from: 'p:tau', to: 'p:carmel', time: 3 * 60 }, 'TLV 03:00');
  check(['ok', 'noservice'].includes(night.status), 'night search answers');
  const other = show(tlv, { ...base, date: '2030-01-01', from: 'p:tau', to: 'p:carmel' }, 'TLV other date');
  check(other.status === 'nocoverage', 'other date reported');

  // real time: without a source nothing is live
  check(!haifa.journeys.some(j => j.live), 'no live data without a source');

  // a source that says each vehicle is still at its first stop, 3 minutes after it should have left
  const calls = [];
  const atStart = { status: { kind: 'test', text: 'בדיקה' }, vehicle(q) { calls.push(q); return { dist: 0, at: q.originDeparture + 3 }; } };
  fresh();
  const busQ = { ...base, from: 'p:tau', to: 'p:carmel' };
  const planned = search(new api.GtfsSliceProvider(data), busQ);
  fresh();
  const live = show(new api.GtfsSliceProvider(data, atStart), busQ, 'TLV university -> Carmel, every bus 3 min late at its first stop');
  const firstRides = live.journeys.map(j => j.segs.find(s => s.type === 'ride'));
  check(firstRides.every(s => s.live && s.live.delay === 3 && s.live.expected === s.t0 + 3), 'a vehicle late at its start gives that delay at the boarding stop');
  check(live.journeys[0].start === planned.journeys[0].start && live.journeys[0].end === planned.journeys[0].end, 'live data does not change the planned times');
  check(calls.length && calls.every(q => q.routeId && Number.isFinite(q.originDeparture)), 'queries carry route_id and origin departure');

  // a source that puts each vehicle exactly where the schedule says, 5 minutes later: placed by distance (bus) or by position (rail)
  fresh();
  const tlv5 = new api.GtfsSliceProvider(data);
  const late5 = {
    status: { kind: 'test', text: 'בדיקה' },
    vehicle(q) {
      const pat = tlv5.patterns().find(p => p.line.routeId === q.routeId && p.trips.some(t => t.times[0] - p.originOffset === q.originDeparture));
      const trip = pat.trips.find(t => t.times[0] - pat.originOffset === q.originDeparture);
      const i = Math.floor(pat.stops.length / 2) - 1, st = tlv5.stops()[pat.stops[i]];
      return { dist: pat.dists ? pat.dists[i] : null, lat: st.lat, lon: st.lon, at: trip.times[i] + 5 };
    }
  };
  tlv5.realtime = late5;
  for (const [q, label] of [[busQ, 'bus'], [{ ...base, from: 'p:savidor', to: 'p:haifa', time: 9 * 60 }, 'rail']]) {
    const r = search(tlv5, q);
    const rides = r.journeys.flatMap(j => j.segs.filter(s => s.type === 'ride'));
    check(rides.length && rides.every(s => s.live && s.live.delay === 5), `${label}: a vehicle 5 minutes behind its schedule gives a 5 minute delay`);
    check(rides.every(s => !!s.live.passed === (Math.floor(s.pat.stops.length / 2) - 1 > s.bi)), `${label}: "already passed" exactly when the vehicle is beyond the boarding stop`);
    check(rides.every(s => s.live.passed || s.live.expected === s.t0 + 5), `${label}: expected time is the schedule plus the delay`);
    console.log(`  ${label}:`, rides.slice(0, 4).map(s => s.live.passed ? `passed(+${s.live.delay})` : `expected ${clock(s.live.expected)} (+${s.live.delay})`).join(', '));
  }
  fresh();

  // StrideRealtime: parses the API answer, matches rides by line and scheduled start, ignores stale and future-dated rows
  {
    const mid = api.israelMidnight(data.date);
    const nowMs = mid + 600 * 60000; // 10:00 on the data's date
    const someRide = tlv.patterns().find(p => p.line.mode === 'bus' && p.dists);
    const origin = someRide.trips[0].times[0] - someRide.originOffset;
    const iso = m => new Date(mid + m * 60000).toISOString();
    const rows = [
      { siri_ride__scheduled_start_time: iso(origin), recorded_at_time: iso(598), lat: 32.08, lon: 34.78, distance_from_journey_start: 1200 },
      { siri_ride__scheduled_start_time: iso(origin), recorded_at_time: iso(599), lat: 32.08, lon: 34.78, distance_from_journey_start: 1500 },
      { siri_ride__scheduled_start_time: iso(origin + 10), recorded_at_time: '2038-01-14T17:22:21+00:00', lat: 32, lon: 34, distance_from_journey_start: 0 }
    ];
    const urls = [];
    const st = new api.StrideRealtime(data.date, { now: () => nowMs, fetchFn: async url => { urls.push(url); return { ok: true, json: async () => rows }; } });
    (async () => {
      const got = await st.refresh([someRide.line.routeId, someRide.line.routeId]);
      check(got && urls.length === 1, 'one request per line');
      check(/recorded_at_time_from=.*&recorded_at_time_to=/.test(urls[0]) && urls[0].includes('siri_routes__line_ref=' + someRide.line.routeId), 'request has both time bounds and the line');
      const v = st.vehicle({ routeId: someRide.line.routeId, originDeparture: origin });
      check(v && v.dist === 1500 && Math.abs(v.at - 599) < 0.01, 'latest position of the ride is kept');
      check(!st.vehicle({ routeId: someRide.line.routeId, originDeparture: origin + 10 }), 'rows dated in the future are ignored');
      check(st.status.kind === 'live', 'status is live');
      const later = new api.StrideRealtime(data.date, { now: () => nowMs + 86400000 * 3, fetchFn: async () => { throw new Error('should not fetch'); } });
      check(!(await later.refresh(['1'])) && later.status.kind === 'off', 'no live data when the schedule is not for today');
      const down = new api.StrideRealtime(data.date, { now: () => nowMs, fetchFn: async () => ({ ok: false, status: 500 }) });
      await down.refresh(['1']);
      check(down.status.kind === 'error', 'failure reported in status');
      finish();
    })();
  }
  fresh();
}

// --- older Open Bus window file ---
{
  const tlv = new api.GtfsSliceProvider(load('tlv_2026-10-15_0700-0930.json'));
  const base = { mode: 'depart', date: '2026-10-15', time: 480, walkPref: 'normal', xferPref: '1', prefStop: '', personal: false };
  console.log('== tlv_2026-10-15_0700-0930.json');
  show(tlv, { ...base, from: 'p:tau', to: 'p:carmel' }, 'TLV university -> Carmel market 08:00');
  show(tlv, { ...base, from: 'p:jaffa', to: 'p:azrieli', mode: 'arrive', time: 540 }, 'TLV Jaffa port -> Azrieli arrive by 09:00');
  show(tlv, { ...base, from: 'p:ichilov', to: 'p:habima', personal: true }, 'TLV Ichilov -> Habima, personal');
  const nc = show(tlv, { ...base, from: 'p:tau', to: 'p:carmel', time: 1000 }, 'TLV outside coverage');
  check(nc.status === 'nocoverage', 'outside coverage reported');
  fresh();
}

// --- sample city ---
{
  const sample = new api.SampleProvider(api.SAMPLE_DATA);
  const base = { mode: 'depart', date: '2026-10-15', time: 480, walkPref: 'normal', xferPref: '1', prefStop: '', personal: false };
  console.log('== sample');
  show(sample, { ...base, from: 'p:home', to: 'p:work' }, 'Sample home -> work');
  const sat = show(sample, { ...base, from: 'p:home', to: 'p:work', date: '2026-10-17', time: 720 }, 'Sample Shabbat noon');
  check(sat.status === 'noservice', 'shabbat reported');
}
let pending = fullFile ? 1 : 0;
function finish() { if (--pending <= 0) done(); }
function done() {
  console.log(failures ? `${failures} failures` : 'all checks passed');
  process.exit(failures ? 1 : 0);
}
if (!pending) done();
