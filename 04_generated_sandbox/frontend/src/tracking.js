// Low-literacy shipment tracking timeline (T4-110). The current status is the hero (pictogram
// + plain words), a % bar shows journey progress, and past events render as a numbered stepper.
// Reads ?shipment=<GLOS-ID>. Tracking endpoints are DID-authenticated, so the page first gets a
// client-credentials token (prototype) then loads the timeline.

import { ReadAloud, el, mount } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const shipmentId = new URLSearchParams(window.location.search).get('shipment');

// Plain-language + pictogram map for each event type.
const STATUS = {
  PICKUP: { icon: '📦', label: 'Picked up' },
  ARRIVED_AT_HUB: { icon: '🏬', label: 'Arrived at hub' },
  DEPARTED: { icon: '🚚', label: 'On the move' },
  HANDOVER: { icon: '🤝', label: 'Handed over' },
  OUT_FOR_DELIVERY: { icon: '🛵', label: 'Out for delivery' },
  DELIVERED: { icon: '✅', label: 'Delivered' },
  EXCEPTION: { icon: '⚠️', label: 'Problem' },
  GEOFENCE_ENTER: { icon: '📍', label: 'Arrived at zone' },
  GEOFENCE_EXIT: { icon: '📍', label: 'Left zone' },
  START: { icon: '⏳', label: 'Getting ready' },
};

const state = { timeline: null, error: null };
const root = document.getElementById('tracking');

let token = null;
async function getToken() {
  if (token) return token;
  const res = await fetch(`${API}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sub: 'tracking-page', type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error('Could not authenticate');
  token = (await res.json()).access_token;
  return token;
}

async function load() {
  if (!shipmentId) { state.error = 'No shipment. Open with ?shipment=GLOS-…'; return render(); }
  try {
    const t = await getToken();
    const res = await fetch(`${API}/tracking/${encodeURIComponent(shipmentId)}/timeline`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Error ${res.status}`);
    }
    state.timeline = await res.json();
    state.error = null;
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    state.error = msg.includes('Failed to fetch') ? 'Cannot reach the server. Start the backend.' : msg;
  }
  render();
}

function timeWords(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function render() {
  if (state.error) {
    mount(root, [el('h1', { className: 'tk__title', text: 'Track' }), el('p', { className: 'tk__msg--err', text: state.error })]);
    return;
  }
  if (!state.timeline) { mount(root, el('p', { text: 'Loading…' })); return; }

  const tl = state.timeline;
  const current = STATUS[tl.currentState] || STATUS.START;
  const pct = tl.milestoneProgress.total > 0 ? Math.round((tl.milestoneProgress.reached / tl.milestoneProgress.total) * 100) : 0;
  const heroText = `Status: ${current.label}. ${pct}% of the way.`;

  const head = el('div', { className: 'tk__head' }, [
    el('h1', { className: 'tk__title', text: 'Where is it?' }),
    ReadAloud(() => heroText, { label: 'Listen' }),
  ]);

  const hero = el('div', { className: 'tk__hero' }, [
    el('div', { className: 'tk__hero-icon', attrs: { 'aria-hidden': 'true' }, text: current.icon }),
    el('div', { className: 'tk__hero-status', text: current.label }),
    el('div', { className: 'tk__bar', attrs: { role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' } }, [
      el('div', { className: 'tk__bar-fill', style: { width: `${pct}%` } }),
    ]),
    el('div', { className: 'tk__bar-label', text: tl.hasContext ? `${tl.milestoneProgress.reached} of ${tl.milestoneProgress.total} steps done` : 'Tracking started' }),
  ]);

  const steps = [...tl.events].reverse().map((ev, i) => {
    const s = STATUS[ev.type] || { icon: '•', label: ev.type };
    return el('div', { className: `tk__step${ev.anomaly ? ' is-anomaly' : ''}` }, [
      el('div', { className: 'tk__step-icon', attrs: { 'aria-hidden': 'true' }, text: s.icon }),
      el('div', {}, [
        el('div', { className: 'tk__step-title', text: ev.anomaly ? `${s.label} (needs checking)` : s.label }),
        el('div', { className: 'tk__step-meta', text: timeWords(ev.occurredAt) }),
      ]),
    ]);
  });

  mount(root, [head, hero, el('div', { className: 'tk__steps' }, steps), el('p', { className: 'tk__id', text: tl.glosShipmentId })]);
}

load();
