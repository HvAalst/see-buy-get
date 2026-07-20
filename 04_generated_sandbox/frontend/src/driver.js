// PUDO Driver App — the courier's own surface. Start a shift by SCANNING the vehicle's dashboard QR
// (this activates + couples driver↔vehicle for the day); close the session to decouple. While on
// shift: see remaining capacity, set/repeat a route A→B, get offered the loads on the way ("≈5 min
// from X, ready — claim it?"), claim, and load a bag with one scan. Opens with ?driver=<did>.

import { el, mount, ReadAloud } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const driverDid = new URLSearchParams(location.search).get('driver');
const root = document.getElementById('driver');
const routeKey = `glos-driver-route:${driverDid}`;

const ICONS = {
  scan: '<svg viewBox="0 0 24 24"><path d="M4 7V5a1 1 0 0 1 1-1h2M4 17v2a1 1 0 0 0 1 1h2M20 7V5a1 1 0 0 0-1-1h-2M20 17v2a1 1 0 0 1-1 1h-2M7 12h10"/></svg>',
  route: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v4a3 3 0 0 0 3 3h4a3 3 0 0 1 3 3"/></svg>',
  box: '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2"/><path d="M20 4v4h-4M4 20v-4h4"/></svg>',
};
function iconEl(name) {
  const span = document.createElement('span');
  span.className = 'dv__action-ic';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = ICONS[name];
  return span;
}

const state = { screen: 'home', driver: null, session: { active: false }, vehicle: null, remaining: 0, claims: [], nodes: [], offers: [], rates: null, msg: null, form: {} };

function savedRoute() { try { return JSON.parse(localStorage.getItem(routeKey) || 'null'); } catch { return null; } }
function saveRoute(r) { try { localStorage.setItem(routeKey, JSON.stringify(r)); } catch { /* no-op */ } }

let token = null;
async function getToken() {
  if (token) return token;
  const res = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'pudo-driver-app', type: 'client_credentials' }) });
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
const feedback = () => { try { navigator.vibrate?.(120); } catch { /* no-op */ } };

async function load() {
  if (!driverDid) { state.msg = { type: 'err', text: 'Open this app with ?driver=<your GLOS ID>.' }; return render(); }
  try {
    state.driver = await api(`/fleet/drivers/${encodeURIComponent(driverDid)}`);
    state.session = await api(`/fleet/drivers/${encodeURIComponent(driverDid)}/session`);
    if (state.session.active) {
      state.vehicle = state.session.vehicle;
      const claims = await api(`/fleet/drivers/${encodeURIComponent(driverDid)}/claims`);
      state.remaining = claims.remainingCapacityKg;
      state.claims = claims.claims || [];
      state.rates = await api('/pricing/near?type=vehicle').catch(() => null); // network per-km benchmark (vehicles roam)
    } else { state.vehicle = null; state.remaining = 0; state.claims = []; state.rates = null; }
    await api(`/fleet/drivers/${encodeURIComponent(driverDid)}/ping`, { method: 'POST', body: {} }).catch(() => undefined);
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; }
  render();
}

async function loadNodes() {
  try {
    const [mdps, agents] = await Promise.all([api('/mdps'), api('/agents')]);
    const m = (mdps || []).map((x) => ({ id: x.mdpId, label: `${x.name} (hub)`, lat: x.location.lat, lng: x.location.lng }));
    const a = (agents || []).filter((x) => x.location).map((x) => ({ id: x.did, label: x.shopName, lat: x.location.lat, lng: x.location.lng }));
    state.nodes = [...m, ...a];
  } catch { state.nodes = []; }
}

// --- shell ---

function topBar() {
  const onShift = state.session.active;
  return el('header', { className: 'dv__top' }, [
    el('div', { className: 'dv__brand' }, [document.createTextNode('PUDO Driver'), el('span', { text: state.driver ? state.driver.displayName : '' })]),
    el('div', { className: 'dv__right' }, [
      el('span', { className: 'dv__status' }, [el('span', { className: `dv__status-dot${onShift ? '' : ' dv__status-dot--off'}` }), onShift ? 'On shift' : 'Off duty']),
      el('a', { className: 'dv__hub', attrs: { href: 'index.html' }, text: 'Hub ›' }),
    ]),
  ]);
}
function actionRow(icon, title, subtitle, onClick, disabled = false, badge) {
  const right = badge ? el('span', { className: 'dv__badge', text: String(badge) }) : null;
  return el('button', { className: 'dv__action', attrs: { type: 'button', ...(disabled ? { disabled: 'disabled' } : {}) }, onClick: disabled ? undefined : onClick }, [
    iconEl(icon),
    el('div', { style: { flex: '1' } }, [el('div', { className: 'dv__action-t', text: title }), el('div', { className: 'dv__action-s', text: subtitle })]),
    right,
  ]);
}
function headerRow(title) {
  return el('div', { className: 'dv__head' }, [
    el('button', { className: 'dv__back', attrs: { type: 'button' }, text: '← Back', onClick: () => { state.form = {}; go('home'); } }),
    el('h1', { className: 'dv__title', text: title }),
  ]);
}
function textInput(placeholder, value, onInput, mono = false) {
  const input = el('input', { className: 'dv__input', style: mono ? { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } : {}, attrs: { value: value || '', placeholder, autocapitalize: 'characters', autocomplete: 'off' } });
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

// --- home ---

function homeScreen() {
  const body = [];
  if (state.driver && state.driver.status !== 'ACTIVE') {
    body.push(el('div', { className: 'dv__notice', text: `Your driver account is ${state.driver.status.replace(/_/g, ' ').toLowerCase()}. The fleet office must activate you before you can start a shift.` }));
  }

  if (!state.session.active) {
    // Off duty → start a shift by scanning the vehicle's dashboard QR.
    const f = state.form;
    const scan = textInput('Scan the vehicle QR (on the dashboard)', f.vehicleQr || '', (v) => { f.vehicleQr = v.trim(); }, true);
    body.push(el('div', { className: 'dv__card' }, [
      el('div', { className: 'dv__step' }, [el('div', { className: 'dv__step-label', text: 'Start your shift' }), scan]),
      el('button', { className: 'dv__primary', attrs: { type: 'button', ...(state.driver && state.driver.status === 'ACTIVE' ? {} : { disabled: 'disabled' }) }, text: 'Scan vehicle — start shift', onClick: startSession }),
      el('div', { className: 'dv__hint', text: 'Scanning the dashboard sticker couples you to that vehicle for the day.' }),
    ]));
    body.push(ReadAloud(() => 'Scan the vehicle QR on the dashboard to start your shift.', { label: 'Read this aloud' }));
    return [topBar(), el('div', { className: 'dv__body' }, body)];
  }

  // On shift → vehicle + capacity, find work, my loads, end session.
  const v = state.vehicle;
  const usedPct = v.capacityKg ? Math.max(0, Math.min(100, Math.round(((v.capacityKg - state.remaining) / v.capacityKg) * 100))) : 0;
  body.push(el('div', { className: 'dv__veh' }, [
    el('div', { className: 'dv__veh-top' }, [
      el('div', {}, [el('div', { className: 'dv__veh-plate', text: v.plate }), el('div', { className: 'dv__veh-class', text: `${v.vehicleClass}${v.truckSubtype ? ` · ${v.truckSubtype.replace(/_/g, ' ')}` : ''}${v.verified ? ' · verified' : ''}` })]),
      el('button', { className: 'dv__back', attrs: { type: 'button' }, text: 'End shift', onClick: endSession }),
    ]),
    el('div', { className: 'dv__cap-bar' }, [el('span', { style: { width: `${usedPct}%` } })]),
    el('div', { className: 'dv__cap-row' }, [el('span', { text: 'Remaining capacity' }), el('b', { text: `${state.remaining} / ${v.capacityKg} kg` })]),
    rateBand(v),
  ].filter(Boolean)));

  const actions = [actionRow('route', 'Find work on my route', 'Get shipments on the way from A to B', () => go('route'))];
  const r = savedRoute();
  if (r) actions.push(actionRow('repeat', 'Repeat my route', `${r.fromLabel} → ${r.toLabel}`, repeatRoute));
  actions.push(actionRow('box', 'My loads', 'Claimed shipments — load them on', () => go('loads'), false, state.claims.length || undefined));
  body.push(el('div', { className: 'dv__actions' }, actions));
  body.push(ReadAloud(() => `On shift with ${v.plate}. Remaining capacity ${state.remaining} kilograms. ${state.claims.length} claimed loads.`, { label: 'Read this screen aloud' }));
  return [topBar(), el('div', { className: 'dv__body' }, body)];
}

// Per-km market band (vehicles roam, so this is the network benchmark, not a local map).
function rateBand(v) {
  const b = state.rates?.benchmark;
  if (!b || !b.count) return null;
  const mine = Number(v.pricePerKm ?? 0);
  const d = b.median > 0 ? Math.round(((mine - b.median) / b.median) * 100) : 0;
  const word = d > 1 ? `${d}% above` : d < -1 ? `${-d}% below` : 'at';
  const row = el('div', { className: 'dv__cap-row', style: { marginTop: '8px', flexWrap: 'wrap', gap: '6px' } }, [
    el('span', { text: `Your rate ${mine.toFixed(3)}/km · market median ${b.median.toFixed(3)} (${b.min.toFixed(3)}–${b.max.toFixed(3)}) — you're ${word}` }),
  ]);
  if (Math.abs(d) > 1) row.append(el('button', { className: 'dv__back', attrs: { type: 'button' }, text: `Match ${b.median.toFixed(3)}`, onClick: () => matchRate(v.vehicleId, b.median) }));
  return row;
}
async function matchRate(vehicleId, price) {
  try { await api(`/vehicles/${vehicleId}/pricing`, { method: 'PATCH', body: { price: Math.round(price * 1000) / 1000 } }); state.msg = { type: 'ok', text: 'Rate set to the market median.' }; await load(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

async function startSession() {
  const f = state.form;
  if (!f.vehicleQr) { state.msg = { type: 'err', text: 'Scan the vehicle QR first.' }; return render(); }
  try {
    await api(`/fleet/drivers/${encodeURIComponent(driverDid)}/start-session`, { method: 'POST', body: { vehicleQr: f.vehicleQr } });
    feedback();
    state.form = {};
    state.msg = { type: 'ok', text: 'Shift started — you are coupled to the vehicle.' };
    await load();
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}
async function endSession() {
  try {
    await api(`/fleet/drivers/${encodeURIComponent(driverDid)}/end-session`, { method: 'POST', body: {} });
    feedback();
    state.msg = { type: 'ok', text: 'Shift closed — vehicle released.' };
    await load();
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- route → suggestions ---

function routeScreen() {
  const f = state.form;
  const opt = (sel) => [el('option', { text: 'Select…', attrs: { value: '' } }), ...state.nodes.map((n) => el('option', { text: n.label, attrs: { value: n.id, ...(sel === n.id ? { selected: 'selected' } : {}) } }))];
  const from = el('select', { className: 'dv__select' }, opt(f.fromId));
  from.addEventListener('change', () => { f.fromId = from.value; });
  const to = el('select', { className: 'dv__select' }, opt(f.toId));
  to.addEventListener('change', () => { f.toId = to.value; });

  return [topBar(), el('div', { className: 'dv__body' }, [headerRow('Find work'), el('div', { className: 'dv__card' }, [
    el('div', { className: 'dv__step' }, [el('div', { className: 'dv__step-label', text: 'Where are you starting from?' }), from]),
    el('div', { className: 'dv__step' }, [el('div', { className: 'dv__step-label', text: 'Where are you heading?' }), to]),
    el('button', { className: 'dv__primary', attrs: { type: 'button' }, text: 'Show shipments on my way', onClick: submitRoute }),
    el('div', { className: 'dv__hint', text: 'We only suggest loads on your route that fit your remaining capacity.' }),
  ])])];
}

async function submitRoute() {
  const f = state.form;
  const from = state.nodes.find((n) => n.id === f.fromId);
  const to = state.nodes.find((n) => n.id === f.toId);
  if (!from || !to) { state.msg = { type: 'err', text: 'Pick where you start and where you are heading.' }; return render(); }
  saveRoute({ from: { lat: from.lat, lng: from.lng }, to: { lat: to.lat, lng: to.lng }, fromLabel: from.label, toLabel: to.label });
  await runSuggest({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng });
}
async function repeatRoute() {
  const r = savedRoute();
  if (!r) return go('route');
  await runSuggest(r.from, r.to);
}
async function runSuggest(from, to) {
  try {
    const r = await api(`/fleet/drivers/${encodeURIComponent(driverDid)}/suggest-work`, { method: 'POST', body: { from, to } });
    state.remaining = r.remainingCapacityKg;
    state.offers = r.offers || [];
    go('offers');
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

function offersScreen() {
  const body = [headerRow('Shipments on your way')];
  if (!state.offers.length) body.push(el('div', { className: 'dv__card' }, [el('div', { className: 'dv__hint', text: 'No shipments waiting on this route right now.' }), el('button', { className: 'dv__ghost', attrs: { type: 'button' }, text: 'Try another route', onClick: () => go('route') })]));
  else {
    for (const o of state.offers) {
      body.push(el('div', { className: 'dv__offer' }, [
        el('div', { className: 'dv__offer-msg', text: o.message }),
        el('div', { className: 'dv__offer-meta' }, [
          el('span', {}, [document.createTextNode('Load '), el('b', { text: `${o.weightKg} kg` })]),
          el('span', {}, [document.createTextNode('To '), el('b', { text: o.destLabel })]),
          el('span', {}, [document.createTextNode('Detour '), el('b', { text: `${o.detourKm} km` })]),
        ]),
        el('div', { className: 'dv__offer-btns' }, [
          el('button', { className: 'dv__claim', attrs: { type: 'button' }, text: 'Claim', onClick: () => respond(o, true) }),
          el('button', { className: 'dv__ignore', attrs: { type: 'button' }, text: 'Ignore', onClick: () => respond(o, false) }),
        ]),
      ]));
    }
  }
  return [topBar(), el('div', { className: 'dv__body' }, body)];
}

async function respond(offer, claim) {
  try {
    await api(`/dispatch/offers/${encodeURIComponent(offer.offerId)}/${claim ? 'claim' : 'ignore'}`, { method: 'POST', body: {} });
    feedback();
    state.offers = state.offers.filter((o) => o.offerId !== offer.offerId);
    if (claim) { state.msg = { type: 'ok', text: `Claimed ${offer.weightKg} kg to ${offer.destLabel}.` }; await load(); }
    render();
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; await load(); }
}

// --- my loads ---

function loadsScreen() {
  const body = [headerRow('My loads')];
  if (state.vehicle) body.push(el('div', { className: 'dv__cap-row', style: { padding: '0 4px' } }, [el('span', { text: 'Remaining capacity' }), el('b', { text: `${state.remaining} / ${state.vehicle.capacityKg} kg` })]));
  if (!state.claims.length) body.push(el('div', { className: 'dv__card' }, [el('div', { className: 'dv__hint', text: 'No claimed loads. Find work on your route to pick some up.' })]));
  else {
    for (const c of state.claims) {
      const row = el('div', { className: 'dv__load' }, [
        el('div', {}, [el('div', { className: 'dv__load-code', text: c.ref }), el('div', { className: 'dv__load-meta', text: `${c.pickupLabel} → ${c.destLabel} · ${c.weightKg} kg` })]),
      ]);
      if (c.kind === 'tote' && c.pickupLabel !== 'on board') row.append(el('button', { className: 'dv__load-btn', attrs: { type: 'button' }, text: 'Load on', onClick: () => loadBag(c.ref) }));
      else if (c.pickupLabel === 'on board') row.append(el('span', { className: 'dv__load-meta', text: 'on board' }));
      body.push(row);
    }
  }
  return [topBar(), el('div', { className: 'dv__body' }, body)];
}

async function loadBag(code) {
  try {
    const r = await api(`/totes/${encodeURIComponent(code)}/load`, { method: 'POST', body: { driverBadgeId: state.driver.badgeId } });
    feedback();
    state.msg = { type: 'ok', text: `${code} loaded — ${r.moved.length} parcel(s) on board.` };
    await load();
    render();
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- nav / render ---

async function go(screen) {
  state.screen = screen;
  if (screen === 'route' && !state.nodes.length) await loadNodes();
  render();
}

function render() {
  const screens = { home: homeScreen, route: routeScreen, offers: offersScreen, loads: loadsScreen };
  const parts = (screens[state.screen] || homeScreen)();
  if (state.msg) {
    const banner = el('div', { className: 'dv__body', style: { paddingBottom: '0' } }, [el('div', { className: `dv__msg dv__msg--${state.msg.type}`, text: state.msg.text })]);
    parts.splice(1, 0, banner);
    state.msg = null;
  }
  mount(root, parts);
}

load();
