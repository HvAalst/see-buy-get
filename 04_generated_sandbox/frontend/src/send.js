// Shipper "Send something" wizard (M2-U1…U5). One task per screen, pictogram-driven, no typing of
// addresses or HS codes. Calls the existing M2 endpoints; gets its own client-credentials token.

import { StepProgress, BigButton, ReadAloud, MapPinPicker, el, mount } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const STEPS = ['What', 'Where', 'Handling', 'Send', 'Label'];

const CATEGORIES = [
  { id: 'documents', icon: '📄', label: 'Documents', description: 'documents' },
  { id: 'electronics', icon: '💻', label: 'Electronics', description: 'electronics' },
  { id: 'fresh', icon: '🥦', label: 'Fresh food', description: 'fresh produce' },
  { id: 'frozen', icon: '❄️', label: 'Frozen', description: 'frozen food' },
  { id: 'clothing', icon: '👕', label: 'Clothing', description: 'clothing' },
  { id: 'valuables', icon: '💎', label: 'Valuables', description: 'jewelry' },
  { id: 'other', icon: '📦', label: 'Other', description: 'general goods' },
];
const MODES = [
  { id: 'courier', icon: '🛵', label: 'Courier' },
  { id: 'road', icon: '🚚', label: 'Road' },
  { id: 'ocean', icon: '🚢', label: 'Sea' },
  { id: 'air', icon: '✈️', label: 'Air' },
];
const HANDLING = [
  { code: 'TEMP_2_8C', icon: '❄️', label: 'Keep cold' },
  { code: 'TEMP_FROZEN', icon: '🧊', label: 'Frozen' },
  { code: 'THIS_WAY_UP', icon: '⬆️', label: 'This way up' },
  { code: 'FRAGILE', icon: '🥚', label: 'Fragile' },
  { code: 'KEEP_DRY', icon: '☂️', label: 'Keep dry' },
];

const state = {
  step: 0, category: null, weight: '', packageCount: '1',
  origin: '', destination: '', mode: 'courier',
  handling: new Set(), shipment: null, labelSvg: null, error: null, busy: false,
};
const root = document.getElementById('send');

let token = null;
async function getToken() {
  if (token) return token;
  const res = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'send-page', type: 'client_credentials' }) });
  if (!res.ok) throw new Error('Could not authenticate');
  token = (await res.json()).access_token;
  return token;
}
async function api(path, body, method = 'POST') {
  const t = await getToken();
  const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${t}` }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(Array.isArray(err.message) ? err.message.join(', ') : err.message || `Error ${res.status}`);
  }
  return res;
}
function friendly(e) {
  const m = String(e && e.message ? e.message : e);
  return m.includes('Failed to fetch') ? 'Cannot reach the server. Start the backend.' : m;
}

function header(instruction) {
  const parts = [
    el('div', { className: 'sn__head' }, [el('h1', { className: 'sn__title', text: 'Send something' }), ReadAloud(() => instruction, { label: 'Listen' })]),
    StepProgress({ steps: STEPS, currentIndex: state.step }),
    el('p', { className: 'sn__instruction', text: instruction }),
  ];
  if (state.error) parts.push(el('p', { className: 'sn__msg--err', text: state.error }));
  return parts;
}

function choiceCard(item, selected, onClick) {
  return el('button', { className: `sn__card${selected ? ' is-selected' : ''}`, attrs: { type: 'button', 'aria-pressed': String(selected) }, onClick }, [
    el('div', { className: 'sn__card-icon', attrs: { 'aria-hidden': 'true' }, text: item.icon }),
    el('div', { className: 'sn__card-label', text: item.label }),
  ]);
}

function field(label, key, type = 'text', placeholder = '') {
  const input = el('input', { attrs: { type, value: state[key], placeholder, 'aria-label': label, inputmode: type === 'number' ? 'decimal' : undefined } });
  input.addEventListener('input', () => { state[key] = input.value; });
  return el('div', { className: 'sn__field' }, [el('label', { text: label }), input]);
}

// --- steps ---

function stepWhat() {
  const instruction = 'What are you sending? Tap a picture.';
  const cards = CATEGORIES.map((c) => choiceCard(c, state.category?.id === c.id, () => { state.category = c; render(); }));
  mount(root, [
    ...header(instruction),
    el('div', { className: 'sn__grid' }, cards),
    field('Weight in kg', 'weight', 'number', 'e.g. 5'),
    field('How many packages?', 'packageCount', 'number', '1'),
    BigButton({ label: 'Continue', icon: '→', disabled: !state.category || !(Number(state.weight) > 0), onClick: () => go(1) }),
  ]);
}

function stepWhere() {
  const instruction = 'Where is it going? Tap how it travels.';
  mount(root, [
    ...header(instruction),
    field('Pick up from', 'origin', 'text', 'e.g. Rotterdam'),
    MapPinPicker({ label: 'Or pin the pickup', onChange: (c) => { state.origin = state.origin || `Pin ${c.lat.toFixed(2)},${c.lng.toFixed(2)}`; } }),
    field('Deliver to', 'destination', 'text', 'e.g. Berlin'),
    el('div', { className: 'sn__grid' }, MODES.map((m) => choiceCard(m, state.mode === m.id, () => { state.mode = m.id; render(); }))),
    BigButton({ label: 'Continue', icon: '→', disabled: !state.origin.trim() || !state.destination.trim(), onClick: () => go(2) }),
  ]);
}

function stepHandling() {
  const instruction = 'Any special care? Tap all that apply. You can skip this.';
  const toggle = (code) => { state.handling.has(code) ? state.handling.delete(code) : state.handling.add(code); render(); };
  mount(root, [
    ...header(instruction),
    el('div', { className: 'sn__grid' }, HANDLING.map((h) => choiceCard({ icon: h.icon, label: h.label }, state.handling.has(h.code), () => toggle(h.code)))),
    BigButton({ label: 'Continue', icon: '→', onClick: () => go(3) }),
  ]);
}

function stepReview() {
  const instruction = 'Check it, then send.';
  const handlingLabels = HANDLING.filter((h) => state.handling.has(h.code)).map((h) => h.icon).join(' ') || '—';
  mount(root, [
    ...header(instruction),
    el('div', { className: 'sn__summary' }, [
      row('Sending', `${state.category.icon} ${state.category.label}`),
      row('Weight', `${state.weight} kg · ${state.packageCount || 1} pkg`),
      row('From → To', `${state.origin} → ${state.destination}`),
      row('Travels by', MODES.find((m) => m.id === state.mode)?.label ?? state.mode),
      row('Special care', handlingLabels),
    ]),
    BigButton({ label: state.busy ? 'Sending…' : 'Send', icon: '🚀', disabled: state.busy, onClick: send }),
  ]);
}

function row(k, v) {
  return el('div', { className: 'sn__row' }, [el('span', { text: k }), el('span', { text: v })]);
}

async function send() {
  state.busy = true; state.error = null; render();
  try {
    const res = await api('/shipments', {
      origin: state.origin.trim(),
      destination: state.destination.trim(),
      mode: state.mode,
      totalWeightKg: Number(state.weight),
      packageCount: Number(state.packageCount) || 1,
      goods: { description: state.category.description },
      handlingCodes: [...state.handling],
    });
    state.shipment = await res.json();
    await api(`/shipments/${state.shipment.glosShipmentId}/label`); // generate label
    const svg = await api(`/shipments/${state.shipment.glosShipmentId}/label?format=svg`, undefined, 'GET');
    state.labelSvg = await svg.text();
    state.busy = false; go(4);
  } catch (e) {
    state.error = friendly(e); state.busy = false; render();
  }
}

function stepLabel() {
  const id = state.shipment.glosShipmentId;
  const instruction = 'Done! Here is your label. Print it or show it on your phone.';
  setTimeout(() => { if (window.speechSynthesis) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(instruction)); } }, 150);

  const labelBox = el('div', { className: 'sn__label-box' });
  if (state.labelSvg) labelBox.innerHTML = state.labelSvg; // our own backend SVG

  mount(root, [
    ...header(instruction),
    labelBox,
    el('div', { style: { display: 'grid', gap: '10px' } }, [
      BigButton({ label: 'Print label', icon: '🖨️', onClick: () => window.print() }),
      BigButton({ label: 'Track it', icon: '📍', variant: 'secondary', onClick: () => { window.location.href = `./tracking.html?shipment=${encodeURIComponent(id)}`; } }),
    ]),
    el('p', { className: 'sn__did', text: id }),
  ]);
}

function go(step) { state.step = step; render(); }
function render() {
  switch (state.step) {
    case 0: return stepWhat();
    case 1: return stepWhere();
    case 2: return stepHandling();
    case 3: return stepReview();
    case 4: return stepLabel();
    default: return stepWhat();
  }
}

render();
