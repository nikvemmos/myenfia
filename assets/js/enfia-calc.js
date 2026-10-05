// ENFIA calculation for a privately owned residential apartment (natural person).
// Pure functions, no DOM: used by the page and by tests/enfia.test.mjs.
//
// Legal basis (rules valid for ENFIA 2026):
//  - Main tax on buildings: ν.4223/2013 άρθρο 4 Ενότητα Α (now Κώδικας Φορολογίας Περιουσίας ν.5219/2025),
//    base-tax table as replaced by ν.4916/2022 άρθρο 43.
//  - Tax per property right (Ενότητα Γ), surcharge (Ενότητα Ε), value-based reduction (άρθρο 7 παρ. 2Α).
//  - Property value for those thresholds: ν.3842/2010 άρθρο 32 (apartment coefficients, par. 3.1).
//  - Insurance discount 20% / 10% for residences insured against earthquake, fire, flood (ENFIA 2026).

export const TAX_YEAR = 2026;

// Βασικός Φόρος (€/m²) per Φορολογική Ζώνη, by zone price (€/m²).
export const BASE_TAX = [
  { upTo: 750, zone: 1, rate: 2.0 },
  { upTo: 1500, zone: 2, rate: 2.8 },
  { upTo: 2500, zone: 3, rate: 3.7 },
  { upTo: 3000, zone: 4, rate: 4.5 },
  { upTo: 3500, zone: 5, rate: 7.6 },
  { upTo: 4000, zone: 6, rate: 9.2 },
  { upTo: 4500, zone: 7, rate: 11.1 },
  { upTo: 5000, zone: 8, rate: 13.4 },
  { upTo: Infinity, zone: 9, rate: 16.2 },
];

// Floors: 'basement' (υπόγειο/ημιυπόγειο), 0 = ground (ισόγειο), 1..n.
const FLOOR_TAX = (floor) => {
  if (floor === 'basement') return 0.98;
  if (floor <= 1) return 1.0;
  if (floor <= 3) return 1.01;
  if (floor <= 5) return 1.02;
  return 1.03;
};

// Art. 32 floor coefficient for residences, for commerciality coefficient < 1.5 (typical residential street).
const FLOOR_VALUE = (floor) => {
  if (floor === 'basement') return 0.6;
  return [0.9, 1.0, 1.05, 1.1, 1.15, 1.2][floor] ?? 1.25;
};

const FRONTAGE_TAX = [1.0, 1.01, 1.02]; // 0, 1, 2+ frontages
const FRONTAGE_VALUE = [0.8, 1.0, 1.05];
const AUX_TAX_COEF = 0.1; // βοηθητικοί χώροι (storage, parking)
const AUX_VALUE_SHARE = 0.2; // art. 32 par. 3.1.6: 20% of the auxiliary area counts for value
const COOWNERSHIP_VALUE_COEF = 0.9; // art. 32 par. 3.5.6α

export function baseTaxFor(zonePrice) {
  return BASE_TAX.find((b) => Math.round(zonePrice) <= b.upTo);
}

export function ageCoefTax(age, yearBuilt) {
  if (age > 100) return 0.6;
  if (yearBuilt < 1930) return 0.8;
  if (age <= 4) return 1.25;
  if (age <= 9) return 1.2;
  if (age <= 14) return 1.15;
  if (age <= 19) return 1.1;
  if (age <= 25) return 1.05;
  return 1.0;
}

export function ageCoefValue(age) {
  if (age <= 0) return 1.0;
  if (age <= 5) return 0.9;
  if (age <= 10) return 0.8;
  if (age <= 15) return 0.75;
  if (age <= 20) return 0.7;
  if (age <= 25) return 0.65;
  return 0.6;
}

export function areaCoefValue(area) {
  if (area <= 25) return 1.05;
  if (area <= 100) return 1.0;
  if (area <= 200) return 1.05;
  if (area <= 300) return 1.1;
  if (area <= 500) return 1.2;
  return 1.3;
}

// Ενότητα Γ: progressive tax on the value of each property right above €400k.
const RIGHT_BRACKETS = [
  [400000, 0], [500000, 0.002], [600000, 0.003], [700000, 0.004], [800000, 0.005],
  [900000, 0.006], [1000000, 0.007], [2000000, 0.009], [Infinity, 0.01],
];

export function rightValueTax(value) {
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of RIGHT_BRACKETS) {
    if (value > lower) tax += (Math.min(value, upper) - lower) * rate;
    lower = upper;
  }
  return tax;
}

// Άρθρο 7 παρ. 2Α: reduction by total property value (≤ €400k).
export function valueReductionRate(total) {
  if (total <= 100000) return 0.3;
  if (total <= 150000) return 0.25;
  if (total <= 250000) return 0.2;
  if (total <= 300000) return 0.15;
  if (total <= 400000) return 0.1;
  return 0;
}

// Ενότητα Ε: surcharge when total property value > €500k.
export function surchargeRate(total) {
  if (total <= 500000) return 0;
  if (total <= 650000) return 0.05;
  if (total <= 800000) return 0.1;
  if (total <= 1000000) return 0.15;
  return 0.2;
}

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * @param {object} p
 * @param {number} p.zonePrice      τιμή ζώνης €/m²
 * @param {number} p.area           main area m²
 * @param {number} p.yearBuilt      year of the (latest) building permit
 * @param {'basement'|number} p.floor
 * @param {0|1|2} p.frontages       number of street frontages (2 = two or more)
 * @param {number} [p.auxArea=0]    storage / parking m² belonging to the apartment
 * @param {number} [p.share=100]    ownership % (full ownership)
 * @param {number} [p.otherValue=0] value of the owner's other properties (for thresholds)
 * @param {boolean} [p.insured=false] insured all year against earthquake, fire and flood
 * @param {number} [p.taxYear=TAX_YEAR]
 */
export function calculateEnfia(p) {
  const taxYear = p.taxYear ?? TAX_YEAR;
  const share = (p.share ?? 100) / 100;
  const auxArea = p.auxArea ?? 0;
  const age = Math.max(0, taxYear - p.yearBuilt);
  const bt = baseTaxFor(p.zonePrice);

  // 1. Main tax (κύριος φόρος κτισμάτων), on 100% then apportioned by ownership share.
  const coefAge = ageCoefTax(age, p.yearBuilt);
  const coefFloor = FLOOR_TAX(p.floor);
  const coefFront = FRONTAGE_TAX[p.frontages];
  const mainFull = p.area * bt.rate * coefAge * coefFloor * coefFront;
  const auxFull = auxArea * bt.rate * coefAge * AUX_TAX_COEF;
  const mainTax = (mainFull + auxFull) * share;

  // 2. Property value (art. 32 ν.3842/2010).
  const vAge = ageCoefValue(age);
  const vFront = FRONTAGE_VALUE[p.frontages];
  const vFloor = FLOOR_VALUE(p.floor);
  const valueFull =
    p.zonePrice * p.area * vFront * vFloor * areaCoefValue(p.area) * vAge +
    p.zonePrice * auxArea * AUX_VALUE_SHARE * vFront * FLOOR_VALUE('basement') * vAge;
  const coownCoef = share < 1 ? COOWNERSHIP_VALUE_COEF : 1;
  const value = valueFull * coownCoef * share;
  const totalValue = value + (p.otherValue ?? 0);

  // 3. Tax on the value of the right (only if total property value > €300k).
  const rightTax = totalValue > 300000 ? rightValueTax(valueFull * coownCoef) * share : 0;

  // 4. Surcharge or reduction depending on total property value.
  const principal = mainTax + rightTax;
  const surcharge = principal * surchargeRate(totalValue);
  const reduction = principal * valueReductionRate(totalValue);
  const afterValueRules = principal + surcharge - reduction;

  // 5. Insurance discount.
  const insuranceRate = p.insured ? (value <= 500000 ? 0.2 : 0.1) : 0;
  const insurance = afterValueRules * insuranceRate;
  const total = afterValueRules - insurance;

  return {
    taxYear,
    age,
    taxZone: bt.zone,
    baseRate: bt.rate,
    coefs: { age: coefAge, floor: coefFloor, frontage: coefFront, aux: AUX_TAX_COEF },
    mainTax: round2(mainTax),
    mainApartmentFull: round2(mainFull), // 100% ownership, before share
    mainAuxFull: round2(auxFull),
    value: Math.round(value),
    totalValue: Math.round(totalValue),
    rightTax: round2(rightTax),
    surchargeRate: surchargeRate(totalValue),
    surcharge: round2(surcharge),
    reductionRate: valueReductionRate(totalValue),
    reduction: round2(reduction),
    insuranceRate,
    insurance: round2(insurance),
    total: round2(total),
    monthly: round2(total / 12),
  };
}
