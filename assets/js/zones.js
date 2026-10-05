// Zone lookup: which AADE zone (τιμή ζώνης) contains a point, and which street-line zones are near it.
// Data format: see tools/fetch_zones.py. Coordinates are [lon, lat].

const LINE_RADIUS_M = 35; // street-line zones apply to buildings fronting the street

export async function loadZones(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`zones ${res.status}`);
  const raw = await res.json();
  const areas = raw.areas.map(([id, name, price, dimos, de, rings]) => ({
    id, name, price, dimos, de, rings, bbox: bboxOf(rings.flat()),
  }));
  // Zones without a published price yet: by law they take the lowest zone price of their
  // municipal unit (δημοτική ενότητα), else of their municipality.
  const minBy = (key) => {
    const m = new Map();
    for (const a of areas) if (a.price) m.set(a[key], Math.min(m.get(a[key]) ?? Infinity, a.price));
    return m;
  };
  const minDe = minBy('de');
  const minDimos = minBy('dimos');
  for (const a of areas) {
    if (!a.price) {
      a.price = minDe.get(a.de) ?? minDimos.get(a.dimos) ?? null;
      a.estimated = true;
    }
  }
  const lines = raw.lines.map(([id, name, price, dimos, de, desc, paths]) => ({
    id, name, price, dimos, de, desc, paths, bbox: bboxOf(paths.flat()),
  }));
  return { meta: raw.meta, areas, lines };
}

function bboxOf(pts) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

// Even-odd rule over all rings, so holes are handled.
function inRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function ringArea(rings) {
  let a = 0;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
}

// Distance in meters from a point to a polyline, on a local equirectangular projection.
function distToPaths(lon, lat, paths) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  let best = Infinity;
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const ax = (path[i - 1][0] - lon) * kx, ay = (path[i - 1][1] - lat) * ky;
      const bx = (path[i][0] - lon) * kx, by = (path[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

export function lookup(zones, lon, lat) {
  const hits = zones.areas.filter(
    (a) => lon >= a.bbox[0] && lon <= a.bbox[2] && lat >= a.bbox[1] && lat <= a.bbox[3] && inRings(lon, lat, a.rings),
  );
  // If zones overlap, the smallest (most specific) wins.
  hits.sort((a, b) => ringArea(a.rings) - ringArea(b.rings));
  const pad = 0.0005;
  const lines = zones.lines
    .filter((l) => lon >= l.bbox[0] - pad && lon <= l.bbox[2] + pad && lat >= l.bbox[1] - pad && lat <= l.bbox[3] + pad)
    .map((l) => ({ ...l, dist: distToPaths(lon, lat, l.paths) }))
    .filter((l) => l.dist <= LINE_RADIUS_M)
    .sort((a, b) => a.dist - b.dist)
    .filter((l, i, arr) => arr.findIndex((o) => o.id === l.id) === i);
  return { area: hits[0] ?? null, lines };
}
