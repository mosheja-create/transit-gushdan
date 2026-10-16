/* Live vehicle positions for the engine (see estimateLive in engine.js and docs/REALTIME.md).

   A real-time source answers vehicle({ routeId, originDeparture }) -> { lat, lon, dist, at } or null, where
   routeId is the GTFS route_id (SIRI LineRef), originDeparture the trip's scheduled departure from its first stop
   and at the minute the position was recorded, both in minutes after midnight of the data's date. */

export class NoRealtime {
  constructor() { this.status = { kind: 'off', text: 'אין חיבור לזמן אמת' }; }
  vehicle() { return null; }
  async refresh() { return false; }
}

export const TZ = 'Asia/Jerusalem';
function tzOffsetMin(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(ms).map(x => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms) / 60000);
}
/* ms timestamp of 00:00 Israel time on dateStr */
export function israelMidnight(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d) - tzOffsetMin(Date.UTC(y, m - 1, d)) * 60000;
  return Date.UTC(y, m - 1, d) - tzOffsetMin(guess) * 60000;
}
export const israelDate = ms => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(ms);
export const israelMinutes = ms => Math.floor((ms - israelMidnight(israelDate(ms))) / 60000);
const clock = m => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

/* Vehicle positions from Open Bus Stride (the Public Knowledge Workshop), which stores the Ministry's SIRI feed
   about every minute, roughly two minutes behind. A community service, not the Ministry's own: free, no key,
   no guarantee. Only used when the schedule data is for today. One request per line, both time bounds given
   (without them the API is slow). */
export class StrideRealtime {
  constructor(dateStr, { base = 'https://open-bus-stride-api.hasadna.org.il', fetchFn = (...a) => fetch(...a), now = () => Date.now() } = {}) {
    this.date = dateStr; this.base = base; this.fetch = fetchFn; this.now = now;
    this.midnight = israelMidnight(dateStr);
    this.lines = new Map(); // routeId -> { fetchedAt, rides: Map(originDeparture -> observation) }
    this.lastSeen = null;
    this.status = this.active() ? { kind: 'idle', text: 'זמן אמת: ממתין לנתונים' } : { kind: 'off', text: 'זמן אמת זמין רק לנסיעות של היום' };
  }
  active() { return israelDate(this.now()) === this.date; }
  nowMinute() { return (this.now() - this.midnight) / 60000; }
  async refresh(routeIds) {
    if (!this.active()) { this.status = { kind: 'off', text: 'זמן אמת זמין רק לנסיעות של היום' }; return false; }
    const t = this.now();
    const todo = [...new Set(routeIds)].filter(id => { const c = this.lines.get(id); return !c || t - c.fetchedAt > 50000; });
    if (!todo.length) return false;
    const iso = ms => new Date(ms).toISOString().slice(0, 19) + 'Z';
    const from = iso(t - 6 * 60000), to = iso(t + 60000);
    const res = await Promise.allSettled(todo.map(id => this._line(id, from, to, t)));
    const failed = res.filter(r => r.status === 'rejected').length;
    if (failed === todo.length) this.status = { kind: 'error', text: 'זמן אמת: אין תשובה מ־Stride' };
    else this.status = { kind: 'live', text: `זמן אמת: Open Bus Stride${this.lastSeen != null ? ` · מיקום אחרון מ־${clock(this.lastSeen)}` : ''}` };
    return true;
  }
  async _line(id, from, to, t) {
    const url = `${this.base}/siri_vehicle_locations/list?limit=500&recorded_at_time_from=${from}&recorded_at_time_to=${to}&siri_routes__line_ref=${encodeURIComponent(id)}`;
    const r = await this.fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error('unexpected answer');
    const rides = new Map();
    for (const v of rows) {
      const origin = Math.round((Date.parse(v.siri_ride__scheduled_start_time) - this.midnight) / 60000);
      const at = (Date.parse(v.recorded_at_time) - this.midnight) / 60000;
      if (!Number.isFinite(origin) || !Number.isFinite(at) || at > this.nowMinute() + 2) continue; // the feed has some rows dated years ahead
      const prev = rides.get(origin);
      if (!prev || at > prev.at) rides.set(origin, { lat: v.lat, lon: v.lon, dist: v.distance_from_journey_start, at });
      if (this.lastSeen == null || at > this.lastSeen) this.lastSeen = at;
    }
    this.lines.set(id, { fetchedAt: t, rides });
  }
  vehicle({ routeId, originDeparture }) {
    const c = this.lines.get(routeId);
    const v = c && c.rides.get(originDeparture);
    return v && this.nowMinute() - v.at <= 6 ? v : null;
  }
}
