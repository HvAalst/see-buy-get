// MDP Worker App — the sort-hub floor. The repetitive loop the Compendium (Ch 17) describes:
//   Drop a bag  → scan the bag code, the system empties it; its parcels join the sort queue.
//   Sort        → scan each parcel; the system reads its NEXT DESTINATION and the BAG to place it in.
//   Load a bag  → a full destination bag is scanned onto the onward bus (one scan, not each parcel).
//   New tote    → register a fresh laminated QR (BAG-###) into the pool.
// Professional WS-UX (brand palette, large targets, status pinned). Opens with ?mdp=<mdpId>.

import { el, mount, ReadAloud } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const mdpId = new URLSearchParams(location.search).get('mdp');
const root = document.getElementById('mdp');

const ICONS = {
  drop: '<svg viewBox="0 0 24 24"><path d="M3 7h13l4 4v6H3z"/><path d="M16 7v4h4"/><path d="M8 17v3M14 17v3"/></svg>',
  sort: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  bus: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="11" rx="2"/><path d="M3 11h18"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M3 11l8-8 10 10-8 8z"/><circle cx="8" cy="8" r="1.4"/></svg>',
};
function iconEl(name) {
  const span = document.createElement('span');
  span.className = 'mdp__action-ic';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = ICONS[name];
  return span;
}

// A stable colour per destination so the worker can visually match bag ↔ destination at a glance.
const SWATCHES = ['#0E7C5A', '#2563EB', '#D97706', '#7C3AED', '#DB2777', '#0891B2', '#65A30D', '#DC2626'];
function destColor(id) {
  let h = 0;
  for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SWATCHES[h % SWATCHES.length];
}

const state = { screen: 'home', mdp: null, totes: [], inbound: [], toSort: [], awaiting: 0, last: null, msg: null, form: {}, rates: null };

let token = null;
async function getToken() {
  if (token) return token;
  const res = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'mdp-worker-app', type: 'client_credentials' }) });
  token = (await res.json()).access_token;
  return token;
}
async function api(path, { method = 'GET', body } = {}) {
  const t = await getToken();
  const res = await fetch(`${API}/sbg${path}`, { method, headers: { Authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Error ${res.status}`);
  return data;
}
const feedback = () => { try { navigator.vibrate?.(120); } catch { /* no-op */ } };

async function loadHub() {
  if (!mdpId) { state.msg = { type: 'err', text: 'Open this app with ?mdp=<hub id>.' }; return render(); }
  try {
    const mdps = await api('/mdps');
    state.mdp = (mdps || []).find((m) => m.mdpId === mdpId) || null;
    if (!state.mdp) throw new Error('Hub not found');
    state.totes = (await api(`/totes?location=${encodeURIComponent(mdpId)}`)) || [];
    const awaiting = (await api('/parcels?status=At_MDP')) || [];
    state.inbound = awaiting.filter((p) => p.atMdpId === mdpId); // parcels dropped at THIS hub
    state.awaiting = state.inbound.length;
    // Seed the sort queue from UNSORTED parcels at the hub (sorted ones already sit in a destination bag).
    state.toSort = [...new Set([...state.toSort, ...state.inbound.filter((p) => !p.toteId).map((p) => p.parcelId)])];
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; }
  render();
}

// --- shell ---

function topBar() {
  return el('header', { className: 'mdp__top' }, [
    el('div', { className: 'mdp__brand' }, [document.createTextNode('MDP Sort'), el('span', { text: state.mdp ? state.mdp.name : '' })]),
    el('div', { className: 'mdp__right' }, [
      el('span', { className: 'mdp__status' }, [el('span', { className: 'mdp__status-dot' }), state.mdp ? `${state.mdp.zones.length} zone${state.mdp.zones.length === 1 ? '' : 's'}` : 'Connecting']),
      el('a', { className: 'mdp__hub', attrs: { href: 'index.html' }, text: 'Hub ›' }),
    ]),
  ]);
}
function actionRow(icon, title, subtitle, onClick, disabled = false) {
  return el('button', { className: 'mdp__action', attrs: { type: 'button', ...(disabled ? { disabled: 'disabled' } : {}) }, onClick: disabled ? undefined : onClick }, [
    iconEl(icon),
    el('div', {}, [el('div', { className: 'mdp__action-t', text: title }), el('div', { className: 'mdp__action-s', text: subtitle })]),
  ]);
}
function headerRow(title) {
  return el('div', { className: 'mdp__head' }, [
    el('button', { className: 'mdp__back', attrs: { type: 'button' }, text: '← Back', onClick: () => { state.form = {}; state.last = null; go('home'); } }),
    el('h1', { className: 'mdp__title', text: title }),
  ]);
}
function step(n, label, content) {
  return el('div', { className: 'mdp__step' }, [el('div', { className: 'mdp__step-label' }, [el('b', { text: String(n) }), label]), content]);
}
function textInput(placeholder, value, onInput) {
  const input = el('input', { className: 'mdp__input', attrs: { value, placeholder, autocapitalize: 'characters', autocomplete: 'off' } });
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

// --- home ---

function homeScreen() {
  const filling = state.totes.filter((t) => t.status === 'filling');
  const free = state.totes.filter((t) => t.status === 'free');
  const inbound = state.inbound || [];
  const unsorted = inbound.filter((p) => !p.toteId); // still loose, awaiting sort
  const sortedWaiting = inbound.filter((p) => p.toteId); // sorted into a destination bag, awaiting load
  const tiles = el('div', { className: 'mdp__tiles' }, [
    tile(unsorted.length, 'To sort', unsorted.length > 0),
    tile(filling.length, 'Outbound bags'),
    tile(free.length, 'Empty totes'),
    tile(state.mdp ? state.mdp.zones.length : 0, 'Zones'),
  ]);

  // Inbound — bags dropped here, parcels still loose and waiting to be sorted.
  const inList = unsorted.length
    ? unsorted.slice(0, 10).map((p) => el('div', { className: 'mdp__inrow' }, [el('span', { className: 'mdp__incode', text: p.parcelId }), el('span', { className: 'mdp__indest', text: `→ ${p.destZone}` })]))
    : [el('div', { className: 'mdp__hint', text: 'Nothing to sort. Drop a bag to unload one.' })];
  if (sortedWaiting.length) inList.push(el('div', { className: 'mdp__hint', style: { paddingTop: '8px' }, text: `${sortedWaiting.length} sorted · waiting in an outbound bag` }));
  const inbCard = el('div', { className: 'mdp__sect mdp__sect--in' }, [
    el('div', { className: 'mdp__sect-h' }, [el('div', { className: 'mdp__sect-t', text: 'Inbound — to sort' }), el('span', { className: 'mdp__count', text: String(unsorted.length) })]),
    el('div', {}, inList),
    el('div', { className: 'mdp__btnrow' }, [
      el('button', { className: 'mdp__ghost', attrs: { type: 'button' }, text: 'Drop a bag', onClick: () => go('drop') }),
      el('button', { className: 'mdp__primary', attrs: { type: 'button', ...(unsorted.length ? {} : { disabled: 'disabled' }) }, text: 'Sort parcels', onClick: () => go('sort') }),
    ]),
  ]);

  // Outbound — destination bags being built, ready to load onward.
  const outList = filling.length
    ? filling.map((t) => el('div', { className: 'mdp__bag' }, [
        el('span', { className: 'mdp__bag-swatch', style: { background: destColor(t.destinationNodeId) } }),
        el('div', { style: { flex: '1' } }, [
          el('div', { className: 'mdp__bag-code', text: t.code }),
          el('div', { className: 'mdp__bag-dest', text: `→ ${t.destinationLabel || 'unassigned'} · ${t.parcels.length} parcel${t.parcels.length === 1 ? '' : 's'}` }),
          el('div', { className: 'mdp__fill' }, [el('span', { style: { width: `${Math.min(100, Math.round((t.unitsUsed / 10) * 100))}%` } })]),
        ]),
      ]))
    : [el('div', { className: 'mdp__hint', text: 'No destination bags yet. Sort parcels to start one.' })];
  const outCard = el('div', { className: 'mdp__sect mdp__sect--out' }, [
    el('div', { className: 'mdp__sect-h' }, [el('div', { className: 'mdp__sect-t', text: 'Outbound — destination bags' }), el('span', { className: 'mdp__count', text: `${filling.length} open · ${free.length} free` })]),
    el('div', { className: 'mdp__bags' }, outList),
    el('div', { className: 'mdp__btnrow' }, [
      el('button', { className: 'mdp__primary', attrs: { type: 'button', ...(filling.length ? {} : { disabled: 'disabled' }) }, text: 'Load a bag', onClick: () => go('load') }),
      el('button', { className: 'mdp__ghost', attrs: { type: 'button' }, text: 'New tote', onClick: () => go('newtote') }),
    ]),
  ]);

  const priceRow = el('div', { className: 'mdp__sect', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
    el('div', { className: 'mdp__sect-t', text: `Sort price per parcel: ${Number(state.mdp?.pricePerParcel ?? 0).toFixed(2)}` }),
    el('div', { className: 'mdp__btnrow', style: { margin: '0' } }, [
      el('button', { className: 'mdp__ghost', attrs: { type: 'button' }, text: 'Rates near you', onClick: () => go('rates') }),
      el('button', { className: 'mdp__ghost', attrs: { type: 'button' }, text: 'Change', onClick: setPrice }),
    ]),
  ]);

  return [topBar(), el('div', { className: 'mdp__body' }, [tiles, priceRow, inbCard, outCard, ReadAloud(() => `${inbound.length} parcels inbound to sort. ${filling.length} outbound bags building.`, { label: 'Read this screen aloud' })])];
}

// --- rates near you (competitive price discovery for MDP sort fees) ---
function rateBar(b, mine) {
  const lo = b.min, hi = b.max, span = Math.max(0.01, hi - lo);
  const at = (v) => Math.min(100, Math.max(0, ((v - lo) / span) * 100));
  const track = el('div', { style: { position: 'relative', height: '34px', margin: '14px 0 6px' } });
  track.append(el('div', { style: { position: 'absolute', top: '14px', left: '0', right: '0', height: '6px', borderRadius: '999px', background: '#E2E2E6' } }));
  track.append(el('div', { style: { position: 'absolute', top: '14px', left: `${at(b.p25)}%`, width: `${at(b.p75) - at(b.p25)}%`, height: '6px', borderRadius: '999px', background: 'rgba(76,70,224,0.30)' } }));
  track.append(el('div', { style: { position: 'absolute', top: '8px', left: `${at(b.median)}%`, width: '3px', height: '18px', background: '#4C46E0' } }));
  track.append(el('div', { style: { position: 'absolute', top: '6px', left: `${at(mine)}%`, transform: 'translateX(-50%)', display: 'grid', justifyItems: 'center' } }, [el('div', { style: { width: '14px', height: '14px', borderRadius: '999px', background: '#FF6200', border: '2px solid #fff' } }), el('div', { style: { fontSize: '0.66rem', fontWeight: '800', color: '#DC4405', marginTop: '2px' }, text: 'you' })]));
  return track;
}
function ratesScreen() {
  const r = state.rates, me = state.mdp;
  const mine = Number(me?.pricePerParcel ?? 0);
  const back = el('button', { style: { background: 'none', border: 'none', color: '#4C46E0', fontWeight: '700', cursor: 'pointer', font: 'inherit', padding: '0 0 8px' }, text: '‹ Back', onClick: () => go('home') });
  const body = [back, el('h2', { style: { margin: '0 0 4px', fontSize: '1.2rem' }, text: 'Sort rates near you' })];
  if (!r) body.push(el('p', { style: { color: '#5A5A64' }, text: 'Loading nearby hubs…' }));
  else if (!r.benchmark || !r.benchmark.count) body.push(el('p', { style: { color: '#5A5A64' }, text: 'No nearby hubs have published a rate yet.' }));
  else {
    const b = r.benchmark;
    const d = b.median > 0 ? Math.round(((mine - b.median) / b.median) * 100) : 0;
    const word = d > 1 ? `${d}% above` : d < -1 ? `${-d}% below` : 'at';
    body.push(el('div', { style: { background: '#fff', border: '1px solid #E2E2E6', borderRadius: '14px', padding: '18px', margin: '8px 0 16px' } }, [
      el('div', { style: { color: '#5A5A64', fontWeight: '700', fontSize: '0.85rem' }, text: `Sort price near you · ${r.radiusKm ? r.radiusKm + ' km' : 'network'} · ${b.count} hubs` }),
      el('div', { style: { fontSize: '1.9rem', fontWeight: '800', color: '#4C46E0', margin: '4px 0' }, text: `median ${b.median.toFixed(2)}` }),
      el('div', { style: { fontSize: '0.85rem', color: '#5A5A64' }, text: `typical ${b.p25.toFixed(2)}–${b.p75.toFixed(2)} · range ${b.min.toFixed(2)}–${b.max.toFixed(2)}` }),
      rateBar(b, mine),
      el('div', { style: { fontWeight: '800', marginTop: '8px', color: d > 1 ? '#DC4405' : '#1FA45A' }, text: `You charge ${mine.toFixed(2)} — ${word} the median.` }),
      Math.abs(d) > 1 ? el('button', { className: 'mdp__primary', style: { marginTop: '10px' }, attrs: { type: 'button' }, text: `Match the median (${b.median.toFixed(2)})`, onClick: () => applyPrice(b.median) }) : null,
    ].filter(Boolean)));
    body.push(el('div', {}, (r.pins || []).filter((p) => p.id !== me?.mdpId).slice(0, 8).map((p) => el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '9px 2px', borderBottom: '1px solid #E2E2E6' } }, [
      el('span', { text: `${p.label}${p.km != null ? ' · ' + p.km + ' km' : ''}` }), el('b', { style: { color: '#4C46E0' }, text: Number(p.price).toFixed(2) }),
    ]))));
  }
  return [topBar(), el('div', { className: 'mdp__body' }, body)];
}
async function applyPrice(price) {
  try { await api(`/mdps/${encodeURIComponent(mdpId)}/pricing`, { method: 'PATCH', body: { price: Math.round(price * 100) / 100 } }); state.msg = { type: 'ok', text: 'Price set to the market median.' }; await loadHub(); await go('rates'); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// Open-data pricing: the hub publishes its own per-parcel sort fee.
async function setPrice() {
  const cur = Number(state.mdp?.pricePerParcel ?? 0).toFixed(2);
  const v = window.prompt('Your sort price per parcel:', cur);
  if (v == null) return;
  const price = Number(v);
  if (!(price >= 0)) { state.msg = { type: 'err', text: 'Enter a valid price.' }; return render(); }
  try { await api(`/mdps/${encodeURIComponent(mdpId)}/pricing`, { method: 'PATCH', body: { price } }); state.msg = { type: 'ok', text: 'Price updated.' }; await loadHub(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}
function tile(value, label, alert = false) {
  return el('div', { className: `mdp__tile${alert ? ' mdp__tile--alert' : ''}` }, [el('div', { className: 'mdp__tile-v', text: String(value) }), el('div', { className: 'mdp__tile-l', text: label })]);
}
function openBagsCard(filling, selectable) {
  const f = state.form;
  return el('div', { className: 'mdp__card' }, [
    el('div', { className: 'mdp__step-label', text: `Open destination bags (${filling.length})` }),
    el('div', { className: 'mdp__bags' }, filling.map((t) => {
      const on = selectable && f.loadCode === t.code;
      return el('div', { className: `mdp__bag${on ? ' is-on' : ''}`, attrs: selectable ? {} : {}, onClick: selectable ? () => { f.loadCode = t.code; render(); } : undefined }, [
        el('span', { className: 'mdp__bag-swatch', style: { background: destColor(t.destinationNodeId) } }),
        el('div', { style: { flex: '1' } }, [
          el('div', { className: 'mdp__bag-code', text: t.code }),
          el('div', { className: 'mdp__bag-dest', text: `→ ${t.destinationLabel || t.destinationNodeId || 'unassigned'} · ${t.parcels.length} parcel${t.parcels.length === 1 ? '' : 's'}` }),
          el('div', { className: 'mdp__fill' }, [el('span', { style: { width: `${Math.min(100, Math.round((t.unitsUsed / 10) * 100))}%` } })]),
        ]),
      ]);
    })),
  ]);
}

// --- drop a bag ---

function dropScreen() {
  const f = state.form;
  const code = textInput('Scan the bag code (BAG-###)', f.dropCode || '', (v) => { f.dropCode = v.trim().toUpperCase(); });
  const body = [headerRow('Drop a bag'), el('div', { className: 'mdp__card' }, [
    step(1, 'Bag code', code),
    el('button', { className: 'mdp__primary', attrs: { type: 'button' }, text: 'Empty this bag', onClick: submitDrop }),
    el('div', { className: 'mdp__hint', text: 'The bag is emptied and freed for reuse. Its parcels go to the sort queue.' }),
  ])];
  if (state.toSort.length) {
    body.push(el('div', { className: 'mdp__card' }, [
      el('div', { className: 'mdp__msg mdp__msg--ok', text: `${state.toSort.length} parcel(s) emptied — ready to sort.` }),
      el('div', { className: 'mdp__queue' }, state.toSort.map((id) => el('span', { className: 'mdp__qchip', text: id }))),
      el('button', { className: 'mdp__primary', attrs: { type: 'button' }, text: 'Start sorting →', onClick: () => go('sort') }),
    ]));
  }
  return [topBar(), el('div', { className: 'mdp__body' }, body)];
}
async function submitDrop() {
  const f = state.form;
  if (!f.dropCode) { state.msg = { type: 'err', text: 'Scan the bag code first.' }; return render(); }
  try {
    const r = await api(`/mdps/${encodeURIComponent(mdpId)}/drop-bag`, { method: 'POST', body: { code: f.dropCode } });
    feedback();
    state.toSort = [...new Set([...state.toSort, ...(r.emptied || [])])];
    f.dropCode = '';
    await refreshCounts();
    render();
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- sort loop ---

function sortScreen() {
  const f = state.form;
  const parcel = textInput('Scan a parcel sticker', f.sortId || '', (v) => { f.sortId = v.trim().toUpperCase(); });
  const body = [headerRow('Sort parcels')];

  if (state.last) {
    const c = destColor(state.last.nextDestination.id);
    body.push(el('div', { className: 'mdp__place', style: { background: c } }, [
      el('div', { className: 'mdp__place-k', text: 'Place in bag' }),
      el('div', { className: 'mdp__place-bag', text: state.last.toteCode }),
      el('div', { className: 'mdp__place-dest', text: `→ ${state.last.nextDestination.label} (${state.last.nextDestination.type === 'pudo' ? 'last mile' : 'onward hub'})` }),
      el('div', { className: 'mdp__place-meta', text: `Parcel ${state.last.parcelId} · bag ${state.last.fillPct}% full` }),
    ]));
  }

  body.push(el('div', { className: 'mdp__card' }, [
    step(1, `Scan the next parcel (${state.toSort.length} queued)`, parcel),
    el('button', { className: 'mdp__primary', attrs: { type: 'button' }, text: 'Sort — where does it go?', onClick: submitSort }),
    state.toSort.length ? el('div', { className: 'mdp__queue' }, state.toSort.slice(0, 12).map((id) => el('span', { className: 'mdp__qchip', text: id, onClick: () => { f.sortId = id; render(); } })) ) : el('div', { className: 'mdp__hint', text: 'Queue empty — scan any At_MDP parcel to sort it.' }),
  ]));

  const filling = state.totes.filter((t) => t.status === 'filling');
  if (filling.length) body.push(openBagsCard(filling, false));
  return [topBar(), el('div', { className: 'mdp__body' }, body)];
}
async function submitSort() {
  const f = state.form;
  if (!f.sortId) { state.msg = { type: 'err', text: 'Scan a parcel first.' }; return render(); }
  try {
    const r = await api(`/mdps/${encodeURIComponent(mdpId)}/sort`, { method: 'POST', body: { parcelId: f.sortId } });
    feedback();
    state.last = r;
    state.toSort = state.toSort.filter((id) => id !== f.sortId);
    f.sortId = '';
    await refreshTotes();
    await refreshCounts();
    render();
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- load a bag onward ---

function loadScreen() {
  const f = state.form;
  const filling = state.totes.filter((t) => t.status === 'filling' && t.parcels.length);
  const badge = textInput('Scan the driver badge', f.badge || '', (v) => { f.badge = v.trim().toUpperCase(); });
  const body = [headerRow('Load a bag onward')];
  if (!filling.length) body.push(el('div', { className: 'mdp__card' }, [el('div', { className: 'mdp__hint', text: 'No full bags ready to load.' })]));
  else {
    body.push(openBagsCard(filling, true));
    body.push(el('div', { className: 'mdp__card' }, [
      step(1, 'Driver badge', badge),
      el('button', { className: 'mdp__primary', attrs: { type: 'button', ...(f.loadCode && f.badge ? {} : { disabled: 'disabled' }) }, text: f.loadCode ? `Load ${f.loadCode} onto the bus` : 'Pick a bag above', onClick: submitLoad }),
      el('div', { className: 'mdp__hint', text: 'One scan moves the whole bag — every parcel inside goes On the bus.' }),
    ]));
  }
  return [topBar(), el('div', { className: 'mdp__body' }, body)];
}
async function submitLoad() {
  const f = state.form;
  if (!f.loadCode || !f.badge) { state.msg = { type: 'err', text: 'Pick a bag and scan the driver badge.' }; return render(); }
  try {
    const r = await api(`/totes/${encodeURIComponent(f.loadCode)}/load`, { method: 'POST', body: { driverBadgeId: f.badge } });
    feedback();
    state.msg = { type: 'ok', text: `${f.loadCode} on the bus → ${r.tote.destinationLabel || ''} (${r.moved.length} parcel${r.moved.length === 1 ? '' : 's'}).` };
    state.form = {};
    await refreshTotes();
    go('home');
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- new tote ---

function newToteScreen() {
  const body = [headerRow('New tote'), el('div', { className: 'mdp__card' }, [
    el('div', { className: 'mdp__hint', text: 'Registers a fresh reusable tote into this hub. Print the QR, laminate it, slot it into the bag pocket.' }),
    el('button', { className: 'mdp__primary', attrs: { type: 'button' }, text: 'Register a tote', onClick: submitNewTote }),
  ])];
  if (state.last && state.last.toteId && state.last.code) {
    body.push(el('div', { className: 'mdp__card' }, [
      el('div', { className: 'mdp__msg mdp__msg--ok', text: 'Tote registered — print + laminate this:' }),
      el('div', { style: { textAlign: 'center', display: 'grid', gap: '6px' } }, [
        el('div', { className: 'mdp__place-bag', style: { color: 'var(--forest)' }, text: state.last.code }),
        el('div', { className: 'mdp__hint', text: state.last.toteId }),
      ]),
    ]));
  }
  return [topBar(), el('div', { className: 'mdp__body' }, body)];
}
async function submitNewTote() {
  try {
    const t = await api(`/mdps/${encodeURIComponent(mdpId)}/totes`, { method: 'POST' });
    feedback();
    state.last = t;
    await refreshTotes();
    render();
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- helpers ---

async function refreshTotes() {
  try { state.totes = (await api(`/totes?location=${encodeURIComponent(mdpId)}`)) || []; } catch { /* keep stale */ }
}
async function refreshCounts() {
  try { state.awaiting = ((await api('/parcels?status=At_MDP')) || []).length; } catch { /* keep stale */ }
}

async function go(screen) {
  state.screen = screen;
  if (screen === 'newtote') state.last = null;
  if (screen === 'rates') { state.rates = null; render(); try { const here = state.mdp?.location; const qs = here ? `&lat=${here.lat}&lng=${here.lng}` : ''; state.rates = await api(`/pricing/near?type=mdp${qs}`); } catch { state.rates = null; } }
  if (screen === 'home' || screen === 'load' || screen === 'sort') await refreshTotes();
  if (screen === 'home') await refreshCounts();
  render();
}

function render() {
  const screens = { home: homeScreen, drop: dropScreen, sort: sortScreen, load: loadScreen, newtote: newToteScreen, rates: ratesScreen };
  const parts = (screens[state.screen] || homeScreen)();
  if (state.msg) {
    const banner = el('div', { className: 'mdp__body', style: { paddingBottom: '0' } }, [el('div', { className: `mdp__msg mdp__msg--${state.msg.type}`, text: state.msg.text })]);
    parts.splice(1, 0, banner);
    state.msg = null;
  }
  mount(root, parts);
}

loadHub();
