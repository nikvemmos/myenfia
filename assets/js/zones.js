// Zone lookup: which AADE zone (τιμή ζώνης) contains a point, and which street-line zones are near it.
// Data is split per regional unit (see tools/fetch_zones.py); units are fetched on demand. Coordinates are [lon, lat].

const LINE_RADIUS_M = 35; // street-line zones apply to buildings fronting the street
const SNAP_RADIUS_M = 60; // a click on a street or tiny gap snaps to the nearest area zone
const FALLBACK_RADIUS_M = 15000; // outside all zones: offer municipal units within this distance
const PAD = 0.0008; // ~80 m, bbox padding

export async function loadIndex(base) {
  const res = await fetch(`${base}/index.json`);
  if (!res.ok) throw new Error(`zones index ${res.status}`);
  const idx = await res.json();
  return { ...idx, base, cache: new Map() };
}

function loadUnit(zones, unit) {
  if (!zones.cache.has(unit.id)) {
    zones.cache.set(unit.id, fetch(`${zones.base}/${unit.id}.json`).then((r) => {
      if (!r.ok) throw new Error(`zones ${unit.id} ${r.status}`);
      return r.json();
    }).then((raw) => parseUnit(raw, unit)).catch((e) => { zones.cache.delete(unit.id); throw e; }));
  }
  return zones.cache.get(unit.id);
}

function parseUnit(raw, unit) {
  const areas = raw.areas.map(([id, name, price, dimos, de, rings]) => ({
    id, name, price, dimos, de, unit: unit.name, region: unit.region, rings, bbox: bboxOf(rings.flat()),
  }));
  // Minimum zone price per municipal unit (δημοτική ενότητα), else per municipality. By law it applies to
  // zones without a published price and to buildings outside any zone.
  const minDe = new Map();
  const minDimos = new Map();
  for (const a of areas) {
    if (!a.price) continue;
    minDe.set(a.de ?? a.dimos, Math.min(minDe.get(a.de ?? a.dimos) ?? Infinity, a.price));
    minDimos.set(a.dimos, Math.min(minDimos.get(a.dimos) ?? Infinity, a.price));
  }
  for (const a of areas) {
    if (!a.price) {
      a.price = minDe.get(a.de ?? a.dimos) ?? minDimos.get(a.dimos) ?? null;
      a.estimated = true;
    }
    a.deMin = minDe.get(a.de ?? a.dimos) ?? minDimos.get(a.dimos) ?? a.price;
  }
  const lines = raw.lines.map(([id, name, price, dimos, de, desc, paths]) => ({
    id, name, price, dimos, de, desc, paths, bbox: bboxOf(paths.flat()),
  }));
  return { areas, lines };
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

const inBox = (lon, lat, b, pad = 0) => lon >= b[0] - pad && lon <= b[2] + pad && lat >= b[1] - pad && lat <= b[3] + pad;

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

// Distance in meters from a point to a set of polylines, on a local equirectangular projection.
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

function boxDist(lon, lat, b) {
  const dx = Math.max(b[0] - lon, 0, lon - b[2]);
  const dy = Math.max(b[1] - lat, 0, lat - b[3]);
  return Math.hypot(dx * Math.cos((lat * Math.PI) / 180), dy);
}

/**
 * @returns {Promise<{area, snapped, lines, fallback, region}>}
 *   area: containing (or snapped-to) zone or null; lines: nearby street-line zones;
 *   fallback: when outside all zones, nearby municipal units [{dimos, de, price, dist}] sorted by distance.
 */
export async function lookupAt(zones, lon, lat, unitPad = 0.01) {
  let units = zones.units.filter((u) => inBox(lon, lat, u.bbox, unitPad));
  if (!units.length) units = [...zones.units].sort((a, b) => boxDist(lon, lat, a.bbox) - boxDist(lon, lat, b.bbox)).slice(0, 2);
  const parts = await Promise.all(units.map((u) => loadUnit(zones, u)));
  const areas = parts.flatMap((p) => p.areas);
  const allLines = parts.flatMap((p) => p.lines);

  const hits = areas.filter((a) => inBox(lon, lat, a.bbox) && inRings(lon, lat, a.rings));
  hits.sort((a, b) => ringArea(a.rings) - ringArea(b.rings)); // overlapping zones: most specific wins
  let area = hits[0] ?? null;
  let snapped = 0;
  let fallback = [];
  if (!area) {
    const near = areas
      .filter((a) => inBox(lon, lat, a.bbox, FALLBACK_RADIUS_M / 90000))
      .map((a) => ({ a, d: distToPaths(lon, lat, a.rings) }))
      .sort((x, y) => x.d - y.d);
    if (near[0] && near[0].d <= SNAP_RADIUS_M) {
      area = near[0].a;
      snapped = Math.round(near[0].d);
    } else if (unitPad < 0.15) {
      // Outside all zones: widen to neighbouring regional units before listing fallback municipal units.
      return lookupAt(zones, lon, lat, 0.15);
    } else {
      const seen = new Set();
      for (const { a, d } of near) {
        const key = `${a.dimos}|${a.de}`;
        if (d > FALLBACK_RADIUS_M || seen.has(key) || !a.deMin) continue;
        seen.add(key);
        fallback.push({ dimos: a.dimos, de: a.de, price: a.deMin, dist: Math.round(d), region: a.region, unit: a.unit });
        if (fallback.length === 6) break;
      }
    }
  }
  const lines = allLines
    .filter((l) => inBox(lon, lat, l.bbox, PAD))
    .map((l) => ({ ...l, dist: distToPaths(lon, lat, l.paths) }))
    .filter((l) => l.dist <= LINE_RADIUS_M)
    .sort((a, b) => a.dist - b.dist)
    .filter((l, i, arr) => arr.findIndex((o) => o.id === l.id) === i);
  const region = area?.region ?? fallback[0]?.region ?? units[0]?.region ?? null;
  const unit = area?.unit ?? fallback[0]?.unit ?? units[0]?.name ?? null;
  return { area, snapped, lines, fallback, region, unit };
}
