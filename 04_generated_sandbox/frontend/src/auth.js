// GLOS participant auth — one shared module behind the sign-in / forgot / sign-up pages for the three
// field apps. Each page sets `window.GLOS_AUTH = { mode, role }` then loads this file. Sign-up is a
// role-specific multi-step wizard that creates the account + the domain entity and drops the user into
// their app. Real email+password (hashed on the backend); reset token shown on screen (no email infra).

import { el, mount } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const CFG = window.GLOS_AUTH || { mode: 'signin', role: 'pudo' };
const root = document.getElementById('auth');

const HEAVY = ['tuktuk', 'car', 'van', 'bus', 'truck'];
const VCLASSES = ['bike', 'motorcycle', 'tuktuk', 'car', 'van', 'bus', 'truck'];
const TRUCK_BODIES = ['flatbed', 'box', 'refrigerated', 'tipper', 'tanker', 'curtain_side', 'lowboy'];
const rand = () => Math.random().toString(16).slice(2, 8);
const appUrl = (role, did) => ({ pudo: `agent.html?agent=${encodeURIComponent(did)}`, driver: `driver.html?driver=${encodeURIComponent(did)}`, mdp: `mdp.html?mdp=${encodeURIComponent(did)}` })[role];
const ROLE_LABEL = { pudo: 'PUDO agent', driver: 'Driver', mdp: 'MDP hub' };

let token = null;
async function getToken() {
  if (token) return token;
  const r = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'pudo-auth', type: 'client_credentials' }) });
  token = (await r.json()).access_token;
  return token;
}
async function api(path, body) {
  const t = await getToken();
  const r = await fetch(`${API}/pudo${path}`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || `Error ${r.status}`);
  return data;
}

const state = { step: 0, form: {}, msg: null, reset: null, done: null, phoneSent: false, phoneVerified: false, otpDemo: null };

// --- small DOM helpers ---
function brand() { return el('div', { className: 'pnl-brand' }, [el('b', { text: 'GLOS · PUDO' }), el('span', { text: ROLE_LABEL[CFG.role] })]); }
function input(name, attrs = {}) {
  const node = el('input', { className: 'pnl-input', attrs: { value: state.form[name] || '', ...attrs } });
  node.addEventListener('input', () => { state.form[name] = node.value; });
  return node;
}
function fieldRow(label, control, hint) { return el('div', { className: 'pnl-field' }, [el('label', { className: 'pnl-label', text: label }), control, ...(hint ? [el('div', { className: 'pnl-hint', text: hint })] : [])]); }
function msgBanner() { if (!state.msg) return null; const m = el('div', { className: `pnl-msg pnl-msg--${state.msg.type}`, text: state.msg.text }); state.msg = null; return m; }

// --- SIGN IN ---
function signinView() {
  const email = input('email', { type: 'email', placeholder: 'you@example.com' });
  const pw = input('password', { type: 'password', placeholder: 'Your password' });
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  return el('div', { className: 'pnl-auth' }, [
    el('div', { className: 'pnl-swoosh' }), brand(),
    el('h1', { className: 'pnl-h1', text: 'Sign in' }),
    el('p', { className: 'pnl-sub', text: `Access your ${ROLE_LABEL[CFG.role]} app.` }),
    msgBanner(),
    el('div', { className: 'pnl-card' }, [
      fieldRow('Email', email),
      fieldRow('Password', pw),
      el('button', { className: 'pnl-btn pnl-btn--block', attrs: { type: 'button' }, text: 'Sign in', onClick: doLogin }),
      el('div', { className: 'pnl-foot' }, [
        el('a', { className: 'pnl-link', attrs: { href: `forgot-${CFG.role}.html` }, text: 'Forgot password?' }),
        el('a', { className: 'pnl-link', attrs: { href: `signup-${CFG.role}.html` }, text: 'Create new account' }),
      ]),
    ]),
  ]);
}
async function doLogin() {
  if (!state.form.email || !state.form.password) { state.msg = { type: 'err', text: 'Enter your email and password.' }; return render(); }
  try { const r = await api('/auth/login', { email: state.form.email, password: state.form.password }); location.href = appUrl(r.role, r.did); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- FORGOT / RESET ---
function forgotView() {
  if (state.reset) {
    const token2 = input('token', { placeholder: 'RST-XXXX', style: 'text-transform:uppercase' });
    const npw = input('newpw', { type: 'password', placeholder: 'New password (min 6)' });
    return el('div', { className: 'pnl-auth' }, [
      el('div', { className: 'pnl-swoosh' }), brand(),
      el('h1', { className: 'pnl-h1', text: 'Reset password' }),
      el('p', { className: 'pnl-sub', text: 'Demo: your reset token is shown below (it would be emailed in production).' }),
      msgBanner(),
      el('div', { className: 'pnl-card' }, [
        el('div', { className: 'pnl-msg pnl-msg--ok', text: `Reset token: ${state.reset}` }),
        fieldRow('Reset token', token2),
        fieldRow('New password', npw),
        el('button', { className: 'pnl-btn pnl-btn--block', attrs: { type: 'button' }, text: 'Set new password', onClick: doReset }),
      ]),
    ]);
  }
  const email = input('email', { type: 'email', placeholder: 'you@example.com' });
  return el('div', { className: 'pnl-auth' }, [
    el('div', { className: 'pnl-swoosh' }), brand(),
    el('h1', { className: 'pnl-h1', text: 'Forgot password' }),
    el('p', { className: 'pnl-sub', text: 'Enter your email and we’ll issue a reset token.' }),
    msgBanner(),
    el('div', { className: 'pnl-card' }, [
      fieldRow('Email', email),
      el('button', { className: 'pnl-btn pnl-btn--block', attrs: { type: 'button' }, text: 'Send reset token', onClick: doForgot }),
      el('div', { className: 'pnl-foot' }, [el('a', { className: 'pnl-link', attrs: { href: `signin-${CFG.role}.html` }, text: '‹ Back to sign in' })]),
    ]),
  ]);
}
async function doForgot() {
  try { const r = await api('/auth/forgot', { email: state.form.email || '' }); state.reset = r.resetToken || 'check your email'; state.form.token = r.resetToken || ''; }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; }
  render();
}
async function doReset() {
  try { await api('/auth/reset', { token: state.form.token, password: state.form.newpw || '' }); location.href = `signin-${CFG.role}.html`; }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- SIGN UP (wizard) ---
const WIZ = {
  pudo: {
    eyebrow: 'Become a PUDO point', title: 'Sign up your shop as a PUDO point',
    sub: 'Turn your storefront into a pick-up/drop-off point. Accept parcels, hand them to the bus, release to customers — earn a fee on every handling.',
    bullets: [['Earn', 'A labour fee on every parcel you handle'], ['Pre-paid', 'GLOS never touches your cash — top up a wallet'], ['Simple', 'Three big tasks: accept · hand to bus · release']],
    shots: ['Accept a parcel', 'Hand to bus', 'Release to customer'],
    need: ['A storefront with shelving (rows × columns)', 'Your ID + trading licence', 'A storefront photo', 'An Android phone'],
    steps: ['Account', 'Contact', 'Your shop', 'Shelf', 'ID & docs', 'Get started'],
  },
  driver: {
    eyebrow: 'Drive with GLOS', title: 'Sign up to drive',
    sub: 'Move parcels on the corridors and the MDP→PUDO feeder. Work for yourself with your own vehicle, or join an existing fleet.',
    bullets: [['Flexible', 'Find work on your route and claim it'], ['Your vehicle', 'Register your own, or use a fleet’s'], ['Scan to start', 'Begin a shift by scanning the vehicle QR']],
    shots: ['Find work', 'Claim a load', 'My loads'],
    need: ['Your ID + driving licence (for cars/trucks)', 'Vehicle details (if self-employed)', 'Or your fleet’s sign-in code'],
    steps: ['Account', 'Contact', 'How you drive', 'You', 'Licence', 'Get started'],
  },
  mdp: {
    eyebrow: 'Run an MDP hub', title: 'Sign up your MDP sort hub',
    sub: 'Operate a Main Distribution Point: receive bags, empty + sort parcels into next-hop totes, and dispatch them onward across the zones you serve.',
    bullets: [['Sort fast', 'Bag-level scan in, parcel-level sort out'], ['Tote bags', 'Reusable QR totes by next destination'], ['Multi-zone', 'Serve one or more delivery zones']],
    shots: ['Drop a bag', 'Sort parcels', 'Load onward'],
    need: ['Hub name + the zones you serve', 'The hub’s address + map location'],
    steps: ['Account', 'Contact', 'Your hub', 'Get started'],
  },
};

// --- shared Contact step: a verified phone (control-tower escalation + GPS) ---
async function sendOtp() {
  if (!state.form.phone) { state.msg = { type: 'err', text: 'Enter your phone number.' }; return render(); }
  try { const r = await api('/auth/phone/request', { phone: state.form.phone }); state.phoneSent = true; state.otpDemo = r.code; }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; }
  render();
}
async function verifyOtp() {
  try { await api('/auth/phone/verify', { phone: state.form.phone, code: state.form.otp || '' }); state.phoneVerified = true; state.otpDemo = null; }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; }
  render();
}
function contactStep() {
  const phone = input('phone', { type: 'tel', placeholder: '+2547…' });
  const out = [fieldRow('Mobile phone (required)', phone, 'The control tower contacts you on this for escalations; it anchors GPS tracking.')];
  if (state.phoneVerified) { out.push(el('div', { className: 'pnl-verified', text: '✓ Phone verified' })); return out; }
  if (!state.phoneSent) { out.push(el('button', { className: 'pnl-btn pnl-btn--ghost', attrs: { type: 'button' }, text: 'Send verification code', onClick: sendOtp })); return out; }
  if (state.otpDemo) out.push(el('div', { className: 'pnl-msg pnl-msg--ok', text: `Demo code (would be SMS'd): ${state.otpDemo}` }));
  const code = input('otp', { placeholder: '4-digit code', inputmode: 'numeric', maxlength: '4' });
  out.push(el('div', { className: 'pnl-otp' }, [code, el('button', { className: 'pnl-btn', attrs: { type: 'button' }, text: 'Verify', onClick: verifyOtp })]));
  out.push(el('button', { className: 'pnl-link', attrs: { type: 'button' }, text: 'Resend code', onClick: sendOtp }));
  return out;
}

// --- shared address + map pin picker (region-scoped) ---
function locationPicker() {
  const f = state.form;
  const surface = el('div', { className: 'pnl-map__surface' });
  if (f._px != null) { const pin = el('span', { className: 'pnl-map__pin', text: '📍' }); pin.style.left = `${f._px}%`; pin.style.top = `${f._py}%`; surface.append(pin); }
  surface.addEventListener('click', (e) => {
    const r = surface.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 100, py = ((e.clientY - r.top) / r.height) * 100;
    const BASE = { lat: -1.28, lng: 36.82 }, SPAN = 0.6; // network centroid bounding box
    f.lng = Math.round((BASE.lng - SPAN / 2 + (px / 100) * SPAN) * 1e5) / 1e5;
    f.lat = Math.round((BASE.lat + SPAN / 2 - (py / 100) * SPAN) * 1e5) / 1e5;
    f._px = px; f._py = py; render();
  });
  const readout = el('div', { className: 'pnl-map__readout', text: f.lat != null ? `Pinned: ${f.lat}, ${f.lng}` : 'Tap the map to drop a pin' });
  const useLoc = el('button', { className: 'pnl-link', attrs: { type: 'button' }, text: 'Use my location', onClick: () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => { f.lat = Math.round(pos.coords.latitude * 1e5) / 1e5; f.lng = Math.round(pos.coords.longitude * 1e5) / 1e5; f._px = 50; f._py = 50; render(); });
  } });
  return el('div', { className: 'pnl-field' }, [el('label', { className: 'pnl-label', text: 'Choose location from map' }), el('div', { className: 'pnl-map' }, [surface, el('div', { className: 'pnl-map__bar' }, [readout, useLoc])])]);
}

function stepRail(steps) {
  return el('div', { className: 'pnl-steps' }, steps.map((s, i) => el('div', { className: `pnl-step${i === state.step ? ' is-on' : ''}${i < state.step ? ' is-done' : ''}` }, [el('b', { text: i < state.step ? '✓' : String(i + 1) }), s])));
}
function chips(name, opts, multi) {
  const cur = state.form[name] || (multi ? [] : '');
  return el('div', { className: 'pnl-chips' }, opts.map((o) => {
    const on = multi ? cur.includes(o) : cur === o;
    return el('button', { className: `pnl-chip${on ? ' is-on' : ''}`, attrs: { type: 'button' }, text: o.replace(/_/g, ' '), onClick: () => {
      if (multi) { const set = new Set(state.form[name] || []); if (set.has(o)) set.delete(o); else set.add(o); state.form[name] = [...set]; }
      else state.form[name] = o;
      render();
    } });
  }));
}
function checkbox(name, label) {
  const node = el('input', { attrs: { type: 'checkbox', ...(state.form[name] ? { checked: 'checked' } : {}) } });
  node.addEventListener('change', () => { state.form[name] = node.checked; });
  return el('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.92rem', marginBottom: '12px' } }, [node, label]);
}

function pudoStep(i) {
  const f = state.form;
  if (i === 0) return [fieldRow('Email', input('email', { type: 'email', placeholder: 'shop@example.com' })), fieldRow('Password', input('password', { type: 'password', placeholder: 'Min 6 characters' }))];
  if (i === 1) return contactStep();
  if (i === 2) return [fieldRow('Shop name', input('shopName')), el('div', { className: 'pnl-row' }, [fieldRow('Zone', input('zone', { placeholder: 'e.g. NorthTown' })), fieldRow('Landmark', input('landmark'))]), fieldRow('Address', input('address', { placeholder: 'Street / area' })), locationPicker()];
  if (i === 3) return [el('p', { className: 'pnl-hint', text: 'Your chaos-shelf as a grid: columns get a colour, rows a number (e.g. Green-3). Min 6 slots.' }), el('div', { className: 'pnl-row' }, [fieldRow('Rows', input('rows', { type: 'number', min: '1', value: f.rows || '3' })), fieldRow('Columns', input('cols', { type: 'number', min: '1', value: f.cols || '3' }))]), el('div', { className: 'pnl-row' }, [fieldRow('Opens', input('open', { type: 'time', value: f.open || '08:00' })), fieldRow('Closes', input('close', { type: 'time', value: f.close || '18:00' }))])];
  if (i === 4) return [el('div', { className: 'pnl-row' }, [fieldRow('Full name', input('fullName')), fieldRow('National ID', input('nationalId'))]), fieldRow('Trading licence no.', input('tradingLicence')), fieldRow('Storefront photo', input('shopPhotoRef', { type: 'file' })), checkbox('criminalRecordClear', 'I confirm a clean criminal record'), checkbox('reliablePower', 'My shop has reliable power')];
  return [el('div', { className: 'pnl-need' }, [el('h3', { text: 'Almost done — your starter kit' }), el('ul', {}, ['QR sticker rolls + a shelf label set', 'The PUDO Agent app (Android)', 'A quick get-started walkthrough'].map((t) => el('li', { text: t })))]), checkbox('starterKit', 'Apply for the starter kit'), el('p', { className: 'pnl-hint', text: 'On submit we create your PUDO and your account. Your shop is reviewed (KYC) before it goes live.' })];
}
function driverStep(i) {
  const f = state.form;
  const heavy = (f.licenceClasses || []).some((c) => HEAVY.includes(c));
  if (i === 0) return [fieldRow('Email', input('email', { type: 'email' })), fieldRow('Password', input('password', { type: 'password', placeholder: 'Min 6 characters' }))];
  if (i === 1) return contactStep();
  if (i === 2) return [el('label', { className: 'pnl-label', text: 'How do you drive?' }), chips('path', ['self', 'fleet'], false), ...(f.path === 'fleet' ? [el('div', { style: { marginTop: '12px' } }, [fieldRow('Fleet sign-in code', input('fleetCode', { placeholder: 'FM-XXXX', style: 'text-transform:uppercase' }), 'From your fleet manager — your vehicle is already registered.')])] : []), ...(f.path === 'self' ? [el('p', { className: 'pnl-hint', style: { marginTop: '10px' }, text: 'Self-employed: you’ll register your own vehicle next.' })] : [])];
  if (i === 3) return [el('div', { className: 'pnl-row' }, [fieldRow('Display name', input('displayName', { placeholder: 'Driver J.' })), fieldRow('Full name', input('fullName'))]), fieldRow('National ID', input('nationalId'))];
  if (i === 4) {
    const out = [el('label', { className: 'pnl-label', text: 'Vehicle classes you can operate' }), chips('licenceClasses', VCLASSES, true)];
    if (heavy) out.push(el('div', { className: 'pnl-row', style: { marginTop: '12px' } }, [fieldRow('Licence number', input('licenceNumber')), fieldRow('Licence expires', input('licenceExpiresAt', { type: 'date' }))]), checkbox('criminalRecordClear', 'Clean criminal record confirmed'));
    if (f.path === 'self') {
      out.push(el('label', { className: 'pnl-label', style: { marginTop: '10px' }, text: 'Your vehicle' }), el('div', { className: 'pnl-row' }, [fieldRow('Plate', input('plate')), fieldRow('Class', select('vehicleClass', VCLASSES, f.vehicleClass || 'motorcycle'))]));
      if (f.vehicleClass === 'truck') out.push(fieldRow('Truck body', select('truckSubtype', TRUCK_BODIES, f.truckSubtype || 'box')));
    }
    return out;
  }
  return [el('div', { className: 'pnl-need' }, [el('h3', { text: 'You’re set' }), el('ul', {}, ['Download the Driver app', 'Scan your vehicle’s QR to start a shift', 'Find work on your route'].map((t) => el('li', { text: t })))]), el('p', { className: 'pnl-hint', text: heavy ? 'Heavy classes need a quick KYC review before you can be coupled to a vehicle.' : 'Bike/motorcycle: you’re active immediately.' })];
}
function mdpStep(i) {
  if (i === 0) return [fieldRow('Email', input('email', { type: 'email' })), fieldRow('Password', input('password', { type: 'password', placeholder: 'Min 6 characters' }))];
  if (i === 1) return contactStep();
  if (i === 2) return [fieldRow('Hub name', input('name', { placeholder: 'e.g. East Sort Hub' })), fieldRow('Zones served', input('zones', { placeholder: 'Comma-separated, e.g. EastTown, SouthTown' })), fieldRow('Address', input('address', { placeholder: 'Depot / hub address' })), locationPicker()];
  return [el('div', { className: 'pnl-need' }, [el('h3', { text: 'Your sort floor' }), el('ul', {}, ['Register tote bags (laminated QR)', 'Drop → empty → sort → re-bag', 'Dispatch onward by zone'].map((t) => el('li', { text: t })))]), el('p', { className: 'pnl-hint', text: 'An MDP can also register as a PUDO separately.' })];
}
function select(name, opts, value) {
  const node = el('select', { className: 'pnl-select' }, opts.map((o) => el('option', { text: o.replace(/_/g, ' '), attrs: { value: o, ...(o === value ? { selected: 'selected' } : {}) } })));
  node.addEventListener('change', () => { state.form[name] = node.value; render(); });
  state.form[name] = state.form[name] || value;
  return node;
}

function stepFields(role, i) { return ({ pudo: pudoStep, driver: driverStep, mdp: mdpStep })[role](i); }

function signupView() {
  const w = WIZ[CFG.role];
  if (state.done) {
    return el('div', { className: 'pnl-auth' }, [
      el('div', { className: 'pnl-swoosh' }), brand(),
      el('h1', { className: 'pnl-h1', text: 'Account created' }),
      el('p', { className: 'pnl-sub', text: state.done.note }),
      el('div', { className: 'pnl-card' }, [
        el('div', { className: 'pnl-msg pnl-msg--ok', text: `Signed up as ${ROLE_LABEL[CFG.role]}.` }),
        el('button', { className: 'pnl-btn pnl-btn--block', attrs: { type: 'button' }, text: 'Go to your app', onClick: () => { location.href = appUrl(CFG.role, state.done.did); } }),
        el('div', { className: 'pnl-foot' }, [el('a', { className: 'pnl-link', attrs: { href: `signin-${CFG.role}.html` }, text: 'Or sign in later' })]),
      ]),
    ]);
  }
  const last = state.step === w.steps.length - 1;
  const info = el('div', {}, [
    el('div', { className: 'pnl-swoosh' }),
    el('div', { className: 'pnl-eyebrow', style: { marginTop: '16px' }, text: w.eyebrow }),
    el('h1', { className: 'pnl-h1', text: w.title }),
    el('p', { className: 'pnl-sub', text: w.sub }),
    el('div', { className: 'pnl-bullets' }, w.bullets.map((b) => el('div', { className: 'pnl-bullet' }, [el('div', { className: 'pnl-bullet-ic', text: '✓' }), el('div', {}, [el('div', { className: 'pnl-bullet-t', text: b[0] }), el('div', { className: 'pnl-bullet-s', text: b[1] })])]))),
    el('div', { className: 'pnl-shots' }, w.shots.map((s) => el('div', { className: 'pnl-shot' }, [el('span', { text: s })]))),
    el('div', { className: 'pnl-need', style: { marginTop: '18px' } }, [el('h3', { text: 'What you’ll need' }), el('ul', {}, w.need.map((n) => el('li', { text: n })))]),
  ]);
  const formCard = el('div', { className: 'pnl-card' }, [
    stepRail(w.steps),
    el('h2', { className: 'pnl-h2', text: w.steps[state.step] }),
    ...(state.msg ? [msgBanner()] : []),
    el('div', {}, stepFields(CFG.role, state.step)),
    el('div', { className: 'pnl-btns', style: { marginTop: '8px' } }, [
      ...(state.step > 0 ? [el('button', { className: 'pnl-btn pnl-btn--ghost', attrs: { type: 'button' }, text: '‹ Back', onClick: () => { state.step -= 1; render(); } })] : []),
      el('button', { className: 'pnl-btn', style: { flex: '1' }, attrs: { type: 'button', ...(state.step === 1 && !state.phoneVerified ? { disabled: 'disabled' } : {}) }, text: last ? 'Create account' : 'Continue', onClick: last ? doSignup : () => { state.step += 1; render(); } }),
    ]),
    el('div', { className: 'pnl-foot' }, [el('a', { className: 'pnl-link', attrs: { href: `signin-${CFG.role}.html` }, text: 'Already have an account? Sign in' })]),
  ]);
  return el('div', { className: 'pnl-split' }, [info, formCard]);
}

function uniform(open, close) { const d = { open: open || '08:00', close: close || '18:00' }; return { mon: d, tue: d, wed: d, thu: d, fri: d, sat: d, sun: null }; }
function buildProfile(role, f) {
  const pin = f.lat != null && f.lng != null ? { lat: f.lat, lng: f.lng } : undefined;
  if (role === 'pudo') return {
    agent: { shopName: f.shopName, zone: f.zone, landmark: f.landmark || 'n/a', physicalAddress: f.address, location: pin, openingHours: uniform(f.open, f.close), shelf: { rows: Number(f.rows) || 3, cols: Number(f.cols) || 3 }, fullName: f.fullName, nationalId: f.nationalId, mobile: f.phone, deviceImei: `IMEI-${rand()}`, requirements: { androidVersion: 13, reliablePower: f.reliablePower !== false, tradingLicence: f.tradingLicence || 'TL', criminalRecordClear: !!f.criminalRecordClear } },
    kyc: { idCopyRef: 'id.jpg', tradingLicenceRef: 'licence.pdf', shopPhotoRefs: [f.shopPhotoRef || 'shop.jpg'] },
  };
  if (role === 'driver') {
    const heavy = (f.licenceClasses || []).some((c) => HEAVY.includes(c));
    return {
      fleetCode: f.path === 'fleet' ? f.fleetCode : undefined,
      driver: { displayName: f.displayName, fullName: f.fullName, nationalId: f.nationalId, mobile: f.phone, licenceClasses: f.licenceClasses || [], licenceNumber: f.licenceNumber, licenceExpiresAt: f.licenceExpiresAt ? new Date(f.licenceExpiresAt).toISOString() : undefined, criminalRecordClear: !!f.criminalRecordClear },
      vehicle: f.path === 'self' ? { plate: f.plate, vehicleClass: f.vehicleClass || 'motorcycle', truckSubtype: f.vehicleClass === 'truck' ? (f.truckSubtype || 'box') : undefined, ownerName: f.fullName } : undefined,
      kyc: heavy ? { idCopyRef: 'id.jpg', licenceCopyRef: 'licence.jpg' } : undefined,
    };
  }
  return { mdp: { name: f.name, zones: String(f.zones || '').split(',').map((s) => s.trim()).filter(Boolean), location: pin || { lat: -1.28, lng: 36.82 }, address: f.address, contactPhone: f.phone } };
}
async function doSignup() {
  const f = state.form;
  if (!f.email || !f.password) { state.step = 0; state.msg = { type: 'err', text: 'Email and password are required.' }; return render(); }
  try {
    const r = await api('/auth/signup', { role: CFG.role, email: f.email, password: f.password, phone: f.phone, profile: buildProfile(CFG.role, f) });
    const note = CFG.role === 'pudo' ? 'Your shop is created and pending KYC review. You can open the app now.' : CFG.role === 'driver' ? 'You can open the Driver app now.' : 'Your hub is live. Open the MDP app to start sorting.';
    state.done = { did: r.did, note };
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; }
  render();
}

function render() {
  const view = CFG.mode === 'signup' ? signupView() : CFG.mode === 'forgot' ? forgotView() : signinView();
  mount(root, [view]);
}
render();
