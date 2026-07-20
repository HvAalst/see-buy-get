// Low-literacy financial dashboard (S-305 / SSE-081). Shows the escrow as a plain 3-step money
// journey (Held → Partly paid → Paid), each milestone payment as a card with the breakdown, fees,
// and any disputes. Money in plain words, read-aloud. Reads ?shipment=GLOS-… or ?escrow=esc_…

import { AmountHero, BigButton, StatusBadge, StepProgress, ReadAloud, el, mount } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const params = new URLSearchParams(window.location.search);
const shipmentId = params.get('shipment');
const escrowId = params.get('escrow');

const MS = {
  PICKUP: { icon: '📦', label: 'Pickup payment' },
  HANDOVER: { icon: '🤝', label: 'Handover payment' },
  DELIVERY: { icon: '✅', label: 'Delivery payment' },
};
const STEPS = ['Money held safe', 'Partly paid', 'All paid'];

const state = { escrow: null, error: null };
const root = document.getElementById('settlement');

let token = null;
async function getToken() {
  if (token) return token;
  const res = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'money-page', type: 'client_credentials' }) });
  if (!res.ok) throw new Error('Could not authenticate');
  token = (await res.json()).access_token;
  return token;
}

async function load() {
  if (!shipmentId && !escrowId) { state.error = 'Open with ?shipment=GLOS-… or ?escrow=esc_…'; return render(); }
  try {
    const t = await getToken();
    const path = escrowId ? `/settlement/escrows/${encodeURIComponent(escrowId)}` : `/settlement/escrows/by-shipment/${encodeURIComponent(shipmentId)}`;
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Error ${res.status}`);
    }
    state.escrow = await res.json();
    state.error = null;
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    state.error = msg.includes('Failed to fetch') ? 'Cannot reach the server. Start the backend.' : msg;
  }
  render();
}

function money(amount, currency) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount); } catch { return `${currency} ${amount}`; }
}

function stepIndex(status) {
  if (status === 'released') return 2;
  if (status === 'partially_released') return 1;
  return 0;
}

function render() {
  if (state.error) { mount(root, [el('h1', { className: 'st__title', text: 'Your money' }), el('p', { className: 'st__msg--err', text: state.error })]); return; }
  if (!state.escrow) { mount(root, el('p', { text: 'Loading…' })); return; }

  const e = state.escrow;
  const instruction = `Money held safe: ${money(e.heldAmount, e.currency)}. Paid so far: ${money(e.releasedAmount, e.currency)}.`;

  const head = el('div', { className: 'st__head' }, [
    el('h1', { className: 'st__title', text: 'Your money' }),
    ReadAloud(() => instruction, { label: 'Listen' }),
  ]);

  const panel = el('div', { className: 'st__panel' }, [
    AmountHero({ amount: e.heldAmount, currency: e.currency, caption: 'Money held safe' }),
    el('div', { className: 'st__steps' }, [StepProgress({ steps: STEPS, currentIndex: stepIndex(e.status) })]),
    el('div', { className: 'st__sub', text: `Paid out: ${money(e.releasedAmount, e.currency)} of ${money(e.totalAmount, e.currency)}` }),
  ]);

  const milestones = e.milestones.map((m) => {
    const meta = MS[m.name] || { icon: '•', label: m.name };
    const paid = m.state === 'released';
    const children = [
      el('div', { className: 'st__ms-icon', attrs: { 'aria-hidden': 'true' }, text: meta.icon }),
      el('div', {}, [
        el('div', { className: 'st__ms-title', text: meta.label }),
        el('div', { className: 'st__sub' }, [StatusBadge(paid ? 'verified' : m.state === 'frozen' ? 'held' : 'pending', { labelOverride: paid ? 'Paid' : m.state === 'frozen' ? 'On hold' : 'Waiting' })]),
        paid && m.fee ? el('div', { className: 'st__fee', text: `Fee ${money(m.fee, e.currency)}${m.penalty ? ` · Late −${money(m.penalty, e.currency)}` : ''}` }) : null,
      ]),
      el('div', { className: 'st__ms-amt', text: paid ? money(m.fx ? m.fx.converted : (m.payeeNet ?? m.amount), m.fx ? m.fx.currency : e.currency) : money(m.amount, e.currency) }),
    ];
    return el('div', { className: `st__ms${m.state === 'frozen' ? ' is-frozen' : ''}` }, children);
  });

  const parts = [head, panel, el('div', { style: { display: 'grid', gap: '10px' } }, milestones)];

  if (e.feesCollected > 0) parts.push(el('div', { className: 'st__fee', text: `Platform fee total: ${money(e.feesCollected, e.currency)}` }));

  if (e.disputes && e.disputes.length) {
    parts.push(el('div', { className: 'st__panel st__dispute' }, [
      el('div', { className: 'st__ms-title', text: '⚠️ Disputes' }),
      ...e.disputes.map((d) => el('div', { className: 'st__sub', text: `${d.milestone}: ${d.reason} — ${d.status}` })),
    ]));
  }

  parts.push(BigButton({ label: 'Refresh', icon: '↻', variant: 'secondary', onClick: load }));
  mount(root, parts);
}

load();
