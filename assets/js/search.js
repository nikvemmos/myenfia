// Address search with an autocomplete dropdown, using Esri's World Geocoding Service
// (suggest while typing, findAddressCandidates to resolve a pick or a plain Enter). Results are not stored.

const GEOCODER = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';
const CATEGORIES = 'Address,Street Address,Street Name,Populated Place,Postal';
const DEBOUNCE_MS = 180;
const MIN_CHARS = 3;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

export function initSearch({ input, list, msg, t, getLang, getBias, onSelect }) {
  let items = [];
  let active = -1;
  let timer = 0;
  let ctrl = null;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const renderList = () => {
    if (!items.length) { close(); return; }
    list.innerHTML = items.map((it, i) => {
      const [main, ...rest] = it.text.split(', ');
      return `<li role="option" id="sugg-${i}" class="${i === active ? 'active' : ''}" aria-selected="${i === active}">
        <span class="s-main">${esc(main)}</span>${rest.length ? `<span class="s-area">${esc(rest.join(', ').replace(/, GRC$/, ''))}</span>` : ''}</li>`;
    }).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `sugg-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  async function resolve(params) {
    msg.textContent = t('search.searching');
    try {
      const res = await fetch(`${GEOCODER}/findAddressCandidates?${qs({
        f: 'json', countryCode: 'GRC', outFields: 'StName', maxLocations: 1, langCode: getLang(), ...params,
      })}`);
      const c = (await res.json()).candidates?.[0];
      if (!c) { msg.textContent = t('search.none'); return; }
      msg.textContent = '';
      onSelect({ lon: c.location.x, lat: c.location.y, road: c.attributes?.StName || null, label: c.address });
    } catch {
      msg.textContent = t('search.error');
    }
  }

  const choose = (it) => {
    input.value = it.text.replace(/, GRC$/, '');
    close();
    resolve({ singleLine: it.text, magicKey: it.magicKey });
  };

  // Two requests in parallel: one biased to the map view (nearby addresses rank first) and one unbiased
  // (towns and villages anywhere). Places from the unbiased list go first, then nearby results.
  async function suggest(q) {
    ctrl?.abort();
    ctrl = new AbortController();
    const [lat, lon] = getBias();
    const base = { f: 'json', text: q, countryCode: 'GRC', maxSuggestions: 6, category: CATEGORIES, langCode: getLang() };
    const get = (extra) => fetch(`${GEOCODER}/suggest?${qs({ ...base, ...extra })}`, { signal: ctrl.signal })
      .then((r) => r.json()).then((d) => (d.suggestions || []).filter((x) => !x.isCollection));
    try {
      const [near, any] = await Promise.all([get({ location: `${lon},${lat}` }), get({})]);
      const isPlace = (x) => !/\d{3} \d{2}/.test(x.text); // addresses carry a postcode, places don't
      const seen = new Set();
      items = [...any.filter(isPlace), ...near, ...any].filter((x) => !seen.has(x.text) && seen.add(x.text)).slice(0, 6);
      active = -1;
      if (document.activeElement === input) renderList();
    } catch (e) {
      if (e.name !== 'AbortError') { items = []; close(); }
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    msg.textContent = '';
    const q = input.value.trim();
    if (q.length < MIN_CHARS) { ctrl?.abort(); items = []; close(); return; }
    timer = setTimeout(() => suggest(q), DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    const open = !list.hidden && items.length;
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); active = (active + 1) % items.length; renderList(); }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); active = (active - 1 + items.length) % items.length; renderList(); }
    else if (e.key === 'Escape') { close(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      clearTimeout(timer);
      ctrl?.abort();
      if (open) choose(items[Math.max(active, 0)]); // Enter takes the highlighted (or top) suggestion
      else { close(); resolve({ singleLine: q }); }
    }
  });

  // mousedown (not click) so it fires before the input loses focus
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    choose(items[+li.id.slice(6)]);
  });
  list.addEventListener('mousemove', (e) => {
    const li = e.target.closest('li');
    if (li && +li.id.slice(6) !== active) { active = +li.id.slice(6); renderList(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('focus', () => { if (items.length && input.value.trim().length >= MIN_CHARS) renderList(); });
}
