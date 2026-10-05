"""Download current AADE zone prices (τιμές ζώνης) with geometry for a region.

Source: AADE public valuemaps service (maps.gsis.gr/valuemaps), layer ZONES_LATEST.
  layer 1 = area zones (κυκλικές ζώνες, polygons)
  layer 0 = street-line zones (γραμμικές ζώνες, polylines; apply to buildings fronting that street)

Output: data/zones-<slug>.json, a compact custom format (not GeoJSON) to keep the file small:
  {"meta": {...}, "areas": [[id, name, price, dimos, de, [[ring], ...]], ...],
   "lines": [[id, name, price, dimos, de, desc, [[path], ...]], ...]}
Coordinates are [lon, lat] rounded to 5 decimals (~1 m).

Usage: python tools/fetch_zones.py            (Attica)
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

PROXY = "https://maps.gsis.gr/valuemaps2/PHP/proxy.php?"
SERVICE = "https://maps.gsis.gr/arcgis/rest/services/APAA_PUBLIC/ZONES_LATEST/MapServer"
# ZONES_LATEST omits zones without a registry id (e.g. Athens zone ΚΑ, Ilisia). The 2021 layer has them,
# so area zones from it that ZONES_LATEST doesn't cover are added as a fallback.
SERVICE_2021 = "https://maps.gsis.gr/arcgis/rest/services/APAA_PUBLIC/PUBLIC_ZONES_APAA_2021_INFO/MapServer"
HEADERS = {"User-Agent": "Mozilla/5.0 (myenfia zone import)", "Referer": "https://maps.gsis.gr/valuemaps/"}
PAGE = 200
REGION_WHERE = "PERIFERIA = 'ΑΤΤΙΚΗΣ' AND VALID_TO IS NULL"
OUT = Path(__file__).resolve().parent.parent / "data" / "zones-attica.json"


def query(layer, params, service=SERVICE):
    url = f"{service}/{layer}/query?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(PROXY + url, headers=HEADERS)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.load(r)
            if "error" in data:
                raise RuntimeError(data["error"])
            return data
        except Exception as e:  # noqa: BLE001 - retry any network/server hiccup
            if attempt == 3:
                raise
            print(f"  retry {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))


def fetch_layer(layer):
    fields = "OBJECTID,ZONEREGISTRYID,ZONENAME,CURRENTZONEVALUE,DIMOS,DIMOTIKI_ENOTITA,ZONEDESCRIPTION,VALID_FROM"
    feats, offset = [], 0
    while True:
        data = query(layer, {
            "where": REGION_WHERE, "outFields": fields, "returnGeometry": "true",
            "outSR": 4326, "geometryPrecision": 5, "maxAllowableOffset": 0.00001,
            "orderByFields": "OBJECTID", "resultOffset": offset, "resultRecordCount": PAGE, "f": "json",
        })
        batch = data.get("features", [])
        feats += batch
        print(f"  layer {layer}: {len(feats)}", file=sys.stderr)
        if len(batch) < PAGE and not data.get("exceededTransferLimit"):
            break
        offset += len(batch)
        time.sleep(0.5)  # be polite to the public service
    return feats


def fetch_2021_areas():
    """The 2021 layer allows only 10 records per request, so fetch by object id in batches."""
    ids = query(1, {"where": REGION_WHERE, "returnIdsOnly": "true", "f": "json"}, SERVICE_2021)["objectIds"]
    feats = []
    for i in range(0, len(ids), 10):
        feats += query(1, {
            "objectIds": ",".join(map(str, ids[i:i + 10])),
            "outFields": "ZONEREGISTRYID,ZONENAME,CURRENTZONEVALUE,DIMOS,DIMOTIKI_ENOTITA",
            "returnGeometry": "true", "outSR": 4326, "geometryPrecision": 5, "maxAllowableOffset": 0.00001, "f": "json",
        }, SERVICE_2021)["features"]
        print(f"  2021 layer: {len(feats)}/{len(ids)}", file=sys.stderr)
        time.sleep(0.3)
    return feats


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
    """True if most sample points inside `rings` fall in none of `areas`."""
    pts = [p for r in rings for p in r]
    x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
    y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
    samples = [(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * j / 8) for i in range(1, 8) for j in range(1, 8)]
    samples = [(x, y) for x, y in samples if in_rings(x, y, rings)]
    if not samples:
        return False
    miss = sum(1 for x, y in samples if not any(in_rings(x, y, a[5]) for a in areas))
    return miss / len(samples) > 0.5


def main():
    areas, lines, valid_from = [], [], set()
    for f in fetch_layer(1):
        a, g = f["attributes"], f.get("geometry") or {}
        if not g.get("rings"):
            continue
        valid_from.add(a["VALID_FROM"])
        areas.append([a["ZONEREGISTRYID"], a["ZONENAME"], a["CURRENTZONEVALUE"], a["DIMOS"],
                      a["DIMOTIKI_ENOTITA"], g["rings"]])
    added = []
    for f in fetch_2021_areas():
        a, g = f["attributes"], f.get("geometry") or {}
        if g.get("rings") and uncovered(g["rings"], areas):
            added.append([a["ZONEREGISTRYID"], a["ZONENAME"], a["CURRENTZONEVALUE"], a["DIMOS"],
                          a["DIMOTIKI_ENOTITA"], g["rings"]])
    print(f"  added from 2021 layer: {[(x[3], x[1]) for x in added]}", file=sys.stderr)
    areas += added
    for f in fetch_layer(0):
        a, g = f["attributes"], f.get("geometry") or {}
        if not g.get("paths"):
            continue
        valid_from.add(a["VALID_FROM"])
        lines.append([a["ZONEREGISTRYID"], a["ZONENAME"], a["CURRENTZONEVALUE"], a["DIMOS"],
                      a["DIMOTIKI_ENOTITA"], (a["ZONEDESCRIPTION"] or "").strip(), g["paths"]])
    meta = {
        "region": "Αττική",
        "source": "ΑΑΔΕ - valuemaps (ZONES_LATEST)",
        "fetched": date.today().isoformat(),
        "validFrom": sorted({date.fromtimestamp(v / 1000).isoformat() for v in valid_from if v}),
        "counts": {"areas": len(areas), "lines": len(lines), "fromLayer2021": len(added)},
    }
    OUT.write_text(json.dumps({"meta": meta, "areas": areas, "lines": lines},
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB) {meta}", file=sys.stderr)


if __name__ == "__main__":
    main()
