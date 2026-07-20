// GLOS M7 — AI Control Tower (administrator console).
//
// Unlike the participant UIs, this surface is for highly-literate, culture-aware control-tower
// admins: information-dense, precise, professional. It is built to be CLONED PER REGION — one
// codebase, configured by the REGIONS map and selected with ?region=<code>. Each region carries its
// own locale, time zone, currency and geographic bounds, so the same console deploys as "EMEA Tower",
// "APAC Tower", etc. as the network grows. Add a region = add a config entry.

import { StatusBadge, el, mount } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';

// --- region clones -------------------------------------------------------------------------------
const REGIONS = {
  global: { code: 'global', name: 'Global Network', locale: 'en-US', timeZone: 'UTC', currency: 'USD', bounds: { minLat: -60, maxLat: 78, minLng: -170, maxLng: 180 } },
  emea: { code: 'emea', name: 'EMEA', locale: 'en-GB', timeZone: 'Europe/Amsterdam', currency: 'EUR', bounds: { minLat: -38, maxLat: 72, minLng: -28, maxLng: 62 } },
  apac: { code: 'apac', name: 'APAC', locale: 'en-SG', timeZone: 'Asia/Singapore', currency: 'SGD', bounds: { minLat: -48, maxLat: 55, minLng: 60, maxLng: 180 } },
  amer: { code: 'amer', name: 'Americas', locale: 'en-US', timeZone: 'America/New_York', currency: 'USD', bounds: { minLat: -56, maxLat: 72, minLng: -170, maxLng: -30 } },
};
const REGION = REGIONS[new URLSearchParams(location.search).get('region') || 'global'] || REGIONS.global;

// Culture-aware formatters bound to the active region.
const fmtMoney = (n) => new Intl.NumberFormat(REGION.locale, { style: 'currency', currency: REGION.currency, maximumFractionDigits: 0 }).format(n || 0);
const fmtDateTime = (iso) => {
  try { return new Intl.DateTimeFormat(REGION.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: REGION.timeZone }).format(new Date(iso)); } catch { return iso; }
};
const fmtNum = (n) => new Intl.NumberFormat(REGION.locale, { maximumFractionDigits: 1 }).format(n);

// --- status vocabularies (admin-grade, icon+color+shape) -----------------------------------------
const SHIP_STATUS = {
  created: { label: 'Created', icon: '•', tone: 'neutral', shape: 'pill' },
  planned: { label: 'Planned', icon: '◦', tone: 'info', shape: 'pill' },
  assigned: { label: 'Assigned', icon: '●', tone: 'info', shape: 'pill' },
  picked_up: { label: 'Picked up', icon: '▲', tone: 'info', shape: 'pill' },
  in_transit: { label: 'In transit', icon: '▶', tone: 'info', shape: 'pill' },
  handed_over: { label: 'Handed over', icon: '⇄', tone: 'info', shape: 'pill' },
  out_for_delivery: { label: 'Out for delivery', icon: '▸', tone: 'info', shape: 'pill' },
  delivered: { label: 'Delivered', icon: '✓', tone: 'success', shape: 'circle' },
  exception: { label: 'Exception', icon: '!', tone: 'danger', shape: 'square' },
};
const ACTION_STATUS = {
  executed: { label: 'Executed', icon: '✓', tone: 'success', shape: 'circle' },
  pending_approval: { label: 'Pending approval', icon: '⏳', tone: 'warn', shape: 'diamond' },
  frozen: { label: 'Frozen (anomaly)', icon: '⛔', tone: 'danger', shape: 'square' },
  rejected: { label: 'Rejected', icon: '✕', tone: 'danger', shape: 'square' },
  rolled_back: { label: 'Rolled back', icon: '↺', tone: 'neutral', shape: 'pill' },
};
const OPTION_ICON = { reroute: '🔀', wait: '⏸️', rebook_fastest: '⚡', split_air: '✈️' };

// --- state ---------------------------------------------------------------------------------------
const state = {
  shipments: [], etas: {}, disruptions: [], impacted: [], impactedBy: null,
  selected: null, options: [], result: null, actions: [], msg: null, loading: true,
  sources: [], recentSignals: [], scenario: null, carbon: null, design: null,
};
const root = document.getElementById('control-tower');

// --- api ------------------------------------------------------------------------------------------
let token = null;
async function getToken() {
  if (token) return token;
  const res = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: `tower-${REGION.code}`, type: 'client_credentials' }) });
  if (!res.ok) throw new Error('Could not authenticate');
  token = (await res.json()).access_token;
  return token;
}
async function api(path, { method = 'GET', body } = {}) {
  const t = await getToken();
  const res = await fetch(`${API}/control-tower${path}`, {
    method, headers: { Authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `Error ${res.status}`); }
  return res.json();
}
function fail(e) {
  const m = String(e && e.message ? e.message : e);
  state.msg = { type: 'err', text: m.includes('Failed to fetch') ? 'Cannot reach the server. Start the backend.' : m };
}

// --- region scoping ------------------------------------------------------------------------------
function inRegion(node) {
  if (REGION.code === 'global') return true;
  const loc = node.location;
  if (!loc) return false;
  const b = REGION.bounds;
  return loc.lat >= b.minLat && loc.lat <= b.maxLat && loc.lng >= b.minLng && loc.lng <= b.maxLng;
}
const sid = (node) => String(node.props?.glosShipmentId ?? '');
const critOf = (id) => state.impacted.find((i) => i.glosShipmentId === id)?.criticality ?? null;

// --- data loading --------------------------------------------------------------------------------
async function loadAll() {
  try {
    const all = await api('/twin/shipments');
    state.shipments = all.filter(inRegion);
    state.etas = {};
    await Promise.all(state.shipments.map(async (n) => { try { state.etas[sid(n)] = await api(`/eta/${encodeURIComponent(sid(n))}`); } catch { /* node without legs */ } }));
    [state.actions, state.disruptions, state.sources, state.recentSignals, state.carbon, state.design] = await Promise.all([api('/actions'), api('/disruptions'), api('/signals/sources'), api('/signals/recent'), api('/carbon/network'), api('/network-design')]);
    state.msg = null;
  } catch (e) { fail(e); }
  state.loading = false;
  render();
}

async function pollFeeds() {
  try {
    const created = await api('/signals/poll', { method: 'POST' });
    [state.actions, state.disruptions, state.recentSignals] = await Promise.all([api('/actions'), api('/disruptions'), api('/signals/recent')]);
    state.msg = { type: 'ok', text: created.length ? `Polled feeds: ${created.length} new advisory(ies) ingested. Policies auto-evaluated — see the audit trail.` : 'Polled feeds: no new advisories.' };
  } catch (e) { fail(e); }
  render();
}

async function submitRawSignal(form) {
  try {
    await api('/signals', { method: 'POST', body: { source: 'manual-webhook', zone: form.zone, headline: form.headline, severity: form.severity } });
    [state.actions, state.disruptions, state.recentSignals] = await Promise.all([api('/actions'), api('/disruptions'), api('/signals/recent')]);
    state.msg = { type: 'ok', text: 'Advisory ingested + classified. Policies auto-evaluated against the blast radius.' };
  } catch (e) { fail(e); }
  render();
}

async function registerDisruption(form) {
  try {
    const body = { zone: form.zone, severity: form.severity, radiusKm: form.radiusKm ? Number(form.radiusKm) : undefined };
    if (form.type && form.type !== 'auto') body.type = form.type; else body.keywords = [form.zone];
    const d = await api('/disruptions', { method: 'POST', body });
    state.disruptions = [d, ...state.disruptions.filter((x) => x.id !== d.id)];
    await assessImpact(d.id);
  } catch (e) { fail(e); render(); }
}
async function assessImpact(disruptionId) {
  try {
    state.impacted = await api(`/disruptions/${disruptionId}/impact`);
    state.impactedBy = disruptionId;
    const d = state.disruptions.find((x) => x.id === disruptionId);
    state.msg = { type: 'ok', text: `${state.impacted.length} shipment(s) in the blast radius of ${d ? d.type.replace('_', ' ') : 'the disruption'} @ ${d ? d.zone : ''}.` };
  } catch (e) { fail(e); }
  render();
}
async function selectShipment(id) {
  try {
    state.selected = id;
    state.result = null;
    state.options = await api(`/recommend/${encodeURIComponent(id)}${state.impactedBy ? `?disruptionId=${state.impactedBy}` : ''}`);
  } catch (e) { fail(e); }
  render();
}
async function executeOption(action) {
  try {
    state.result = await api('/actions', { method: 'POST', body: { glosShipmentId: state.selected, action, disruptionId: state.impactedBy || undefined } });
    state.actions = await api('/actions');
  } catch (e) { fail(e); }
  render();
}
async function actOn(actionId, verb) {
  try {
    state.result = await api(`/actions/${actionId}/${verb}`, { method: 'POST' });
    state.actions = await api('/actions');
  } catch (e) { fail(e); }
  render();
}
async function runSimulation(scenario) {
  try {
    state.scenario = await api('/simulate', { method: 'POST', body: scenario }); // read-only — commits nothing
    state.msg = { type: 'ok', text: `Rehearsed “${state.scenario.label}”: ${state.scenario.totals.impacted} shipment(s) impacted. Nothing was committed.` };
  } catch (e) { fail(e); }
  render();
}

async function registerPolicy(form) {
  try {
    await api('/policies', { method: 'POST', body: { shipperDid: form.shipperDid, ifDelayHoursGt: Number(form.ifDelayHoursGt), ifExtraCostLt: Number(form.ifExtraCostLt), thenAction: form.thenAction } });
    state.msg = { type: 'ok', text: 'Policy saved. It will be evaluated on the next disruption for that shipper.' };
  } catch (e) { fail(e); }
  render();
}

// --- render helpers ------------------------------------------------------------------------------
const short = (s) => (s && s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s || '—');

function topBar() {
  const regionBtns = Object.values(REGIONS).map((r) =>
    el('a', { className: `ct__region-btn${r.code === REGION.code ? ' is-on' : ''}`, text: r.name, attrs: { href: `?region=${r.code}` } }),
  );
  return el('div', { className: 'ct__bar' }, [
    el('div', { className: 'ct__brand' }, [
      el('h1', { className: 'ct__title', text: '◎ GLOS Control Tower' }),
      el('span', { className: 'ct__region', text: REGION.name }),
    ]),
    el('div', { className: 'ct__bar-right' }, [
      el('div', { className: 'ct__regions' }, regionBtns),
      el('div', { className: 'ct__meta', text: `${REGION.locale} · ${REGION.timeZone} · ${REGION.currency}` }),
      el('button', { className: 'ct__btn ct__btn--ghost', text: '⟳ Refresh', onClick: () => { state.loading = true; render(); loadAll(); } }),
    ]),
  ]);
}

function kpis() {
  const s = state.shipments;
  const active = s.filter((n) => n.state && !['delivered', 'created'].includes(n.state));
  const atRisk = new Set(state.impacted.map((i) => i.glosShipmentId));
  const delivered = s.filter((n) => n.state === 'delivered');
  const avgEta = (() => { const v = Object.values(state.etas).map((e) => e.hoursRemaining).filter((h) => h > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; })();
  const tile = (num, label, risk) => el('div', { className: `ct__kpi${risk ? ' is-risk' : ''}` }, [el('div', { className: 'ct__kpi-num', text: String(num) }), el('div', { className: 'ct__kpi-label', text: label })]);
  // F-pattern: the most action-critical metric (At risk) sits top-left and is accented.
  return el('div', { className: 'ct__kpis' }, [
    tile(atRisk.size > 0 ? `▲ ${atRisk.size}` : '0', 'At risk', atRisk.size > 0),
    tile(active.length, 'In flight'),
    tile(s.length, 'Shipments'),
    tile(delivered.length, 'Delivered'),
    tile(avgEta ? `${fmtNum(avgEta)}h` : '—', 'Avg ETA'),
  ]);
}

function mapPanel() {
  const b = REGION.bounds;
  const dots = state.shipments.filter((n) => n.location).map((n) => {
    const x = Math.max(0, Math.min(100, ((n.location.lng - b.minLng) / (b.maxLng - b.minLng)) * 100));
    const y = Math.max(0, Math.min(100, ((b.maxLat - n.location.lat) / (b.maxLat - b.minLat)) * 100));
    const risk = state.impacted.some((i) => i.glosShipmentId === sid(n)) || n.state === 'exception';
    const color = risk ? 'var(--danger)' : n.state === 'delivered' ? 'var(--success)' : 'var(--brand-bright)';
    return el('div', {
      attrs: { title: `${short(sid(n))} · ${n.state || ''}` },
      style: { position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)', width: risk ? '16px' : '12px', height: risk ? '16px' : '12px', borderRadius: '50%', background: color, border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,.3)' },
    });
  });
  const legend = el('div', { className: 'ct__legend' }, [
    el('span', {}, [el('i', { className: 'ct__sw', style: { background: 'var(--brand-bright)' } }), 'On track']),
    el('span', {}, [el('i', { className: 'ct__sw', style: { background: 'var(--danger)' } }), 'At risk']),
    el('span', {}, [el('i', { className: 'ct__sw', style: { background: 'var(--success)' } }), 'Delivered']),
  ]);
  return el('div', { className: 'ct__panel' }, [
    el('div', { className: 'ct__panel-h' }, [el('h2', { className: 'ct__panel-title', text: 'Live network map' }), el('span', { className: 'ct__panel-hint', text: `${dots.length} located` })]),
    el('div', { className: 'ct__map', style: { position: 'relative' } }, dots.length ? dots : [el('div', { className: 'ct__empty', style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center' }, text: 'No located shipments in this region yet.' })]),
    legend,
  ]);
}

function watchlistPanel() {
  if (!state.shipments.length) {
    return el('div', { className: 'ct__panel' }, [el('h2', { className: 'ct__panel-title', text: 'Shipment watchlist' }), el('div', { className: 'ct__empty', text: 'No shipments in the twin for this region. Create one via /send.html, then refresh.' })]);
  }
  const rows = [...state.shipments]
    .sort((a, b) => (critOf(sid(b)) ?? -1) - (critOf(sid(a)) ?? -1))
    .map((n) => {
      const id = sid(n);
      const eta = state.etas[id];
      const crit = critOf(id);
      const sel = state.selected === id;
      const impacted = crit != null;
      return el('tr', { className: `${impacted ? 'is-impacted' : ''}${sel ? ' is-selected' : ''}` }, [
        el('td', {}, [el('span', { className: 'ct__mono', text: short(id) })]),
        el('td', {}, [StatusBadge(n.state || 'created', { map: SHIP_STATUS })]),
        el('td', { text: eta ? `${fmtNum(eta.hoursRemaining)}h` : '—' }),
        el('td', { text: eta ? fmtDateTime(eta.eta) : '—' }),
        el('td', {}, crit != null ? [critMeter(crit)] : [el('span', { text: '—' })]),
        el('td', {}, [el('button', { className: 'ct__linklike', text: 'Options →', onClick: () => selectShipment(id) })]),
      ]);
    });
  const table = el('table', { className: 'ct__table' }, [
    el('thead', {}, [el('tr', {}, ['Shipment', 'State', 'ETA', 'Arrival (local)', 'Risk', ''].map((h) => el('th', { text: h })))]),
    el('tbody', {}, rows),
  ]);
  return el('div', { className: 'ct__panel' }, [
    el('div', { className: 'ct__panel-h' }, [el('h2', { className: 'ct__panel-title', text: 'Shipment watchlist' }), el('span', { className: 'ct__panel-hint', text: state.impactedBy ? 'sorted by blast-radius criticality' : 'sorted by criticality' })]),
    table,
  ]);
}

function critMeter(crit) {
  return el('span', { className: 'ct__crit' }, [
    el('span', { className: 'ct__crit-bar' }, [el('span', { className: 'ct__crit-fill', style: { width: `${crit}%` } })]),
    el('b', { text: String(crit) }),
  ]);
}

const DISPOSITION = {
  auto: { label: 'Auto-execute', cls: 'low' },
  approval: { label: 'Needs approval', cls: 'medium' },
  frozen: { label: 'Frozen (anomaly)', cls: 'high' },
};

function simulatorPanel() {
  const zone = el('input', { className: 'ct__input', attrs: { placeholder: 'e.g. Singapore, Suez' } });
  const type = el('select', { className: 'ct__select' }, ['auto', 'port_strike', 'weather', 'unrest', 'congestion', 'carrier_failure'].map((o) => el('option', { text: o.replace('_', ' '), attrs: { value: o } })));
  const severity = el('select', { className: 'ct__select' }, ['high', 'medium', 'low'].map((o) => el('option', { text: o, attrs: { value: o } })));
  const run = el('button', {
    className: 'ct__btn', text: '▶ Run simulation',
    onClick: () => {
      if (!zone.value.trim()) { state.msg = { type: 'err', text: 'Enter a zone to simulate.' }; return render(); }
      const d = { zone: zone.value.trim(), severity: severity.value };
      if (type.value !== 'auto') d.type = type.value;
      runSimulation({ label: `${type.value === 'auto' ? 'disruption' : type.value.replace('_', ' ')} @ ${zone.value.trim()}`, disruptions: [d] });
    },
  });

  const children = [
    el('div', { className: 'ct__panel-h' }, [el('h2', { className: 'ct__panel-title', text: 'What-if simulator' }), el('span', { className: 'ct__panel-hint', text: 'rehearsal · commits nothing' })]),
    el('p', { className: 'ct__panel-hint', text: 'Project a hypothetical disruption against the live network — blast radius, ETA hit and what each policy would do — without changing anything.' }),
    el('div', { className: 'ct__form-row' }, [el('div', { className: 'ct__field' }, [el('label', { text: 'Type' }), type]), el('div', { className: 'ct__field' }, [el('label', { text: 'Severity' }), severity])]),
    el('div', { className: 'ct__field' }, [el('label', { text: 'Zone' }), zone]),
    run,
  ];

  if (state.scenario) children.push(scenarioReport(state.scenario));
  return el('div', { className: 'ct__panel' }, children);
}

function scenarioReport(r) {
  const t = r.totals;
  const tiles = el('div', { className: 'ct__kpis', style: { gridTemplateColumns: 'repeat(3,1fr)', margin: '14px 0' } }, [
    miniTile(t.impacted, 'Impacted'),
    miniTile(`${fmtNum(t.addedHours)}h`, 'Added delay'),
    miniTile(fmtMoney(t.autonomousCost), 'Auto spend'),
    miniTile(t.autonomousActions, 'Auto-execute'),
    miniTile(t.approvalsRequired, 'Need approval'),
    miniTile(t.unprotected, 'Unprotected', t.unprotected > 0),
  ]);
  const rows = r.impacted.map((s) => {
    const disp = s.policyWouldFire ? DISPOSITION[s.disposition] || { label: s.disposition, cls: 'medium' } : { label: 'Manual (no policy)', cls: 'medium' };
    return el('tr', { className: s.policyWouldFire ? '' : 'is-impacted' }, [
      el('td', {}, [el('span', { className: 'ct__mono', text: short(s.glosShipmentId) })]),
      el('td', {}, [StatusBadge(s.state, { map: SHIP_STATUS })]),
      el('td', { text: `▲ ${fmtNum(s.deltaHours)}h` }),
      el('td', {}, [critMeter(s.criticality)]),
      el('td', { text: s.recommended ? `${OPTION_ICON[s.recommended.action] || ''} ${s.recommended.action.replace('_', ' ')} (${fmtMoney(s.recommended.deltaCost)})` : '—' }),
      el('td', {}, [el('span', { className: `ct__chip ct__chip--${disp.cls}`, text: disp.label })]),
    ]);
  });
  const table = r.impacted.length
    ? el('table', { className: 'ct__table' }, [
        el('thead', {}, [el('tr', {}, ['Shipment', 'State', 'ΔETA', 'Risk', 'Best action', 'Policy'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, rows),
      ])
    : el('div', { className: 'ct__empty', text: 'No shipments would be affected by this scenario.' });
  return el('div', { style: { borderTop: '1px solid var(--border)', marginTop: '12px', paddingTop: '12px' } }, [
    el('h3', { className: 'ct__panel-title', style: { fontSize: '0.92rem' }, text: `Projection — ${r.label}` }),
    tiles,
    table,
  ]);
}

function miniTile(num, label, risk) {
  return el('div', { className: `ct__kpi${risk ? ' is-risk' : ''}` }, [el('div', { className: 'ct__kpi-num', text: String(num) }), el('div', { className: 'ct__kpi-label', text: label })]);
}

function signalsPanel() {
  const sources = state.sources.length
    ? el('div', { className: 'ct__btns', style: { marginBottom: '12px' } }, state.sources.map((s) => el('span', { className: 'ct__chip ct__chip--low', text: `📡 ${s}` })))
    : el('div', { className: 'ct__empty', text: 'No feed connectors registered.' });

  const poll = el('button', { className: 'ct__btn', text: '⟲ Poll feeds now', onClick: () => pollFeeds() });

  // Webhook simulator — what an external feed would POST.
  const zone = el('input', { className: 'ct__input', attrs: { placeholder: 'Zone, e.g. Singapore' } });
  const headline = el('input', { className: 'ct__input', attrs: { placeholder: 'Advisory text, e.g. “port strike halts handling”' } });
  const severity = el('select', { className: 'ct__select' }, ['high', 'medium', 'low'].map((o) => el('option', { text: o, attrs: { value: o } })));
  const push = el('button', {
    className: 'ct__btn ct__btn--ghost', text: 'Push advisory',
    onClick: () => { if (!zone.value.trim() || !headline.value.trim()) { state.msg = { type: 'err', text: 'Enter a zone and advisory text.' }; return render(); } submitRawSignal({ zone: zone.value.trim(), headline: headline.value.trim(), severity: severity.value }); },
  });

  const recent = state.recentSignals.length
    ? el('table', { className: 'ct__table' }, [
        el('thead', {}, [el('tr', {}, ['Source', 'Zone', 'Classified', 'When'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, state.recentSignals.slice(0, 6).map((s) => el('tr', {}, [
          el('td', { text: s.source }),
          el('td', { text: s.zone }),
          el('td', { text: s.type.replace('_', ' ') }),
          el('td', { text: fmtDateTime(s.at) }),
        ]))),
      ])
    : el('div', { className: 'ct__empty', text: 'No advisories ingested yet.' });

  return el('div', { className: 'ct__panel' }, [
    el('div', { className: 'ct__panel-h' }, [el('h2', { className: 'ct__panel-title', text: 'Signal feeds' }), el('span', { className: 'ct__panel-hint', text: 'live advisories → auto-policy' })]),
    el('p', { className: 'ct__panel-hint', text: 'External feeds push or are polled; each advisory is classified and shipper policies are evaluated automatically.' }),
    sources,
    poll,
    el('h3', { className: 'ct__panel-title', style: { fontSize: '0.9rem', margin: '16px 0 8px' }, text: 'Push advisory (webhook)' }),
    el('div', { className: 'ct__field' }, [el('label', { text: 'Zone' }), zone]),
    el('div', { className: 'ct__field' }, [el('label', { text: 'Advisory' }), headline]),
    el('div', { className: 'ct__form-row' }, [el('div', { className: 'ct__field' }, [el('label', { text: 'Severity' }), severity]), el('div', { style: { display: 'flex', alignItems: 'end' } }, [push])]),
    el('h3', { className: 'ct__panel-title', style: { fontSize: '0.9rem', margin: '16px 0 8px' }, text: 'Recent advisories' }),
    recent,
  ]);
}

function disruptionPanel() {
  const zone = el('input', { className: 'ct__input', attrs: { placeholder: 'e.g. Singapore, Suez, Rotterdam' } });
  const type = el('select', { className: 'ct__select' }, ['auto', 'port_strike', 'weather', 'unrest', 'congestion', 'carrier_failure'].map((o) => el('option', { text: o.replace('_', ' '), attrs: { value: o } })));
  const severity = el('select', { className: 'ct__select' }, ['high', 'medium', 'low'].map((o) => el('option', { text: o, attrs: { value: o } })));
  const radius = el('input', { className: 'ct__input', attrs: { type: 'number', placeholder: '100', min: '0' } });

  const submit = el('button', {
    className: 'ct__btn', text: 'Detect & assess impact',
    onClick: () => { if (!zone.value.trim()) { state.msg = { type: 'err', text: 'Enter an affected zone.' }; return render(); } registerDisruption({ zone: zone.value.trim(), type: type.value, severity: severity.value, radiusKm: radius.value }); },
  });

  const active = state.disruptions.length
    ? el('table', { className: 'ct__table' }, [
        el('thead', {}, [el('tr', {}, ['Type', 'Zone', 'Severity', ''].map((h) => el('th', { text: h })))]),
        el('tbody', {}, state.disruptions.map((d) => el('tr', {}, [
          el('td', { text: d.type.replace('_', ' ') }),
          el('td', { text: d.zone }),
          el('td', {}, [el('span', { className: `ct__chip ct__chip--${d.severity}`, text: d.severity })]),
          el('td', {}, [el('button', { className: 'ct__linklike', text: d.id === state.impactedBy ? 're-assess' : 'assess', onClick: () => assessImpact(d.id) })]),
        ]))),
      ])
    : el('div', { className: 'ct__empty', text: 'No active disruptions.' });

  return el('div', { className: 'ct__panel' }, [
    el('h2', { className: 'ct__panel-title', text: 'Disruption desk' }),
    el('div', { className: 'ct__field' }, [el('label', { text: 'Affected zone' }), zone]),
    el('div', { className: 'ct__form-row' }, [
      el('div', { className: 'ct__field' }, [el('label', { text: 'Type' }), type]),
      el('div', { className: 'ct__field' }, [el('label', { text: 'Severity' }), severity]),
    ]),
    el('div', { className: 'ct__field' }, [el('label', { text: 'Radius (km)' }), radius]),
    submit,
    el('h3', { className: 'ct__panel-title', style: { fontSize: '0.92rem', marginTop: '16px' }, text: 'Active disruptions' }),
    active,
  ]);
}

function optionsPanel() {
  if (!state.selected) return el('div', { className: 'ct__panel' }, [el('h2', { className: 'ct__panel-title', text: 'Recommended actions' }), el('div', { className: 'ct__empty', text: 'Pick a shipment’s “Options →” to see prescriptive recommendations.' })]);
  const opts = state.options.map((o, i) => el('div', { className: `ct__opt${i === 0 ? ' is-best' : ''}` }, [
    el('div', { className: 'ct__opt-icon', text: OPTION_ICON[o.action] || '•' }),
    el('div', {}, [
      el('div', { className: 'ct__opt-title', text: o.label + (i === 0 ? '  ★ recommended' : '') }),
      el('div', { className: 'ct__opt-just', text: o.justification }),
      el('div', { className: 'ct__opt-figs' }, [
        el('span', {}, ['+', el('b', { text: `${fmtNum(o.deltaHours)}h` })]),
        el('span', {}, ['+', el('b', { text: fmtMoney(o.deltaCost) })]),
        el('span', {}, [el('b', { text: `${Math.round(o.reliability * 100)}%` }), ' reliable']),
      ]),
    ]),
    el('button', { className: 'ct__btn', text: 'Execute', onClick: () => executeOption(o.action) }),
  ]));

  const children = [
    el('div', { className: 'ct__panel-h' }, [el('h2', { className: 'ct__panel-title', text: 'Recommended actions' }), el('span', { className: 'ct__mono ct__panel-hint', text: short(state.selected) })]),
    ...opts,
  ];
  if (state.result) children.push(resultBlock(state.result));
  return el('div', { className: 'ct__panel' }, children);
}

function resultBlock(a) {
  const def = ACTION_STATUS[a.status] || {};
  const lines = [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', margin: '4px 0 8px' } }, [StatusBadge(a.status, { map: ACTION_STATUS }), el('span', { text: a.option ? a.option.label : '' })]),
  ];
  const facts = [];
  if (a.anchorTxId) facts.push(`Anchored: ${short(a.anchorTxId)}`);
  if (a.rematchId) facts.push(`Re-matched via M3: ${short(a.rematchId)}`);
  if (a.approvalDeadline) facts.push(`Approve before: ${fmtDateTime(a.approvalDeadline)}`);
  if (a.rollbackUntil) facts.push(`Undo before: ${fmtDateTime(a.rollbackUntil)}`);
  if (facts.length) lines.push(el('div', { className: 'ct__opt-just', text: facts.join('  ·  ') }));

  const btns = [];
  if (a.status === 'pending_approval') {
    btns.push(el('button', { className: 'ct__btn', text: 'Approve', onClick: () => actOn(a.id, 'approve') }));
    btns.push(el('button', { className: 'ct__btn ct__btn--danger', text: 'Reject', onClick: () => actOn(a.id, 'reject') }));
  } else if (a.status === 'executed') {
    btns.push(el('button', { className: 'ct__btn ct__btn--warn', text: '↺ Undo', onClick: () => actOn(a.id, 'rollback') }));
  } else if (a.status === 'frozen') {
    lines.push(el('div', { className: 'ct__msg ct__msg--err', text: 'Flagged as anomalous — not executed. Manual review required.' }));
  }
  if (btns.length) lines.push(el('div', { className: 'ct__btns', style: { marginTop: '10px' } }, btns));
  return el('div', { style: { borderTop: '1px solid var(--border)', marginTop: '12px', paddingTop: '12px' } }, [el('h3', { className: 'ct__panel-title', style: { fontSize: '0.9rem' }, text: 'Action outcome' }), ...lines]);
}

const DESIGN_TYPE = {
  expand_hub: { icon: '🏗️', label: 'Expand hub' },
  consolidate_hub: { icon: '🧹', label: 'Consolidate hub' },
  direct_lane: { icon: '➡️', label: 'Direct lane' },
  mode_shift: { icon: '🌱', label: 'Mode shift' },
};
const PRIORITY_CLS = { high: 'high', medium: 'medium', low: 'low' };

function networkDesignPanel() {
  const d = state.design;
  if (!d || !d.shipments) return el('div', { className: 'ct__panel' }, [el('h2', { className: 'ct__panel-title', text: 'Network design' }), el('div', { className: 'ct__empty', text: 'Not enough flow to analyze yet.' })]);

  const recs = d.recommendations.length
    ? d.recommendations.map((r) => {
        const t = DESIGN_TYPE[r.type] || { icon: '•', label: r.type };
        return el('div', { className: 'ct__opt' }, [
          el('div', { className: 'ct__opt-icon', text: t.icon }),
          el('div', {}, [
            el('div', { className: 'ct__opt-title' }, [`${t.label}: ${r.subject} `, el('span', { className: `ct__chip ct__chip--${PRIORITY_CLS[r.priority]}`, text: r.priority })]),
            el('div', { className: 'ct__opt-just', text: r.rationale }),
            el('div', { className: 'ct__opt-figs' }, [el('span', {}, [el('b', { text: r.estBenefit })])]),
          ]),
          el('span', {}),
        ]);
      })
    : [el('div', { className: 'ct__empty', text: 'No structural changes recommended — the network is balanced.' })];

  const lanes = d.lanes.slice(0, 4).length
    ? el('table', { className: 'ct__table' }, [
        el('thead', {}, [el('tr', {}, ['Lane', 'Vol', 'Weight', 'Modes'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, d.lanes.slice(0, 4).map((l) => el('tr', {}, [
          el('td', { text: l.lane }),
          el('td', { text: String(l.count) }),
          el('td', { text: `${fmtNum(l.weightKg)}kg` }),
          el('td', { text: l.modes.join(', ') }),
        ]))),
      ])
    : el('div', { className: 'ct__empty', text: 'No lanes yet.' });

  return el('div', { className: 'ct__panel' }, [
    el('div', { className: 'ct__panel-h' }, [el('h2', { className: 'ct__panel-title', text: 'Network design' }), el('span', { className: 'ct__panel-hint', text: `${d.shipments} flows · ${d.hubs.length} hubs` })]),
    el('p', { className: 'ct__panel-hint', text: 'Strategic recommendations from accumulated flow — hub capacity, direct lanes, modal shift.' }),
    el('div', {}, recs),
    el('h3', { className: 'ct__panel-title', style: { fontSize: '0.9rem', margin: '16px 0 8px' }, text: 'Top lanes' }),
    lanes,
  ]);
}

function policyPanel() {
  const shipper = el('input', { className: 'ct__input', attrs: { placeholder: 'did:glos:shipper-…' } });
  const delay = el('input', { className: 'ct__input', attrs: { type: 'number', placeholder: '6', min: '0' } });
  const cost = el('input', { className: 'ct__input', attrs: { type: 'number', placeholder: '1000', min: '0' } });
  const action = el('select', { className: 'ct__select' }, ['rebook_fastest', 'reroute', 'split_air', 'wait'].map((o) => el('option', { text: o.replace('_', ' '), attrs: { value: o } })));
  const submit = el('button', {
    className: 'ct__btn', text: 'Save policy',
    onClick: () => { if (!shipper.value.trim()) { state.msg = { type: 'err', text: 'Enter the shipper DID.' }; return render(); } registerPolicy({ shipperDid: shipper.value.trim(), ifDelayHoursGt: delay.value || 6, ifExtraCostLt: cost.value || 1000, thenAction: action.value }); },
  });
  return el('div', { className: 'ct__panel' }, [
    el('h2', { className: 'ct__panel-title', text: 'Autonomous policies' }),
    el('p', { className: 'ct__panel-hint', text: 'IF predicted delay exceeds X hours AND extra cost is under Y THEN act automatically (high-cost actions still require human approval).' }),
    el('div', { className: 'ct__field' }, [el('label', { text: 'Shipper DID' }), shipper]),
    el('div', { className: 'ct__form-row' }, [
      el('div', { className: 'ct__field' }, [el('label', { text: 'Delay over (hours)' }), delay]),
      el('div', { className: 'ct__field' }, [el('label', { text: `Extra cost under (${REGION.currency})` }), cost]),
    ]),
    el('div', { className: 'ct__field' }, [el('label', { text: 'Then' }), action]),
    submit,
  ]);
}

const MODE_COLOR = { air: 'var(--danger)', courier: 'var(--warn)', road: '#8a6d1f', multimodal: 'var(--brand)', rail: 'var(--brand-bright)', ocean: 'var(--forest)' };
const fmtKg = (n) => `${fmtNum(n)} kg`;

function carbonPanel() {
  const c = state.carbon;
  if (!c || !c.shipments) return el('div', { className: 'ct__panel' }, [el('h2', { className: 'ct__panel-title', text: 'Sustainability' }), el('div', { className: 'ct__empty', text: 'No digitized shipments to measure yet.' })]);

  const tiles = el('div', { className: 'ct__kpis', style: { gridTemplateColumns: 'repeat(3,1fr)', margin: '4px 0 14px' } }, [
    miniTile(`${fmtNum(c.totalKgCo2)}`, 'kg CO₂e total'),
    miniTile(`${fmtNum(c.potentialSavingKgCo2)}`, 'kg saveable'),
    miniTile(c.shipments, 'measured'),
  ]);

  const max = Math.max(1, ...Object.values(c.byMode));
  const bars = Object.entries(c.byMode).sort((a, b) => b[1] - a[1]).map(([mode, kg]) => el('div', { style: { display: 'grid', gridTemplateColumns: '90px 1fr auto', alignItems: 'center', gap: '8px', marginBottom: '6px' } }, [
    el('span', { style: { fontSize: '0.82rem' }, text: mode }),
    el('span', { style: { height: '10px', borderRadius: '999px', background: 'var(--border-soft)', overflow: 'hidden' } }, [el('span', { style: { display: 'block', height: '100%', width: `${(kg / max) * 100}%`, background: MODE_COLOR[mode] || 'var(--brand)' } })]),
    el('span', { className: 'ct__mono', style: { fontSize: '0.8rem' }, text: fmtKg(kg) }),
  ]));

  const rows = c.topEmitters.map((f) => el('tr', {}, [
    el('td', {}, [el('span', { className: 'ct__mono', text: short(f.glosShipmentId) })]),
    el('td', { text: fmtKg(f.totalKgCo2) }),
    el('td', { text: `${f.intensityGPerTonneKm} g/t·km` }),
    el('td', {}, f.greener.savingPct > 0 ? [el('span', { className: 'ct__chip ct__chip--low', text: `−${f.greener.savingPct}% greener` })] : [el('span', { text: '—' })]),
  ]));
  const table = el('table', { className: 'ct__table' }, [
    el('thead', {}, [el('tr', {}, ['Shipment', 'CO₂e', 'Intensity', 'Greener'].map((h) => el('th', { text: h })))]),
    el('tbody', {}, rows),
  ]);

  return el('div', { className: 'ct__panel' }, [
    el('div', { className: 'ct__panel-h' }, [el('h2', { className: 'ct__panel-title', text: 'Sustainability' }), el('span', { className: 'ct__panel-hint', text: 'CO₂e · estimated' })]),
    tiles,
    el('h3', { className: 'ct__panel-title', style: { fontSize: '0.9rem', margin: '0 0 8px' }, text: 'Emissions by mode' }),
    bars.length ? el('div', {}, bars) : el('div', { className: 'ct__empty', text: 'No legs measured.' }),
    el('h3', { className: 'ct__panel-title', style: { fontSize: '0.9rem', margin: '16px 0 8px' }, text: 'Top emitters' }),
    table,
  ]);
}

function auditPanel() {
  const body = state.actions.length
    ? el('table', { className: 'ct__table' }, [
        el('thead', {}, [el('tr', {}, ['Action', 'Shipment', 'Type', 'Cost', 'Status', 'When', 'Anchor'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, [...state.actions].reverse().map((a) => el('tr', {}, [
          el('td', {}, [el('span', { className: 'ct__mono', text: short(a.id) })]),
          el('td', {}, [el('span', { className: 'ct__mono', text: short(a.glosShipmentId) })]),
          el('td', { text: a.option ? a.option.action.replace('_', ' ') : '—' }),
          el('td', { text: a.option ? fmtMoney(a.option.deltaCost) : '—' }),
          el('td', {}, [StatusBadge(a.status, { map: ACTION_STATUS })]),
          el('td', { text: fmtDateTime(a.at) }),
          el('td', {}, [el('span', { className: 'ct__mono', text: short(a.anchorTxId) })]),
        ]))),
      ])
    : el('div', { className: 'ct__empty', text: 'No autonomous actions yet.' });
  return el('div', { className: 'ct__panel' }, [el('h2', { className: 'ct__panel-title', text: 'Action audit trail (anchored)' }), body]);
}

function render() {
  const parts = [topBar()];
  if (state.msg) parts.push(el('div', { className: `ct__msg ct__msg--${state.msg.type === 'ok' ? 'ok' : 'err'}`, text: state.msg.text }));
  if (state.loading) { parts.push(el('div', { className: 'ct__empty', text: 'Loading control tower…' })); mount(root, parts); return; }
  parts.push(kpis());
  // F-pattern: situational awareness (map) + at-risk watchlist top-left; live response actions
  // (disruption desk + recommended options) top-right; analytics/admin tools flow below.
  parts.push(el('div', { className: 'ct__grid' }, [
    el('div', {}, [mapPanel(), watchlistPanel(), carbonPanel(), auditPanel()]),
    el('div', {}, [disruptionPanel(), optionsPanel(), signalsPanel(), simulatorPanel(), networkDesignPanel(), policyPanel()]),
  ]));
  mount(root, parts);
}

render();
loadAll();
