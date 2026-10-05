// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_TAX, calculateEnfia, baseTaxFor, ageCoefTax, rightValueTax, valueReductionRate, surchargeRate,
} from '../assets/js/enfia-calc.js';
import ministry from './ministry-2022-examples.json' with { type: 'json' };

// Ministry of Finance examples for ENFIA 2022 (ν.4916/2022): 80 m², 1st floor, one frontage, 11 years old.
// The sheet applies only the value-based reduction (from the stated total value), never the >€500k
// surcharge, and a 2022-only transitional rule that kept some zones in the lower band.
// We check every row where those simplifications don't change the result.
test('matches Ministry of Finance 2022 examples', () => {
  const base = { area: 80, yearBuilt: 2011, floor: 1, frontages: 1, taxYear: 2022 };
  let checked = 0;
  for (const r of ministry) {
    const own = calculateEnfia({ ...base, zonePrice: r.zone });
    if (r.total > 400000 || own.value > r.total || r.total === 300000) continue;
    const res = calculateEnfia({ ...base, zonePrice: r.zone, otherValue: r.total - own.value });
    // 2022 transitional rule: same result with the next lower band's base tax
    const lower = BASE_TAX[res.taxZone - 2];
    const transitional = lower && Math.abs(res.total * (lower.rate / res.baseRate) - r.enfia) < 0.02;
    if (transitional) continue;
    assert.ok(Math.abs(res.total - r.enfia) < 0.02, `${r.name}: got ${res.total}, expected ${r.enfia}`);
    checked++;
  }
  assert.ok(checked >= 80, `only ${checked} rows checked`);
});

test('base tax bands', () => {
  assert.equal(baseTaxFor(750).rate, 2.0);
  assert.equal(baseTaxFor(751).rate, 2.8);
  assert.equal(baseTaxFor(2500).rate, 3.7);
  assert.equal(baseTaxFor(3001).rate, 7.6);
  assert.equal(baseTaxFor(5001).rate, 16.2);
});

test('age coefficient', () => {
  assert.equal(ageCoefTax(0, 2026), 1.25);
  assert.equal(ageCoefTax(4, 2022), 1.25);
  assert.equal(ageCoefTax(25, 2001), 1.05);
  assert.equal(ageCoefTax(26, 2000), 1.0);
  assert.equal(ageCoefTax(98, 1928), 0.8);
  assert.equal(ageCoefTax(101, 1925), 0.6);
});

test('value thresholds', () => {
  assert.equal(valueReductionRate(100000), 0.3);
  assert.equal(valueReductionRate(100001), 0.25);
  assert.equal(valueReductionRate(400001), 0);
  assert.equal(surchargeRate(500000), 0);
  assert.equal(surchargeRate(500001), 0.05);
  assert.equal(surchargeRate(1000001), 0.2);
  assert.equal(rightValueTax(400000), 0);
  assert.equal(rightValueTax(852000), 1712); // taxheaven worked example, ENFIA per right
});

test('typical Athens apartment, 2026', () => {
  // 90 m², 3rd floor, zone €2,000, permit 1975, one frontage, 100% owner, insured.
  const r = calculateEnfia({ zonePrice: 2000, area: 90, yearBuilt: 1975, floor: 3, frontages: 1, insured: true });
  const main = 90 * 3.7 * 1.0 * 1.01 * 1.01; // 339.70
  assert.equal(r.mainTax, Math.round(main * 100) / 100);
  assert.equal(r.value, Math.round(2000 * 90 * 1.0 * 1.1 * 1.0 * 0.6)); // 118,800 -> 25% reduction
  assert.equal(r.reductionRate, 0.25);
  assert.equal(r.total, Math.round(main * 0.75 * 0.8 * 100) / 100);
});

test('co-ownership halves the tax and applies 0.9 value coefficient', () => {
  const full = calculateEnfia({ zonePrice: 3200, area: 100, yearBuilt: 2010, floor: 4, frontages: 2 });
  const half = calculateEnfia({ zonePrice: 3200, area: 100, yearBuilt: 2010, floor: 4, frontages: 2, share: 50 });
  assert.equal(half.mainTax, Math.round(full.mainTax * 50) / 100);
  assert.equal(half.value, Math.round(full.value * 0.9 * 0.5));
});

test('small-settlement main residence: 50% off, then insurance', () => {
  const base = { zonePrice: 600, area: 100, yearBuilt: 1990, floor: 0, frontages: 1 };
  const plain = calculateEnfia(base);
  const v = calculateEnfia({ ...base, smallVillage: true, insured: true });
  assert.equal(v.villageRate, 0.5);
  assert.equal(v.total, Math.round(plain.total * 0.5 * 0.8 * 100) / 100);
  // not for residences valued over €400k
  const big = calculateEnfia({ zonePrice: 5500, area: 150, yearBuilt: 2020, floor: 5, frontages: 2, smallVillage: true });
  assert.equal(big.villageRate, 0);
});
