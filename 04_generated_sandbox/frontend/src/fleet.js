// GLOS Fleet Console — the fleet manager's back office (Compendium Ch 19). Landing is a live
// DASHBOARD: vehicle GPS positions, driver working hours from active/inactive sessions, active claimed
// cargo, and shortcuts into Fleet data (vehicles), the Drivers pool, and Sessions. Drivers and vehicles
// each have their own ID; coupling is a re-assignable shift session. Reads /v1/pudo/*.

import { el, mount } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const root = document.getElementById('fleet');

const VEHICLE_CLASSES = ['bike', 'motorcycle', 'tuktuk', 'car', 'van', 'bus', 'truck'];
const HEAVY_CLASSES = ['tuktuk', 'car', 'van', 'bus', 'truck'];
const CAP_FLAGS = [['coldChain', 'cold'], ['carriesBulk', 'bulk'], ['liquid', 'liquid'], ['hazmat', 'hazmat'], ['oversized', 'oversized']];

const SESSION_KEY = 'glos-fleet-session';
function savedSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
function persistSession(s) { try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch { /* no-op */ } }

const state = { session: null, loginForm: {}, view: 'dashboard', dashboard: null, vehicles: [], drivers: [], assignments: [], corridors: [], subtypes: [], managers: [], activeManager: '', msg: null, loading: true, vForm: { vehicleClass: 'bike', ownerType: 'driver_owned' }, dForm: { classes: new Set(['bike']) }, cForm: {}, mForm: {} };
const isManager = () => state.session?.mode === 'manager';

let token = null;
async function getToken() {
  if (token) return token;
  const res = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'fleet-console', type: 'client_credentials' }) });
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

async function loadAll() {
  try {
    const dashPath = state.activeManager ? `/fleet/dashboard?manager=${encodeURIComponent(state.activeManager)}` : '/fleet/dashboard';
    [state.dashboard, state.vehicles, state.drivers, state.assignments, state.corridors, state.subtypes, state.managers] = await Promise.all([
      api(dashPath), api('/vehicles'), api('/fleet/drivers'), api('/fleet/assignments?status=active'), api('/corridors'), api('/vehicles/truck-subtypes'), api('/fleet/managers'),
    ]);
    if (state.msg && state.msg.type !== 'ok') state.msg = null;
  } catch (e) {
    const m = String(e.message || e);
    state.msg = { type: 'err', text: m.includes('Failed to fetch') ? 'Cannot reach the server. Start the backend.' : m };
  }
  state.loading = false;
  render();
}

const short = (s) => (s && s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s || '—');

// --- shell ---

const TAB_ICONS = {
  dashboard: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  vehicles: '<svg viewBox="0 0 24 24"><rect x="2" y="8" width="13" height="8" rx="1.5"/><path d="M15 11h4l3 3v2h-7"/><circle cx="6" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/></svg>',
  drivers: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg>',
  sessions: '<svg viewBox="0 0 24 24"><path d="M9 12h6"/><path d="M10 8H8a4 4 0 0 0 0 8h2"/><path d="M14 8h2a4 4 0 0 1 0 8h-2"/></svg>',
  managers: '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/></svg>',
};
function svgSpan(cls, markup) { const s = document.createElement('span'); s.className = cls; s.innerHTML = markup; return s; }

function topBar() {
  const tab = (id, label, icon) => el('button', { className: `fl__tab${state.view === id ? ' is-on' : ''}`, attrs: { type: 'button' }, onClick: () => { state.view = id; render(); } }, [svgSpan('fl__tab-ic', TAB_ICONS[icon]), el('span', { className: 'fl__tab-l', text: label })]);
  const refresh = el('button', { className: 'fl__btn', text: '⟳ Refresh', onClick: () => { state.loading = true; render(); loadAll(); } });
  const logout = el('button', { className: 'fl__btn', text: 'Sign out', onClick: signOut });
  const manager = isManager();

  const who = manager
    ? el('span', { className: 'fl__who' }, [document.createTextNode('Signed in as '), el('b', { text: state.session.company })])
    : el('span', { className: 'fl__who' }, [el('b', { text: 'GLOS operator' })]);

  const controls = [];
  if (!manager) {
    const activeManagers = state.managers.filter((m) => m.status === 'ACTIVE');
    const picker = el('select', { className: 'fl__select', style: { width: 'auto' } }, [
      el('option', { text: 'All fleets', attrs: { value: '' } }),
      ...activeManagers.map((m) => el('option', { text: m.companyName, attrs: { value: m.did, ...(state.activeManager === m.did ? { selected: 'selected' } : {}) } })),
    ]);
    picker.addEventListener('change', () => { state.activeManager = picker.value; state.loading = true; render(); loadAll(); });
    controls.push(picker);
  }
  controls.push(refresh, logout);

  const tabs = [tab('dashboard', 'Dashboard', 'dashboard'), tab('vehicles', 'Fleet data', 'vehicles'), tab('drivers', 'Drivers', 'drivers'), tab('sessions', 'Sessions', 'sessions')];
  if (!manager) tabs.push(tab('managers', 'Managers', 'managers'));

  return el('div', { className: 'fl__head' }, [
    el('div', { className: 'fl__swoosh' }),
    el('div', { className: 'fl__bar' }, [el('div', { className: 'fl__brand' }, [el('h1', { className: 'fl__title', text: 'GLOS Fleet' }), who]), el('div', { className: 'fl__controls' }, controls)]),
    el('div', { className: 'fl__tabs' }, tabs),
  ]);
}

function loginScreen() {
  const f = state.loginForm;
  const codeInput = input(f.code, (v) => { f.code = v; }, { placeholder: 'e.g. FM-9A3C', style: 'text-transform:uppercase' });
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') signInManager(); });
  return [
    el('div', { className: 'fl__login' }, [
      el('div', { className: 'fl__login-brand' }, [el('h1', { text: 'GLOS Fleet' }), el('p', { text: 'Sign in to manage your fleet' })]),
      ...(state.msg ? [el('div', { className: `fl__msg fl__msg--${state.msg.type}`, text: state.msg.text })] : []),
      el('div', { className: 'fl__card' }, [
        field('Fleet manager sign-in code', codeInput),
        el('button', { className: 'fl__btn-primary', style: { width: '100%' }, attrs: { type: 'button' }, text: 'Sign in', onClick: signInManager }),
        el('div', { className: 'fl__or', text: 'or' }),
        el('button', { className: 'fl__btn', style: { width: '100%' }, attrs: { type: 'button' }, text: 'Continue as GLOS operator', onClick: () => setSession({ mode: 'operator' }) }),
      ]),
    ]),
  ];
}

async function signInManager() {
  const code = (state.loginForm.code || '').trim();
  if (!code) { state.msg = { type: 'err', text: 'Enter your sign-in code.' }; return render(); }
  try {
    const m = await api('/fleet/managers/login', { method: 'POST', body: { code } });
    setSession({ mode: 'manager', managerDid: m.did, company: m.companyName });
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

function setSession(session) {
  state.session = session;
  state.activeManager = session.mode === 'manager' ? session.managerDid : '';
  state.view = 'dashboard';
  state.msg = null;
  state.loginForm = {};
  persistSession(session);
  state.loading = true;
  render();
  loadAll();
}

function signOut() {
  state.session = null;
  state.activeManager = '';
  persistSession(null);
  render();
}
function field(label, control) { return el('div', { className: 'fl__field' }, [el('label', { className: 'fl__label', text: label }), control]); }
function input(value, oninput, attrs = {}) {
  const node = el('input', { className: 'fl__input', attrs: { value: value || '', ...attrs } });
  node.addEventListener('input', () => oninput(node.value));
  return node;
}
function select(options, value, onchange) {
  const node = el('select', { className: 'fl__select' }, options.map((o) => el('option', { text: o.label, attrs: { value: o.value, ...(o.value === value ? { selected: 'selected' } : {}) } })));
  node.addEventListener('change', () => onchange(node.value));
  return node;
}
function capBadges(v) {
  const caps = CAP_FLAGS.filter(([k]) => v[k]).map(([, label]) => el('span', { className: 'fl__cap', text: label }));
  if (v.verified) caps.unshift(el('span', { className: 'fl__cap', text: 'verified' }));
  return el('div', { className: 'fl__caps' }, caps.length ? caps : [el('span', { className: 'fl__cap', style: { background: 'var(--surface)', color: 'var(--muted)' }, text: 'standard' })]);
}

// --- dashboard ---

function dashboardView() {
  const d = state.dashboard || { vehicles: {}, drivers: {}, sessions: { list: [] }, positions: [], cargo: { items: [], totalKg: 0 } };
  const kpi = (v, l) => el('div', { className: 'fl__kpi' }, [el('div', { className: 'fl__kpi-v', text: String(v) }), el('div', { className: 'fl__kpi-l', text: l })]);
  const kpis = el('div', { className: 'fl__kpis' }, [
    kpi(`${d.vehicles.active ?? 0}/${d.vehicles.total ?? 0}`, 'Vehicles active'),
    kpi(`${d.drivers.onShift ?? 0}/${d.drivers.total ?? 0}`, 'Drivers on shift'),
    kpi(d.sessions.active ?? 0, 'Active sessions'),
    kpi(`${d.cargo.count ?? 0} · ${d.cargo.totalKg ?? 0}kg`, 'Cargo in motion'),
    kpi(`${d.sessions.todayHours ?? 0}h`, 'Hours today'),
  ]);

  const grid = el('div', { className: 'fl__grid' }, [el('div', {}, [mapPanel(d.positions)]), el('div', {}, [hoursPanel(d.sessions.list), cargoPanel(d.cargo.items)])]);

  const shortcut = (id, t, s) => el('button', { className: 'fl__shortcut', attrs: { type: 'button' }, onClick: () => { state.view = id; render(); } }, [el('div', { className: 'fl__shortcut-t', text: t }), el('div', { className: 'fl__shortcut-s', text: s })]);
  const shortcuts = el('div', { className: 'fl__shortcuts' }, [
    shortcut('vehicles', 'Fleet data →', `${state.vehicles.length} vehicles · register + docs`),
    shortcut('drivers', 'Drivers pool →', `${d.drivers.onShift ?? 0} on shift · ${d.drivers.offShift ?? 0} off · onboarding + KYC`),
    shortcut('sessions', 'Sessions →', `${d.sessions.active ?? 0} on duty · couplings`),
  ]);
  return [kpis, grid, shortcuts];
}

function mapPanel(positions) {
  const pts = positions || [];
  const lats = pts.map((p) => p.location.lat), lngs = pts.map((p) => p.location.lng);
  const pad = 0.05;
  const b = pts.length ? { minLat: Math.min(...lats) - pad, maxLat: Math.max(...lats) + pad, minLng: Math.min(...lngs) - pad, maxLng: Math.max(...lngs) + pad } : { minLat: -1.4, maxLat: -1.1, minLng: 36.6, maxLng: 37.0 };
  const span = (mx, mn) => (mx - mn || 1);
  const xy = (lat, lng) => ({ x: Math.max(4, Math.min(96, ((lng - b.minLng) / span(b.maxLng, b.minLng)) * 100)), y: Math.max(6, Math.min(94, ((b.maxLat - lat) / span(b.maxLat, b.minLat)) * 100)) });
  const dots = pts.flatMap((p) => {
    const { x, y } = xy(p.location.lat, p.location.lng);
    return [
      el('div', { className: 'fl__dot-l', style: { left: `${x}%`, top: `${y}%` }, text: `${p.plate} · ${p.hoursOnDuty}h` }),
      el('div', { className: 'fl__dot', attrs: { title: `${p.plate} · ${p.driverName} · ${p.vehicleClass}` }, style: { left: `${x}%`, top: `${y}%` } }),
    ];
  });
  return el('div', { className: 'fl__card' }, [
    el('h2', { className: 'fl__card-h', text: 'Live vehicle map (GPS)' }),
    el('p', { className: 'fl__card-hint', text: 'Vehicles on shift that have reported a position (drivers ping location when they look for work).' }),
    el('div', { className: 'fl__map' }, pts.length ? dots : [el('div', { className: 'fl__empty', style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center' }, text: 'No vehicles reporting position.' })]),
  ]);
}

function hoursPanel(sessions) {
  const list = sessions || [];
  const rows = list.map((s) => el('tr', {}, [
    el('td', { text: s.driverName }),
    el('td', {}, [el('span', { className: 'fl__mono', text: `${s.plate} · ${s.vehicleClass}` })]),
    el('td', { text: `${s.hoursOnDuty}h` }),
    el('td', {}, [el('span', { className: `fl__pill fl__pill--${s.location ? 'ok' : 'info'}`, text: s.location ? 'located' : 'no signal' })]),
  ]));
  return el('div', { className: 'fl__card' }, [
    el('h2', { className: 'fl__card-h', text: 'Working hours — active sessions' }),
    list.length ? el('table', { className: 'fl__table' }, [el('thead', {}, [el('tr', {}, ['Driver', 'Vehicle', 'On duty', 'GPS'].map((h) => el('th', { text: h })))]), el('tbody', {}, rows)]) : el('div', { className: 'fl__empty', text: 'No drivers on shift.' }),
  ]);
}

function cargoPanel(items) {
  const list = items || [];
  const rows = list.map((c) => el('tr', {}, [
    el('td', {}, [el('span', { className: 'fl__mono', text: c.ref }), el('div', { className: 'fl__cap', style: { display: 'inline-block', marginLeft: '4px' }, text: c.kind })]),
    el('td', { text: `${c.weightKg} kg` }),
    el('td', { text: c.destLabel }),
    el('td', { text: c.driver }),
    el('td', {}, [el('span', { className: `fl__pill fl__pill--${c.status === 'in_transit' ? 'ok' : 'warn'}`, text: c.status.replace(/_/g, ' ') })]),
  ]));
  return el('div', { className: 'fl__card' }, [
    el('h2', { className: 'fl__card-h', text: 'Active cargo (claimed / moving)' }),
    list.length ? el('table', { className: 'fl__table' }, [el('thead', {}, [el('tr', {}, ['Load', 'Weight', 'To', 'Driver', 'Status'].map((h) => el('th', { text: h })))]), el('tbody', {}, rows)]) : el('div', { className: 'fl__empty', text: 'No cargo claimed right now.' }),
  ]);
}

// --- vehicles (Fleet data) ---

function vehiclePanel() {
  const f = state.vForm;
  const isTruck = f.vehicleClass === 'truck';
  const sub = isTruck ? state.subtypes.find((s) => s.id === f.truckSubtype) : null;
  const formCard = el('div', { className: 'fl__card' }, [
    el('h2', { className: 'fl__card-h', text: 'Register a vehicle' }),
    el('p', { className: 'fl__card-hint', text: 'Own ID + a dashboard QR (drivers scan it to start a shift). Capacity is computed from the class / truck body; full registration + a doc photo + a factory/VIN number marks it verified.' }),
    field('Number plate', input(f.plate, (v) => { f.plate = v; })),
    el('div', { className: 'fl__row' }, [
      field('Class', select(VEHICLE_CLASSES.map((c) => ({ value: c, label: c })), f.vehicleClass, (v) => { f.vehicleClass = v; render(); })),
      isTruck ? field('Truck body', select([{ value: '', label: 'Select body…' }, ...state.subtypes.map((s) => ({ value: s.id, label: s.label }))], f.truckSubtype || '', (v) => { f.truckSubtype = v; render(); })) : field('Owner type', select([{ value: 'driver_owned', label: 'Driver owned' }, { value: 'fleet_owned', label: 'Fleet owned' }, { value: 'third_party', label: 'Third party' }], f.ownerType, (v) => { f.ownerType = v; })),
    ]),
    sub ? el('p', { className: 'fl__card-hint', style: { marginTop: '-6px' }, text: `${sub.label}: ~${sub.capacityKg} kg${[sub.coldChain && 'cold-chain', sub.bulk && 'dry-bulk', sub.liquid && 'liquid', sub.hazmat && 'hazmat', sub.oversized && 'oversized'].filter(Boolean).length ? ' · ' + [sub.coldChain && 'cold-chain', sub.bulk && 'dry-bulk', sub.liquid && 'liquid', sub.hazmat && 'hazmat', sub.oversized && 'oversized'].filter(Boolean).join(', ') : ''}` }) : null,
    el('div', { className: 'fl__row' }, [
      field('Owner name', input(f.ownerName, (v) => { f.ownerName = v; })),
      field('Load capacity (kg, optional)', input(f.capacityKg, (v) => { f.capacityKg = v; }, { type: 'number', min: '1', placeholder: 'computed if blank' })),
    ]),
    el('div', { className: 'fl__row' }, [
      field('Price per km (open data)', input(f.pricePerKm, (v) => { f.pricePerKm = v; }, { type: 'number', min: '0', step: '0.01', placeholder: 'default if blank' })),
    ]),
    el('div', { className: 'fl__row' }, [
      field('Registration photo ref', input(f.registrationPhotoRef, (v) => { f.registrationPhotoRef = v; }, { placeholder: 'reg.jpg' })),
      field('Factory / VIN number', input(f.factoryId, (v) => { f.factoryId = v; }, { placeholder: 'VIN-…' })),
    ]),
    el('button', { className: 'fl__btn-primary', attrs: { type: 'button' }, text: 'Register vehicle', onClick: submitVehicle }),
  ]);

  const vlist = state.vehicles.filter((v) => !state.activeManager || v.managerDid === state.activeManager);
  const rows = vlist.map((v) => el('tr', {}, [
    el('td', {}, [el('div', { style: { fontWeight: '700' }, text: v.plate }), el('div', { className: 'fl__mono', text: v.vehicleClass + (v.truckSubtype ? ` · ${(state.subtypes.find((s) => s.id === v.truckSubtype) || {}).label || v.truckSubtype}` : '') })]),
    el('td', {}, [el('span', { className: 'fl__pill fl__pill--info', text: v.qr })]),
    el('td', { text: `${v.capacityKg} kg` }),
    el('td', {}, [el('span', { style: { fontWeight: '700' }, text: Number(v.pricePerKm ?? 0).toFixed(3) }), el('button', { attrs: { type: 'button' }, style: { marginLeft: '8px', background: 'none', border: 'none', color: '#4c46e0', fontWeight: '700', cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }, text: 'edit', onClick: () => editVehiclePrice(v) })]),
    el('td', {}, [el('span', { className: `fl__pill fl__pill--${v.status === 'ACTIVE' ? 'ok' : 'bad'}`, text: v.status.toLowerCase() })]),
  ]));
  const listCard = el('div', { className: 'fl__card' }, [
    el('h2', { className: 'fl__card-h', text: `Vehicles · ${vlist.length}` }),
    el('p', { className: 'fl__card-hint', text: 'Print each QR and stick it on the dashboard — the driver scans it to start a shift. The per-km rate is open data — vendors quote routes against it.' }),
    vlist.length ? el('table', { className: 'fl__table' }, [el('thead', {}, [el('tr', {}, ['Vehicle', 'QR (dashboard)', 'Capacity', 'Per km', 'Status'].map((h) => el('th', { text: h })))]), el('tbody', {}, rows)]) : el('div', { className: 'fl__empty', text: state.activeManager ? 'No vehicles in this fleet yet.' : 'No vehicles yet.' }),
  ]);
  return [formCard, listCard];
}

async function editVehiclePrice(v) {
  const val = window.prompt(`Open-data price per km for ${v.plate}:`, Number(v.pricePerKm ?? 0).toFixed(3));
  if (val == null) return;
  const price = Number(val);
  if (!(price >= 0)) { state.msg = { type: 'err', text: 'Enter a valid price.' }; return render(); }
  try { await api(`/vehicles/${v.vehicleId}/pricing`, { method: 'PATCH', body: { price } }); state.msg = { type: 'ok', text: `Rate updated for ${v.plate}.` }; await loadAll(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

async function submitVehicle() {
  const f = state.vForm;
  if (!f.plate || !f.ownerName) { state.msg = { type: 'err', text: 'Plate and owner name are required.' }; return render(); }
  if (f.vehicleClass === 'truck' && !f.truckSubtype) { state.msg = { type: 'err', text: 'Pick a truck body.' }; return render(); }
  const body = { plate: f.plate, vehicleClass: f.vehicleClass, ownerName: f.ownerName, ownerType: f.ownerType };
  if (state.activeManager) body.managerDid = state.activeManager;
  if (f.vehicleClass === 'truck') body.truckSubtype = f.truckSubtype;
  if (f.capacityKg) body.capacityKg = Number(f.capacityKg);
  if (f.pricePerKm) body.pricePerKm = Number(f.pricePerKm);
  if (f.registrationPhotoRef || f.factoryId) body.documents = { registrationPhotoRef: f.registrationPhotoRef, factoryId: f.factoryId };
  try {
    const v = await api('/vehicles', { method: 'POST', body });
    state.msg = { type: 'ok', text: `Vehicle ${v.plate} registered — QR ${v.qr} (${v.capacityKg} kg${v.verified ? ', verified' : ''}).` };
    state.vForm = { vehicleClass: 'bike', ownerType: 'driver_owned' };
    await loadAll();
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- drivers ---

function driverPanel() {
  const f = state.dForm;
  const isHeavy = [...f.classes].some((c) => HEAVY_CLASSES.includes(c));
  const chips = el('div', { className: 'fl__chips' }, VEHICLE_CLASSES.map((c) => el('button', { className: `fl__chip${f.classes.has(c) ? ' is-on' : ''}`, attrs: { type: 'button' }, text: c, onClick: () => { if (f.classes.has(c)) f.classes.delete(c); else f.classes.add(c); render(); } })));

  const formCard = el('div', { className: 'fl__card' }, [
    el('h2', { className: 'fl__card-h', text: 'Onboard a driver' }),
    el('p', { className: 'fl__card-hint', text: 'Bike / motorcycle = light registry (active immediately). Any heavier class = heavy registry (licence + KYC + vetting).' }),
    el('div', { className: 'fl__row' }, [field('Display name', input(f.displayName, (v) => { f.displayName = v; }, { placeholder: 'Driver J.' })), field('Full name (vaulted)', input(f.fullName, (v) => { f.fullName = v; }))]),
    el('div', { className: 'fl__row' }, [field('National ID', input(f.nationalId, (v) => { f.nationalId = v; })), field('Mobile', input(f.mobile, (v) => { f.mobile = v; }))]),
    field('Cleared vehicle classes', chips),
    isHeavy ? el('div', { className: 'fl__row' }, [field('Licence number', input(f.licenceNumber, (v) => { f.licenceNumber = v; })), field('Licence expires', input(f.licenceExpiresAt, (v) => { f.licenceExpiresAt = v; }, { type: 'date' }))]) : el('div', { className: 'fl__card-hint', text: 'Light registry — no licence/KYC required.' }),
    isHeavy ? el('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', fontSize: '0.9rem' } }, [checkbox(Boolean(f.criminalRecordClear), (v) => { f.criminalRecordClear = v; }), 'Criminal-record check cleared']) : null,
    el('button', { className: 'fl__btn-primary', attrs: { type: 'button' }, text: 'Onboard driver', onClick: submitDriver }),
  ]);

  const dlist = state.drivers.filter((d) => !state.activeManager || d.managerDid === state.activeManager);
  const rows = dlist.map((d) => {
    const cls = { ACTIVE: 'ok', KYC_PENDING: 'warn', DRAFT: 'info', SUSPENDED: 'bad' }[d.status] || 'info';
    const actions = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, []);
    if (d.status === 'DRAFT' && d.registry === 'heavy') actions.append(el('button', { className: 'fl__act', attrs: { type: 'button' }, text: 'Submit KYC', onClick: () => submitKyc(d.did) }));
    if (d.status === 'KYC_PENDING') { actions.append(el('button', { className: 'fl__act fl__act--go', attrs: { type: 'button' }, text: 'Approve', onClick: () => decideKyc(d.did, true) })); actions.append(el('button', { className: 'fl__act fl__act--no', attrs: { type: 'button' }, text: 'Reject', onClick: () => decideKyc(d.did, false) })); }
    if (d.status === 'ACTIVE') actions.append(el('button', { className: 'fl__act fl__act--no', attrs: { type: 'button' }, text: 'Suspend', onClick: () => suspendDriver(d.did) }));
    return el('tr', {}, [
      el('td', {}, [el('div', { style: { fontWeight: '700' }, text: d.displayName }), el('div', { className: 'fl__mono', text: d.badgeId || short(d.did) })]),
      el('td', { text: d.registry }),
      el('td', { text: (d.licence?.classes || []).join(', ') }),
      el('td', {}, [el('span', { className: `fl__pill fl__pill--${cls}`, text: d.status.replace(/_/g, ' ').toLowerCase() })]),
      el('td', {}, [actions]),
    ]);
  });
  const listCard = el('div', { className: 'fl__card' }, [
    el('h2', { className: 'fl__card-h', text: `Drivers pool · ${dlist.length}` }),
    dlist.length ? el('table', { className: 'fl__table' }, [el('thead', {}, [el('tr', {}, ['Driver', 'Registry', 'Cleared for', 'Status', ''].map((h) => el('th', { text: h })))]), el('tbody', {}, rows)]) : el('div', { className: 'fl__empty', text: state.activeManager ? 'No drivers in this fleet yet.' : 'No drivers yet.' }),
  ]);
  return [formCard, listCard];
}

function checkbox(checked, onchange) {
  const node = el('input', { attrs: { type: 'checkbox', ...(checked ? { checked: 'checked' } : {}) } });
  node.addEventListener('change', () => onchange(node.checked));
  return node;
}

async function submitDriver() {
  const f = state.dForm;
  const licenceClasses = [...f.classes];
  if (!f.displayName || !f.fullName || !f.nationalId || !f.mobile || !licenceClasses.length) { state.msg = { type: 'err', text: 'Fill name, ID, mobile and at least one vehicle class.' }; return render(); }
  const body = { displayName: f.displayName, fullName: f.fullName, nationalId: f.nationalId, mobile: f.mobile, licenceClasses };
  if (state.activeManager) body.managerDid = state.activeManager;
  if (licenceClasses.some((c) => HEAVY_CLASSES.includes(c))) {
    body.licenceNumber = f.licenceNumber;
    body.licenceExpiresAt = f.licenceExpiresAt ? new Date(f.licenceExpiresAt).toISOString() : undefined;
    body.criminalRecordClear = Boolean(f.criminalRecordClear);
  }
  try {
    const d = await api('/drivers/onboard', { method: 'POST', body });
    state.msg = { type: 'ok', text: `Driver ${d.displayName} onboarded (${d.registry}${d.status === 'ACTIVE' ? `, badge ${d.badgeId}` : ', awaiting KYC'}).` };
    state.dForm = { classes: new Set(['bike']) };
    await loadAll();
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}
async function submitKyc(did) {
  try { await api(`/fleet/drivers/${did}/submit-kyc`, { method: 'POST', body: { idCopyRef: 'id.jpg', licenceCopyRef: 'licence.jpg' } }); state.msg = { type: 'ok', text: 'KYC documents submitted — ready to vet.' }; await loadAll(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}
async function decideKyc(did, approve) {
  try { await api(`/fleet/drivers/${did}/kyc-decision`, { method: 'POST', body: { approve, by: 'fleet-manager' } }); state.msg = { type: 'ok', text: approve ? 'Driver approved — badge issued.' : 'Driver rejected.' }; await loadAll(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}
async function suspendDriver(did) {
  try { await api(`/fleet/drivers/${did}/suspend`, { method: 'POST', body: {} }); state.msg = { type: 'ok', text: 'Driver suspended.' }; await loadAll(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- sessions / coupling ---

function couplePanel() {
  const f = state.cForm;
  const coupledDriverDids = new Set(state.assignments.map((a) => a.driverDid));
  const coupledVehicleIds = new Set(state.assignments.map((a) => a.vehicleId));
  const freeDrivers = state.drivers.filter((d) => d.status === 'ACTIVE' && !coupledDriverDids.has(d.did));
  const freeVehicles = state.vehicles.filter((v) => v.status === 'ACTIVE' && !coupledVehicleIds.has(v.vehicleId));

  const formCard = el('div', { className: 'fl__card' }, [
    el('h2', { className: 'fl__card-h', text: 'Couple manually (admin)' }),
    el('p', { className: 'fl__card-hint', text: 'Drivers normally start a shift themselves by scanning the vehicle QR in their app. Use this to couple on their behalf.' }),
    field('Driver', select([{ value: '', label: 'Select driver…' }, ...freeDrivers.map((d) => ({ value: d.did, label: `${d.displayName} (${(d.licence?.classes || []).join('/')})` }))], f.driverDid || '', (v) => { f.driverDid = v; })),
    field('Vehicle', select([{ value: '', label: 'Select vehicle…' }, ...freeVehicles.map((v) => ({ value: v.vehicleId, label: `${v.plate} · ${v.vehicleClass} · ${v.capacityKg}kg` }))], f.vehicleId || '', (v) => { f.vehicleId = v; })),
    field('Corridor (optional)', select([{ value: '', label: 'No corridor' }, ...state.corridors.map((c) => ({ value: c.corridorId, label: `${c.name} (${c.originZone}→${c.destZone})` }))], f.corridorId || '', (v) => { f.corridorId = v; })),
    el('button', { className: 'fl__btn-primary', attrs: { type: 'button', ...(freeDrivers.length && freeVehicles.length ? {} : { disabled: 'disabled' }) }, text: 'Couple', onClick: submitCouple }),
  ]);

  const rows = state.assignments.map((a) => {
    const d = state.drivers.find((x) => x.did === a.driverDid);
    const v = state.vehicles.find((x) => x.vehicleId === a.vehicleId);
    const cor = state.corridors.find((x) => x.corridorId === a.corridorId);
    return el('tr', {}, [
      el('td', { text: d ? d.displayName : short(a.driverDid) }),
      el('td', {}, [el('span', { className: 'fl__mono', text: v ? `${v.plate} · ${v.vehicleClass}` : short(a.vehicleId) })]),
      el('td', { text: cor ? cor.name : '—' }),
      el('td', {}, [el('button', { className: 'fl__act fl__act--no', attrs: { type: 'button' }, text: 'End session', onClick: () => uncouple(a.driverDid) })]),
    ]);
  });
  const listCard = el('div', { className: 'fl__card' }, [
    el('h2', { className: 'fl__card-h', text: `Active sessions · ${state.assignments.length}` }),
    el('p', { className: 'fl__card-hint', text: 'Driver↔vehicle couplings on duty right now (a driver QR scan or a manual couple). End-of-shift closes them.' }),
    state.assignments.length ? el('table', { className: 'fl__table' }, [el('thead', {}, [el('tr', {}, ['Driver', 'Vehicle', 'Corridor', ''].map((h) => el('th', { text: h })))]), el('tbody', {}, rows)]) : el('div', { className: 'fl__empty', text: 'No drivers on shift.' }),
  ]);
  return [formCard, listCard];
}

async function submitCouple() {
  const f = state.cForm;
  if (!f.driverDid || !f.vehicleId) { state.msg = { type: 'err', text: 'Pick a driver and a vehicle.' }; return render(); }
  try {
    await api(`/fleet/drivers/${f.driverDid}/couple`, { method: 'POST', body: { vehicleId: f.vehicleId, ...(f.corridorId ? { corridorId: f.corridorId } : {}) } });
    state.msg = { type: 'ok', text: 'Coupled.' };
    state.cForm = {};
    await loadAll();
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}
async function uncouple(driverDid) {
  try { await api(`/fleet/drivers/${driverDid}/uncouple`, { method: 'POST', body: {} }); state.msg = { type: 'ok', text: 'Session ended.' }; await loadAll(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- managers (the fleet operator's own onboarding) ---

function managerPanel() {
  const f = state.mForm;
  const formCard = el('div', { className: 'fl__card' }, [
    el('h2', { className: 'fl__card-h', text: 'Onboard a fleet manager' }),
    el('p', { className: 'fl__card-hint', text: 'The operator who owns the vehicles + employs the drivers. Requires a business registration, a transport-operator licence and a tax ID; then KYC vetting and a refundable operating bond before they may build a fleet.' }),
    el('div', { className: 'fl__row' }, [field('Company name', input(f.companyName, (v) => { f.companyName = v; })), field('Trading name (optional)', input(f.tradingName, (v) => { f.tradingName = v; }))]),
    el('div', { className: 'fl__row' }, [field('Contact phone', input(f.contactPhone, (v) => { f.contactPhone = v; })), field('Contact email (optional)', input(f.contactEmail, (v) => { f.contactEmail = v; }))]),
    el('div', { className: 'fl__row' }, [field('Owner full name (vaulted)', input(f.ownerFullName, (v) => { f.ownerFullName = v; })), field('Owner national ID', input(f.ownerNationalId, (v) => { f.ownerNationalId = v; }))]),
    field('Depot address', input(f.depotAddress, (v) => { f.depotAddress = v; }, { placeholder: 'Depot / office address' })),
    el('div', { className: 'fl__row' }, [field('Business registration no.', input(f.businessRegistrationNo, (v) => { f.businessRegistrationNo = v; })), field('Transport-operator licence', input(f.transportOperatorLicence, (v) => { f.transportOperatorLicence = v; }))]),
    el('div', { className: 'fl__row' }, [field('Tax ID', input(f.taxId, (v) => { f.taxId = v; })), field('Declared fleet size (optional)', input(f.declaredFleetSize, (v) => { f.declaredFleetSize = v; }, { type: 'number', min: '1' }))]),
    el('button', { className: 'fl__btn-primary', attrs: { type: 'button' }, text: 'Register fleet manager', onClick: submitManager }),
  ]);

  const rows = state.managers.map((m) => {
    const cls = { ACTIVE: 'ok', APPROVED: 'warn', KYC_PENDING: 'warn', DRAFT: 'info', SUSPENDED: 'bad' }[m.status] || 'info';
    const actions = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, []);
    if (m.status === 'DRAFT') actions.append(el('button', { className: 'fl__act', attrs: { type: 'button' }, text: 'Submit KYC', onClick: () => managerSubmitKyc(m.did) }));
    if (m.status === 'KYC_PENDING') { actions.append(el('button', { className: 'fl__act fl__act--go', attrs: { type: 'button' }, text: 'Approve', onClick: () => managerDecide(m.did, true) })); actions.append(el('button', { className: 'fl__act fl__act--no', attrs: { type: 'button' }, text: 'Reject', onClick: () => managerDecide(m.did, false) })); }
    if (m.status === 'APPROVED') actions.append(el('button', { className: 'fl__act fl__act--go', attrs: { type: 'button' }, text: 'Record bond → Activate', onClick: () => managerBond(m.did) }));
    if (m.status === 'ACTIVE') actions.append(el('button', { className: 'fl__act fl__act--no', attrs: { type: 'button' }, text: 'Suspend', onClick: () => suspendManager(m.did) }));
    return el('tr', {}, [
      el('td', {}, [el('div', { style: { fontWeight: '700' }, text: m.companyName }), el('div', { className: 'fl__mono', text: m.loginCode ? `sign-in ${m.loginCode}` : (m.requirements?.transportOperatorLicence || short(m.did)) })]),
      el('td', { text: `${state.vehicles.filter((v) => v.managerDid === m.did).length}v · ${state.drivers.filter((d) => d.managerDid === m.did).length}d` }),
      el('td', {}, [el('span', { className: `fl__pill fl__pill--${cls}`, text: m.status.replace(/_/g, ' ').toLowerCase() })]),
      el('td', {}, [actions]),
    ]);
  });
  const listCard = el('div', { className: 'fl__card' }, [
    el('h2', { className: 'fl__card-h', text: `Fleet managers · ${state.managers.length}` }),
    state.managers.length ? el('table', { className: 'fl__table' }, [el('thead', {}, [el('tr', {}, ['Company', 'Fleet', 'Status', ''].map((h) => el('th', { text: h })))]), el('tbody', {}, rows)]) : el('div', { className: 'fl__empty', text: 'No fleet managers yet.' }),
  ]);
  return [formCard, listCard];
}

async function submitManager() {
  const f = state.mForm;
  if (!f.companyName || !f.contactPhone || !f.ownerFullName || !f.ownerNationalId) { state.msg = { type: 'err', text: 'Company, phone, and owner name + ID are required.' }; return render(); }
  const body = {
    companyName: f.companyName, tradingName: f.tradingName, contactPhone: f.contactPhone, contactEmail: f.contactEmail,
    ownerFullName: f.ownerFullName, ownerNationalId: f.ownerNationalId, depotAddress: f.depotAddress,
    requirements: { businessRegistrationNo: f.businessRegistrationNo, transportOperatorLicence: f.transportOperatorLicence, taxId: f.taxId, ...(f.declaredFleetSize ? { declaredFleetSize: Number(f.declaredFleetSize) } : {}) },
  };
  try {
    const m = await api('/fleet/managers', { method: 'POST', body });
    state.msg = { type: 'ok', text: `${m.companyName} registered (${m.status}). Submit KYC, vet, then record the bond to activate.` };
    state.mForm = {};
    await loadAll();
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}
async function managerSubmitKyc(did) {
  try { await api(`/fleet/managers/${did}/submit-kyc`, { method: 'POST', body: { businessRegCertRef: 'reg-cert.pdf', operatorLicenceRef: 'operator-licence.pdf', ownerIdRef: 'owner-id.jpg', proofOfAddressRef: 'proof-address.pdf' } }); state.msg = { type: 'ok', text: 'Business KYC submitted — ready to vet.' }; await loadAll(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}
async function managerDecide(did, approve) {
  try { await api(`/fleet/managers/${did}/kyc-decision`, { method: 'POST', body: { approve, by: 'glos-ops' } }); state.msg = { type: 'ok', text: approve ? 'Approved — record the operating bond to activate.' : 'Manager rejected.' }; await loadAll(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}
async function managerBond(did) {
  try { await api(`/fleet/managers/${did}/bond`, { method: 'POST', body: {} }); state.msg = { type: 'ok', text: 'Operating bond recorded — fleet manager is ACTIVE.' }; await loadAll(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}
async function suspendManager(did) {
  try { await api(`/fleet/managers/${did}/suspend`, { method: 'POST', body: {} }); state.msg = { type: 'ok', text: 'Manager suspended.' }; await loadAll(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- render ---

function render() {
  if (!state.session) { mount(root, loginScreen()); state.msg = null; return; }
  const parts = [topBar()];
  if (state.msg) parts.push(el('div', { className: `fl__msg fl__msg--${state.msg.type}`, text: state.msg.text }));
  if (state.loading) { parts.push(el('div', { className: 'fl__empty', text: 'Loading fleet…' })); mount(root, parts); return; }
  if (state.activeManager) {
    const co = (state.managers.find((m) => m.did === state.activeManager) || {}).companyName || 'fleet';
    parts.push(el('div', { className: 'fl__card-hint', style: { margin: '-8px 0 14px' }, text: `Scoped to ${co} — registrations are filed under this fleet. Switch to “All fleets” for the network view.` }));
  }
  if (state.view === 'dashboard') parts.push(...dashboardView());
  else if (state.view === 'vehicles') parts.push(el('div', { className: 'fl__grid' }, vehiclePanel().map((c) => el('div', {}, [c]))));
  else if (state.view === 'drivers') parts.push(el('div', { className: 'fl__grid' }, driverPanel().map((c) => el('div', {}, [c]))));
  else if (state.view === 'sessions') parts.push(...couplePanel());
  else if (state.view === 'managers' && !isManager()) parts.push(el('div', { className: 'fl__grid' }, managerPanel().map((c) => el('div', {}, [c]))));
  mount(root, parts);
}

// --- boot ---
function boot() {
  const qs = new URLSearchParams(location.search);
  const restored = savedSession();
  if (qs.get('manager')) { setSession({ mode: 'manager', managerDid: qs.get('manager'), company: 'My fleet' }); return; }
  if (qs.has('ops')) { setSession({ mode: 'operator' }); return; }
  if (restored) { setSession(restored); return; }
  render(); // show the sign-in screen
}
boot();
