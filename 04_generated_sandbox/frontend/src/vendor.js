// GLOS Merchant Console — wire an online store into PUDO click-and-collect. Two working screens:
//   • New shipment — mint a parcel. Origin PUDO is chosen on a map near the store (not a dropdown that
//     can't scale to thousands). The destination is the buyer's choice, fed in from the embedded checkout
//     node (the "incoming orders" inbox) or entered manually. Size is DERIVED from dimensions+weight (no
//     subjective S/M/L dispute). A content photo is captured for dispute defence. The mint returns the
//     persisted label, the handover collection code, the public tracking key, and the split settlement.
//   • Orders — watch-only status; click a row to see everything captured at mint + the dispute photo.
// Plus a Store tab: credentials, map pin (origin ranking), and the split/contribution policy.
// PUDO endpoints are DID-authenticated, so the console fetches a token first.

import { el, mount } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const STORE_KEY = 'glos_pudo_vendor';
const root = document.getElementById('vendor');
const BASE = { lat: -1.28, lng: 36.82 }, SPAN = 0.6; // network centroid bounding box (shared with onboarding)

const state = {
  vendor: loadVendor(),
  agents: [],
  orders: [],
  callbacks: [],
  checkouts: [],
  view: 'mint', // mint | orders | store
  detail: null, // a full parcel when drilling into an order
  label: null,
  lastSettlement: null,
  quote: null, // route quote (flexible vs locked) for the current origin+dest+size
  originPrices: {}, // did → full cost per drop-off PUDO candidate (against the chosen destination)
  balance: 0, // prepaid balance with the daughter company
  settlement: [], // settlement book entries
  form: blankForm(),
  profile: null,
  secretShown: false,
  msg: null,
};

function blankForm() {
  return { source: 'manual', originDid: '', destDid: '', buyerEmail: '', buyerMobile: '', externalOrderId: '', items: [{ name: '', qty: 1 }], dims: { l: '', w: '', h: '' }, weightKg: '', size: null, routeMode: 'flexible', contentRef: null, contentName: null, subtotal: '' };
}
function loadVendor() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; } }
function saveVendor(v) { state.vendor = v; localStorage.setItem(STORE_KEY, JSON.stringify(v)); }

let token = null;
async function getToken() {
  if (token) return token;
  const res = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'merchant-console', type: 'client_credentials' }) });
  token = (await res.json()).access_token;
  return token;
}
async function api(path, { method = 'GET', body } = {}) {
  const t = await getToken();
  const res = await fetch(`${API}/pudo${path}`, { method, headers: { Authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Error ${res.status}`);
  return data;
}
function fail(e) { const m = String(e.message || e); state.msg = { type: 'err', text: m.includes('Failed to fetch') ? 'Cannot reach the server. Start the backend.' : m }; }

async function init() {
  const qsVendor = new URLSearchParams(location.search).get('vendor');
  try { state.agents = await api('/agents'); } catch (e) { fail(e); }
  if (qsVendor && (!state.vendor || state.vendor.vendorId !== qsVendor)) {
    try { saveVendor(await api(`/vendors/${encodeURIComponent(qsVendor)}`)); } catch (e) { fail(e); }
  }
  if (state.vendor) await refreshAll();
  render();
}
async function refreshAll() {
  if (!state.vendor) return;
  const id = state.vendor.vendorId;
  try {
    const [orders, callbacks, checkouts, settle] = await Promise.all([
      api(`/vendors/${id}/orders`),
      api(`/vendors/${id}/callbacks`).catch(() => []),
      api(`/vendors/${id}/checkouts`).catch(() => []),
      api(`/vendors/${id}/settlement`).catch(() => ({ balance: 0, entries: [] })),
    ]);
    state.orders = orders; state.callbacks = callbacks; state.checkouts = checkouts;
    state.balance = settle.balance; state.settlement = settle.entries;
  } catch { /* keep */ }
}

// Re-price on any change: the full origin→dest route quote (panel + tail), and a per-origin-pin price
// (each drop-off candidate quoted against the chosen destination) so the map carries real totals.
async function maybeQuote() {
  const f = state.form;
  const sz = f.size || 'M';
  if (f.originDid && f.destDid) { try { state.quote = await api(`/quote?origin=${f.originDid}&dest=${f.destDid}&size=${sz}`); } catch { state.quote = null; } } else state.quote = null;
  if (f.destDid) {
    const origins = ranked(state.vendor.location).slice(0, 6).map((a) => a.did);
    try { const r = await api(`/quote/options?dest=${f.destDid}&origins=${origins.join(',')}&size=${sz}`); state.originPrices = {}; (r.options || []).forEach((o) => { if (o.quote) state.originPrices[o.did] = o.quote.flexible.total; }); } catch { /* keep */ }
  } else state.originPrices = {};
  render();
}

// The route "tail" — each stop + its open-data fee, each leg + its km, summing to the chosen quote.
function routeTail(q) {
  if (!q) return null;
  const rows = [];
  q.nodes.forEach((n, i) => {
    rows.push(el('div', { className: 'vn__tail-node' }, [el('span', { text: `${n.type === 'mdp' ? '◆ hub' : '● PUDO'} · ${n.label}` }), el('b', { text: n.fee.toFixed(2) })]));
    if (q.legs[i]) rows.push(el('div', { className: 'vn__tail-leg', text: `│ ${q.legs[i].km} km` }));
  });
  const chosen = chosenQuote();
  return el('div', { className: 'vn__tail' }, [...rows, el('div', { className: 'vn__tail-sum', text: `nodes ${q.nodeFees.toFixed(2)} + transport ${chosen ? chosen.transport.toFixed(2) : '—'} + 2% = ${chosen ? chosen.total.toFixed(2) : '—'} (${state.form.routeMode})` })]);
}
function chosenQuote() { return state.quote ? (state.form.routeMode === 'locked' ? state.quote.locked : state.quote.flexible) : null; }
// What the buyer is charged at checkout (reported only); the vendor always settles the full cost.
function buyerChargeFor(cost) {
  const p = state.vendor?.shippingPolicy; if (!p || cost == null) return null;
  if (p.mode === 'full') return cost;
  if (Number(state.form.subtotal) >= p.freeOverSubtotal) return 0;
  return Math.min(p.buyerContributionCap, cost);
}

// --- geo helpers ---
function pos(loc) {
  if (!loc) return { x: 50, y: 50 };
  const x = ((loc.lng - (BASE.lng - SPAN / 2)) / SPAN) * 100;
  const y = ((BASE.lat + SPAN / 2 - loc.lat) / SPAN) * 100;
  return { x: Math.min(96, Math.max(4, x)), y: Math.min(92, Math.max(8, y)) };
}
function km(a, b) {
  if (!a || !b) return null;
  const dLat = (a.lat - b.lat) * 111, dLng = (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.round(Math.sqrt(dLat * dLat + dLng * dLng) * 10) / 10;
}
function ranked(from) {
  return state.agents.map((a) => ({ ...a, _km: km(a.location, from) })).sort((x, y) => (x._km ?? 1e9) - (y._km ?? 1e9));
}
function agentName(did) { const a = state.agents.find((x) => x.did === did); return a ? a.shopName : did; }

// A map of PUDO dots + a ranked shortlist; clicking either selects the PUDO. `from` ranks by distance.
// `prices` (optional did→cost) prints a real total on each pin + row.
function pudoPicker(selectedDid, onPick, from, prices) {
  const list = ranked(from);
  const surface = el('div', { className: 'vn__surface' });
  list.forEach((a, i) => {
    const { x, y } = pos(a.location);
    const dot = el('div', { className: `vn__dot ${selectedDid === a.did ? 'vn__dot--on' : ''}`, text: String(i + 1), attrs: { title: a.shopName }, onClick: () => onPick(a.did) });
    dot.style.left = `${x}%`; dot.style.top = `${y}%`;
    surface.append(dot);
    if (prices && prices[a.did] != null) { const tag = el('div', { className: 'vn__tag', text: prices[a.did].toFixed(2) }); tag.style.left = `${x}%`; tag.style.top = `${y}%`; surface.append(tag); }
  });
  const rows = list.slice(0, 6).map((a, i) => el('button', { className: `vn__pudo-row ${selectedDid === a.did ? 'vn__pudo-row--on' : ''}`, attrs: { type: 'button' }, onClick: () => onPick(a.did) }, [
    el('div', {}, [el('div', { className: 'vn__label', text: `${i + 1}. ${a.shopName}` }), el('div', { className: 'vn__handoff-sub', text: `${a.zone}${a.landmark ? ' · ' + a.landmark : ''}${a._km != null ? ' · ' + a._km + ' km' : ''}` })]),
    prices && prices[a.did] != null ? el('div', { className: 'vn__pudo-km', style: { color: 'var(--pnl-indigo)', fontWeight: '800' }, text: prices[a.did].toFixed(2) }) : (a._km != null ? el('div', { className: 'vn__pudo-km', text: `${a._km} km` }) : null),
  ]));
  return el('div', {}, [el('div', { className: 'vn__map' }, [surface]), el('div', { className: 'vn__maplist' }, rows)]);
}

// --- store connect / profile ---

function connectCard() {
  const name = input('Store name', '');
  const cb = input('Status callback URL', 'https://your-store.example/glos/webhook');
  const addr = input('Store address', '');
  const pf = { lat: null, lng: null, _px: null, _py: null };
  const surface = el('div', { className: 'vn__surface' });
  const paint = () => { surface.replaceChildren(); if (pf._px != null) { const pin = el('span', { className: 'vn__pin', text: '📍' }); pin.style.left = `${pf._px}%`; pin.style.top = `${pf._py}%`; surface.append(pin); } };
  surface.addEventListener('click', (e) => {
    const r = surface.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 100, py = ((e.clientY - r.top) / r.height) * 100;
    pf.lng = Math.round((BASE.lng - SPAN / 2 + (px / 100) * SPAN) * 1e5) / 1e5;
    pf.lat = Math.round((BASE.lat + SPAN / 2 - (py / 100) * SPAN) * 1e5) / 1e5;
    pf._px = px; pf._py = py; paint();
  });
  paint();
  return el('div', { className: 'vn__card' }, [
    el('h2', { className: 'vn__card-h', text: 'Connect your store' }),
    el('p', { className: 'vn__card-hint', text: 'Register once to get a vendor ID + signing secret. Drop a pin on your store so we can rank pick-up points near you.' }),
    field('Store name', name),
    field('Store address', addr),
    field('Status callback URL (optional)', cb),
    el('div', { className: 'vn__field' }, [el('span', { className: 'vn__label', text: 'Store location' }), el('div', { className: 'vn__map' }, [surface])]),
    el('button', { className: 'vn__btn', text: 'Register store', onClick: async () => {
      if (!name.value.trim()) { state.msg = { type: 'err', text: 'Enter a store name.' }; return render(); }
      try {
        const v = await api('/vendors', { method: 'POST', body: { name: name.value.trim(), callbackUrl: cb.value.trim() || undefined, address: addr.value.trim() || undefined, location: pf.lat != null ? { lat: pf.lat, lng: pf.lng } : undefined } });
        saveVendor(v); state.msg = { type: 'ok', text: 'Store connected. Keep your signing secret safe.' }; await refreshAll(); render();
      } catch (e) { fail(e); render(); }
    } }),
  ]);
}

function storeTab() {
  const v = state.vendor;
  if (!state.profile) state.profile = { callbackUrl: v.callbackUrl || '', address: v.address || '', lat: v.location?.lat ?? null, lng: v.location?.lng ?? null, _px: null, _py: null, mode: v.shippingPolicy?.mode || 'capped', freeOver: v.shippingPolicy?.freeOverSubtotal ?? 50, cap: v.shippingPolicy?.buyerContributionCap ?? 3, topUp: '' };
  const pf = state.profile;
  if (pf._px == null && pf.lat != null) { const p = pos({ lat: pf.lat, lng: pf.lng }); pf._px = p.x; pf._py = p.y; }

  const surface = el('div', { className: 'vn__surface' });
  const paint = () => { surface.replaceChildren(); if (pf._px != null) { const pin = el('span', { className: 'vn__pin', text: '📍' }); pin.style.left = `${pf._px}%`; pin.style.top = `${pf._py}%`; surface.append(pin); } };
  surface.addEventListener('click', (e) => {
    const r = surface.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 100, py = ((e.clientY - r.top) / r.height) * 100;
    pf.lng = Math.round((BASE.lng - SPAN / 2 + (px / 100) * SPAN) * 1e5) / 1e5;
    pf.lat = Math.round((BASE.lat + SPAN / 2 - (py / 100) * SPAN) * 1e5) / 1e5;
    pf._px = px; pf._py = py; paint();
  });
  paint();

  const cb = input('Callback URL', pf.callbackUrl); cb.addEventListener('input', () => { pf.callbackUrl = cb.value; });
  const addr = input('Store address', pf.address); addr.addEventListener('input', () => { pf.address = addr.value; });
  const free = input('Free delivery over (order value)', String(pf.freeOver), 'number'); free.addEventListener('input', () => { pf.freeOver = Number(free.value) || 0; });
  const cap = input('Max buyer contribution', String(pf.cap), 'number'); cap.addEventListener('input', () => { pf.cap = Number(cap.value) || 0; });
  const topUp = input('Amount', String(pf.topUp), 'number'); topUp.addEventListener('input', () => { pf.topUp = topUp.value; });
  const modeBtn = (m, label) => el('button', { className: `vn__tab ${pf.mode === m ? 'vn__tab--on' : ''}`, attrs: { type: 'button' }, text: label, onClick: () => { pf.mode = m; render(); } });

  return el('div', {}, [
    // Prepaid balance with the per-country daughter company (the ParcelPaid gate).
    el('div', { className: 'vn__card' }, [
      el('h2', { className: 'vn__card-h', text: `Prepaid balance · ${v.country || 'KE'}` }),
      el('p', { className: 'vn__card-hint', text: 'You settle the full shipment cost in advance with the GLOS daughter company. A shipment only prints once it is ParcelPaid. GLOS reports the price; it never holds your money.' }),
      el('div', { className: 'vn__size', style: { justifyContent: 'space-between' } }, [el('span', { className: 'vn__size-note', text: 'Available' }), el('span', { className: 'vn__size-chip', style: { fontSize: '1.1rem' }, text: state.balance.toFixed(2) })]),
      el('div', { className: 'vn__row', style: { marginTop: '12px', alignItems: 'end' } }, [field('Top up', topUp), el('button', { className: 'vn__btn', text: 'Prepay', onClick: async () => {
        const amt = Number(pf.topUp); if (!amt || amt <= 0) { state.msg = { type: 'err', text: 'Enter a top-up amount.' }; return render(); }
        try { await api(`/vendors/${v.vendorId}/top-up`, { method: 'POST', body: { amount: amt } }); pf.topUp = ''; state.msg = { type: 'ok', text: `Prepaid ${amt.toFixed(2)}.` }; await refreshAll(); render(); } catch (e) { fail(e); render(); }
      } })]),
      state.settlement.length ? el('table', { className: 'vn__table', style: { marginTop: '14px' } }, [
        el('thead', {}, [el('tr', {}, ['Entry', 'Parcel', 'Amount', 'When'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, state.settlement.slice(0, 8).map((s) => el('tr', {}, [
          el('td', {}, [el('span', { className: `vn__pill vn__pill--${s.type === 'TOP_UP' ? 'done' : s.type === 'REBATE' ? 'ready' : 'move'}`, text: s.type.replace('_', ' ').toLowerCase() })]),
          el('td', {}, [el('span', { className: 'vn__mono', text: s.parcelId || '—' })]),
          el('td', { text: `${s.sign}${Number(s.amount).toFixed(2)}` }),
          el('td', { text: fmtTime(s.at) }),
        ]))),
      ]) : null,
    ].filter(Boolean)),
    el('div', { className: 'vn__card' }, [
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'start' } }, [
        el('div', {}, [el('h2', { className: 'vn__card-h', text: v.name }), el('p', { className: 'vn__card-hint', text: 'Connected store' })]),
        el('button', { className: 'vn__btn vn__btn--ghost', text: 'Disconnect', onClick: () => { localStorage.removeItem(STORE_KEY); state.vendor = null; state.orders = []; state.callbacks = []; state.checkouts = []; state.profile = null; render(); } }),
      ]),
      el('dl', { className: 'vn__cred' }, [
        el('dt', { text: 'Vendor ID' }), el('dd', { text: v.vendorId }),
        el('dt', { text: 'Signing secret' }), el('dd', {}, [
          state.secretShown ? el('span', { text: v.secret }) : el('span', { text: '••••••••••••••••' }),
          el('button', { className: 'vn__reveal', style: { marginLeft: '10px' }, text: state.secretShown ? 'Hide' : 'Reveal', onClick: () => { state.secretShown = !state.secretShown; render(); } }),
        ]),
        el('dt', { text: 'Checkout node' }), el('dd', {}, [el('a', { className: 'vn__doc', attrs: { href: `./checkout.html?vendor=${v.vendorId}`, target: '_blank' }, text: '↗ Open buyer pick-up picker (embed this in checkout)' })]),
      ]),
    ]),
    el('div', { className: 'vn__card' }, [
      el('h2', { className: 'vn__card-h', text: 'Store location & checkout charge' }),
      el('p', { className: 'vn__card-hint', text: 'The pin ranks pick-up points near you. The checkout charge is what your buyer pays (your income) — you always settle the full cost to GLOS.' }),
      field('Store address', addr),
      el('div', { className: 'vn__field' }, [el('span', { className: 'vn__label', text: 'Store location (tap to move the pin)' }), el('div', { className: 'vn__map' }, [surface])]),
      el('div', { className: 'vn__field' }, [el('span', { className: 'vn__label', text: 'Buyer pays at checkout' }), el('div', { className: 'vn__tabs', style: { marginBottom: '0' } }, [modeBtn('full', 'Full shipping'), modeBtn('capped', 'Capped contribution')])]),
      pf.mode === 'capped' ? el('div', { className: 'vn__row' }, [field('Free delivery over', free), field('Max buyer contribution', cap)]) : null,
      field('Status callback URL', cb),
      el('button', { className: 'vn__btn', text: 'Save store profile', onClick: async () => {
        try {
          const v2 = await api(`/vendors/${v.vendorId}`, { method: 'PATCH', body: { callbackUrl: pf.callbackUrl.trim(), address: pf.address.trim(), location: pf.lat != null ? { lat: pf.lat, lng: pf.lng } : undefined, shippingPolicy: { mode: pf.mode, freeOverSubtotal: pf.freeOver, buyerContributionCap: pf.cap } } });
          saveVendor(v2); state.msg = { type: 'ok', text: 'Store profile saved.' }; render();
        } catch (e) { fail(e); render(); }
      } }),
    ].filter(Boolean)),
  ]);
}

// --- new shipment ---

function inboxCard() {
  if (!state.checkouts.length) {
    return el('div', { className: 'vn__card' }, [
      el('h2', { className: 'vn__card-h', text: 'Incoming orders' }),
      el('p', { className: 'vn__card-hint', text: 'When a buyer picks a pick-up point in your checkout, it lands here with their email + destination — ready to ship in one tap. Test it via the checkout node link in the Store tab.' }),
      el('div', { className: 'vn__empty', text: 'No incoming pick-up selections yet.' }),
    ]);
  }
  return el('div', { className: 'vn__card' }, [
    el('h2', { className: 'vn__card-h', text: `Incoming orders (${state.checkouts.length})` }),
    el('p', { className: 'vn__card-hint', text: 'Buyer pick-up selections from your checkout. Tap one to load it into the shipment form — destination + email are filled automatically.' }),
    ...state.checkouts.map((c) => el('div', { className: `vn__handoff ${state.form.source === c.id ? 'vn__handoff--on' : ''}` }, [
      el('div', {}, [
        el('div', { className: 'vn__handoff-em', text: c.buyerEmail }),
        el('div', { className: 'vn__handoff-sub', text: `${c.externalOrderId || '—'} · to ${agentName(c.destAgentDid)}${c.subtotal != null ? ' · order ' + Number(c.subtotal).toFixed(2) : ''}` }),
      ]),
      el('button', { className: 'vn__btn vn__btn--ghost', text: state.form.source === c.id ? 'Loaded' : 'Load', onClick: () => loadHandoff(c) }),
    ])),
  ]);
}

function loadHandoff(c) {
  const f = state.form;
  f.source = c.id; f.destDid = c.destAgentDid; f.buyerEmail = c.buyerEmail; f.buyerMobile = c.buyerMobile || ''; f.externalOrderId = c.externalOrderId || '';
  f.subtotal = c.subtotal != null ? String(c.subtotal) : ''; if (c.items?.length) f.items = c.items.map((it) => ({ ...it }));
  maybeQuote();
}

async function classify() {
  const f = state.form; const { l, w, h } = f.dims; const kg = f.weightKg;
  if (!l || !w || !h || !kg) { f.size = null; return maybeQuote(); }
  try { const r = await api('/size/classify', { method: 'POST', body: { l: Number(l), w: Number(w), h: Number(h), kg: Number(kg) } }); f.size = r.size; } catch { f.size = null; }
  maybeQuote();
}

function mintCard() {
  const f = state.form;
  const manual = f.source === 'manual';

  // Destination block: auto from a loaded handoff, or a manual map picker + email.
  const destBlock = manual
    ? el('div', {}, [
        el('p', { className: 'vn__card-hint', text: "No incoming order loaded — enter the buyer's choice the old-fashioned way." }),
        el('div', { className: 'vn__field' }, [el('span', { className: 'vn__label', text: "Destination PUDO (buyer's pick-up point)" }), pudoPicker(f.destDid, (did) => { f.destDid = did; maybeQuote(); }, state.vendor.location)]),
        field("Buyer's email (for the collection code)", bound('you@example.com', f.buyerEmail, (v) => { f.buyerEmail = v; }, 'email')),
        el('div', { className: 'vn__row' }, [field('Order reference', bound('e.g. #1043', f.externalOrderId, (v) => { f.externalOrderId = v; })), field('Order value (for split)', bound('e.g. 42.00', f.subtotal, (v) => { f.subtotal = v; }, 'number'))]),
      ])
    : el('div', { className: 'vn__money', style: { borderColor: 'rgba(76,70,224,0.25)', background: 'rgba(76,70,224,0.05)' } }, [
        el('div', { className: 'vn__money-row' }, [el('span', { text: 'From checkout' }), el('b', { text: f.buyerEmail })]),
        el('div', { className: 'vn__money-row' }, [el('span', { text: 'Destination' }), el('b', { text: agentName(f.destDid) })]),
        el('div', { className: 'vn__money-row' }, [el('span', { text: 'Order' }), el('b', { text: `${f.externalOrderId || '—'}${f.subtotal ? ' · ' + Number(f.subtotal).toFixed(2) : ''}` })]),
        el('button', { className: 'vn__reveal', style: { justifySelf: 'start' }, text: 'Clear / enter manually', onClick: () => { state.form = { ...blankForm(), originDid: f.originDid }; render(); } }),
      ]);

  // Dimensions → derived size.
  const dim = (k, ph) => bound(ph, f.dims[k], (v) => { f.dims[k] = v; classify(); }, 'number');
  const sizeReadout = f.size
    ? el('div', { className: 'vn__size' }, [el('span', { className: 'vn__size-chip', text: f.size }), el('span', { className: 'vn__size-note', text: 'Derived from your measurements — the size tier can’t be disputed.' })])
    : el('div', { className: 'vn__size' }, [el('span', { className: 'vn__size-note', text: 'Enter length, width, height (cm) and weight (kg) — we set the size tier, so it can’t be disputed.' })]);

  // Content photo (dispute baseline). Stored as a data URL so it is genuinely retrievable later.
  const fileIn = el('input', { attrs: { type: 'file', accept: 'image/*' }, style: { display: 'none' } });
  fileIn.addEventListener('change', () => { const file = fileIn.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { f.contentRef = String(reader.result); f.contentName = file.name; render(); }; reader.readAsDataURL(file); });
  const photoBlock = el('div', { className: 'vn__photo' }, [
    fileIn,
    el('button', { className: 'vn__photo-btn', attrs: { type: 'button' }, text: f.contentRef ? '↻ Replace photo' : '📷 Capture contents', onClick: () => fileIn.click() }),
    f.contentRef ? el('img', { className: 'vn__thumb', attrs: { src: f.contentRef, alt: 'contents' } }) : el('span', { className: 'vn__size-note', text: 'Required — the baseline for any dispute.' }),
  ]);

  const items = f.items.map((it, i) => el('div', { className: 'vn__item-row' }, [
    bound('Item', it.name, (v) => { it.name = v; }),
    bound('Qty', String(it.qty), (v) => { it.qty = Number(v) || 1; }, 'number'),
    el('button', { className: 'vn__x', attrs: { type: 'button', 'aria-label': 'remove' }, text: '×', onClick: () => { f.items.splice(i, 1); if (!f.items.length) f.items.push({ name: '', qty: 1 }); render(); } }),
  ]));

  const chosen = chosenQuote();
  const shortfall = chosen ? chosen.total - state.balance : 0;
  const canMint = chosen && shortfall <= 1e-9 && f.contentRef && f.originDid && f.destDid;
  const mintBtn = el('button', { className: 'vn__btn', attrs: canMint ? {} : { disabled: 'true' }, text: 'Create shipment & generate label', onClick: mint });

  return el('div', { className: 'vn__card' }, [
    el('h2', { className: 'vn__card-h', text: 'Create a shipment' }),
    el('p', { className: 'vn__card-hint', text: 'Open-data pricing. You prepay the full cost to GLOS; the buyer’s share is collected at your checkout (it’s your income). GLOS never holds the money.' }),
    el('div', { className: 'vn__field' }, [el('span', { className: 'vn__label', text: 'Origin PUDO (where you drop the parcel)' }), f.destDid ? null : el('span', { className: 'vn__size-note', text: 'Set the destination first to price each drop-off point.' }), pudoPicker(f.originDid, (did) => { f.originDid = did; maybeQuote(); }, state.vendor.location, state.originPrices)].filter(Boolean)),
    destBlock,
    el('div', { className: 'vn__field', style: { marginTop: '14px' } }, [el('span', { className: 'vn__label', text: 'Size — dimensions (cm) & weight (kg)' }), el('div', { className: 'vn__seg' }, [dim('l', 'Length'), dim('w', 'Width'), dim('h', 'Height'), bound('Weight kg', f.weightKg, (v) => { f.weightKg = v; classify(); }, 'number')]), sizeReadout]),
    quotePanel(),
    el('div', { className: 'vn__field' }, [el('span', { className: 'vn__label', text: 'Content photo' }), photoBlock]),
    el('div', { className: 'vn__field' }, [el('span', { className: 'vn__label', text: 'Items (optional)' }), el('div', {}, items), el('button', { className: 'vn__btn vn__btn--ghost', style: { marginTop: '4px' }, text: '+ Add item', onClick: () => { f.items.push({ name: '', qty: 1 }); render(); } })]),
    field("Buyer's mobile (optional)", bound('+254…', f.buyerMobile, (v) => { f.buyerMobile = v; })),
    chosen && shortfall > 1e-9 ? el('div', { className: 'vn__msg vn__msg--err', style: { marginBottom: '10px' } }, [`Prepaid balance ${state.balance.toFixed(2)} is short by ${shortfall.toFixed(2)}. `, el('button', { className: 'vn__reveal', text: 'Top up in Store →', onClick: () => { state.view = 'store'; render(); } })]) : null,
    mintBtn,
    state.label ? labelOut() : null,
  ].filter(Boolean));
}

// The open-data quote: pick Flexible (any carrier @ ceiling, rebated on delivery) vs Locked (cheapest route).
function quotePanel() {
  const q = state.quote;
  if (!q) return el('div', { className: 'vn__size', style: { marginTop: '12px' } }, [el('span', { className: 'vn__size-note', text: 'Pick origin + destination + size to price the route from live participant rates.' })]);
  const f = state.form;
  const opt = (mode, leg, title, sub) => {
    const on = f.routeMode === mode;
    return el('button', { className: `vn__pudo-row ${on ? 'vn__pudo-row--on' : ''}`, attrs: { type: 'button' }, style: { marginBottom: '6px' }, onClick: () => { f.routeMode = mode; render(); } }, [
      el('div', {}, [el('div', { className: 'vn__label', text: `${title} · ${leg.total.toFixed(2)}` }), el('div', { className: 'vn__handoff-sub', text: sub })]),
      el('div', { className: 'vn__pudo-km', text: on ? '✓' : '' }),
    ]);
  };
  const chosen = chosenQuote();
  const buyer = buyerChargeFor(chosen?.total);
  return el('div', { className: 'vn__field', style: { marginTop: '12px' } }, [
    el('span', { className: 'vn__label', text: `Routing & price — ${q.totalKm} km · nodes ${q.nodeFees.toFixed(2)}` }),
    opt('flexible', q.flexible, 'Flexible (any carrier)', 'Reserves the dearest rate; the over-hold is rebated after delivery.'),
    opt('locked', q.locked, 'Cheapest route', 'Commits the cheapest carrier — you settle this exact amount.'),
    routeTail(q),
    el('div', { className: 'vn__money' }, [
      el('div', { className: 'vn__money-row' }, [el('span', { text: 'You prepay (full cost)' }), el('b', { text: (chosen?.total ?? 0).toFixed(2) })]),
      el('div', { className: 'vn__money-row' }, [el('span', { text: 'Buyer pays at checkout (your income)' }), el('b', { text: buyer != null ? buyer.toFixed(2) : '—' })]),
      el('div', { className: 'vn__money-row' }, [el('span', { text: 'Your net delivery cost' }), el('b', { text: buyer != null ? ((chosen?.total ?? 0) - buyer).toFixed(2) : '—' })]),
    ]),
  ]);
}

async function mint() {
  const f = state.form;
  if (!state.vendor) { state.msg = { type: 'err', text: 'Connect your store first.' }; return render(); }
  if (!f.originDid) { state.msg = { type: 'err', text: 'Pick the origin PUDO on the map.' }; return render(); }
  if (!f.destDid) { state.msg = { type: 'err', text: 'Load an incoming order or pick a destination PUDO.' }; return render(); }
  if (!f.size || !f.dims.l || !f.dims.w || !f.dims.h || !f.weightKg) { state.msg = { type: 'err', text: 'Enter the dimensions and weight.' }; return render(); }
  if (!f.contentRef) { state.msg = { type: 'err', text: 'Capture a content photo (dispute defence).' }; return render(); }
  const items = f.items.filter((it) => it.name.trim()).map((it) => ({ name: it.name.trim(), qty: it.qty }));
  try {
    const r = await api('/inbound/orders', { method: 'POST', body: {
      vendorId: state.vendor.vendorId,
      checkoutId: f.source !== 'manual' ? f.source : undefined,
      externalOrderId: f.externalOrderId || undefined,
      originPudoDid: f.originDid,
      destPudoDid: f.destDid,
      buyerMobile: f.buyerMobile || undefined,
      buyerEmail: f.buyerEmail || undefined,
      dimensionsCm: { l: Number(f.dims.l), w: Number(f.dims.w), h: Number(f.dims.h) },
      weightKg: Number(f.weightKg),
      contentPhotoRef: f.contentRef,
      subtotal: f.subtotal ? Number(f.subtotal) : undefined,
      routeMode: f.routeMode,
      items: items.length ? items : undefined,
    } });
    const p = r.parcel;
    if (!r.paid) { state.msg = { type: 'err', text: 'Not enough prepaid balance — top up, then it will print.' }; state.view = 'store'; await refreshAll(); return render(); }
    state.label = r.label;
    state.lastSettlement = { code: p.collectionCode, track: p.trackingKey, cost: p.shipmentCost, buyer: p.buyerCharge, mode: p.routeMode };
    state.form = { ...blankForm(), originDid: f.originDid };
    state.quote = null;
    state.msg = { type: 'ok', text: 'ParcelPaid ✓ — print the label and drop the parcel at your origin PUDO.' };
    await refreshAll();
    render();
  } catch (e) { fail(e); render(); }
}

function labelOut() {
  const s = state.lastSettlement;
  const holder = el('div', { className: 'vn__label-out', style: { marginTop: '16px' } });
  const svgWrap = document.createElement('div'); svgWrap.innerHTML = state.label.svg; holder.append(svgWrap); // trusted SVG from our backend
  holder.append(el('div', { style: { marginTop: '12px' } }, [el('div', { style: { color: 'var(--muted)', fontSize: '0.82rem' }, text: 'Buyer collection code' }), el('div', { className: 'vn__code', text: s?.code || '' })]));
  holder.append(el('div', { style: { marginTop: '8px' } }, [el('div', { style: { color: 'var(--muted)', fontSize: '0.82rem' }, text: 'Public tracking key' }), el('div', { className: 'vn__mono', text: s?.track || '' })]));
  if (s) holder.append(el('div', { className: 'vn__money', style: { textAlign: 'left' } }, [
    el('div', { className: 'vn__money-row' }, [el('span', { text: `Prepaid (full cost · ${s.mode})` }), el('b', { text: Number(s.cost || 0).toFixed(2) })]),
    el('div', { className: 'vn__money-row' }, [el('span', { text: 'Buyer paid at checkout' }), el('b', { text: Number(s.buyer || 0).toFixed(2) })]),
    s.mode === 'flexible' ? el('div', { className: 'vn__money-row' }, [el('span', { className: 'vn__size-note', text: 'A flexible over-hold is rebated after delivery.' }), el('span', {})]) : null,
  ].filter(Boolean)));
  holder.append(el('div', { className: 'vn__btns', style: { marginTop: '12px', justifyContent: 'center' } }, [el('button', { className: 'vn__btn vn__btn--ghost', text: 'Print label', onClick: () => printLabel(state.label.svg) })]));
  return holder;
}
function printLabel(svg) {
  const w = window.open('', '_blank', 'width=420,height=320'); if (!w) return;
  w.document.write(`<html><head><title>PUDO label</title></head><body style="margin:0;display:grid;place-items:center;height:100vh">${svg}</body></html>`);
  w.document.close(); w.focus(); w.print();
}

// --- orders (watch-only) + detail ---

const STATUS_PILL = { Created: 'created', At_PUDO: 'move', On_Bus: 'move', At_MDP: 'move', Ready_For_Pickup: 'ready', Delivered: 'done', Disputed: 'bad', Voided: 'bad' };

function ordersCard() {
  const body = state.orders.length
    ? el('table', { className: 'vn__table' }, [
        el('thead', {}, [el('tr', {}, ['Order', 'Parcel', 'Status', 'Size', 'Bin', 'Code'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, state.orders.map((o) => el('tr', { className: 'vn__rowclick', onClick: () => openDetail(o.parcelId) }, [
          el('td', { text: o.externalOrderId || '—' }),
          el('td', {}, [el('span', { className: 'vn__mono', text: o.parcelId })]),
          el('td', {}, [el('span', { className: `vn__pill vn__pill--${STATUS_PILL[o.status] || 'created'}`, text: String(o.status).replace(/_/g, ' ') })]),
          el('td', { text: o.size || '—' }),
          el('td', { text: o.binSlot || '—' }),
          el('td', {}, [el('span', { className: 'vn__mono', text: o.collectionCode || '—' })]),
        ]))),
      ])
    : el('div', { className: 'vn__empty', text: 'No shipments yet. Create one to see it here.' });
  return el('div', { className: 'vn__card' }, [
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' } }, [
      el('h2', { className: 'vn__card-h', style: { margin: 0 }, text: 'Orders' }),
      el('button', { className: 'vn__btn vn__btn--ghost', text: '⟳ Refresh', onClick: async () => { await refreshAll(); render(); } }),
    ]),
    el('p', { className: 'vn__card-hint', text: 'Watch-only. Click a row to see everything captured at mint + the dispute photo.' }),
    body,
  ]);
}

async function openDetail(parcelId) {
  try { state.detail = await api(`/vendors/${state.vendor.vendorId}/orders/${encodeURIComponent(parcelId)}`); } catch (e) { fail(e); }
  render();
}

function kv(label, value) { return [el('dt', { text: label }), el('dd', value instanceof Node ? {} : { text: value ?? '—' }, value instanceof Node ? [value] : [])]; }

function detailCard() {
  const p = state.detail;
  const dims = p.dimensionsCm ? `${p.dimensionsCm.l}×${p.dimensionsCm.w}×${p.dimensionsCm.h} cm · ${p.weightKg} kg` : `${p.weightKg} kg`;
  const itemList = p.items?.length ? p.items.map((it) => `${it.qty}× ${it.name}`).join(', ') : '—';
  const photo = (ref, alt) => ref ? (String(ref).startsWith('data:') ? el('img', { className: 'vn__detail-photo', attrs: { src: ref, alt } }) : el('span', { className: 'vn__mono', text: ref })) : el('span', { className: 'vn__size-note', text: 'none on file' });
  return el('div', { className: 'vn__card' }, [
    el('button', { className: 'vn__back', text: '‹ Back to orders', onClick: () => { state.detail = null; render(); } }),
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' } }, [
      el('h2', { className: 'vn__card-h', style: { margin: 0 }, text: p.externalOrderId || p.parcelId }),
      el('span', { className: `vn__pill vn__pill--${STATUS_PILL[p.status] || 'created'}`, text: String(p.status).replace(/_/g, ' ') }),
    ]),
    el('dl', { className: 'vn__kv' }, [
      ...kv('Parcel ID', el('span', { className: 'vn__mono', text: p.parcelId })),
      ...kv('Tracking key', el('span', { className: 'vn__mono', text: p.trackingKey || '—' })),
      ...kv('Collection code', el('span', { className: 'vn__mono', text: p.collectionCode || '—' })),
      ...kv('Origin PUDO', agentName(p.originAgentDid)),
      ...kv('Destination PUDO', `${agentName(p.destAgentDid)} · ${p.destZone}`),
      ...kv('Buyer email', p.buyerEmail),
      ...kv('Buyer mobile', p.receiverMobile),
      ...kv('Size', `${p.size} (${dims})`),
      ...kv('Items', itemList),
      ...kv('Payment', el('span', { className: `vn__pill vn__pill--${p.paidStatus === 'ParcelPaid' ? 'done' : 'bad'}`, text: p.paidStatus || 'unpaid' })),
      ...kv('Routing', `${p.routeMode || '—'}${p.routeKm != null ? ' · ' + p.routeKm + ' km' : ''}`),
      ...kv('Shelf bin', p.binSlot),
    ]),
    el('div', { className: 'vn__money' }, [
      el('div', { className: 'vn__money-row' }, [el('span', { text: 'Order value' }), el('b', { text: p.subtotal != null ? Number(p.subtotal).toFixed(2) : '—' })]),
      el('div', { className: 'vn__money-row' }, [el('span', { text: 'You prepaid (full cost)' }), el('b', { text: Number(p.shipmentCost || 0).toFixed(2) })]),
      el('div', { className: 'vn__money-row' }, [el('span', { text: 'Buyer paid at checkout' }), el('b', { text: Number(p.buyerCharge || 0).toFixed(2) })]),
      p.rebate != null ? el('div', { className: 'vn__money-row' }, [el('span', { text: 'Flexible rebate (refunded)' }), el('b', { text: Number(p.rebate).toFixed(2) })]) : null,
    ].filter(Boolean)),
    el('div', { className: 'vn__field', style: { marginTop: '16px' } }, [el('span', { className: 'vn__label', text: 'Content photo (dispute baseline)' }), photo(p.contentPhotoRef, 'contents')]),
    p.disputeReason ? el('div', { className: 'vn__field' }, [el('span', { className: 'vn__label', text: `Dispute · ${p.disputeReason}` }), photo(p.disputePhotoRef, 'dispute')]) : null,
    p.label ? el('div', { className: 'vn__btns', style: { marginTop: '14px' } }, [el('button', { className: 'vn__btn vn__btn--ghost', text: 'Reprint label', onClick: () => printLabel(p.label.svg) })]) : null,
  ].filter(Boolean));
}

function callbacksCard() {
  const body = state.callbacks.length
    ? el('table', { className: 'vn__table' }, [
        el('thead', {}, [el('tr', {}, ['Event', 'Order', 'Signature', 'When'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, state.callbacks.slice(0, 8).map((c) => { let data = {}; try { data = JSON.parse(c.body).data || {}; } catch { /* ignore */ } return el('tr', {}, [
          el('td', {}, [el('span', { className: `vn__pill vn__pill--${c.event === 'collected' ? 'done' : c.event === 'disputed' ? 'bad' : 'ready'}`, text: c.event })]),
          el('td', { text: data.externalOrderId || '—' }),
          el('td', {}, [el('span', { className: 'vn__mono', text: `${c.signature.slice(0, 14)}…` })]),
          el('td', { text: fmtTime(c.at) }),
        ]); })),
      ])
    : el('div', { className: 'vn__empty', text: 'GLOS will POST signed status callbacks (ready_for_pickup, collected, disputed) here.' });
  return el('div', { className: 'vn__card' }, [el('h2', { className: 'vn__card-h', style: { marginBottom: '12px' }, text: 'Status callbacks' }), el('p', { className: 'vn__card-hint', text: 'HMAC-SHA256-signed with your secret. Verify before trusting.' }), body]);
}

// --- helpers ---
function input(placeholder, value, type = 'text') { return el('input', { className: 'vn__input', attrs: { type, placeholder, value } }); }
function bound(placeholder, value, onInput, type = 'text') { const i = input(placeholder, value, type); i.addEventListener('input', () => onInput(i.value)); return i; }
function field(label, control) { return el('div', { className: 'vn__field' }, [el('span', { className: 'vn__label', text: label }), control]); }
function fmtTime(iso) { try { return new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)); } catch { return iso; } }

function tab(id, label) { return el('button', { className: `vn__tab ${state.view === id ? 'vn__tab--on' : ''}`, text: label, onClick: () => { state.view = id; state.detail = null; render(); } }); }

function render() {
  const parts = [
    el('div', { className: 'vn__bar' }, [
      el('div', { className: 'vn__brand' }, [el('h1', { className: 'vn__title', text: 'GLOS Merchant Console' }), el('span', { className: 'vn__sub', text: 'PUDO click-and-collect' })]),
      el('div', { className: 'vn__who' }, state.vendor ? [el('div', {}, ['Store: ', el('b', { text: state.vendor.name })]), el('div', { className: 'vn__mono', text: state.vendor.vendorId })] : [el('span', { text: 'Not connected' })]),
    ]),
  ];
  if (state.msg) { parts.push(el('div', { className: `vn__msg vn__msg--${state.msg.type}`, text: state.msg.text })); state.msg = null; }
  if (!state.vendor) { parts.push(connectCard()); mount(root, parts); return; }

  parts.push(el('div', { className: 'vn__tabs' }, [tab('mint', 'New shipment'), tab('orders', `Orders${state.orders.length ? ' (' + state.orders.length + ')' : ''}`), tab('store', 'Store')]));

  if (state.view === 'store') { parts.push(storeTab()); }
  else if (state.view === 'orders') { parts.push(state.detail ? detailCard() : el('div', { className: 'vn__grid' }, [ordersCard(), callbacksCard()])); }
  else { parts.push(el('div', { className: 'vn__grid' }, [mintCard(), inboxCard()])); }

  mount(root, parts);
}

render();
init();
