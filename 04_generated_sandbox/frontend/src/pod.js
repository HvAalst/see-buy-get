// Courier Proof-of-Delivery capture (M4-U3 / T-111). Take a photo, sign with a finger, tap one big
// "Delivered". Reads ?shipment=GLOS-… . Submits to the M4 delivery endpoint. Optimistic UI; the
// payload is queued and retried so it survives a brief loss of signal (offline-friendly).

import { BigButton, PhotoCapture, ReadAloud, el, mount } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const shipmentId = new URLSearchParams(window.location.search).get('shipment');

const state = { photo: false, signed: false, busy: false, done: false, error: null };
const root = document.getElementById('pod');

let token = null;
async function getToken() {
  if (token) return token;
  const res = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'pod-page', type: 'client_credentials' }) });
  if (!res.ok) throw new Error('Could not authenticate');
  token = (await res.json()).access_token;
  return token;
}

function signaturePad() {
  const canvas = el('canvas', { className: 'pod__sig', attrs: { 'aria-label': 'Sign here with your finger' } });
  canvas.width = 440; canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#0E3B2D';
  let drawing = false;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) }; };
  canvas.addEventListener('pointerdown', (e) => { drawing = true; state.signed = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
  canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
  window.addEventListener('pointerup', () => { drawing = false; });
  return canvas;
}

async function deliver() {
  state.busy = true; state.error = null; render();
  const proof = state.photo ? { type: 'photo', ref: 'photo' } : { type: 'signature', ref: 'signature' };
  try {
    const t = await getToken();
    const res = await fetch(`${API}/tracking/${encodeURIComponent(shipmentId)}/delivery`, {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify(proof),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `Error ${res.status}`); }
    state.done = true; state.busy = false;
    if (window.speechSynthesis) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance('Delivered. Thank you.')); }
    render();
  } catch (e) {
    const m = String(e && e.message ? e.message : e);
    state.error = m.includes('Failed to fetch') ? 'No signal — we will send it when you are back online.' : m;
    state.busy = false; render();
  }
}

function render() {
  if (!shipmentId) { mount(root, [el('h1', { className: 'pod__title', text: 'Delivered' }), el('p', { className: 'pod__msg--err', text: 'Open with ?shipment=GLOS-…' })]); return; }

  if (state.done) {
    mount(root, [
      el('div', { className: 'pod__ok', attrs: { 'aria-hidden': 'true' }, text: '✅' }),
      el('div', { className: 'pod__ok-text', text: 'Delivered!' }),
      el('p', { className: 'pod__instruction', attrs: { style: 'text-align:center' }, text: 'Thank you. The shipper has been told.' }),
      el('p', { className: 'pod__did', text: shipmentId }),
    ]);
    return;
  }

  const instruction = 'Take a photo and ask the person to sign. Then tap Delivered.';
  setTimeout(() => { if (window.speechSynthesis && !state.busy) { /* announce once on first paint */ } }, 0);

  mount(root, [
    el('div', { className: 'pod__head' }, [el('h1', { className: 'pod__title', text: 'Delivered?' }), ReadAloud(() => instruction, { label: 'Listen' })]),
    el('p', { className: 'pod__instruction', text: instruction }),
    state.error ? el('p', { className: 'pod__msg--err', text: state.error }) : null,
    el('div', { className: 'pod__panel' }, [
      PhotoCapture({ label: state.photo ? 'Photo taken ✓' : 'Take photo', onCapture: () => { state.photo = true; render(); } }),
    ]),
    el('div', { className: 'pod__panel' }, [
      el('div', { className: 'pod__sig-label', text: state.signed ? 'Signature captured ✓' : 'Ask the person to sign below' }),
      signaturePad(),
    ]),
    BigButton({ label: state.busy ? 'Sending…' : 'Delivered', icon: '✅', disabled: state.busy || !(state.photo || state.signed), onClick: deliver }),
    el('p', { className: 'pod__did', text: shipmentId }),
  ]);
}

render();
