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
HEADERS = {"User-Agent": "Mozilla/5.0 (myenfia zone import)", "Referer": "https://maps.gsis.gr/valuemaps/"}
PAGE = 200
REGION_WHERE = "PERIFERIA = 'ΑΤΤΙΚΗΣ' AND VALID_TO IS NULL"
OUT = Path(__file__).resolve().parent.parent / "data" / "zones-attica.json"


def query(layer, params):
    url = f"{SERVICE}/{layer}/query?" + urllib.parse.urlencode(params)
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


def main():
    areas, lines, valid_from = [], [], set()
    for f in fetch_layer(1):
        a, g = f["attributes"], f.get("geometry") or {}
        if not g.get("rings"):
            continue
        valid_from.add(a["VALID_FROM"])
        areas.append([a["ZONEREGISTRYID"], a["ZONENAME"], a["CURRENTZONEVALUE"], a["DIMOS"],
                      a["DIMOTIKI_ENOTITA"], g["rings"]])
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
        "counts": {"areas": len(areas), "lines": len(lines)},
    }
    OUT.write_text(json.dumps({"meta": meta, "areas": areas, "lines": lines},
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB) {meta}", file=sys.stderr)


if __name__ == "__main__":
    main()
