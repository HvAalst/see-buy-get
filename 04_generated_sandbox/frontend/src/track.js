// Public parcel tracking — the live half of the static track.html shell. Reads ?key=T-XXXX (or the input),
// calls the public, sanitized GET /pudo/track/:key (no PII, no collection code), and renders the status +
// timeline. It also injects a ParcelDelivery JSON-LD for the loaded parcel (correct schema; useful once
// this page is server-rendered). PUDO endpoints are token-auth, so it fetches a token first.

import { el, mount } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const out = document.getElementById('trackOut');
const input = document.getElementById('trackKey');
const btn = document.getElementById('trackBtn');

let token = null;
async function getToken() {
  if (token) return token;
  const res = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'pudo-track', type: 'client_credentials' }) });
  token = (await res.json()).access_token;
  return token;
}

const fmt = (iso) => { try { return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); } catch { return iso; } };
const statusClass = (s) => s === 'Delivered' ? 'tr__status--done' : (s === 'Disputed' || s === 'Voided') ? 'tr__status--bad' : '';

// schema.org/DeliveryEventStatusType mapping for the injected ParcelDelivery JSON-LD.
const DELIVERY_STATUS = {
  Created: 'OrderProcessing', At_PUDO: 'OrderInTransit', On_Bus: 'OrderInTransit', At_MDP: 'OrderInTransit',
  Ready_For_Pickup: 'OrderPickupAvailable', Delivered: 'OrderDelivered', Disputed: 'OrderProblem', Voided: 'OrderProblem',
};

function injectParcelLd(p) {
  document.getElementById('parcel-ld')?.remove();
  const s = document.createElement('script');
  s.type = 'application/ld+json';
  s.id = 'parcel-ld';
  s.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ParcelDelivery',
    trackingNumber: p.ref,
    deliveryStatus: { '@type': 'DeliveryEvent', availableFrom: p.steps?.[p.steps.length - 1]?.at },
    expectedArrivalUntil: undefined,
    hasDeliveryMethod: 'https://schema.org/ParcelService',
    deliveryAddress: { '@type': 'Place', name: p.destination },
    orderStatus: `https://schema.org/${DELIVERY_STATUS[p.status] || 'OrderProcessing'}`,
  });
  document.body.appendChild(s);
}

async function track() {
  const key = (input.value || '').trim();
  if (!key) return;
  history.replaceState(null, '', `?key=${encodeURIComponent(key)}`);
  mount(out, [el('p', { className: 'tr__route', text: 'Looking up…' })]);
  try {
    const t = await getToken();
    const res = await fetch(`${API}/pudo/track/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) { mount(out, [el('div', { className: 'tr__err', text: res.status === 404 ? 'No parcel found with that tracking key. Check the key and try again.' : `Could not look that up (error ${res.status}).` })]); return; }
    const p = await res.json();
    renderResult(p);
    injectParcelLd(p);
  } catch (e) {
    mount(out, [el('div', { className: 'tr__err', text: String(e.message || e).includes('Failed to fetch') ? 'Cannot reach the server right now. Please try again shortly.' : String(e.message || e) })]);
  }
}

function renderResult(p) {
  const steps = (p.steps || []).slice().reverse().map((s) => el('div', { className: 'tr__step' }, [
    el('div', { className: 'tr__step-when', text: fmt(s.at) }),
    el('div', {}, [el('b', { text: String(s.status).replace(/_/g, ' ') }), s.note ? el('span', { style: { color: 'var(--pnl-muted)' }, text: ` · ${s.note}` }) : null]),
  ]));
  mount(out, [el('div', { className: 'tr__result' }, [
    el('span', { className: `tr__status ${statusClass(p.status)}`, text: String(p.status).replace(/_/g, ' ') }),
    el('div', { className: 'tr__route', text: `${p.size || ''} · ${p.ref} → ${p.destination}` }),
    p.binSlot ? el('div', { className: 'tr__ready', text: `Ready to collect · shelf ${p.binSlot}` }) : null,
    ...steps,
  ].filter(Boolean))]);
}

btn.addEventListener('click', track);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') track(); });

// Deep link: track.html?key=T-XXXX auto-loads.
const qsKey = new URLSearchParams(location.search).get('key');
if (qsKey) { input.value = qsKey; track(); }
