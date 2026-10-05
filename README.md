# myenfia

Free ENFIA 2026 calculator for a privately owned residential apartment anywhere in Greece.
Pin the property on the map, enter area, permit year, floor and frontage, and get the tax with a full breakdown.
Greek first, English toggle. Static site, no backend.

**Live:** https://nikvemmos.github.io/myenfia/

## How it works

- **Zone price (τιμή ζώνης):** looked up from the point on the map, using AADE's official zones for all of Greece
  (13k area zones + 5k street-line zones), split into one file per regional unit under `data/zones/` and loaded on
  demand via `data/zones/index.json`. Outside any zone, the lowest zone price of the municipal unit applies (by law),
  so the page offers the nearest municipal units to choose from.
- **Main tax:** m² × base tax (by zone price band) × age × floor × frontage coefficients; auxiliary spaces × 0.1.
  Law 4223/2013 art. 4 (now Property Tax Code, Law 5219/2025), base-tax table as of Law 4916/2022.
- **Total property value** (Law 3842/2010 art. 32) drives the 10–30% reduction (≤ €400k), the 5–20% surcharge
  (> €500k) and the 0.2–1% tax per property right above €400k.
- **Insurance discount:** 20% (10% if value > €500k) for homes insured against earthquake, fire and flood.
- **Small settlements:** 50% off in 2026 for a main residence in a settlement of ≤ 1,500 inhabitants, value ≤ €400k,
  outside Attica except the Islands regional unit (Law 5246/2025). Settlement population is not in the data, so the
  user ticks it; the option is hidden where it can't apply.

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
data/zones/               AADE zones per regional unit + index (generated)
tools/fetch_zones.py      regenerates the zone data from AADE's public map service (~15 min)
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
