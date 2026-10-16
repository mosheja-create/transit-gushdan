/* Address and place search through Photon (https://photon.komoot.io), an OpenStreetMap geocoder: free, no key,
   fair use only. Results are limited to Israel and biased towards the centre of Gush Dan; lang=default gives the
   local (Hebrew) names instead of following the browser language. */
const PHOTON = 'https://photon.komoot.io/api/';
const ISRAEL_BBOX = '34.20,29.45,35.90,33.35';
const BIAS = { lat: 32.075, lon: 34.80 };
const cache = new Map();

export async function searchAddresses(text, { signal } = {}) {
  const q = text.trim();
  if (q.length < 2) return [];
  if (cache.has(q)) return cache.get(q);
  const url = `${PHOTON}?q=${encodeURIComponent(q)}&lang=default&limit=7&bbox=${ISRAEL_BBOX}&lat=${BIAS.lat}&lon=${BIAS.lon}`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const data = await r.json();
  const seen = new Set();
  const out = [];
  for (const f of data.features || []) {
    const p = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    const street = p.street ? `${p.street}${p.housenumber ? ' ' + p.housenumber : ''}` : '';
    const name = p.name && p.name !== street ? p.name : street || p.name || p.city;
    if (!name) continue;
    const detail = [p.name && street && p.name !== street ? street : '', p.city || p.county || ''].filter(Boolean).join(', ');
    const key = name + '|' + detail;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: 'address', name, detail, lat, lon, house: !!p.housenumber && !p.name, street: !p.name && !!p.street });
  }
  // "הרצל 1 ראשון לציון" should find the address itself before shops at that address
  if (/\d/.test(q)) out.sort((a, b) => (b.house - a.house) || (b.street - a.street));
  cache.set(q, out);
  return out;
}
