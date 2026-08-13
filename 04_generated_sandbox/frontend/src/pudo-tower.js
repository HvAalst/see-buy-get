// PUDO Control Tower — the network operator's console (Compendium Ch 14). Five modules: Dashboard
// (KPIs + flags + status mix), Agents (partner network, exception-driven), Finance (float / ledger),
// Map (agent dots), and User/Support (parcel lookup + audit timeline). Admin-grade dark control-room
// theme matching the GLOS control tower. Reads /v1/pudo/* (DID-authenticated).

import { el, mount } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const root = document.getElementById('pudo-tower');

const state = { dashboard: null, agents: [], finance: null, flags: [], kycQueue: [], heatmap: null, mdps: [], totes: [], lookup: null, msg: null, loading: true };

let token = null;
async function getToken() {
  if (token) return token;
  const res = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'pudo-tower', type: 'client_credentials' }) });
  token = (await res.json()).access_token;
  return token;
}
async function api(path) {
  const t = await getToken();
  const res = await fetch(`${API}/sbg${path}`, { headers: { Authorization: `Bearer ${t}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Error ${res.status}`);
  return data;
}
async function post(path, body) {
  const t = await getToken();
  const res = await fetch(`${API}/sbg${path}`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Error ${res.status}`);
  return data;
}

async function loadAll() {
  try {
    [state.dashboard, state.agents, state.finance, state.flags, state.kycQueue, state.heatmap, state.mdps, state.totes] = await Promise.all([api('/dashboard'), api('/agents'), api('/finance'), api('/flags'), api('/agents/kyc-queue'), api('/heatmap'), api('/mdps'), api('/totes')]);
    state.msg = null;
  } catch (e) {
    const m = String(e.message || e);
    state.msg = { type: 'err', text: m.includes('Failed to fetch') ? 'Cannot reach the server. Start the backend.' : m };
  }
  state.loading = false;
  render();
}

const fmtMoney = (n) => `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)}`;
const fmtTime = (iso) => { try { return new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)); } catch { return iso; } };
const short = (s) => (s && s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s || '—');

// Agent status → operator display (Ch 14.2: ACTIVE / LOW BAL / LOCKED / OFFLINE / KYC REV / UNFUNDED).
function agentDisplay(a) {
  const offline = (Date.now() - new Date(a.lastPingAt).getTime()) / 3_600_000 > 1;
  if (a.status === 'LOCKED') return { label: 'Locked', cls: 'bad' };
  if (a.status === 'KYC_PENDING') return { label: 'KYC review', cls: 'info' };
  if (a.status === 'DRAFT') return { label: 'Draft', cls: 'info' };
  if (a.status === 'APPROVED_UNFUNDED') return { label: 'Unfunded', cls: 'warn' };
  if (offline) return { label: 'Offline', cls: 'bad' };
  if (a.balance < 5) return { label: 'Low balance', cls: 'warn' };
  return { label: 'Active', cls: 'ok' };
}

function topBar() {
  return el('div', { className: 'pt__bar' }, [
    el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '12px' } }, [
      el('h1', { className: 'pt__title', text: '◎ PUDO Control Tower' }),
      el('span', { className: 'pt__sub', text: 'Light Edition' }),
    ]),
    el('button', { className: 'pt__btn', text: '⟳ Refresh', onClick: () => { state.loading = true; render(); loadAll(); } }),
  ]);
}

function kpis() {
  const d = state.dashboard || {};
  const tile = (num, label, risk) => el('div', { className: `pt__kpi${risk ? ' is-risk' : ''}` }, [el('div', { className: 'pt__kpi-num', text: String(num) }), el('div', { className: 'pt__kpi-label', text: label })]);
  return el('div', { className: 'pt__kpis' }, [
    tile(d.criticalAlerts > 0 ? `▲ ${d.criticalAlerts}` : '0', 'Critical alerts', d.criticalAlerts > 0),
    tile(d.parcelsInTransit ?? 0, 'In transit'),
    tile(`${d.agentsOnline ?? 0}/${d.agentsTotal ?? 0}`, 'Agents online'),
    tile(fmtMoney(d.systemFloat), 'System float'),
    tile(`${Math.round((d.agentRetention ?? 0) * 100)}%`, 'Retention'),
  ]);
}

const STATE_COLOR = { open: 'var(--success)', closed: 'var(--warn)', inactive: 'var(--slate)' };

function heatmapPanel() {
  const hm = state.heatmap || { points: [], cells: [], counts: { registered: 0, open: 0, closed: 0, inactive: 0 } };
  const pts = hm.points;
  const pad = 0.08;
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  const b = pts.length ? { minLat: Math.min(...lats) - pad, maxLat: Math.max(...lats) + pad, minLng: Math.min(...lngs) - pad, maxLng: Math.max(...lngs) + pad } : { minLat: -2, maxLat: 0, minLng: 36, maxLng: 38 };
  const span = (max, min) => (max - min || 1);
  const xy = (lat, lng) => ({ x: Math.max(2, Math.min(98, ((lng - b.minLng) / span(b.maxLng, b.minLng)) * 100)), y: Math.max(3, Math.min(97, ((b.maxLat - lat) / span(b.maxLat, b.minLat)) * 100)) });

  // Density layer — soft blurred blobs scaled by PUDO count per cell.
  const maxCount = Math.max(1, ...hm.cells.map((c) => c.count));
  const blobs = hm.cells.map((c) => {
    const [lat, lng] = c.cell.split(',').map(Number);
    const { x, y } = xy(lat, lng);
    const intensity = 0.18 + 0.55 * (c.count / maxCount);
    const size = 44 + 30 * (c.count / maxCount);
    return el('div', { style: { position: 'absolute', left: `${x}%`, top: `${y}%`, width: `${size}px`, height: `${size}px`, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: `rgba(91,122,147,${intensity})`, filter: 'blur(10px)', pointerEvents: 'none' } });
  });

  // PUDO markers — coloured by operational state.
  const dots = pts.map((p) => {
    const { x, y } = xy(p.lat, p.lng);
    return el('div', { attrs: { title: `${p.shopName} · ${p.zone} · ${p.state}` }, style: { position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)', width: '12px', height: '12px', borderRadius: '50%', background: STATE_COLOR[p.state] || 'var(--slate)', border: '2px solid #14171c', boxShadow: '0 1px 3px rgba(0,0,0,.4)' } });
  });

  const counts = hm.counts;
  return el('div', { className: 'pt__panel' }, [
    el('div', { className: 'pt__panel-h' }, [el('h2', { className: 'pt__panel-title', text: 'PUDO coverage heatmap' }), el('span', { className: 'pt__panel-hint', text: `${counts.registered} registered` })]),
    el('div', { className: 'pt__map' }, pts.length ? [...blobs, ...dots] : [el('div', { className: 'pt__empty', style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }, text: 'No located PUDOs yet.' })]),
    el('div', { className: 'pt__legend' }, [
      el('span', {}, [el('i', { className: 'pt__sw', style: { background: 'var(--success)' } }), ` Open · ${counts.open}`]),
      el('span', {}, [el('i', { className: 'pt__sw', style: { background: 'var(--warn)' } }), ` Temporarily closed · ${counts.closed}`]),
      el('span', {}, [el('i', { className: 'pt__sw', style: { background: 'var(--slate)' } }), ` Inactive / offline · ${counts.inactive}`]),
    ]),
  ]);
}

function agentsPanel() {
  if (!state.agents.length) return el('div', { className: 'pt__panel' }, [el('h2', { className: 'pt__panel-title', text: 'Agents' }), el('div', { className: 'pt__empty', text: 'No agents onboarded yet.' })]);
  const rows = state.agents.map((a) => {
    const d = agentDisplay(a);
    return el('tr', {}, [
      el('td', {}, [el('div', { style: { fontWeight: '700' }, text: a.shopName }), el('div', { className: 'pt__mono', text: short(a.did) })]),
      el('td', { text: a.zone }),
      el('td', {}, [el('span', { className: `pt__chip pt__chip--${d.cls}`, text: d.label })]),
      el('td', { text: fmtMoney(a.balance) }),
      el('td', { text: a.capacity != null ? `${a.freeSlots}/${a.capacity}` : '—' }),
      el('td', { text: a.rating?.count ? `${a.rating.average.toFixed(1)}★` : '—' }),
    ]);
  });
  return el('div', { className: 'pt__panel' }, [
    el('div', { className: 'pt__panel-h' }, [el('h2', { className: 'pt__panel-title', text: 'Agents' }), el('span', { className: 'pt__panel-hint', text: 'partner network · exception-driven' })]),
    el('table', { className: 'pt__table' }, [
      el('thead', {}, [el('tr', {}, ['Name / shop', 'Zone', 'Status', 'Wallet', 'Slots', 'Rating'].map((h) => el('th', { text: h })))]),
      el('tbody', {}, rows),
    ]),
  ]);
}

// MDP sort hubs + the live tote-bag pool (multi-hop visibility on the same console).
function mdpPanel() {
  const hubs = state.mdps || [];
  if (!hubs.length) return el('div', { className: 'pt__panel' }, [el('h2', { className: 'pt__panel-title', text: 'MDP sort hubs' }), el('div', { className: 'pt__empty', text: 'No MDP hubs registered.' })]);
  const totes = state.totes || [];
  const inTransit = totes.filter((t) => t.status === 'in_transit').length;
  const blocks = hubs.map((m) => {
    const at = totes.filter((t) => t.locationId === m.mdpId);
    const filling = at.filter((t) => t.status === 'filling');
    const free = at.filter((t) => t.status === 'free').length;
    const bags = filling.length
      ? el('table', { className: 'pt__table' }, [
          el('thead', {}, [el('tr', {}, ['Bag', 'Destination', 'Parcels', 'Fill'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, filling.map((t) => el('tr', {}, [
            el('td', {}, [el('span', { className: 'pt__mono', text: t.code })]),
            el('td', { text: t.destinationLabel || short(t.destinationNodeId) }),
            el('td', { text: String(t.parcels.length) }),
            el('td', { text: `${Math.min(100, Math.round((t.unitsUsed / 10) * 100))}%` }),
          ]))),
        ])
      : el('div', { className: 'pt__flag-d', style: { padding: '4px 0' }, text: 'No open bags.' });
    return el('div', { style: { marginBottom: '12px' } }, [
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' } }, [
        el('div', { style: { fontWeight: '700' }, text: m.name }),
        el('span', { className: 'pt__panel-hint', text: `${m.zones.join(', ')} · ${free} empty tote${free === 1 ? '' : 's'}` }),
      ]),
      bags,
    ]);
  });
  return el('div', { className: 'pt__panel' }, [
    el('div', { className: 'pt__panel-h' }, [el('h2', { className: 'pt__panel-title', text: 'MDP sort hubs' }), el('span', { className: 'pt__panel-hint', text: `${hubs.length} hub${hubs.length === 1 ? '' : 's'} · ${inTransit} bag${inTransit === 1 ? '' : 's'} on the road` })]),
    el('div', {}, blocks),
  ]);
}

function kycPanel() {
  const q = state.kycQueue || [];
  const rows = q.map((a) => el('div', { className: 'pt__flag', style: { borderLeftColor: 'var(--slate)' } }, [
    el('span', { className: 'pt__chip pt__chip--info', text: 'KYC' }),
    el('div', {}, [
      el('div', { className: 'pt__flag-t', text: `${a.shopName} · ${a.zone}` }),
      el('div', { className: 'pt__flag-d', text: `shelf ${a.shelf?.rows}×${a.shelf?.cols} (${(a.shelf?.rows || 0) * (a.shelf?.cols || 0)} slots) · Android ${a.requirements?.androidVersion} · licence ${a.requirements?.tradingLicence}` }),
      el('div', { className: 'pt__flag-d', text: `Docs: ${a.kyc ? [a.kyc.idCopyRef, a.kyc.tradingLicenceRef, ...(a.kyc.shopPhotoRefs || [])].join(', ') : '—'}` }),
      el('div', { className: 'pt__btns', style: { marginTop: '8px' } }, [
        el('button', { className: 'pt__btn', style: { background: 'var(--success)', borderColor: 'var(--success)', color: '#fff' }, text: 'Approve', onClick: () => decideKyc(a.did, true) }),
        el('button', { className: 'pt__btn', style: { background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' }, text: 'Reject', onClick: () => decideKyc(a.did, false) }),
      ]),
    ]),
  ]));
  return el('div', { className: 'pt__panel' }, [
    el('h2', { className: 'pt__panel-title', text: `KYC review queue${q.length ? ` · ${q.length}` : ''}` }),
    el('div', {}, rows.length ? rows : [el('div', { className: 'pt__empty', text: 'No agents awaiting KYC review.' })]),
  ]);
}
async function decideKyc(did, approve) {
  try { await post(`/agents/${did}/kyc-decision`, { approve, by: 'ops' }); state.loading = true; render(); loadAll(); }
  catch (e) { state.msg = { type: 'err', text: String(e.message || e) }; render(); }
}

function flagsPanel() {
  const body = state.flags.length
    ? state.flags.map((f) => el('div', { className: 'pt__flag' }, [el('span', { className: 'pt__chip pt__chip--bad', text: f.type.replace(/_/g, ' ') }), el('div', {}, [el('div', { className: 'pt__flag-t', text: f.subject }), el('div', { className: 'pt__flag-d', text: f.detail })])]))
    : [el('div', { className: 'pt__empty', text: 'No active flags. Network healthy.' })];
  return el('div', { className: 'pt__panel' }, [el('h2', { className: 'pt__panel-title', text: 'Critical flags' }), el('div', {}, body)]);
}

function financePanel() {
  const f = state.finance || {};
  const tiles = el('div', { className: 'pt__kpis', style: { gridTemplateColumns: 'repeat(2,1fr)', margin: '4px 0 14px' } }, [
    el('div', { className: 'pt__kpi' }, [el('div', { className: 'pt__kpi-num', text: fmtMoney(f.systemFloat) }), el('div', { className: 'pt__kpi-label', text: 'System float' })]),
    el('div', { className: 'pt__kpi' }, [el('div', { className: 'pt__kpi-num', text: fmtMoney(f.todayRevenue) }), el('div', { className: 'pt__kpi-label', text: "Today's revenue" })]),
  ]);
  const ledger = (f.recentLedger || []).length
    ? el('table', { className: 'pt__table' }, [
        el('thead', {}, [el('tr', {}, ['Type', 'Amt', 'Ref', 'When'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, f.recentLedger.slice(0, 8).map((e) => el('tr', {}, [
          el('td', {}, [el('span', { className: `pt__chip pt__chip--${e.sign === '+' ? 'ok' : 'warn'}`, text: e.type.replace(/_/g, ' ') })]),
          el('td', { text: `${e.sign}${fmtMoney(e.amount).slice(1)}` }),
          el('td', {}, [el('span', { className: 'pt__mono', text: short(e.reference) })]),
          el('td', { text: fmtTime(e.at) }),
        ]))),
      ])
    : el('div', { className: 'pt__empty', text: 'No ledger entries yet.' });
  return el('div', { className: 'pt__panel' }, [el('h2', { className: 'pt__panel-title', text: 'Finance' }), tiles, ledger]);
}

function supportPanel() {
  const input = el('input', { className: 'pt__input', attrs: { placeholder: 'Parcel sticker ID', style: 'flex:1' } });
  const find = el('button', { className: 'pt__btn', text: 'Look up', onClick: async () => { if (!input.value.trim()) return; try { state.lookup = await api(`/parcels/${encodeURIComponent(input.value.trim())}`); state.msg = null; } catch (e) { state.lookup = null; state.msg = { type: 'err', text: String(e.message || e) }; } render(); } });
  const children = [
    el('h2', { className: 'pt__panel-title', text: 'User / support — parcel lookup' }),
    el('div', { style: { display: 'flex', gap: '8px', margin: '0 0 12px' } }, [input, find]),
  ];
  if (state.lookup) {
    const p = state.lookup;
    children.push(el('div', { style: { marginBottom: '10px' } }, [el('span', { className: 'pt__chip pt__chip--info', text: p.status.replace(/_/g, ' ') }), el('span', { style: { marginLeft: '10px', color: 'var(--muted)' }, text: `${p.size} · ${p.origin} → ${p.destination}` })]));
    // The recovery half of the release lockout: a customer is at the counter, the code was burned by
    // wrong guesses, and only the control tower can rotate it. The new code is never shown here — it
    // goes to the buyer's app and the store; a peer-send OTP comes back for the agent to read aloud.
    if (p.status === 'Ready_For_Pickup') {
      const locked = Boolean(p.releaseLockedAt);
      children.push(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', margin: '0 0 12px' } }, [
        locked ? el('span', { className: 'pt__chip pt__chip--warn', text: 'release code locked' }) : el('span', { style: { color: 'var(--muted)' }, text: 'Release code is live.' }),
        el('button', {
          className: 'pt__btn',
          text: 'Reissue release code',
          onClick: async () => {
            try {
              const out = await post(`/parcels/${encodeURIComponent(p.parcelId)}/reissue-release`, { by: 'control-tower' });
              state.lookup = await api(`/parcels/${encodeURIComponent(p.parcelId)}`);
              state.msg = { type: 'ok', text: out.kind === 'otp' ? `New pickup OTP: ${out.otp} — read it to the customer.` : 'New collection code sent to the buyer’s app and the store.' };
            } catch (e) {
              state.msg = { type: 'err', text: String(e.message || e) };
            }
            render();
          },
        }),
      ]));
    }
    children.push(el('div', {}, (p.scans || []).map((s) => el('div', { className: 'pt__scan' }, [
      el('span', { className: 'pt__chip pt__chip--info', text: String(s.status).replace(/_/g, ' ') }),
      el('span', { className: 'pt__flag-d', text: s.note || '' }),
      el('span', { className: 'pt__mono', text: fmtTime(s.at) }),
    ]))));
    if (p.dropoffPhotoRef) children.push(el('div', { className: 'pt__flag-d', style: { marginTop: '8px' }, text: `Drop-off proof: ${p.dropoffPhotoRef}${p.deliveredPhotoRef ? ` · Delivered: ${p.deliveredPhotoRef}` : ''}` }));
  }
  return el('div', { className: 'pt__panel' }, children);
}

function render() {
  const parts = [topBar()];
  // Tone-aware: a successful reissue must not be shouted in the same red as a failure.
  if (state.msg) {
    const tone = state.msg.type === 'ok' ? 'var(--ok, #2e7d32)' : 'var(--danger)';
    parts.push(el('div', { className: 'pt__panel', style: { borderColor: tone, color: tone }, text: state.msg.text }));
  }
  if (state.loading) { parts.push(el('div', { className: 'pt__empty', text: 'Loading control tower…' })); mount(root, parts); return; }
  parts.push(kpis());
  parts.push(el('div', { className: 'pt__grid' }, [
    el('div', {}, [heatmapPanel(), agentsPanel(), mdpPanel()]),
    el('div', {}, [kycPanel(), flagsPanel(), financePanel(), supportPanel()]),
  ]));
  mount(root, parts);
}

render();
loadAll();
