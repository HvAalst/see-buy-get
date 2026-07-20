// PUDO Launcher — a PostNL-style hub: a large horizontal tab bar (icon over label, active in orange)
// across Follow your parcel · Field apps · Businesses · Operators. The first tab is the customer-facing
// track-and-trace; the others launch the right surface (field apps open with a real entity selected).

import { el, mount } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const root = document.getElementById('hub');

const TAB_ICONS = {
  track: '<svg viewBox="0 0 24 24"><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><circle cx="10.5" cy="11" r="2.6"/><path d="M12.6 13.1 15.5 16"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
  shop: '<svg viewBox="0 0 24 24"><path d="M4 9h16l-1.2-4.5H5.2z"/><path d="M5 9v10h14V9"/><path d="M9.5 19v-5h5v5"/></svg>',
  tower: '<svg viewBox="0 0 24 24"><path d="M12 2v20M7 22h10"/><path d="M8 7l8-3M8 11l8-3M8 15l8-3"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M3 12l9-9 9 9-9 9z"/><circle cx="9" cy="9" r="1.4"/></svg>',
};
const CARD_ICONS = {
  agent: '<svg viewBox="0 0 24 24"><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/></svg>',
  driver: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="11" rx="2"/><path d="M3 11h18"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/></svg>',
  hub: '<svg viewBox="0 0 24 24"><path d="M3 7h13l4 4v6H3z"/><path d="M16 7v4h4"/></svg>',
  shop: '<svg viewBox="0 0 24 24"><path d="M4 9h16l-1.2-4.5H5.2z"/><path d="M5 9v10h14V9"/><path d="M9.5 19v-5h5v5"/></svg>',
  fleet: '<svg viewBox="0 0 24 24"><rect x="2" y="8" width="13" height="8" rx="1"/><path d="M15 11h4l3 3v2h-7"/><circle cx="6" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/></svg>',
  tower: '<svg viewBox="0 0 24 24"><path d="M12 2v20M7 22h10"/><path d="M8 7l8-3M8 11l8-3M8 15l8-3"/></svg>',
};
function svgSpan(cls, markup) { const s = document.createElement('span'); s.className = cls; s.innerHTML = markup; return s; }

const TABS = [
  { id: 'follow', label: 'Follow your parcel', icon: 'track' },
  { id: 'field', label: 'Field apps', icon: 'phone' },
  { id: 'business', label: 'Businesses', icon: 'shop' },
  { id: 'operators', label: 'Operators', icon: 'tower' },
];

const state = { tab: 'follow', agents: [], drivers: [], mdps: [], managers: [], pricing: null, showPrices: false, pick: {}, track: { id: '' } };

let token = null;
async function getToken() {
  if (token) return token;
  const res = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'pudo-hub', type: 'client_credentials' }) });
  token = (await res.json()).access_token;
  return token;
}
async function api(path) {
  try { const t = await getToken(); const res = await fetch(`${API}/pudo${path}`, { headers: { Authorization: `Bearer ${t}` } }); return res.ok ? await res.json() : []; } catch { return []; }
}

async function load() {
  [state.agents, state.drivers, state.mdps, state.managers, state.pricing] = await Promise.all([api('/agents'), api('/fleet/drivers'), api('/mdps'), api('/fleet/managers'), api('/pricing/near')]);
  render();
}

// --- cards ---

function cardIcon(name) { return svgSpan('hub__ic', CARD_ICONS[name]); }
function launcher(icon, title, desc, options, urlFor, key, openLabel = 'Open') {
  const sel = el('select', { className: 'hub__select' }, [el('option', { text: options.length ? 'Select…' : 'None registered yet', attrs: { value: '' } }), ...options.map((o) => el('option', { text: o.label, attrs: { value: o.value } }))]);
  sel.addEventListener('change', () => { state.pick[key] = sel.value; });
  const open = el('button', { className: 'hub__open', attrs: { type: 'button' }, text: openLabel, onClick: () => { const v = state.pick[key] || sel.value; if (v) location.href = urlFor(v); } });
  return el('div', { className: 'hub__card' }, [cardIcon(icon), el('div', { className: 'hub__card-t', text: title }), el('div', { className: 'hub__card-s', text: desc }), el('div', { className: 'hub__row' }, [sel, open])]);
}
function linkCard(icon, title, desc, href, label = 'Open') {
  return el('div', { className: 'hub__card' }, [cardIcon(icon), el('div', { className: 'hub__card-t', text: title }), el('div', { className: 'hub__card-s', text: desc }), el('div', { className: 'hub__row' }, [el('a', { className: 'hub__open', attrs: { href }, text: label })])]);
}
function grid(cards) { return el('div', { className: 'hub__grid' }, cards); }
function sub(text) { return el('p', { className: 'hub__panel-sub', text }); }
function signinCard(icon, title, desc, role) {
  return el('div', { className: 'hub__card' }, [cardIcon(icon), el('div', { className: 'hub__card-t', text: title }), el('div', { className: 'hub__card-s', text: desc }), el('div', { className: 'hub__row' }, [el('a', { className: 'hub__open', attrs: { href: `signin-${role}.html` }, text: 'Sign in' })])]);
}

// --- follow your parcel (customer track-and-trace) ---
// The on-ramp to the full tracking page (track.html) — enter a key here and it opens the live status there.

function openTrack(key) { const k = (key || '').trim(); location.href = `track.html${k ? `?key=${encodeURIComponent(k)}` : ''}`; }
function followTab() {
  const t = state.track;
  const input = el('input', { className: 'hub__track-in', attrs: { value: t.id || '', placeholder: 'e.g. T-XXXXXXXXXX' } });
  input.addEventListener('input', () => { t.id = input.value; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') openTrack(input.value); });
  return [
    sub('Track a parcel by its tracking key — what an end customer sees.'),
    el('div', { className: 'hub__track' }, [
      el('div', { className: 'hub__track-label', text: 'Parcel tracking key' }),
      el('div', { className: 'hub__track-row' }, [input, el('button', { className: 'hub__open', attrs: { type: 'button' }, text: 'Track', onClick: () => openTrack(input.value) })]),
    ]),
  ];
}

// --- tab content ---

function tabContent() {
  if (state.tab === 'follow') return followTab();
  if (state.tab === 'field') return [
    sub('Apps for the people on the ground — sign in, or create an account.'),
    grid([
      signinCard('agent', 'PUDO Agent', 'The shopkeeper’s tasks: accept, hand to bus, release to the customer.', 'pudo'),
      signinCard('driver', 'Driver', 'Scan a vehicle to start a shift, find work on a route, claim + load.', 'driver'),
      signinCard('hub', 'MDP sort hub', 'Drop a bag, empty it, and sort each parcel into its next-hop bag.', 'mdp'),
    ]),
  ];
  if (state.tab === 'business') {
    const active = state.managers.filter((m) => m.status === 'ACTIVE');
    return [
      sub('For the vendors and fleet operators that plug into the network.'),
      grid([
        linkCard('shop', 'Merchant console', 'Wire e-commerce into PUDO click-and-collect: create shipments + labels.', 'vendor.html'),
        launcher('fleet', 'Fleet console', active.length ? 'Open a fleet’s dashboard directly, or sign in on the console.' : 'Fleet onboarding, vehicles, drivers, sessions + the live dashboard.', active.map((m) => ({ value: m.did, label: m.companyName })), (v) => `fleet.html?manager=${encodeURIComponent(v)}`, 'fleet', 'Open fleet'),
      ]),
    ];
  }
  return [
    sub('Network-operator control surfaces.'),
    grid([
      linkCard('tower', 'PUDO control tower', 'KPIs, coverage heatmap, MDP hubs, finance and user support.', 'pudo-tower.html'),
      linkCard('tower', 'GLOS control tower', 'The enterprise GLOS digital-twin control tower (all editions, one spine).', 'control-tower.html'),
    ]),
  ];
}

// Open-data pricing — a NETWORK benchmark, not a 30k-row dump. The actionable, location-scoped view of
// nearby rates lives inside each field operator's app ("Rates near you"); this is the public summary.
function benchCard(title, unit, b, decimals = 2) {
  if (!b || !b.count) return el('div', { className: 'hub__bench' }, [el('div', { className: 'hub__bench-t', text: title }), el('div', { className: 'hub__bench-sub', text: 'No rates published yet.' })]);
  const f = (n) => Number(n).toFixed(decimals);
  return el('div', { className: 'hub__bench' }, [
    el('div', { className: 'hub__bench-t', text: title }),
    el('div', { className: 'hub__bench-med' }, [el('b', { text: f(b.median) }), el('span', { className: 'hub__bench-unit', text: ` ${unit}` })]),
    el('div', { className: 'hub__bench-sub', text: `typical ${f(b.p25)}–${f(b.p75)} · range ${f(b.min)}–${f(b.max)} · ${b.count} listed` }),
  ]);
}
// The public market price index — a lightweight overlay opened from a homepage link (not a tab).
function priceModal() {
  if (!state.showPrices) return null;
  const p = state.pricing;
  const close = () => { state.showPrices = false; render(); };
  const overlay = el('div', { className: 'hub__overlay', onClick: (e) => { if (e.target === overlay) close(); } }, [
    el('div', { className: 'hub__modal' }, [
      el('div', { className: 'hub__modal-head' }, [el('div', { className: 'hub__modal-t', text: 'Open market price index' }), el('button', { className: 'hub__modal-x', attrs: { type: 'button', 'aria-label': 'close' }, text: '✕', onClick: close })]),
      el('p', { className: 'hub__bench-sub', style: { margin: '0 0 14px' }, text: 'Rates are open data so newcomers can settle at a competitive price. Network benchmark — every operator sees the live rates near them, on a map, inside their own app.' }),
      (!p || !p.pudo) ? el('p', { className: 'hub__bench-sub', text: 'Loading…' }) : el('div', { className: 'hub__benchgrid' }, [
        benchCard('PUDO handling', 'per parcel', p.pudo),
        benchCard('MDP sorting', 'per parcel', p.mdp),
        benchCard('Transport', 'per km', p.vehicle, 3),
      ]),
    ]),
  ]);
  return overlay;
}

function tabBar() {
  return el('div', { className: 'hub__tabs' }, TABS.map((t) => el('button', { className: `hub__tab${state.tab === t.id ? ' is-on' : ''}`, attrs: { type: 'button' }, onClick: () => { state.tab = t.id; render(); } }, [
    svgSpan('hub__tab-ic', TAB_ICONS[t.icon]),
    el('span', { className: 'hub__tab-l', text: t.label }),
  ])));
}

function render() {
  // The masthead, SEO content + footer are static HTML (for GEO/search); the app renders only the launcher.
  mount(root, [
    el('div', { className: 'hub__widget' }, [tabBar(), el('div', { className: 'hub__panel' }, tabContent())]),
    el('div', { className: 'hub__foot' }, [el('button', { className: 'hub__pricelink', attrs: { type: 'button' }, text: '↗ Open market price index', onClick: () => { state.showPrices = true; render(); } })]),
    priceModal(),
  ].filter(Boolean));
}

render();
load();
