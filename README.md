# myenfia

Free ENFIA 2026 calculator for a privately owned residential apartment in Attica (Greece).
Pin the property on the map, enter area, permit year, floor and frontage, and get the tax with a full breakdown.
Greek first, English toggle. Static site, no backend.

**Live:** https://nikvemmos.github.io/myenfia/

## How it works

- **Zone price (τιμή ζώνης):** looked up from the point on the map, using AADE's official zones
  (area zones + street-line zones) bundled in `data/zones-attica.json`.
- **Main tax:** m² × base tax (by zone price band) × age × floor × frontage coefficients; auxiliary spaces × 0.1.
  Law 4223/2013 art. 4 (now Property Tax Code, Law 5219/2025), base-tax table as of Law 4916/2022.
- **Total property value** (Law 3842/2010 art. 32) drives the 10–30% reduction (≤ €400k), the 5–20% surcharge
  (> €500k) and the 0.2–1% tax per property right above €400k.
- **Insurance discount:** 20% (10% if value > €500k) for homes insured against earthquake, fire and flood.

Out of scope (v1): income-based discounts, detached houses, commercial property, land, usufruct split.
Target accuracy ±10%; checked to the cent against the Ministry of Finance's official ENFIA 2022 examples
(`tests/ministry-2022-examples.json`).

## Project layout

```
index.html               page
assets/js/enfia-calc.js  tax rules (pure functions)
assets/js/zones.js       point-in-zone lookup
assets/js/app.js         UI: map, search, form, results
assets/js/i18n.js        Greek / English strings
data/zones-attica.json   AADE zones for Attica (generated)
tools/fetch_zones.py     regenerates the zone data from AADE's public map service
tests/                   node tests
```

## Develop

```
python -m http.server 8765        # then open http://localhost:8765
node --test tests/*.test.mjs      # run tests
python tools/fetch_zones.py       # refresh zone prices (e.g. after an AADE revision)
```

Yearly update: check the ENFIA rules for the new tax year, adjust `assets/js/enfia-calc.js` (`TAX_YEAR` and tables),
re-run the zone import.

## Credits

Zone data © AADE (valuemaps). Map tiles and address search © OpenStreetMap contributors (Nominatim).
Indicative calculation, not tax advice.
