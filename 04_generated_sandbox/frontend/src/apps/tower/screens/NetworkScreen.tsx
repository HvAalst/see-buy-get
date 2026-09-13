import type { StaffRow } from '../api';
import { useState, useCallback, useEffect } from 'preact/hooks';
import { Icon, PlaceMap } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import {
  AGENT_OFFLINE_H,
  agentState,
  checkedIn,
  ageLabel,
  bagsInTransit,
  coverageLine,
  fillPct,
  flagLabel,
  groupFlags,
  hubSummaries,
  ratingLabel,
  slotsLabel,
  statusMixRows,
} from '../network';
import { money } from '../queues';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * The network at a glance — the MONITORING half of an operator's screen.
 *
 * Deliberately not a queue. Nothing on it is waiting for a decision, and most of it is fine most of the
 * time, so its whole job is making the exceptions findable without teaching anybody to skim: a number
 * always carries its denominator, an alert type carries how long its worst example has been standing,
 * and every "nothing here" says whether it means nothing or means not-yet-read.
 */
export function NetworkScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const d = state.dashboard;
  const now = Date.now();
  /**
   * Which shop a pin belongs to — local, because nothing outside this screen cares.
   *
   * The map COMPLEMENTS the list rather than replacing it (the rule this network settled on for every
   * map it has): tapping a pin does not open a different view, it points at the row that was already
   * there. So no pin is a dead tap, and everything the row says stays readable.
   */
  const [pinned, setPinned] = useState<string | null>(null);
  const pins = (state.agents ?? [])
    .filter((a): a is typeof a & { location: { lat: number; lng: number } } => Boolean(a.location))
    .map((a) => ({ id: a.did, label: a.shopName ?? a.did, point: a.location }));

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.network.title')}</h1>
        <p class="cons__lede">{t('tower.network.lede')}</p>
      </header>

      <div class="cons__panelhead" style="padding:0 0 12px">
        <span class="ctbl__sub">{state.readAt ? t('tower.hazards.updatedAt', { time: new Date(state.readAt).toLocaleTimeString() }) : ''}</span>
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void actions.refresh()} disabled={state.loading}>
          <Icon name="refresh" size={16} />
          {t('tower.hazards.refresh')}
        </button>
      </div>

      {state.error ? (
        <p class="cerr" style="max-width:96ch">
          <b>{t('tower.queues.failedTitle')}</b> — {state.error.detail || state.error.title}
        </p>
      ) : null}

      {/* The five numbers. Each carries what it is OF: "1 online" says nothing until you know it is one
          of six, and a float with no currency is a number pretending to be money. */}
      <div class="twr-kpis">
        <Kpi label={t('tower.network.kpi.alerts')} value={d ? String(d.criticalAlerts ?? 0) : '—'} risk={Boolean(d?.criticalAlerts)} />
        <Kpi label={t('tower.network.kpi.inTransit')} value={d ? String(d.parcelsInTransit ?? 0) : '—'} />
        {/* Counted from the shop list below, on the same rule its rows are labelled with — see
            checkedIn(). A tile that disagrees with the table under it is worse than no tile. */}
        <Kpi
          label={t('tower.network.kpi.shopsOnline', { hours: AGENT_OFFLINE_H })}
          value={state.agents ? `${checkedIn(state.agents, now).online}/${checkedIn(state.agents, now).total}` : '—'}
        />
        <Kpi label={t('tower.network.kpi.float')} value={d ? money(d.systemFloat) : '—'} />
        <Kpi label={t('tower.network.kpi.active')} value={d ? `${Math.round((d.agentRetention ?? 0) * 100)}%` : '—'} />
      </div>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.network.mixTitle')}</span>
          <span class="ctbl__sub">{t('tower.network.mixHint')}</span>
        </div>
        {!d ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : (
          <table class="ctbl">
            <thead>
              <tr>
                <th>{t('tower.network.col.status')}</th>
                <th class="ctbl__num">{t('tower.network.col.parcels')}</th>
                <th>{t('tower.network.col.share')}</th>
              </tr>
            </thead>
            <tbody>
              {statusMixRows(d.statusMix).map((row) => (
                <tr key={row.status}>
                  <td class="ctbl__strong">{row.status.replace(/_/g, ' ')}</td>
                  <td class="ctbl__num">{row.count}</td>
                  <td>
                    {/* A bar, and the number beside it: the bar is for comparing, the number is for
                        quoting to somebody on the phone. */}
                    <span class="twr-bar">
                      <span class="twr-bar__fill" style={`width:${Math.round(row.share * 100)}%`} />
                    </span>
                    <span class="ctbl__sub"> {Math.round(row.share * 100)}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section class="cons__panel" style="margin-top:18px">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.network.flagsTitle')}</span>
          <span class="ctbl__sub">{t('tower.network.flagsHint')}</span>
        </div>
        {!d ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : groupFlags(d.flags ?? []).length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.network.noFlagsTitle')}</p>
            <p>{t('tower.network.noFlagsBody')}</p>
          </div>
        ) : (
          <table class="ctbl">
            <thead>
              <tr>
                <th>{t('tower.network.col.alert')}</th>
                <th class="ctbl__num">{t('tower.network.col.howMany')}</th>
                <th>{t('tower.network.col.longest')}</th>
                <th>{t('tower.network.col.example')}</th>
              </tr>
            </thead>
            <tbody>
              {groupFlags(d.flags ?? []).map((g) => (
                <tr key={g.type}>
                  <td class="ctbl__strong">{flagLabel(g.type, t)}</td>
                  <td class="ctbl__num">{g.count}</td>
                  <td>{ageLabel(g.oldestHours, t)}</td>
                  <td class="ctbl__sub">
                    <span class="ctbl__mono">{g.example.subject}</span> {g.example.detail ? `· ${g.example.detail}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section class="cons__panel" style="margin-top:18px">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.network.shopsTitle')}</span>
          <span class="ctbl__sub">{coverageLine(state.coverage ?? undefined, t)}</span>
        </div>

        {/* Where the shops actually are. A shop with no pin on it is not missing from the network — it
            simply never dropped one, so it stays in the table below and out of here. */}
        {pins.length ? (
          <div class="twr-map">
            <PlaceMap pins={pins} selectedId={pinned} onPick={(id) => setPinned(id === pinned ? null : id)} label={t('tower.network.mapLabel')} />
            <p class="chint">{pinned ? t('tower.network.pinned', { name: pins.find((p) => p.id === pinned)?.label ?? '' }) : t('tower.network.mapHint')}</p>
          </div>
        ) : null}
        {state.agents === null ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : state.agents.length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.network.noShopsTitle')}</p>
            <p>{t('tower.network.noShopsBody')}</p>
          </div>
        ) : (
          <table class="ctbl">
            <thead>
              <tr>
                <th>{t('tower.network.col.shop')}</th>
                <th>{t('tower.network.col.zone')}</th>
                <th>{t('tower.network.col.state')}</th>
                <th class="ctbl__num">{t('tower.network.col.wallet')}</th>
                <th class="ctbl__num">{t('tower.network.col.slots')}</th>
                <th class="ctbl__num">{t('tower.network.col.rating')}</th>
              </tr>
            </thead>
            <tbody>
              {state.agents.map((row) => {
                const s = agentState(row, now);
                return (
                  // Orange marks the row a pin is pointing at — a STATE, the same as everywhere else here.
                  <tr key={row.did} class={pinned === row.did ? 'is-open' : undefined}>
                    <td>
                      <div class="ctbl__strong">{row.shopName ?? row.did}</div>
                      <div class="ctbl__mono">{row.did.slice(0, 18)}…</div>
                    </td>
                    <td>{row.zone ?? '—'}</td>
                    <td>
                      <span class={`ctag ctag--${s.tone === 'bad' ? 'warn' : s.tone}`}>{t(s.labelKey)}</span>
                    </td>
                    {/* A dash, never 0.00: no float rail is a different fact from an empty till. */}
                    <td class="ctbl__num">{row.balance == null ? '—' : money(row.balance)}</td>
                    <td class="ctbl__num">{slotsLabel(row)}</td>
                    <td class="ctbl__num">{ratingLabel(row)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {state.who?.mode === 'operator' ? <FleetsPanel actions={actions} /> : null}
      {state.who?.mode === 'operator' ? <StaffPanel actions={actions} /> : null}

      <section class="cons__panel" style="margin-top:18px">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.network.hubsTitle')}</span>
          <span class="ctbl__sub">{t('tower.network.bagsOnRoad', { n: bagsInTransit(state.totes ?? []) })}</span>
        </div>
        {state.hubs === null ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : state.hubs.length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.network.noHubsTitle')}</p>
            <p>{t('tower.network.noHubsBody')}</p>
          </div>
        ) : (
          <div class="twr-hubs">
            {hubSummaries(state.hubs, state.totes ?? []).map(({ hub, filling, free }) => (
              <div key={hub.mdpId} class="twr-hub">
                <div class="twr-hub__head">
                  <span class="ctbl__strong">{hub.name ?? hub.mdpId}</span>
                  <span class="ctbl__sub">
                    {(hub.zones ?? []).join(', ') || '—'} · {t('tower.network.freeBags', { n: free })}
                  </span>
                </div>
                {filling.length === 0 ? (
                  <p class="chint">{t('tower.network.noOpenBags')}</p>
                ) : (
                  <table class="ctbl">
                    <thead>
                      <tr>
                        <th>{t('tower.network.col.bag')}</th>
                        <th>{t('tower.network.col.destination')}</th>
                        <th class="ctbl__num">{t('tower.network.col.parcels')}</th>
                        <th class="ctbl__num">{t('tower.network.col.fill')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filling.map((bag) => (
                        <tr key={bag.toteId}>
                          <td class="ctbl__mono">{bag.code}</td>
                          <td>{bag.destinationLabel ?? bag.destinationNodeId ?? '—'}</td>
                          <td class="ctbl__num">{bag.parcels?.length ?? 0}</td>
                          <td class="ctbl__num">{fillPct(bag)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/** One number, and what it is a number OF. A tile without its denominator is a tile nobody can act on. */
function Kpi({ label, value, risk }: { label: string; value: string; risk?: boolean }) {
  return (
    <div class={`twr-kpi${risk ? ' twr-kpi--risk' : ''}`}>
      <div class="twr-kpi__v">{value}</div>
      <div class="twr-kpi__l">{label}</div>
    </div>
  );
}

/**
 * The fleets, with each one's sign-in code — which only network staff and the fleet itself may see. A fleet that has
 * lost or leaked its code is issued a new one here; the old one stops naming the fleet at once, and nobody is signed
 * out, because the code names the company and each manager signs in as themselves.
 */
function FleetsPanel({ actions }: { actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [rows, setRows] = useState<Array<{ did: string; companyName: string; status: string; loginCode?: string; codeRotatedAt?: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.fleets();
    if (r.error) setError(r.error.detail || r.error.title);
    else setRows(((r.data as unknown as Array<{ did: string; companyName: string; status: string; loginCode?: string; codeRotatedAt?: string }>) ?? []).sort((a, b) => a.companyName.localeCompare(b.companyName)));
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section class="cons__panel" style="margin-top:18px">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.network.fleetsTitle')}</span>
      </div>
      {error ? <p class="cerr" style="margin:12px 16px">{error}</p> : null}
      {rows === null ? (
        <p class="cons__empty">{t('tower.queues.loading')}</p>
      ) : rows.length === 0 ? (
        <p class="cons__empty">{t('tower.network.fleetsNone')}</p>
      ) : (
        <table class="ctbl">
          <thead>
            <tr>
              <th>{t('tower.network.fleets.company')}</th>
              <th>{t('tower.network.fleets.status')}</th>
              <th>{t('tower.network.fleets.code')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.did}>
                <td class="ctbl__strong">{f.companyName}</td>
                <td>
                  <span class={`ctag ${f.status === 'ACTIVE' ? 'ctag--ok' : 'ctag--quiet'}`}>{f.status}</span>
                </td>
                <td>
                  <span class="ctbl__mono">{f.loginCode ?? '—'}</span>
                  {f.codeRotatedAt ? <div class="ctbl__sub">{t('tower.network.fleets.rotatedAt', { when: new Date(f.codeRotatedAt).toLocaleString() })}</div> : null}
                </td>
                <td class="ctbl__num">
                  {f.status !== 'ACTIVE' ? null : confirm === f.did ? (
                    <span class="twr-panelend">
                      <button
                        type="button"
                        class="cbtn cbtn--primary cbtn--sm"
                        disabled={busy === f.did}
                        onClick={async () => {
                          if (!client) return;
                          setBusy(f.did);
                          const r = await client.api.rotateFleetCode(f.did);
                          setBusy(null);
                          setConfirm(null);
                          if (r.error) setError(r.error.detail || r.error.title);
                          else await load();
                        }}
                      >
                        {t('tower.network.fleets.rotateConfirm')}
                      </button>
                      <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setConfirm(null)}>
                        {t('tower.presence.cancel')}
                      </button>
                    </span>
                  ) : (
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setConfirm(f.did)}>
                      {t('tower.network.fleets.rotate')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * Who works for the network — one sign-in each. The panel exists so that "a different person must approve this" can
 * be true: until the first account is made, everybody holds the one setup key and every name is typed.
 */
function StaffPanel({ actions }: { actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  // Shown until it is closed BY HAND: this is the only time this password exists anywhere.
  const [made, setMade] = useState<{ name: string; email: string; temporaryPassword: string } | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.staff();
    if (r.error) setError(r.error.detail || r.error.title);
    else setRows((r.data as unknown as { items?: StaffRow[] })?.items ?? []);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!client) return;
    setBusy('create');
    setError(null);
    const r = await client.api.createStaff({ email: email.trim(), name: name.trim() });
    setBusy(null);
    if (r.error) return setError(r.error.detail || r.error.title);
    setMade(r.data as unknown as { name: string; email: string; temporaryPassword: string });
    setName('');
    setEmail('');
    setOpen(false);
    await load();
  };

  return (
    <section class="cons__panel" style="margin-top:18px">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.staff.title')}</span>
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t('common.close') : t('tower.staff.add')}
        </button>
      </div>
      <p class="ctbl__sub" style="margin:10px 16px 0">{t('tower.staff.lede')}</p>
      {error ? <p class="cerr" style="margin:12px 16px">{error}</p> : null}

      {made ? (
        <div class="twr-reveal">
          <p class="twr-clear__t">{t('tower.staff.revealTitle', { name: made.name })}</p>
          <p class="twr-clear__b">{t('tower.staff.revealBody')}</p>
          <p class="twr-reveal__creds">
            <span class="ctbl__mono">{made.email}</span>
            <span class="ctbl__mono twr-reveal__pw">{made.temporaryPassword}</span>
          </p>
          <button type="button" class="cbtn cbtn--primary" onClick={() => setMade(null)}>
            {t('tower.staff.revealDone')}
          </button>
        </div>
      ) : null}

      {open ? (
        <div class="twr-knobs" style="padding:12px 16px">
          <div class="twr-knobs__row">
            <div class="twr-knob">
              <label class="cfield">
                <span class="cfield__label">{t('tower.staff.name')}</span>
                <input class="cinput" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
                <span class="chint">{t('tower.staff.nameHint')}</span>
              </label>
              <label class="cfield">
                <span class="cfield__label">{t('tower.staff.email')}</span>
                <input class="cinput" type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
              </label>
              <button type="button" class="cbtn cbtn--primary" disabled={busy === 'create' || !email.trim() || !name.trim()} onClick={() => void create()}>
                {t('tower.staff.create')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rows === null ? (
        <p class="cons__empty">{t('tower.queues.loading')}</p>
      ) : rows.length === 0 ? (
        <p class="cons__empty">{t('tower.staff.none')}</p>
      ) : (
        <table class="ctbl">
          <thead>
            <tr>
              <th>{t('tower.staff.col.who')}</th>
              <th>{t('tower.staff.col.email')}</th>
              <th>{t('tower.staff.col.lastSeen')}</th>
              <th>{t('tower.staff.col.password')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.operatorId}>
                <td class="ctbl__strong">{a.name}</td>
                <td class="ctbl__mono">{a.email}</td>
                <td class="ctbl__sub">{a.lastSeenAt ? new Date(a.lastSeenAt).toLocaleString() : t('tower.staff.never')}</td>
                <td class="ctbl__sub">{a.passwordChangedAt ? new Date(a.passwordChangedAt).toLocaleDateString() : t('tower.staff.never')}</td>
                <td class="ctbl__num">
                  {confirm === a.operatorId ? (
                    <span class="twr-panelend">
                      <button
                        type="button"
                        class="cbtn cbtn--primary cbtn--sm"
                        disabled={busy === a.operatorId}
                        onClick={async () => {
                          if (!client) return;
                          setBusy(a.operatorId);
                          const r = await client.api.revokeStaff(a.operatorId);
                          setBusy(null);
                          setConfirm(null);
                          if (r.error) setError(r.error.detail || r.error.title);
                          else await load();
                        }}
                      >
                        {t('tower.staff.revokeConfirm')}
                      </button>
                      <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setConfirm(null)}>
                        {t('tower.presence.cancel')}
                      </button>
                    </span>
                  ) : (
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setConfirm(a.operatorId)}>
                      {t('tower.staff.revoke')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
