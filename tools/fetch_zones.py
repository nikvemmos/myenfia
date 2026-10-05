"""Download current AADE zone prices (τιμές ζώνης) with geometry for all of Greece.

Source: AADE public valuemaps service (maps.gsis.gr/valuemaps), layer ZONES_LATEST.
  layer 1 = area zones (κυκλικές ζώνες, polygons)
  layer 0 = street-line zones (γραμμικές ζώνες, polylines; apply to buildings fronting that street)
ZONES_LATEST omits some zones (e.g. those without a registry id, like Athens zone ΚΑ / Ilisia).
The 2021 layer has them, so area zones from it that ZONES_LATEST doesn't cover are added.

Output, one file per regional unit (περιφερειακή ενότητα) so the page loads only what it needs:
  data/zones/index.json  {"meta": {...}, "units": [{"id", "name", "region", "bbox", "areas", "lines"}, ...]}
  data/zones/<id>.json   {"areas": [[id, name, price, dimos, de, [[ring], ...]], ...],
                          "lines": [[id, name, price, dimos, de, desc, [[path], ...]], ...]}
Coordinates are [lon, lat] rounded to 5 decimals (~1 m).

Usage: python tools/fetch_zones.py
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

PROXY = "https://maps.gsis.gr/valuemaps2/PHP/proxy.php?"
BASE = "https://maps.gsis.gr/arcgis/rest/services/APAA_PUBLIC"
LATEST = f"{BASE}/ZONES_LATEST/MapServer"
OLD = f"{BASE}/PUBLIC_ZONES_APAA_2021_INFO/MapServer"
HEADERS = {"User-Agent": "Mozilla/5.0 (myenfia zone import)", "Referer": "https://maps.gsis.gr/valuemaps/"}
PAGE = 500
WHERE = "VALID_TO IS NULL"
GEOM = {"returnGeometry": "true", "outSR": 4326, "geometryPrecision": 5, "maxAllowableOffset": 0.00001}
OUT = Path(__file__).resolve().parent.parent / "data" / "zones"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def query(service, layer, params):
    url = f"{service}/{layer}/query?" + urllib.parse.urlencode({**params, "f": "json"})
    req = urllib.request.Request(PROXY + url, headers=HEADERS)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.load(r)
            if "error" in data:
                raise RuntimeError(data["error"])
            return data
        except Exception as e:  # noqa: BLE001 - retry any network/server hiccup
            if attempt == 4:
                raise
            log(f"  retry {attempt + 1}: {e}")
            time.sleep(3 * (attempt + 1))


def fetch_latest(layer, fields):
    feats, offset = [], 0
    while True:
        data = query(LATEST, layer, {"where": WHERE, "outFields": fields, "orderByFields": "OBJECTID",
                                     "resultOffset": offset, "resultRecordCount": PAGE, **GEOM})
        batch = data.get("features", [])
        feats += batch
        log(f"  latest layer {layer}: {len(feats)}")
        if len(batch) < PAGE and not data.get("exceededTransferLimit"):
            return feats
        offset += len(batch)
        time.sleep(0.4)  # be polite to the public service


def bbox(pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


def in_rings(x, y, rings):
    inside = False
    for ring in rings:
        j = len(ring) - 1
        for i in range(len(ring)):
            (xi, yi), (xj, yj) = ring[i], ring[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
    return inside


def uncovered(rings, areas):
    """True if most sample points inside `rings` fall in none of `areas` (each with a precomputed bbox)."""
    x0, y0, x1, y1 = bbox([p for r in rings for p in r])
    samples = [(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * j / 8) for i in range(1, 8) for j in range(1, 8)]
    samples = [(x, y) for x, y in samples if in_rings(x, y, rings)]
    if not samples:
        return False
    cands = [a for a in areas if not (a["bbox"][2] < x0 or a["bbox"][0] > x1 or a["bbox"][3] < y0 or a["bbox"][1] > y1)]
    miss = sum(1 for x, y in samples if not any(in_rings(x, y, a["rings"]) for a in cands))
    return miss / len(samples) > 0.5


def fill_gaps(unit, areas):
    """Area zones of the 2021 layer in this regional unit that ZONES_LATEST lacks."""
    known = sorted({a["rid"] for a in areas if a["rid"] is not None})
    esc = unit.replace("'", "''")
    clauses = ["ZONEREGISTRYID IS NULL"]
    # Split the NOT IN list so the URL stays short.
    for i in range(0, len(known), 300):
        clauses.append("ZONEREGISTRYID NOT IN (%s)" % ",".join(map(str, known[i:i + 300])))
    where = f"PERIFERIAKI_ENOTITA = '{esc}' AND {WHERE} AND (ZONEREGISTRYID IS NULL OR ({' AND '.join(clauses[1:]) or '1=1'}))"
    ids = query(OLD, 1, {"where": where, "returnIdsOnly": "true"}).get("objectIds") or []
    added = []
    for i in range(0, len(ids), 10):  # the 2021 layer returns at most 10 records per request
        for f in query(OLD, 1, {"objectIds": ",".join(map(str, ids[i:i + 10])),
                                "outFields": "ZONEREGISTRYID,ZONENAME,CURRENTZONEVALUE,DIMOS,DIMOTIKI_ENOTITA", **GEOM})["features"]:
            g = f.get("geometry") or {}
            if g.get("rings") and uncovered(g["rings"], areas):
                added.append(area_rec(f["attributes"], g["rings"], unit))
        time.sleep(0.3)
    return added


def area_rec(a, rings, unit):
    return {"rid": a.get("ZONEREGISTRYID"), "name": a["ZONENAME"], "price": a["CURRENTZONEVALUE"],
            "dimos": a["DIMOS"], "de": a["DIMOTIKI_ENOTITA"], "unit": unit, "rings": rings,
            "bbox": bbox([p for r in rings for p in r])}


def main():
    common = "OBJECTID,ZONEREGISTRYID,ZONENAME,CURRENTZONEVALUE,PERIFERIA,PERIFERIAKI_ENOTITA,DIMOS,DIMOTIKI_ENOTITA,VALID_FROM"
    region_of, valid_from = {}, set()
    by_unit_areas, by_unit_lines = defaultdict(list), defaultdict(list)

    for f in fetch_latest(1, common):
        a, g = f["attributes"], f.get("geometry") or {}
        if not g.get("rings") or not a["PERIFERIAKI_ENOTITA"]:
            continue
        unit = a["PERIFERIAKI_ENOTITA"]
        region_of[unit] = a["PERIFERIA"]
        valid_from.add(a["VALID_FROM"])
        by_unit_areas[unit].append(area_rec(a, g["rings"], unit))

    for f in fetch_latest(0, common + ",ZONEDESCRIPTION"):
        a, g = f["attributes"], f.get("geometry") or {}
        if not g.get("paths") or not a["PERIFERIAKI_ENOTITA"]:
            continue
        unit = a["PERIFERIAKI_ENOTITA"]
        region_of.setdefault(unit, a["PERIFERIA"])
        valid_from.add(a["VALID_FROM"])
        by_unit_lines[unit].append([a["ZONEREGISTRYID"], a["ZONENAME"], a["CURRENTZONEVALUE"], a["DIMOS"],
                                    a["DIMOTIKI_ENOTITA"], (a["ZONEDESCRIPTION"] or "").strip(), g["paths"]])

    filled = []
    for unit in sorted(by_unit_areas):
        added = fill_gaps(unit, by_unit_areas[unit])
        if added:
            log(f"  {unit}: +{len(added)} from 2021 layer {[(x['dimos'], x['name']) for x in added]}")
            filled += [(unit, x["dimos"], x["name"]) for x in added]
            by_unit_areas[unit] += added

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    units = []
    for n, unit in enumerate(sorted(set(by_unit_areas) | set(by_unit_lines)), start=1):
        areas, lines = by_unit_areas[unit], by_unit_lines[unit]
        pts = [p for a in areas for r in a["rings"] for p in r] + [p for l in lines for path in l[6] for p in path]
        uid = f"{n:02d}"
        (OUT / f"{uid}.json").write_text(json.dumps({
            "areas": [[a["rid"], a["name"], a["price"], a["dimos"], a["de"], a["rings"]] for a in areas],
            "lines": lines,
        }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        units.append({"id": uid, "name": unit, "region": region_of.get(unit), "bbox": [round(v, 5) for v in bbox(pts)],
                      "areas": len(areas), "lines": len(lines)})

    meta = {
        "source": "ΑΑΔΕ - valuemaps (ZONES_LATEST, gaps filled from PUBLIC_ZONES_APAA_2021_INFO)",
        "fetched": date.today().isoformat(),
        "validFrom": sorted({(datetime(1970, 1, 1) + timedelta(milliseconds=v)).date().isoformat() for v in valid_from if v and v > 0}),
        "counts": {"units": len(units), "areas": sum(u["areas"] for u in units), "lines": sum(u["lines"] for u in units),
                   "filledFrom2021": len(filled)},
    }
    (OUT / "index.json").write_text(json.dumps({"meta": meta, "units": units}, ensure_ascii=False, indent=1),
                                    encoding="utf-8")
    total = sum(p.stat().st_size for p in OUT.glob("*.json"))
    log(f"wrote {len(units)} units to {OUT} ({total / 1e6:.1f} MB) {meta}")


if __name__ == "__main__":
    main()
