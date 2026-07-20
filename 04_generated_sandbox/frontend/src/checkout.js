// GLOS PUDO-picker node — the widget a merchant embeds in its checkout. The buyer picks the destination
// PUDO on a map and gives their email; we capture it as a "checkout handoff" that travels across the auth
// boundary into the merchant console, where it pre-fills a shipment (no dropdown, no manual destination).
// Open as checkout.html?vendor=<vendorId>&subtotal=<orderValue>&order=<ref>. PUDO endpoints are
// DID-authenticated, so the node fetches a token first (mirrors how a real embed would use a public key).

import { el, mount } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const root = document.getElementById('checkout');
const qs = new URLSearchParams(location.search);

const BASE = { lat: -1.28, lng: 36.82 }, SPAN = 0.6; // network centroid bounding box (shared with onboarding)

const state = {
  vendorId: qs.get('vendor') || '',
  vendor: null,
  agents: [],
  destDid: '',
  email: '',
  subtotal: Number(qs.get('subtotal')) || 42,
  externalOrderId: qs.get('order') || `WEB-${Math.floor(Math.random() * 9000 + 1000)}`,
  quotes: {}, // did → route quote per nearby pick-up point (so each pin shows a real total)
  done: null,
  err: null,
  loading: true,
};

let token = null;
async function getToken() {
  if (token) return token;
  const res = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'pudo-picker', type: 'client_credentials' }) });
  token = (await res.json()).access_token;
  return token;
}
async function api(path, opts = {}) {
  const t = await getToken();
  const res = await fetch(`${API}/pudo${path}`, { method: opts.method || 'GET', headers: { Authorization: `Bearer ${t}`, ...(opts.body ? { 'content-type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Error ${res.status}`);
  return data;
}

async function init() {
  if (!state.vendorId) { state.err = 'This pick-up picker needs a ?vendor=<id> in the URL (the store that embedded it).'; state.loading = false; return render(); }
  try {
    [state.vendor, state.agents] = await Promise.all([api(`/vendors/${encodeURIComponent(state.vendorId)}`), api('/agents')]);
    await quoteDests();
  } catch (e) { state.err = String(e.message || e).includes('Failed to fetch') ? 'Cannot reach the server. Start the backend.' : String(e.message || e); }
  state.loading = false;
  render();
}

// Map a PUDO's coordinates to a % position inside the shared bounding box (clamped to stay on the canvas).
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

// Rank PUDOs by distance from the store (a stand-in for "near the buyer"; the buyer then picks one).
function rankedAgents() {
  const from = state.vendor?.location;
  return state.agents
    .map((a) => ({ a, d: km(a.location, from) }))
    .sort((x, y) => (x.d ?? 1e9) - (y.d ?? 1e9))
    .map(({ a, d }) => ({ ...a, _km: d }));
}

// What the buyer is charged at checkout under the vendor's policy, for a given delivery cost.
function buyerChargeFor(cost) {
  const p = state.vendor?.shippingPolicy;
  if (!p || cost == null) return null;
  if (p.mode === 'full') return cost; // the buyer pays the whole shipment
  if (state.subtotal >= p.freeOverSubtotal) return 0;
  return Math.min(p.buyerContributionCap, cost);
}
function destCharge(did) { const q = state.quotes[did]; return buyerChargeFor(q ? q.flexible.total : null); }
function fmtCharge(c) { return c === 0 ? 'FREE' : c == null ? '…' : c.toFixed(2); }
function shippingLine() {
  const charge = destCharge(state.destDid);
  if (charge === 0) return el('span', { className: 'ck__ship ck__ship--free', text: 'FREE' });
  if (charge == null) return el('span', { className: 'ck__ship', text: '—' });
  return el('span', { className: 'ck__ship', text: charge.toFixed(2) });
}

// Quote every nearby pick-up point at once (assumed origin = nearest PUDO to the store) so each pin
// carries the real total the buyer would pay there.
async function quoteDests() {
  const ranked = rankedAgents();
  const origin = ranked[0];
  const dests = ranked.slice(0, 6).map((a) => a.did);
  if (!origin || !dests.length) return;
  try {
    const res = await api(`/quote/options?origin=${origin.did}&dests=${dests.join(',')}`);
    (res.options || []).forEach((o) => { if (o.quote) state.quotes[o.did] = o.quote; });
  } catch { /* keep */ }
}

// The route "tail" — each stop + its fee, each leg + its km, summing to the quote.
function routeTail(q) {
  if (!q) return null;
  const rows = [];
  q.nodes.forEach((n, i) => {
    rows.push(el('div', { className: 'ck__tail-node' }, [el('span', { text: `${n.type === 'mdp' ? '◆ hub' : '● PUDO'} · ${n.label}` }), el('b', { text: n.fee.toFixed(2) })]));
    if (q.legs[i]) rows.push(el('div', { className: 'ck__tail-leg', text: `│ ${q.legs[i].km} km` }));
  });
  return el('div', { className: 'ck__tail' }, [
    ...rows,
    el('div', { className: 'ck__tail-sum', text: `${q.nodes.length} stops · ${q.totalKm} km · delivery ${q.flexible.total.toFixed(2)}` }),
  ]);
}

function mapCard(ranked) {
  const surface = el('div', { className: 'ck__surface' });
  ranked.forEach((a, i) => {
    const { x, y } = pos(a.location);
    const charge = destCharge(a.did);
    const dot = el('div', { className: `ck__dot ${state.destDid === a.did ? 'ck__dot--on' : ''}`, text: String(i + 1), attrs: { title: a.shopName }, onClick: () => pickDest(a.did) });
    dot.style.left = `${x}%`; dot.style.top = `${y}%`;
    const tag = el('div', { className: 'ck__tag', text: fmtCharge(charge) }); tag.style.left = `${x}%`; tag.style.top = `${y}%`;
    surface.append(dot, tag);
  });
  return el('div', { className: 'ck__map' }, [surface]);
}

function pickDest(did) { state.destDid = did; render(); }
function pudoRow(a, i) {
  const charge = destCharge(a.did);
  return el('button', { className: `ck__pudo ${state.destDid === a.did ? 'ck__pudo--on' : ''}`, attrs: { type: 'button' }, onClick: () => pickDest(a.did) }, [
    el('div', {}, [
      el('div', { className: 'ck__pudo-name', text: `${i + 1}. ${a.shopName}` }),
      el('div', { className: 'ck__pudo-sub', text: `${a.zone}${a.landmark ? ' · ' + a.landmark : ''}${a._km != null ? ' · ' + a._km + ' km' : ''}` }),
    ]),
    el('div', { className: 'ck__pudo-km', style: { color: charge === 0 ? 'var(--pnl-green)' : 'var(--pnl-indigo)', fontWeight: '800' }, text: fmtCharge(charge) }),
  ]);
}

async function confirm() {
  if (!state.destDid || !state.email.trim()) return;
  state.err = null;
  try {
    const handoff = await api(`/vendors/${encodeURIComponent(state.vendorId)}/checkout`, { method: 'POST', body: { destPudoDid: state.destDid, buyerEmail: state.email.trim(), externalOrderId: state.externalOrderId, subtotal: state.subtotal, source: 'node' } });
    const dest = state.agents.find((a) => a.did === state.destDid);
    state.done = { handoff, dest };
  } catch (e) { state.err = String(e.message || e); }
  render();
}

function render() {
  const chrome = el('div', { className: 'store__chrome' }, [
    el('div', { className: 'store__logo', text: state.vendor ? state.vendor.name : 'Demo Store' }),
    el('div', { text: 'Checkout · step 3 of 4' }),
  ]);

  if (state.loading) { mount(root, [chrome, el('div', { className: 'ck' }, [el('p', { className: 'ck__hint', text: 'Loading pick-up points…' })])]); return; }

  if (state.done) {
    const { handoff, dest } = state.done;
    mount(root, [chrome, el('div', { className: 'ck' }, [
      el('div', { className: 'ck__done' }, [
        el('div', { className: 'ck__done-ic', text: '✓' }),
        el('h1', { className: 'ck__h', text: 'Pick-up point set' }),
        el('p', { className: 'ck__hint', text: `${state.vendor.name} will dispatch your parcel. You'll get a tracking key and a collection code by email when it's on the way.` }),
        el('div', { className: 'ck__done-card' }, [
          el('div', {}, ['Collect at: ', el('b', { text: dest ? dest.shopName : '—' })]),
          el('div', {}, [`${dest ? dest.zone : ''}${dest && dest.landmark ? ' · ' + dest.landmark : ''}`]),
          el('div', { style: { marginTop: '6px' } }, ['Order: ', el('b', { text: handoff.externalOrderId || '—' })]),
          el('div', {}, ['Updates to: ', el('b', { text: handoff.buyerEmail })]),
        ]),
      ]),
    ])]);
    return;
  }

  const ranked = rankedAgents();
  const emailIn = el('input', { className: 'ck__input', attrs: { type: 'email', placeholder: 'you@example.com', value: state.email } });
  emailIn.addEventListener('input', () => { state.email = emailIn.value; toggleBtn(); });
  const btn = el('button', { className: 'ck__btn', attrs: { type: 'button' }, text: 'Confirm pick-up point', onClick: confirm });
  function toggleBtn() { btn.disabled = !(state.destDid && state.email.trim()); }

  const card = el('div', { className: 'ck' }, [
    el('div', { className: 'ck__powered' }, ['Pick-up & collect, powered by ', el('b', { text: 'GLOS PUDO' })]),
    el('h1', { className: 'ck__h', text: 'Where would you like to collect?' }),
    el('p', { className: 'ck__hint', text: 'Choose a nearby pick-up point. We text and email you a code when your parcel is ready — collect any time the shop is open.' }),
    el('div', { className: 'ck__summary' }, [
      el('div', {}, [el('div', { className: 'ck__summary-l', text: 'Order total' }), el('div', { className: 'ck__summary-v', text: state.subtotal.toFixed(2) })]),
      el('div', { style: { textAlign: 'right' } }, [el('div', { className: 'ck__summary-l', text: 'Your delivery' }), el('div', { className: 'ck__summary-v' }, [shippingLine()].filter(Boolean))]),
    ]),
    state.err ? el('div', { className: 'ck__err', text: state.err }) : null,
    mapCard(ranked),
    el('div', { className: 'ck__list' }, ranked.slice(0, 6).map((a, i) => pudoRow(a, i))),
    state.destDid ? routeTail(state.quotes[state.destDid]) : null,
    el('div', { className: 'ck__field', style: { marginTop: '16px' } }, [el('label', { className: 'ck__label', text: 'Email for your collection code' }), emailIn]),
    btn,
  ].filter(Boolean));

  toggleBtn();
  mount(root, [chrome, card]);
}

render();
init();
