import { calculateEnfia, TAX_YEAR } from './enfia-calc.js';
import { loadZones, lookup } from './zones.js';
import { makeT } from './i18n.js';

const $ = (id) => document.getElementById(id);
const ATTICA_VIEWBOX = '23.25,38.35,24.15,37.60'; // lon/lat box for address search
const state = { lang: 'el', zones: null, point: null, hit: null, lineId: null, road: null };
// Uppercase without accents, for matching street names against zone descriptions.
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
let t = makeT('el');

// ---------- language ----------
function initialLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'el') return q;
  try { return localStorage.getItem('lang') || 'el'; } catch { return 'el'; }
}

function applyLang(lang) {
  state.lang = lang;
  t = makeT(lang);
  document.documentElement.lang = lang;
  document.title = t('meta.title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  fillFloors();
  try { localStorage.setItem('lang', lang); } catch { /* storage unavailable */ }
  renderZone();
  render();
  if (state.zones) $('footerData').textContent = t('footer.data', { d: fmtDate(state.zones.meta.fetched) });
}

function fillFloors() {
  const sel = $('floor');
  const current = sel.value || '1';
  const opts = [['basement', t('floor.basement')], ['0', t('floor.0')]];
  for (let n = 1; n <= 5; n++) opts.push([String(n), t('floor.n', { n })]);
  opts.push(['6', t('floor.6')]);
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  sel.value = current;
}

// ---------- formatting ----------
const locale = () => (state.lang === 'el' ? 'el-GR' : 'en-GB');
const eur = (x, d = 2) => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
const num = (x, d = 2) => new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
const pct = (r) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(r * 100);
const fmtDate = (iso) => new Date(iso).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- map ----------
let map, marker, zoneLayer;
function initMap() {
  map = L.map('map', { zoomControl: true, scrollWheelZoom: false }).setView([37.9838, 23.7275], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.on('click', (e) => selectPoint(e.latlng.lng, e.latlng.lat));
  map.on('focus', () => map.scrollWheelZoom.enable());
  map.on('blur', () => map.scrollWheelZoom.disable());
}

function selectPoint(lon, lat, fly = false, road = null) {
  state.point = [lon, lat];
  state.road = road;
  if (!marker) marker = L.marker([lat, lon], { draggable: true, icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(map);
  marker.setLatLng([lat, lon]);
  marker.off('dragend').on('dragend', () => { const p = marker.getLatLng(); selectPoint(p.lng, p.lat); });
  if (fly) map.setView([lat, lon], 17);
  updateZone();
}

function updateZone() {
  if (!state.zones || !state.point) { renderZone(); return; }
  state.hit = lookup(state.zones, ...state.point);
  // If the searched street is one of the nearby street-line zones, preselect it.
  const road = norm(state.road).replace(/^(ΟΔΟΣ|ΛΕΩΦΟΡΟΣ|ΛΕΩΦ\.)\s+/, '');
  state.lineId = road ? state.hit.lines.find((l) => norm(l.desc).includes(road))?.id ?? null : null;
  if (zoneLayer) zoneLayer.remove();
  if (state.hit.area) {
    zoneLayer = L.layerGroup([
      L.polygon(state.hit.area.rings.map((r) => r.map(([x, y]) => [y, x])), { className: 'zone-poly', weight: 2 }),
      ...state.hit.lines.map((l) => L.polyline(l.paths.map((p) => p.map(([x, y]) => [y, x])), { className: 'zone-line', weight: 5 })),
    ]).addTo(map);
  }
  renderZone();
  render();
}

// ---------- address search (OpenStreetMap Nominatim; on submit only, per its usage policy) ----------
async function search() {
  const q = $('q').value.trim();
  if (!q) return;
  const msg = $('searchMsg');
  msg.textContent = t('search.searching');
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=gr&bounded=1&viewbox=${ATTICA_VIEWBOX}&accept-language=${state.lang}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const [hit] = await res.json();
    if (!hit) { msg.textContent = t('search.none'); return; }
    msg.textContent = hit.display_name;
    selectPoint(+hit.lon, +hit.lat, true, hit.address?.road);
  } catch {
    msg.textContent = t('search.error');
  }
}

// ---------- zone panel ----------
function currentZonePrice() {
  const manual = parseFloat($('manualPrice').value);
  if (manual > 0) return { price: manual, source: 'manual' };
  const hit = state.hit;
  if (!hit?.area?.price) return null;
  const line = hit.lines.find((l) => l.id === state.lineId);
  return line ? { price: line.price, source: 'line' } : { price: hit.area.price, source: 'area' };
}

function renderZone() {
  const box = $('zoneBox');
  if (!state.zones) { box.innerHTML = `<p class="muted">${t('zone.loading')}</p>`; return; }
  if (!state.point) { box.innerHTML = `<p class="muted">${t('zone.empty')}</p>`; return; }
  const { area, lines } = state.hit;
  if (!area) {
    box.innerHTML = `<p class="warn">${t('zone.outside')}</p>`;
    $('manualBox').open = true;
    return;
  }
  const z = currentZonePrice();
  const place = esc(area.dimos) + (area.de && area.de !== area.dimos ? ' · ' + esc(area.de) : '');
  let html = `<table class="zone-table">
      <tr><th>${t('zone.place')}</th><th>${t('zone.label')}</th><th>${t('zone.price')}</th></tr>
      <tr><td>${place}</td><td>${esc(area.name)}</td>
      <td class="price">${eur(z?.price ?? area.price, 0)}<small> /${t('unit.sqm')}</small></td></tr>
    </table>`;
  if (state.hit.snapped) html += `<p class="note">${t('zone.snapped', { m: state.hit.snapped })}</p>`;
  if (area.estimated) html += `<p class="note">${t('zone.estimated')}</p>`;
  if (lines.length) {
    html += `<p class="note strong">${t('zone.lines')}</p><div class="choices">`;
    for (const l of lines) {
      html += `<label class="choice"><input type="radio" name="line" value="${l.id}" ${state.lineId === l.id ? 'checked' : ''}>
        <span>${esc(l.desc || l.name)}</span><b>${eur(l.price, 0)}</b></label>`;
    }
    html += `<label class="choice"><input type="radio" name="line" value="" ${state.lineId == null ? 'checked' : ''}><span>${t('zone.lineNone')}</span><b>${eur(area.price, 0)}</b></label></div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll('input[name=line]').forEach((r) => r.addEventListener('change', () => {
    state.lineId = r.value ? +r.value : null;
    renderZone();
    render();
  }));
}

// ---------- result ----------
function readInputs() {
  const z = currentZonePrice();
  const area = parseFloat($('area').value);
  const year = parseInt($('year').value, 10);
  if (!z || !(area > 0) || !(year > 1800 && year <= TAX_YEAR)) return null;
  const floorV = $('floor').value;
  return {
    zonePrice: z.price,
    area,
    yearBuilt: year,
    floor: floorV === 'basement' ? 'basement' : +floorV,
    frontages: +document.querySelector('input[name=front]:checked').value,
    auxArea: parseFloat($('aux').value) || 0,
    share: Math.min(100, Math.max(0.01, parseFloat($('share').value) || 100)),
    otherValue: parseFloat($('other').value) || 0,
    insured: $('insured').checked,
  };
}

function row(label, value, cls = '') {
  return `<div class="line ${cls}"><span class="l">${label}</span><span class="dots"></span><span class="v">${value}</span></div>`;
}

// Large serif total with smaller cents, e.g. 254,77 € -> 254<sup>,77</sup> €
function amountHtml(x) {
  const parts = new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR' }).formatToParts(x);
  return parts.map((p) => (p.type === 'decimal' || p.type === 'fraction' ? `<span class="cents">${p.value}</span>` : esc(p.value)))
    .join('').replace('</span><span class="cents">', '');
}

function render() {
  const body = $('resultBody');
  const input = readInputs();
  const bar = $('mobilebar');
  if (!input) {
    body.innerHTML = `<p class="placeholder">${t('res.placeholder')}</p>`;
    bar.hidden = true;
    return;
  }
  const r = calculateEnfia(input);
  const transitional = (input.zonePrice > 750 && input.zonePrice <= 800) || (input.zonePrice > 1500 && input.zonePrice <= 1550);
  let rows = row(`${t('b.main')} <small>${num(input.area, 0)} ${t('unit.sqm')} × ${eur(r.baseRate)} × ${num(r.coefs.age)} × ${num(r.coefs.floor)} × ${num(r.coefs.frontage)}</small>`, eur(r.mainApartmentFull));
  if (input.auxArea) rows += row(`${t('b.aux')} <small>${num(input.auxArea, 0)} ${t('unit.sqm')} × ${eur(r.baseRate)} × ${num(r.coefs.age)} × ${num(0.1)}</small>`, eur(r.mainAuxFull));
  if (input.share < 100) rows += row(t('b.share', { p: pct(input.share / 100) }), eur(r.mainTax), 'indent');
  if (r.rightTax) rows += row(t('b.right'), '+' + eur(r.rightTax));
  if (r.surcharge) rows += row(t('b.surcharge', { p: pct(r.surchargeRate) }), '+' + eur(r.surcharge));
  if (r.reduction) rows += row(t('b.reduction', { p: pct(r.reductionRate) }), '−' + eur(r.reduction), 'good');
  else if (!r.surcharge) rows += row(t('b.noReduction'), eur(0));
  if (r.insurance) rows += row(t('b.insurance', { p: pct(r.insuranceRate) }), '−' + eur(r.insurance), 'good');
  rows += row(t('b.total'), eur(r.total), 'total');

  body.innerHTML = `
    <div class="amount">${amountHtml(r.total)}</div>
    <p class="permonth">${t('res.perMonth', { x: eur(r.monthly) })}</p>
    <p class="accuracy">${t('res.accuracy')}</p>
    ${transitional ? `<p class="note">${t('zone.transitional')}</p>` : ''}
    <h3 class="sect">${t('res.breakdown')}</h3>
    ${rows}
    <dl class="params">
      <dt>${t('k.zone')}</dt><dd>${r.taxZone} · ${eur(r.baseRate)}/${t('unit.sqm')}</dd>
      <dt>${t('k.coefs')}</dt><dd>${num(r.coefs.age)} · ${num(r.coefs.floor)} · ${num(r.coefs.frontage)}</dd>
      <dt>${t('k.value')}</dt><dd>${eur(r.value, 0)}</dd>
      <dt>${t('k.totalValue')}</dt><dd>${eur(r.totalValue, 0)}</dd>
    </dl>`;
  $('mobileTotal').textContent = eur(r.total);
  bar.hidden = false;
}

// ---------- boot ----------
function bind() {
  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => applyLang(b.dataset.lang)));
  $('searchBtn').addEventListener('click', search);
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  $('form').addEventListener('input', (e) => {
    if (e.target.id === 'manualPrice') renderZone();
    render();
  });
  $('form').addEventListener('change', render);
}

fillFloors();
bind();
applyLang(initialLang());
initMap();
loadZones('data/zones-attica.json')
  .then((z) => {
    state.zones = z;
    $('footerData').textContent = t('footer.data', { d: fmtDate(z.meta.fetched) });
    updateZone();
  })
  .catch(() => { $('zoneBox').innerHTML = `<p class="warn">${t('zone.outside')}</p>`; $('manualBox').open = true; });
