// PUDO Agent App — the shopkeeper's three tasks: Accept a parcel, Hand to the bus, Release to the
// customer. Simple, one-task-at-a-time flows with large targets, pinned wallet/status and read-aloud
// for accessibility — presented as a professional, refined product. Built on the WS-UX kit + the
// green brand palette. Opens with ?agent=<did>; PUDO endpoints are DID-authenticated.

import { AmountHero, PhotoCapture, ReadAloud, el, mount } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const agentDid = new URLSearchParams(location.search).get('agent');
const root = document.getElementById('agent');

const SIZES = [
  { key: 'S', label: 'Small' },
  { key: 'M', label: 'Medium' },
  { key: 'L', label: 'Large' },
  { key: 'HEAVY', label: 'Heavy (over 20 kg)' },
];

// Restrained line icons (one clear pictogram per action — not decoration).
const ICONS = {
  parcel: '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
  bus: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="11" rx="2"/><path d="M3 11h18"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/></svg>',
  person: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg>',
  inbox: '<svg viewBox="0 0 24 24"><path d="M3 12l3-7h12l3 7"/><path d="M3 12v7h18v-7"/><path d="M3 12h5l1 2h6l1-2h5"/></svg>',
  bag: '<svg viewBox="0 0 24 24"><path d="M6 8h12l-1.2 12H7.2z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M3 12l9-9 9 9-9 9z"/><circle cx="9" cy="9" r="1.4"/></svg>',
};
function iconEl(name) {
  const span = document.createElement('span');
  span.className = 'ag__action-ic';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = ICONS[name]; // static, trusted markup
  return span;
}

const state = { screen: 'home', agent: null, balance: 0, canScan: false, zones: [], msg: null, form: {}, handoverParcels: [], rates: null };

let token = null;
async function getToken() {
  if (token) return token;
  const res = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'pudo-agent-app', type: 'client_credentials' }) });
  token = (await res.json()).access_token;
  return token;
}
async function api(path, { method = 'GET', body } = {}) {
  const t = await getToken();
  const res = await fetch(`${API}/sbg${path}`, { method, headers: { Authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 402) throw new Error(data.message || `Error ${res.status}`);
  return { ok: res.ok, status: res.status, data };
}
const feedback = () => { try { navigator.vibrate?.(150); } catch { /* no-op */ } };

async function loadAgent() {
  if (!agentDid) { state.msg = { type: 'err', text: 'Open this app with ?agent=<your GLOS ID>.' }; return render(); }
  try {
    state.agent = (await api(`/agents/${encodeURIComponent(agentDid)}`)).data;
    const ct = await api(`/agents/${encodeURIComponent(agentDid)}/can-transact`);
    state.balance = ct.data.balance ?? 0;
    state.canScan = Boolean(ct.data.ok);
    const corridors = (await api('/corridors')).data || [];
    state.zones = corridors.filter((c) => c.originZone === state.agent.zone && c.status === 'active').map((c) => c.destZone);
    await api(`/agents/${encodeURIComponent(agentDid)}/ping`, { method: 'POST', body: {} }).catch(() => undefined);
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; }
  render();
}

// --- shell ---

function topBar() {
  const online = state.agent && state.agent.status !== 'LOCKED' && state.agent.status !== 'OFFLINE';
  const statusText = state.agent ? (online ? 'Online' : state.agent.status.replace('_', ' ').toLowerCase()) : 'Connecting';
  return el('header', { className: 'ag__top' }, [
    el('div', { className: 'ag__brand', text: 'PUDO Agent' }),
    el('div', { className: 'ag__right' }, [
      el('span', { className: 'ag__status' }, [el('span', { className: `ag__status-dot${online ? '' : ' ag__status-dot--off'}` }), statusText]),
      el('a', { className: 'ag__hub', attrs: { href: 'index.html' }, text: 'Hub ›' }),
    ]),
  ]);
}

function actionRow(icon, title, subtitle, onClick, disabled = false) {
  return el('button', { className: 'ag__action', attrs: { type: 'button', ...(disabled ? { disabled: 'disabled' } : {}) }, onClick: disabled ? undefined : onClick }, [
    iconEl(icon),
    el('div', {}, [el('div', { className: 'ag__action-t', text: title }), el('div', { className: 'ag__action-s', text: subtitle })]),
  ]);
}

// --- home ---

function homeScreen() {
  const wallet = el('div', { className: 'ag__wallet' }, [
    el('div', { className: 'ag__wallet-row' }, [
      AmountHero({ amount: state.balance, caption: state.agent ? `${state.agent.shopName} · wallet` : 'Wallet' }),
      el('button', { className: 'ag__topup', text: 'Top up', onClick: topUp }),
    ]),
  ]);

  const body = [wallet];
  if (state.agent && !state.canScan) {
    body.push(el('div', { className: 'ag__notice ag__notice--lock', text: state.agent.status === 'ACTIVE' ? 'Low balance — top up to keep accepting parcels.' : 'Account locked. Top up to start accepting parcels.' }));
  }
  if (state.agent && (state.agent.status === 'ACTIVE' || state.agent.status === 'LOCKED')) {
    const open = state.agent.openState !== 'closed';
    body.push(el('div', { className: 'ag__notice', style: { background: '#fff', borderColor: 'var(--border)', color: 'var(--text)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
      el('span', { text: open ? 'Shop is open' : 'Shop is temporarily closed' }),
      el('button', { className: 'ag__topup', attrs: { type: 'button' }, text: open ? 'Mark closed' : 'Reopen', onClick: toggleOpen }),
    ]));
    body.push(el('div', { className: 'ag__notice', style: { background: '#fff', borderColor: 'var(--border)', color: 'var(--text)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
      el('span', { text: `Your price per parcel: ${Number(state.agent.pricePerParcel ?? 0).toFixed(2)}` }),
      el('button', { className: 'ag__topup', attrs: { type: 'button' }, text: 'Change', onClick: setPrice }),
    ]));
  }
  body.push(el('div', { className: 'ag__actions' }, [
    actionRow('parcel', 'Accept a parcel', 'Take in a new drop-off', () => go('accept'), !state.canScan),
    actionRow('bus', 'Hand to the bus', 'Give parcels to the driver', () => go('handover')),
    actionRow('person', 'Release to customer', 'Verify OTP and hand over', () => go('pickup')),
    actionRow('inbox', 'Collect order', 'Release an online order to the buyer', () => go('collect')),
    actionRow('bag', 'Receive a bag', 'A bus dropped a bag for your shop', () => go('receivebag')),
    actionRow('tag', 'Rates near you', 'See what nearby shops charge — price to compete', () => go('rates')),
  ]));
  body.push(ReadAloud(() => `Wallet balance ${state.balance} dollars. ${state.canScan ? 'You can accept parcels.' : 'Top up to accept parcels.'}`, { label: 'Read this screen aloud' }));

  return [topBar(), el('div', { className: 'ag__body' }, body)];
}

async function toggleOpen() {
  const open = state.agent?.openState !== 'closed';
  try { await api(`/agents/${encodeURIComponent(agentDid)}/availability`, { method: 'POST', body: { open: !open } }); feedback(); await loadAgent(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// Open-data pricing: the agent sets its own handling fee per parcel (public — competition pressure).
async function setPrice() {
  const cur = Number(state.agent?.pricePerParcel ?? 0).toFixed(2);
  const v = window.prompt('Your price per parcel (what vendors pay this shop to handle a parcel):', cur);
  if (v == null) return;
  const price = Number(v);
  if (!(price >= 0)) { state.msg = { type: 'err', text: 'Enter a valid price.' }; return render(); }
  try { await api(`/agents/${encodeURIComponent(agentDid)}/pricing`, { method: 'PATCH', body: { price } }); feedback(); state.msg = { type: 'ok', text: 'Price updated.' }; await loadAgent(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

async function topUp() {
  const amount = Number(prompt('Top-up amount in dollars:', '50'));
  if (!amount || amount <= 0) return;
  try { await api(`/agents/${encodeURIComponent(agentDid)}/top-up`, { method: 'POST', body: { amount } }); feedback(); await loadAgent(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- accept ---

function acceptScreen() {
  const f = state.form;
  const qr = textInput('Scan or type the sticker ID', f.parcelId || '', (v) => { f.parcelId = v; });

  const sizes = el('div', { className: 'ag__grid2' }, SIZES.map((s) => el('button', { className: `ag__chip${f.size === s.key ? ' is-on' : ''}`, attrs: { type: 'button' }, text: s.label, onClick: () => { f.size = s.key; render(); } })));

  let dest;
  if (state.zones.length) {
    dest = el('select', { className: 'ag__input' }, [el('option', { text: 'Select destination', attrs: { value: '' } }), ...state.zones.map((z) => el('option', { text: z, attrs: { value: z, ...(f.destZone === z ? { selected: 'selected' } : {}) } }))]);
    dest.addEventListener('change', () => { f.destZone = dest.value; });
  } else {
    dest = textInput('Destination zone', f.destZone || '', (v) => { f.destZone = v; });
  }

  const sender = textInput('Sender phone', f.senderMobile || '', (v) => { f.senderMobile = v; });
  const receiver = textInput('Receiver phone', f.receiverMobile || '', (v) => { f.receiverMobile = v; });
  const photo = PhotoCapture({ label: f.photoRef ? 'Photo captured' : 'Take proof photo', onCapture: (file) => { f.photoRef = file.name || `photo-${Date.now()}.jpg`; } });

  return [topBar(), el('div', { className: 'ag__body' }, [
    headerRow('Accept a parcel'),
    el('div', { className: 'ag__card' }, [
      step(1, 'Parcel sticker', qr),
      step(2, 'Size', sizes),
      step(3, 'Destination', dest),
      step(4, 'Sender and receiver phone', el('div', { className: 'ag__grid2' }, [sender, receiver])),
      step(5, 'Proof photo (required)', photo),
      el('button', { className: 'ag__primary', attrs: { type: 'button' }, text: 'Confirm and accept', onClick: submitAccept }),
    ]),
  ])];
}

async function submitAccept() {
  const f = state.form;
  if (!f.parcelId || !f.size || !f.destZone || !f.photoRef) { state.msg = { type: 'err', text: 'Add the sticker, size, destination and a proof photo.' }; return render(); }
  try {
    await api('/parcels/accept', { method: 'POST', body: { agentDid, parcelId: f.parcelId, size: f.size, destZone: f.destZone, senderMobile: f.senderMobile || 'n/a', receiverMobile: f.receiverMobile || 'n/a', dropoffPhotoRef: f.photoRef } });
    feedback();
    state.form = {};
    state.msg = { type: 'ok', text: 'Parcel accepted. A tracking message has been sent.' };
    await loadAgent();
    go('home');
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- handover ---

function handoverScreen() {
  const f = state.form;
  f.selected = f.selected || new Set();
  const badge = textInput('Scan the driver badge', f.badge || '', (v) => { f.badge = v; });

  const rows = state.handoverParcels.map((p) => {
    const on = f.selected.has(p.parcelId);
    return el('div', { className: `ag__row${on ? ' is-on' : ''}`, onClick: () => { if (on) f.selected.delete(p.parcelId); else f.selected.add(p.parcelId); render(); } }, [
      el('div', { className: 'ag__check', text: on ? '✓' : '' }),
      el('div', {}, [el('div', { style: { fontWeight: '700' }, text: `${p.parcelId} · ${p.size}` }), el('div', { style: { color: 'var(--muted)', fontSize: '0.85rem' }, text: `To ${p.destZone}` })]),
    ]);
  });

  return [topBar(), el('div', { className: 'ag__body' }, [
    headerRow('Hand to the bus'),
    el('div', { className: 'ag__card' }, [
      step(1, 'Driver badge', badge),
      step(2, `Parcels at your shop (${rows.length})`, rows.length ? el('div', { className: 'ag__pick' }, rows) : el('div', { className: 'ag__hint', text: 'No parcels waiting.' })),
      el('button', { className: 'ag__primary', attrs: { type: 'button', ...(f.selected.size === 0 ? { disabled: 'disabled' } : {}) }, text: `Finish handover (${f.selected.size} selected)`, onClick: submitHandover }),
    ]),
  ])];
}

async function submitHandover() {
  const f = state.form;
  if (!f.badge) { state.msg = { type: 'err', text: 'Scan the driver badge first.' }; return render(); }
  try {
    const r = await api('/parcels/handover', { method: 'POST', body: { agentDid, driverBadgeId: f.badge, parcelIds: [...f.selected] } });
    feedback();
    state.form = {};
    state.msg = { type: 'ok', text: `${r.data.handed.length} parcel(s) loaded on the ${r.data.vehicle}.` };
    go('home');
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- pickup ---

function pickupScreen() {
  const f = state.form;
  const idIn = textInput('Scan the parcel sticker', f.pickId || '', (v) => { f.pickId = v; });
  const body = [headerRow('Release to customer'), el('div', { className: 'ag__card' }, [step(1, 'Parcel sticker', idIn), el('button', { className: 'ag__primary', attrs: { type: 'button' }, text: 'Find parcel', onClick: findParcel })])];

  const p = f.pickParcel;
  if (p) {
    if (p.status === 'On_Bus') body.push(el('div', { className: 'ag__card' }, [el('div', { text: 'This parcel is still on the bus.' }), el('button', { className: 'ag__primary', attrs: { type: 'button' }, text: 'Mark arrived and shelve', onClick: markArrived })]));
    else if (p.status === 'Ready_For_Pickup') {
      const otp = textInput('', f.otp || '', (v) => { f.otp = v; }, 'ag__input ag__otp');
      otp.setAttribute('inputmode', 'numeric'); otp.setAttribute('maxlength', '4'); otp.setAttribute('placeholder', '0000');
      // The code comes from the CUSTOMER (their app, or the sender who passed it on). This shop is never
      // told it — showing it here would make the check meaningless.
      const items = [step(2, 'Enter the 4-digit code from the customer', otp)];
      items.push(el('button', { className: 'ag__primary', attrs: { type: 'button' }, text: 'Confirm pickup', onClick: submitPickup }));
      body.push(el('div', { className: 'ag__card' }, items));
    } else if (p.status === 'Delivered') body.push(ratingCard(p));
    else body.push(el('div', { className: 'ag__msg ag__msg--err', text: `This parcel is ${p.status.replace('_', ' ')}.` }));
  }
  return [topBar(), el('div', { className: 'ag__body' }, body)];
}

async function findParcel() {
  const f = state.form;
  if (!f.pickId) return;
  try { f.pickParcel = (await api(`/parcels/${encodeURIComponent(f.pickId)}`)).data; }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; }
  render();
}
async function markArrived() {
  const f = state.form;
  try { await api(`/parcels/${encodeURIComponent(f.pickId)}/arrive`, { method: 'POST', body: { destAgentDid: agentDid } }); await findParcel(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}
async function submitPickup() {
  const f = state.form;
  try { await api(`/parcels/${encodeURIComponent(f.pickId)}/pickup`, { method: 'POST', body: { agentDid, otp: f.otp || '' } }); feedback(); f.pickParcel = (await api(`/parcels/${encodeURIComponent(f.pickId)}`)).data; render(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

function ratingCard(p) {
  const f = state.form;
  const stars = el('div', { className: 'ag__stars' }, [1, 2, 3, 4, 5].map((n) => el('span', { className: `ag__star${(f.stars || 0) >= n ? ' is-on' : ''}`, attrs: { role: 'button', 'aria-label': `${n} stars` }, text: '★', onClick: () => { f.stars = n; render(); } })));
  return el('div', { className: 'ag__card' }, [
    el('div', { className: 'ag__msg ag__msg--ok', text: 'Delivered. The customer has the parcel.' }),
    el('div', { className: 'ag__step-label', text: 'Rate this delivery' }), stars,
    el('button', { className: 'ag__primary', attrs: { type: 'button', ...(f.stars ? {} : { disabled: 'disabled' }) }, text: 'Submit rating', onClick: async () => {
      try { await api(`/parcels/${encodeURIComponent(p.parcelId)}/rate`, { method: 'POST', body: { stars: f.stars, raterMobile: p.receiverMobile || 'n/a' } }); state.msg = { type: 'ok', text: 'Thank you. Rating recorded.' }; state.form = {}; go('home'); }
      catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
    } }),
  ]);
}

// --- collect (inbound e-commerce order) ---

function collectScreen() {
  const f = state.form;
  const code = textInput('Scan the customer collection code', f.collectCode || '', (v) => { f.collectCode = v; });
  const body = [headerRow('Collect order'), el('div', { className: 'ag__card' }, [step(1, 'Collection code', code), el('button', { className: 'ag__primary', attrs: { type: 'button' }, text: 'Find order', onClick: findCollect })])];

  const p = f.collectParcel;
  if (p) {
    const items = (p.items || []).map((it) => el('div', { className: 'ag__hint', style: { textAlign: 'left' }, text: `• ${it.qty} × ${it.name}` }));
    body.push(el('div', { className: 'ag__card' }, [
      el('div', { className: 'ag__msg ag__msg--ok', text: `Shelf ${f.collectBin || p.binSlot || '—'} — fetch the parcel` }),
      el('div', { className: 'ag__step-label', text: 'Order contents — let the customer check' }),
      ...(items.length ? items : [el('div', { className: 'ag__hint', text: 'No item list provided.' })]),
      el('button', { className: 'ag__primary', attrs: { type: 'button' }, text: 'Hand over — all good', onClick: confirmCollect }),
      el('button', { className: 'ag__topup', style: { width: '100%' }, text: 'Report a problem', onClick: () => { f.disputing = true; render(); } }),
    ]));
    if (f.disputing) {
      const reason = textInput('What is wrong with the parcel?', f.disputeReason || '', (v) => { f.disputeReason = v; });
      const photo = PhotoCapture({ label: f.disputePhoto ? 'Photo captured' : 'Photo of the problem (required)', onCapture: (file) => { f.disputePhoto = file.name || `dispute-${Date.now()}.jpg`; } });
      body.push(el('div', { className: 'ag__card' }, [step(2, 'Describe the problem', reason), step(3, 'Proof photo', photo), el('button', { className: 'ag__primary', attrs: { type: 'button' }, text: 'Submit dispute', onClick: submitDispute })]));
    }
  }
  return [topBar(), el('div', { className: 'ag__body' }, body)];
}

async function findCollect() {
  const f = state.form;
  if (!f.collectCode) return;
  try { const r = await api('/parcels/collect', { method: 'POST', body: { agentDid, collectionCode: f.collectCode } }); f.collectParcel = r.data.parcel; f.collectBin = r.data.binSlot; f.disputing = false; }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; f.collectParcel = null; }
  render();
}
async function confirmCollect() {
  const f = state.form;
  try { await api(`/parcels/${encodeURIComponent(f.collectParcel.parcelId)}/collect-confirm`, { method: 'POST', body: { agentDid, collectionCode: f.collectCode } }); feedback(); state.msg = { type: 'ok', text: 'Handed over. Order closed.' }; state.form = {}; go('home'); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}
async function submitDispute() {
  const f = state.form;
  if (!f.disputeReason || !f.disputePhoto) { state.msg = { type: 'err', text: 'Add what is wrong and a photo.' }; return render(); }
  try { await api(`/parcels/${encodeURIComponent(f.collectParcel.parcelId)}/dispute`, { method: 'POST', body: { agentDid, reason: f.disputeReason, photoProofRef: f.disputePhoto } }); feedback(); state.msg = { type: 'ok', text: 'Dispute filed. The store has been notified.' }; state.form = {}; go('home'); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- receive a bag (the tote-flow last mile) ---

function receivebagScreen() {
  const f = state.form;
  const code = textInput('Scan the bag code (BAG-###)', f.bagCode || '', (v) => { f.bagCode = v.trim().toUpperCase(); });
  return [topBar(), el('div', { className: 'ag__body' }, [
    headerRow('Receive a bag'),
    el('div', { className: 'ag__card' }, [
      step(1, 'Bag code', code),
      el('button', { className: 'ag__primary', attrs: { type: 'button' }, text: 'Receive & shelve parcels', onClick: submitReceiveBag }),
      el('div', { className: 'ag__hint', text: 'Each parcel is shelved for pickup; the bag is freed for reuse.' }),
    ]),
  ])];
}
async function submitReceiveBag() {
  const f = state.form;
  if (!f.bagCode) { state.msg = { type: 'err', text: 'Scan the bag code first.' }; return render(); }
  try {
    const r = await api(`/agents/${encodeURIComponent(agentDid)}/receive-bag`, { method: 'POST', body: { code: f.bagCode } });
    feedback();
    state.form = {};
    state.msg = { type: 'ok', text: `Received — ${r.data.delivered.length} parcel(s) shelved for pickup.` };
    go('home');
  } catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

// --- helpers ---

function textInput(placeholder, value, onInput, className = 'ag__input') {
  const input = el('input', { className, attrs: { value, ...(placeholder ? { placeholder } : {}) } });
  input.addEventListener('input', () => onInput(input.value));
  return input;
}
function step(n, label, content) {
  return el('div', { className: 'ag__step' }, [el('div', { className: 'ag__step-label' }, [el('b', { text: String(n) }), label]), content]);
}
function headerRow(title) {
  return el('div', { className: 'ag__head' }, [
    el('button', { className: 'ag__back', attrs: { type: 'button' }, text: '← Back', onClick: () => { state.form = {}; go('home'); } }),
    el('h1', { className: 'ag__title', text: title }),
  ]);
}

async function go(screen) {
  state.screen = screen;
  if (screen === 'handover') { try { state.handoverParcels = (await api(`/parcels?status=At_PUDO&agent=${encodeURIComponent(agentDid)}`)).data || []; } catch { state.handoverParcels = []; } }
  if (screen === 'rates') { state.rates = null; render(); try { const here = state.agent?.location; const qs = here ? `&lat=${here.lat}&lng=${here.lng}` : ''; state.rates = (await api(`/pricing/near?type=pudo${qs}`)).data; } catch { state.rates = null; } }
  render();
}

// --- rates near you (competitive price discovery: you vs the local median + nearby pins) ---

function rateBar(b, mine) {
  const lo = b.min, hi = b.max, span = Math.max(0.01, hi - lo);
  const at = (v) => Math.min(100, Math.max(0, ((v - lo) / span) * 100));
  const track = el('div', { style: { position: 'relative', height: '34px', margin: '14px 0 6px' } });
  track.append(el('div', { style: { position: 'absolute', top: '14px', left: '0', right: '0', height: '6px', borderRadius: '999px', background: '#E2E2E6' } }));
  track.append(el('div', { style: { position: 'absolute', top: '14px', left: `${at(b.p25)}%`, width: `${at(b.p75) - at(b.p25)}%`, height: '6px', borderRadius: '999px', background: 'rgba(76,70,224,0.30)' } })); // typical band
  track.append(el('div', { style: { position: 'absolute', top: '8px', left: `${at(b.median)}%`, width: '3px', height: '18px', background: '#4C46E0', transform: 'translateX(-1px)' } })); // median
  const you = el('div', { style: { position: 'absolute', top: '6px', left: `${at(mine)}%`, transform: 'translateX(-50%)', display: 'grid', justifyItems: 'center' } }, [el('div', { style: { width: '14px', height: '14px', borderRadius: '999px', background: '#FF6200', border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' } }), el('div', { style: { fontSize: '0.66rem', fontWeight: '800', color: '#DC4405', marginTop: '2px' }, text: 'you' })]);
  track.append(you);
  return track;
}

function ratesScreen() {
  const r = state.rates, me = state.agent;
  const mine = Number(me?.pricePerParcel ?? 0);
  const body = [el('button', { className: 'ag__back', style: { background: 'none', border: 'none', color: '#4C46E0', fontWeight: '700', cursor: 'pointer', font: 'inherit', padding: '0 0 8px' }, text: '‹ Back', onClick: () => go('home') }), el('h2', { style: { margin: '0 0 4px', fontSize: '1.25rem' }, text: 'Rates near you' })];

  if (!r) { body.push(el('p', { style: { color: '#5A5A64' }, text: 'Loading nearby rates…' })); }
  else if (!r.benchmark || !r.benchmark.count) { body.push(el('p', { style: { color: '#5A5A64' }, text: 'No nearby shops have published a rate yet. You set the benchmark.' })); }
  else {
    const b = r.benchmark;
    const deltaPct = b.median > 0 ? Math.round(((mine - b.median) / b.median) * 100) : 0;
    const word = deltaPct > 1 ? `${deltaPct}% above` : deltaPct < -1 ? `${-deltaPct}% below` : 'at';
    const card = el('div', { style: { background: '#fff', border: '1px solid #E2E2E6', borderRadius: '14px', padding: '18px', margin: '8px 0 16px' } }, [
      el('div', { style: { color: '#5A5A64', fontWeight: '700', fontSize: '0.85rem' }, text: `Handling price near you · ${r.radiusKm ? r.radiusKm + ' km' : 'network'} · ${b.count} shops` }),
      el('div', { style: { fontSize: '1.9rem', fontWeight: '800', color: '#4C46E0', margin: '4px 0' }, text: `median ${b.median.toFixed(2)}` }),
      el('div', { style: { fontSize: '0.85rem', color: '#5A5A64' }, text: `typical ${b.p25.toFixed(2)}–${b.p75.toFixed(2)} · range ${b.min.toFixed(2)}–${b.max.toFixed(2)}` }),
      rateBar(b, mine),
      el('div', { style: { fontWeight: '800', marginTop: '8px', color: deltaPct > 1 ? '#DC4405' : '#1FA45A' }, text: `You charge ${mine.toFixed(2)} — ${word} the median.` }),
      Math.abs(deltaPct) > 1 ? el('button', { className: 'ag__topup', style: { marginTop: '10px' }, attrs: { type: 'button' }, text: `Match the median (${b.median.toFixed(2)})`, onClick: () => applyPrice(b.median) }) : null,
    ].filter(Boolean));
    body.push(card);

    // map of nearby pins (centered on you)
    if (me?.location && r.pins.length) {
      const center = me.location, spanDeg = ((r.radiusKm || 25) * 2) / 111;
      const ratePos = (loc) => ({ x: Math.min(94, Math.max(6, ((loc.lng - (center.lng - spanDeg / 2)) / spanDeg) * 100)), y: Math.min(90, Math.max(10, ((center.lat + spanDeg / 2 - loc.lat) / spanDeg) * 100)) });
      const surface = el('div', { style: { position: 'relative', width: '100%', height: '180px', borderRadius: '12px', border: '1.5px solid #C9C9D0', overflow: 'hidden', background: 'repeating-linear-gradient(0deg,#f6f7f9 0 23px,#eef0f3 23px 24px),repeating-linear-gradient(90deg,#f6f7f9 0 23px,#eef0f3 23px 24px)' } });
      const youP = ratePos(center); const youDot = el('div', { style: { position: 'absolute', left: `${youP.x}%`, top: `${youP.y}%`, transform: 'translate(-50%,-50%)', width: '16px', height: '16px', borderRadius: '999px', background: '#FF6200', border: '2px solid #fff', zIndex: '4' }, attrs: { title: 'you' } }); surface.append(youDot);
      r.pins.forEach((p) => {
        if (!p.location || p.id === me.did) return;
        const xy = ratePos(p.location);
        const dot = el('div', { style: { position: 'absolute', left: `${xy.x}%`, top: `${xy.y}%`, transform: 'translate(-50%,-50%)', width: '12px', height: '12px', borderRadius: '999px', background: '#4C46E0', border: '2px solid #fff' }, attrs: { title: p.label } });
        const tag = el('div', { style: { position: 'absolute', left: `${xy.x}%`, top: `${xy.y}%`, transform: 'translate(-50%,12px)', background: '#fff', border: '1px solid #C9C9D0', borderRadius: '999px', padding: '0 6px', fontSize: '0.66rem', fontWeight: '800', color: '#4C46E0', whiteSpace: 'nowrap' }, text: Number(p.price).toFixed(2) });
        surface.append(dot, tag);
      });
      body.push(el('div', { style: { borderRadius: '12px', marginBottom: '14px' } }, [surface]));
    }

    // nearby list
    body.push(el('div', {}, r.pins.filter((p) => p.id !== me?.did).slice(0, 8).map((p) => el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '9px 2px', borderBottom: '1px solid #E2E2E6' } }, [
      el('span', { text: `${p.label}${p.km != null ? ' · ' + p.km + ' km' : ''}` }),
      el('b', { style: { color: '#4C46E0' }, text: Number(p.price).toFixed(2) }),
    ]))));
  }
  return [topBar(), el('div', { className: 'ag__body' }, body)];
}

async function applyPrice(price) {
  try { await api(`/agents/${encodeURIComponent(agentDid)}/pricing`, { method: 'PATCH', body: { price: Math.round(price * 100) / 100 } }); feedback(); await loadAgent(); await go('rates'); state.msg = { type: 'ok', text: 'Price updated to the market median.' }; render(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

function render() {
  const screens = { home: homeScreen, accept: acceptScreen, handover: handoverScreen, pickup: pickupScreen, collect: collectScreen, receivebag: receivebagScreen, rates: ratesScreen };
  const parts = (screens[state.screen] || homeScreen)();
  if (state.msg) {
    const banner = el('div', { className: 'ag__body', style: { paddingBottom: '0' } }, [el('div', { className: `ag__msg ag__msg--${state.msg.type}`, text: state.msg.text })]);
    parts.splice(1, 0, banner);
    state.msg = null;
  }
  mount(root, parts);
}

loadAgent();
