/* The map: Leaflet 1.9.4 (BSD-2-Clause) with OpenStreetMap tiles (attribution required, fair use). */
const MODE_COLOR = { bus: '#1d8a4e', lrt: '#c8243a', rail: '#1c5ba8', taxi: '#8a5a12' };

export function createMap(el, { onPick }) {
  const L = window.L;
  if (!L) { el.textContent = 'המפה לא נטענה.'; return { show() {}, setPoints() {}, fitRegion() {} }; }
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView([32.075, 34.80], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  const pinLayer = L.layerGroup().addTo(map);
  const pin = (cls, letter) => L.divIcon({ className: '', html: `<div class="map-pin ${cls}">${letter}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });

  // pick a point by clicking the map
  map.on('click', e => {
    const { lat, lng } = e.latlng;
    const box = document.createElement('div');
    box.className = 'map-pop';
    box.innerHTML = '<button type="button" class="from">מכאן</button><button type="button" class="to">לכאן</button>';
    const pop = L.popup({ closeButton: false }).setLatLng(e.latlng).setContent(box).openOn(map);
    box.querySelector('.from').onclick = () => { map.closePopup(pop); onPick('from', lat, lng); };
    box.querySelector('.to').onclick = () => { map.closePopup(pop); onPick('to', lat, lng); };
  });

  let points = { from: null, to: null };
  function drawPins() {
    pinLayer.clearLayers();
    if (points.from) L.marker([points.from.lat, points.from.lon], { icon: pin('from', 'מ'), title: points.from.name, keyboard: false }).addTo(pinLayer);
    if (points.to) L.marker([points.to.lat, points.to.lon], { icon: pin('to', 'ל'), title: points.to.name, keyboard: false }).addTo(pinLayer);
  }

  return {
    setPoints(from, to) {
      map.invalidateSize();
      points = { from, to };
      drawPins();
      const ll = [from, to].filter(Boolean).map(p => [p.lat, p.lon]);
      if (ll.length === 1) map.setView(ll[0], Math.max(map.getZoom(), 14));
      else if (ll.length === 2) map.fitBounds(ll, { padding: [40, 40], maxZoom: 15 });
    },
    /* draw a journey: rides along their stops in the line's colour, walks dashed */
    show(journey) {
      map.invalidateSize(); // the layout around the map may have changed since it was created
      routeLayer.clearLayers();
      if (!journey) return;
      const all = [];
      for (const l of journey.legs) {
        if (l.type === 'ride') {
          const ll = l.stops.map(s => [s.lat, s.lon]);
          all.push(...ll);
          L.polyline(ll, { color: MODE_COLOR[l.line.mode] || '#1d8a4e', weight: 6, opacity: 0.9 }).addTo(routeLayer);
          for (const s of [l.stops[0], l.stops[l.stops.length - 1]]) L.circleMarker([s.lat, s.lon], { radius: 5, color: '#fff', weight: 2, fillColor: MODE_COLOR[l.line.mode] || '#1d8a4e', fillOpacity: 1 }).bindTooltip(s.name, { direction: 'top' }).addTo(routeLayer);
        } else if (l.type === 'walk' || l.type === 'transfer') {
          const ll = [[l.from.lat, l.from.lon], [l.to.lat, l.to.lon]];
          all.push(...ll);
          L.polyline(ll, { color: '#586863', weight: 3, dashArray: '2 7', opacity: 0.9 }).addTo(routeLayer);
        }
      }
      if (all.length) map.fitBounds(all, { padding: [30, 30], maxZoom: 16 });
    },
    invalidate() { map.invalidateSize(); }
  };
}
