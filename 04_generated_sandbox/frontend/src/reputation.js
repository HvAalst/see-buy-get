// Low-literacy reputation dashboard (M5-060/061/063). Trust score as stars, dimension bars with
// plain names, trust badges, dispute summary, plain-language explanation + read-aloud. Reads
// ?did=did:glos:… . Calls the M5 endpoints with a client-credentials token.

import { ReadAloud, StatusBadge, el, mount } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const did = new URLSearchParams(window.location.search).get('did');

// Plain names + icons for each scoring dimension.
const DIM = {
  onTime: { icon: '⏰', label: 'On time' },
  cargoCare: { icon: '📦', label: 'Careful with cargo' },
  communication: { icon: '💬', label: 'Good communication' },
  documentation: { icon: '📄', label: 'Paperwork correct' },
  equipment: { icon: '🚚', label: 'Right equipment' },
  paymentPromptness: { icon: '💰', label: 'Pays on time' },
  loadReadiness: { icon: '📦', label: 'Ready to load' },
  informationAccuracy: { icon: '✅', label: 'Accurate info' },
  facilityAccessibility: { icon: '🚪', label: 'Easy access' },
};
const BADGE_ICON = { 'Elite On-Time': '⏱️', 'Zero Damage': '🛡️', 'Top Communicator': '💬', 'Prompt Payer': '💰' };

const state = { view: null, dashboard: null, error: null };
const root = document.getElementById('reputation');

let token = null;
async function getToken() {
  if (token) return token;
  const res = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'rep-page', type: 'client_credentials' }) });
  if (!res.ok) throw new Error('Could not authenticate');
  token = (await res.json()).access_token;
  return token;
}
async function get(path) {
  const t = await getToken();
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `Error ${res.status}`); }
  return res.json();
}

async function load() {
  if (!did) { state.error = 'Open with ?did=did:glos:…'; return render(); }
  try {
    state.view = await get(`/reputation/${encodeURIComponent(did)}`);
    state.dashboard = await get(`/reputation/${encodeURIComponent(did)}/dashboard`);
    state.error = null;
  } catch (e) {
    const m = String(e && e.message ? e.message : e);
    state.error = m.includes('Failed to fetch') ? 'Cannot reach the server. Start the backend.' : m;
  }
  render();
}

function stars(score) {
  const filled = Math.round(score);
  return '★★★★★☆☆☆☆☆'.slice(5 - filled, 10 - filled);
}

function render() {
  if (state.error) { mount(root, [el('h1', { className: 'rp__title', text: 'Trust score' }), el('p', { className: 'rp__msg--err', text: state.error })]); return; }
  if (!state.view) { mount(root, el('p', { text: 'Loading…' })); return; }

  const v = state.view;
  const instruction = v.explanation;
  const head = el('div', { className: 'rp__head' }, [el('h1', { className: 'rp__title', text: 'Trust score' }), ReadAloud(() => instruction, { label: 'Listen' })]);

  const hero = el('div', { className: 'rp__hero' }, [
    el('div', { className: 'rp__stars', attrs: { 'aria-label': `${v.composite} out of 5` }, text: stars(v.composite) }),
    el('div', { className: 'rp__score', text: `${v.composite.toFixed(1)} / 5` }),
    el('div', { className: 'rp__sub', text: v.samples > 0 ? `From ${v.samples} rating(s) · ±${v.confidenceInterval.toFixed(2)}` : 'New — no ratings yet' }),
    v.sanction && v.sanction !== 'none' ? el('div', { style: { marginTop: '10px' } }, [StatusBadge('held', { labelOverride: `Status: ${v.sanction}` })]) : null,
  ]);

  const parts = [head, hero];

  // Dimension bars.
  const dims = Object.entries(v.dimensions || {});
  if (dims.length) {
    parts.push(el('div', { className: 'rp__dim' }, dims.map(([key, d]) => {
      const meta = DIM[key] || { icon: '•', label: key };
      return el('div', { className: 'rp__dim-row' }, [
        el('div', { className: 'rp__dim-top' }, [el('span', { text: `${meta.icon} ${meta.label}` }), el('span', { text: `${Math.round(d.value)}/100` })]),
        el('div', { className: 'rp__bar' }, [el('div', { className: 'rp__bar-fill', style: { width: `${d.value}%` } })]),
      ]);
    })));
  }

  // Badges.
  if (v.badges && v.badges.length) {
    parts.push(el('div', { className: 'rp__chips' }, v.badges.map((b) => el('span', { className: 'rp__badge' }, [el('span', { attrs: { 'aria-hidden': 'true' }, text: BADGE_ICON[b] || '🏅' }), el('span', { text: b })]))));
  }

  // Disputes.
  if (v.disputeSummary && v.disputeSummary.total > 0) {
    parts.push(el('div', { className: 'rp__panel' }, [
      el('div', { style: { fontWeight: '700' }, text: '⚠️ Disputes' }),
      el('div', { className: 'rp__hist', text: `${v.disputeSummary.total} total · ${v.disputeSummary.atFault} found at fault` }),
    ]));
  }

  // Explanation + history.
  parts.push(el('div', { className: 'rp__panel' }, [
    el('div', { style: { fontWeight: '700' }, text: 'Why this score' }),
    el('div', { className: 'rp__hist', text: v.explanation }),
  ]));

  const history = (state.dashboard?.history) || [];
  if (history.length) {
    parts.push(el('div', { className: 'rp__panel' }, [
      el('div', { style: { fontWeight: '700' }, text: 'Recent ratings' }),
      ...history.slice(-5).reverse().map((h) => el('div', { className: 'rp__hist', text: `${new Date(h.at).toLocaleDateString()} — ${Object.keys(h.scores).map((k) => (DIM[k]?.label || k)).join(', ')}` })),
    ]));
  }

  parts.push(el('p', { className: 'rp__did', text: did }));
  mount(root, parts);
}

load();
