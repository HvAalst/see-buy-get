import { Abbreviated } from '../../../shared/ui/Abbr';
import { credentialAge } from '../../../shared/account/password';
import { resetTwoStep, sendStaffLink, stopStaffRemoval, type StaffInvited, type StaffRow } from '../api';
import { useState, useCallback, useEffect } from 'preact/hooks';
import { Icon, PlaceMap } from '../../../shared/ui';
import { ConsoleFold } from '../ConsoleFold';
import { PlanVsActualFold } from './PlanVsActualFold';
import { useT, type MessageKey } from '../../../shared/i18n';
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
import { amount, floatsLine } from '../queues';
import { fleetSystemWords, type FleetSystemCounts } from '../fleets';
import { askedLine, linkWords, opensItself, staffAddWay, staffFoldHint, staffListOf, waitingActions, waitingLine, waitingRoles, type StaffWaiting } from '../staff';
import { holds, ROLE_WORDS, rolesOf, STAFF_ROLES, type StaffRole } from '../staffRoles';
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
    .map((a) => ({ id: a.did, label: a.shopName ?? t('tower.network.unnamedShop'), point: a.location }));

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
        {/* Each money's float, one figure each: "Money across shop floats" was the home money's alone, said bare. */}
        <Kpi label={t('tower.network.kpi.float')} value={d ? floatsLine(d) : '—'} />
        <Kpi label={t('tower.network.kpi.active')} value={d ? `${Math.round((d.agentRetention ?? 0) * 100)}%` : '—'} />
      </div>

      <ConsoleFold
        title={t('tower.network.mixTitle')}
        hint={d ? t('tower.network.fold.parcels', { n: statusMixRows(d.statusMix).reduce((sum, r) => sum + r.count, 0) }) : t('tower.queues.loading')}
      >
        <p class="cons__lede">{t('tower.network.mixHint')}</p>
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
      </ConsoleFold>

      {/* Each lane against the promises kept when its parcels were taken in. */}
      <PlanVsActualFold client={actions.client()} />

      <ConsoleFold
        title={t('tower.network.flagsTitle')}
        hint={!d ? t('tower.queues.loading') : groupFlags(d.flags ?? []).length === 0 ? t('tower.network.fold.noAlerts') : t('tower.network.fold.alerts', { kinds: groupFlags(d.flags ?? []).length, n: (d.flags ?? []).length })}
        aside={<>{d && groupFlags(d.flags ?? []).length ? <span class="ctag ctag--warn">{t('tower.network.fold.oldest', { age: ageLabel(groupFlags(d.flags ?? [])[0].oldestHours, t) })}</span> : null}</>}
      >
        <p class="cons__lede">{t('tower.network.flagsHint')}</p>
        {!d ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : groupFlags(d.flags ?? []).length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.network.noFlagsTitle')}</p>
            <p>{t('tower.network.noFlagsBody')}</p>
          </div>
        ) : (
          <table class="ctbl ctbl--stack">
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
                  <td class="ctbl__num">
                    <span class="ctbl__lbl">{t('tower.network.col.howMany')}</span>
                    {g.count}
                  </td>
                  <td>
                    <span class="ctbl__lbl">{t('tower.network.col.longest')}</span>
                    {ageLabel(g.oldestHours, t)}
                  </td>
                  <td class="ctbl__sub">
                    <span class="ctbl__lbl">{t('tower.network.col.example')}</span>
                    <span class="ctbl__mono">{g.example.subject}</span> {g.example.detail ? `· ${g.example.detail}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ConsoleFold>

      <ConsoleFold
        title={t('tower.network.shopsTitle')}
        hint={coverageLine(state.coverage ?? undefined, t)}
      >

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
          <table class="ctbl ctbl--stack">
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
                      <div class="ctbl__strong">{row.shopName ?? t('tower.network.unnamedShop')}</div>
                    </td>
                    <td>
                      <span class="ctbl__lbl">{t('tower.network.col.zone')}</span>
                      {row.zone ?? '—'}
                    </td>
                    <td>
                      <span class="ctbl__lbl">{t('tower.network.col.state')}</span>
                      <span class={`ctag ctag--${s.tone === 'bad' ? 'warn' : s.tone}`}>{t(s.labelKey)}</span>
                    </td>
                    {/* A dash, never 0.00: no float rail is a different fact from an empty till. */}
                    <td class="ctbl__num">
                      <span class="ctbl__lbl">{t('tower.network.col.wallet')}</span>
                      {row.balance == null ? '—' : amount(row.balance, row.currency)}
                    </td>
                    <td class="ctbl__num">
                      <span class="ctbl__lbl">{t('tower.network.col.slots')}</span>
                      {slotsLabel(row)}
                    </td>
                    <td class="ctbl__num">
                      <span class="ctbl__lbl">{t('tower.network.col.rating')}</span>
                      {ratingLabel(row)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ConsoleFold>

      {state.who?.mode === 'operator' ? <FleetsPanel actions={actions} rotates={holds(state.who.roles, 'vetting')} /> : null}
      {/* Round 38 — who is on staff, and what they hold, is administration's. */}
      {state.who?.mode === 'operator' && holds(state.who.roles, 'admin') ? <StaffPanel actions={actions} named={Boolean(state.who.named)} /> : null}

      <ConsoleFold
        title={t('tower.network.hubsTitle')}
        hint={t('tower.network.bagsOnRoad', { n: bagsInTransit(state.totes ?? []) })}
      >
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
                  <table class="ctbl ctbl--stack">
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
                          <td>
                            <span class="ctbl__lbl">{t('tower.network.col.destination')}</span>
                            {bag.destinationLabel ?? bag.destinationNodeId ?? '—'}
                          </td>
                          <td class="ctbl__num">
                            <span class="ctbl__lbl">{t('tower.network.col.parcels')}</span>
                            {bag.parcels?.length ?? 0}
                          </td>
                          <td class="ctbl__num">
                            <span class="ctbl__lbl">{t('tower.network.col.fill')}</span>
                            {fillPct(bag)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
      </ConsoleFold>

      <RecordPanel actions={actions} />
    </>
  );
}

interface EvidenceView {
  ledger?: { anchors: number; whole: boolean; brokenAt?: number; reason?: string; first?: string; last?: string };
  store: { engine: 'postgres' | 'files'; claimed: boolean; pid?: number; since?: string };
}

/**
 * THE RECORD (the user, 2026-10-18: "evidence that lasts"): whether every fingerprint the network has handed out — on a
 * scan, a signature, a damage claim report — can still be checked, and which one server writes the store. A chain that
 * breaks opens the fold and says so at the top, where it cannot be missed.
 */
function RecordPanel({ actions }: { actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [view, setView] = useState<EvidenceView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.evidence();
    if (r.error) return setError(r.error.detail || r.error.title);
    setError(null);
    setView(r.data as unknown as EvidenceView);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const l = view?.ledger;
  const day = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '—');
  return (
    <ConsoleFold
      title={t('tower.record.title')}
      hint={!view ? t('tower.queues.loading') : !l ? t('tower.record.noLedger') : l.whole ? t('tower.record.whole', { n: l.anchors }) : t('tower.record.broken', { block: l.brokenAt ?? 0 })}
      defaultOpen={Boolean(l && !l.whole)}
    >
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
      {view ? (
        <div class="crows">
          {l ? (
            <div class="crow">
              <span class="crow__body">
                <span class="crow__top">
                  <span class={`ctag ctag--${l.whole ? 'ok' : 'danger'}`}>{t(l.whole ? 'tower.record.wholeTag' : 'tower.record.brokenTag')}</span>
                  <span class="crow__name">{t('tower.record.fingerprints', { n: l.anchors })}</span>
                </span>
                <span class="crow__sub">{l.whole ? t('tower.record.wholeSub', { first: day(l.first), last: day(l.last) }) : t('tower.record.brokenSub', { block: l.brokenAt ?? 0, reason: l.reason ?? '' })}</span>
              </span>
            </div>
          ) : null}
          <div class="crow">
            <span class="crow__body">
              <span class="crow__top">
                <span class={`ctag ctag--${view.store.claimed ? 'ok' : 'warn'}`}>{t(view.store.engine === 'postgres' ? 'tower.record.postgres' : 'tower.record.files')}</span>
                <span class="crow__name">{view.store.claimed ? t('tower.record.oneWriter', { pid: view.store.pid ?? 0 }) : t('tower.record.notKept')}</span>
              </span>
              <span class="crow__sub">{view.store.claimed ? t('tower.record.oneWriterSub', { since: day(view.store.since) }) : t('tower.record.notKeptSub')}</span>
            </span>
          </div>
        </div>
      ) : null}
      <div class="twr-panelend">
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void load()}>
          <Icon name="refresh" size={16} />
          {t('tower.record.checkAgain')}
        </button>
      </div>
    </ConsoleFold>
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
function FleetsPanel({ actions, rotates }: { actions: TowerActions; /** Round 38 — a fleet's sign-in code is vetting's to change. */ rotates: boolean }) {
  const t = useT();
  const client = actions.client();
  const [rows, setRows] = useState<Array<{ did: string; companyName: string; status: string; loginCode?: string; codeRotatedAt?: string; createdAt?: string; system?: FleetSystemCounts }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.fleets();
    if (r.error) setError(r.error.detail || r.error.title);
    else setRows(((r.data as unknown as Array<{ did: string; companyName: string; status: string; loginCode?: string; codeRotatedAt?: string; createdAt?: string; system?: FleetSystemCounts }>) ?? []).sort((a, b) => a.companyName.localeCompare(b.companyName)));
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ConsoleFold
      title={t('tower.network.fleetsTitle')}
      hint={rows === null ? t('tower.queues.loading') : t('tower.network.fold.fleets', { n: rows.length })}
    >
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
      {rows === null ? (
        <p class="cons__empty">{t('tower.queues.loading')}</p>
      ) : rows.length === 0 ? (
        <p class="cons__empty">{t('tower.network.fleetsNone')}</p>
      ) : (
        <table class="ctbl ctbl--stack">
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
                <td class="ctbl__strong">
                  {f.companyName}
                  {/* Round 11 — its own system, counted. Staff read it; they send nothing in the fleet's name. */}
                  {f.system ? <div class="ctbl__sub">{fleetSystemWords(f.system, t)}</div> : null}
                </td>
                <td><span class="ctbl__lbl">{t('tower.network.fleets.status')}</span>
                  <span class={`ctag ${f.status === 'ACTIVE' ? 'ctag--ok' : 'ctag--quiet'}`}>{f.status}</span>
                </td>
                <td><span class="ctbl__lbl">{t('tower.network.fleets.code')}</span>
                  <span class="ctbl__mono">{f.loginCode ?? '—'}</span>
                  {f.codeRotatedAt ? <div class="ctbl__sub">{t('tower.network.fleets.rotatedAt', { when: new Date(f.codeRotatedAt).toLocaleString() })}</div> : null}
                  {credentialAge(f.codeRotatedAt ?? f.createdAt)?.due ? <span class="ctag ctag--warn">{t('tower.network.fleets.due')}</span> : null}
                </td>
                <td>
                  {f.status !== 'ACTIVE' || !rotates ? null : confirm === f.did ? (
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
    </ConsoleFold>
  );
}

/**
 * ALL THE SETUP KEY HAS, OUTSIDE A SANDBOX: who is on staff, and setting them up. The key is nobody — no name, no
 * account — so there it opens no other screen, decides nothing and acts for nobody; the server refuses it everything
 * else, and this is shown instead of a console full of refusals.
 */
export function StaffSetupScreen({ actions }: { actions: TowerActions }) {
  const t = useT();
  return (
    <>
      <div class="cons__head">
        <h1 class="cons__title">{t('tower.setup.title')}</h1>
        <p class="cons__lede">{t('tower.setup.lede')}</p>
      </div>
      <StaffPanel actions={actions} named={false} startOpen />
    </>
  );
}

/**
 * Round 38 — THE ROLES SOMEBODY IS TO HOLD, each with what it covers (the user: "Four roles"). Several may be ticked; at
 * least one is, or the button beside it stays off. What each opens is the server's to enforce — this only asks.
 */
function RolePicker({ value, onChange, hint }: { value: StaffRole[]; onChange: (roles: StaffRole[]) => void; /** A new account's, or a change's. */ hint: MessageKey }) {
  const t = useT();
  return (
    <div class="cfield">
      <span class="cfield__label">{t('tower.roles.pick')}</span>
      {STAFF_ROLES.map((r) => (
        <label class="cfield cfield--check" key={r}>
          <input
            type="checkbox"
            checked={value.includes(r)}
            onChange={(e) => {
              const on = (e.target as HTMLInputElement).checked;
              onChange(STAFF_ROLES.filter((x) => (x === r ? on : value.includes(x))));
            }}
          />
          <span>
            <b>{t(ROLE_WORDS[r].name)}</b> — {t(ROLE_WORDS[r].covers)}
          </span>
        </label>
      ))}
      <span class="chint">{t(hint)}</span>
    </div>
  );
}

/**
 * Who works for the network — one sign-in each. The panel exists so that "a different person must approve this" can
 * be true: until the first account is made, everybody holds the one setup key and every name is typed.
 *
 * A NEW SIGN-IN TAKES TWO PEOPLE. Somebody with an account of their own ASKS here; a second person approves it here.
 * Nobody is shown a password: the new person is emailed a link to choose their own, and this panel says whether that
 * email went. Only the setup key (`named` is false) makes an account at once, with a password shown once — its own
 * first account on a new installation.
 */
function StaffPanel({ actions, named, startOpen = false }: { actions: TowerActions; named: boolean; /** The only thing on the screen: it arrives open. */ startOpen?: boolean }) {
  const t = useT();
  const client = actions.client();
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [waiting, setWaiting] = useState<StaffWaiting[]>([]);
  // Asked for, not made: said until the next thing is done here.
  const [asked, setAsked] = useState<{ name: string; email: string } | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  // Opened for the reader when an account waits that is theirs to decide: work behind a click is work nobody does.
  const [fold, setFold] = useState(startOpen);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  // Shown until it is closed BY HAND: this is the only time this password exists anywhere.
  const [made, setMade] = useState<{ name: string; email: string; temporaryPassword: string } | null>(null);
  // Approved, or sent a new link: whether the email went. Never a password — there is none.
  const [invited, setInvited] = useState<StaffInvited | null>(null);
  // Round 38 — the roles a new account is asked with: none ticked until somebody chooses.
  const [pick, setPick] = useState<StaffRole[]>([]);
  // Round 38 — whose roles are being changed here, and to what.
  const [changing, setChanging] = useState<{ operatorId: string; roles: StaffRole[] } | null>(null);
  // Round 38 — a change of roles asked for, or approved: said until the next thing is done here.
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.staff();
    if (r.error) return setError(r.error.detail || r.error.title);
    const data = staffListOf<StaffRow>(r.data);
    setRows(data.items);
    setWaiting(data.waiting);
    if (opensItself(data.waiting, named)) setFold(true);
  }, [client, named]);

  useEffect(() => {
    void load();
  }, [load]);

  const way = staffAddWay(named);

  /** With an account of your own you ASK, and a second member of staff approves. The setup key makes it at once. */
  const add = async () => {
    if (!client) return;
    setBusy('create');
    setError(null);
    setAsked(null);
    setSaid(null);
    const body = { email: email.trim(), name: name.trim() };
    if (way === 'ask') {
      const r = await client.api.askStaff({ ...body, roles: pick });
      setBusy(null);
      if (r.error) return setError(r.error.detail || r.error.title);
      setAsked(body);
    } else {
      const r = await client.api.createStaff(body);
      setBusy(null);
      if (r.error) return setError(r.error.detail || r.error.title);
      setMade(r.data as unknown as { name: string; email: string; temporaryPassword: string });
    }
    setName('');
    setEmail('');
    setPick([]);
    setOpen(false);
    await load();
  };

  /** The second person: yes — and the new colleague is emailed a link to choose their password — or no, with the reason. */
  const decide = async (p: StaffWaiting, yes: boolean, why?: string) => {
    if (!client) return;
    setBusy(p.proposalId);
    setError(null);
    setAsked(null);
    setSaid(null);
    const r = yes ? await client.api.approveStaff(p.proposalId) : await client.api.declineStaff(p.proposalId, why);
    setBusy(null);
    setDeclining(null);
    setReason('');
    if (r.error) setError(r.error.detail || r.error.title);
    // A change of roles sends no email: the person was signed out, and their next sign-in carries the new roles.
    else if (yes && p.kind === 'roles') setSaid(t('tower.roles.approved', { name: p.name }));
    else if (yes) setInvited(r.data as unknown as StaffInvited);
    await load();
  };

  /** Round 38 — ask that somebody hold other roles. Nothing changes until a second member of staff approves. */
  const askRoles = async (a: StaffRow, roles: StaffRole[]) => {
    if (!client) return;
    setBusy(`roles:${a.operatorId}`);
    setError(null);
    setAsked(null);
    setSaid(null);
    const r = await client.api.proposeStaffRoles(a.operatorId, roles);
    setBusy(null);
    if (r.error) return setError(r.error.detail || r.error.title);
    setChanging(null);
    setSaid(t('tower.roles.asked', { name: a.name }));
    await load();
  };

  /** The email did not arrive, or its two days passed: a new link, to the same address. The one before it stops working. */
  const sendLink = async (a: StaffRow) => {
    if (!client) return;
    setBusy(`link:${a.operatorId}`);
    setError(null);
    const r = await sendStaffLink(client, a.operatorId);
    setBusy(null);
    if (r.error) setError(r.error.detail || r.error.title);
    else setInvited(r.data ?? null);
    await load();
  };

  /** The setup key asked to take a colleague's sign-in away, and everybody was told: any one of us stops it. */
  const stopRemoval = async (a: StaffRow) => {
    if (!client) return;
    setBusy(`stop:${a.operatorId}`);
    setError(null);
    const r = await stopStaffRemoval(client, a.operatorId);
    setBusy(null);
    if (r.error) setError(r.error.detail || r.error.title);
    await load();
  };
  const day = (iso: string) => new Date(iso).toLocaleDateString();

  return (
    <ConsoleFold
      title={t('tower.staff.title')}
      hint={rows === null ? t('tower.queues.loading') : staffFoldHint(rows.length, waiting.length, t)}
      aside={waiting.length ? <span class="ctag ctag--warn">{t('tower.staff.waiting.tag', { n: waiting.length })}</span> : undefined}
      open={fold}
      onOpenChange={setFold}
    >
      {rows === null ? null : (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t('common.close') : t('tower.staff.add')}
          </button>
        </div>
      )}
      <p class="cons__lede">{t(way === 'key' ? 'tower.staff.ledeKey' : 'tower.staff.lede')}</p>
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
      {asked ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {askedLine(asked, waiting, t)}
        </p>
      ) : null}
      {said ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {said}
        </p>
      ) : null}

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

      {/* Approved, or sent a new link. What is said is whether the email WENT — and, where none leaves (a laptop), the
          link itself, so the sandbox can be walked through. There is no password to show. */}
      {invited ? (
        <div class="twr-reveal">
          <p class="twr-clear__t">{t('tower.staff.invited.title', { name: invited.name })}</p>
          <p class="twr-clear__b">{t(invited.sent ? 'tower.staff.invited.sent' : 'tower.staff.invited.notSent', { email: invited.email })}</p>
          {invited.link ? (
            <>
              <p class="twr-clear__b">{t('tower.staff.invited.sandbox')}</p>
              <p class="twr-reveal__creds">
                <span class="ctbl__mono twr-reveal__link">{invited.link}</span>
              </p>
            </>
          ) : null}
          <button type="button" class="cbtn cbtn--primary" onClick={() => setInvited(null)}>
            {t('common.close')}
          </button>
        </div>
      ) : null}

      {open ? (
        <div class="twr-knobs">
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
              {/* Round 38 — what they will hold is said when they are asked for, and approved with them. The setup key's
                  own first account holds every role: it is the one setting the network up. */}
              {way === 'ask' ? <RolePicker value={pick} onChange={setPick} hint="tower.roles.pickHint" /> : <p class="chint">{t('tower.roles.keyMakesAll')}</p>}
              <button type="button" class="cbtn cbtn--primary" disabled={busy === 'create' || !email.trim() || !name.trim() || (way === 'ask' && !pick.length)} onClick={() => void add()}>
                {t(way === 'ask' ? 'tower.staff.ask' : 'tower.staff.create')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Asked for, and not yet anybody: nothing here can sign in. The one who asked may only take it back — the
          server refuses them an approval, so the button is not drawn for them. */}
      {waiting.length ? (
        <>
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.staff.waiting.title')}</span>
            <span class="ctag ctag--warn">{waiting.length}</span>
          </div>
          <table class="ctbl ctbl--stack">
            <tbody>
              {waiting.map((p) => {
                const may = waitingActions(p, named);
                const roles = waitingRoles(p, t);
                return (
                  <tr key={p.proposalId}>
                    <td>
                      <div class="ctbl__strong">{p.name}</div>
                      <div class="ctbl__mono">{p.email}</div>
                    </td>
                    <td class="ctbl__sub">
                      {roles ? <div>{roles}</div> : null}
                      {waitingLine(p, named, t, day)}
                    </td>
                    <td>
                      {declining === p.proposalId ? (
                        <span class="twr-panelend">
                          <input
                            class="cinput"
                            value={reason}
                            placeholder={t('tower.staff.declineReason', { who: p.askedBy })}
                            aria-label={t('tower.staff.declineReason', { who: p.askedBy })}
                            onInput={(e) => setReason((e.target as HTMLInputElement).value)}
                          />
                          <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy === p.proposalId || !reason.trim()} onClick={() => void decide(p, false, reason.trim())}>
                            {t('tower.staff.decline')}
                          </button>
                          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setDeclining(null)}>
                            {t('tower.presence.cancel')}
                          </button>
                        </span>
                      ) : (
                        <span class="twr-panelend">
                          {may.includes('approve') ? (
                            <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy === p.proposalId} onClick={() => void decide(p, true)}>
                              {t('tower.staff.approve')}
                            </button>
                          ) : null}
                          {may.includes('decline') ? (
                            <button
                              type="button"
                              class="cbtn cbtn--ghost cbtn--sm"
                              disabled={busy === p.proposalId}
                              onClick={() => {
                                setReason('');
                                setDeclining(p.proposalId);
                              }}
                            >
                              {t('tower.staff.decline')}
                            </button>
                          ) : null}
                          {may.includes('takeBack') ? (
                            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy === p.proposalId} onClick={() => void decide(p, false)}>
                              {t('tower.staff.takeBack')}
                            </button>
                          ) : null}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}

      {rows === null ? (
        <p class="cons__empty">{t('tower.queues.loading')}</p>
      ) : rows.length === 0 ? (
        <p class="cons__empty">{t('tower.staff.none')}</p>
      ) : (
        <table class="ctbl ctbl--stack">
          <thead>
            <tr>
              <th>{t('tower.staff.col.who')}</th>
              <th>{t('tower.staff.col.email')}</th>
              <th>{t('tower.roles.col')}</th>
              <th>{t('tower.staff.col.lastSeen')}</th>
              <th>{t('tower.staff.col.password')}</th>
              <th>{t('tower.staff.col.twoStep')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.operatorId}>
                <td>
                  <div class="ctbl__strong">{a.name}</div>
                  {/* The setup key asked to take this sign-in away. Said to everybody; stopped by any member of staff. */}
                  {a.removalFrom ? (
                    <div class="chint">
                      {t('tower.staff.removalAsked', { when: new Date(a.removalFrom).toLocaleString() })}
                      {named ? (
                        <button type="button" class="cbtn cbtn--ghost cbtn--sm" style="margin:6px 0 0;display:block" disabled={busy === `stop:${a.operatorId}`} onClick={() => void stopRemoval(a)}>
                          {t('tower.staff.removalStop')}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </td>
                <td class="ctbl__mono">
                  <span class="ctbl__lbl">{t('tower.staff.col.email')}</span>
                  {a.email}
                </td>
                {/* Round 38 — what they hold, and the way to ask that they hold something else: one change waiting at a time. */}
                <td>
                  <span class="ctbl__lbl">{t('tower.roles.col')}</span>
                  <span class="twr-caps">
                    {rolesOf(a.roles).map((r) => (
                      <span key={r} class="ctag ctag--quiet">
                        {t(ROLE_WORDS[r].name)}
                      </span>
                    ))}
                  </span>
                  {waiting.some((p) => p.kind === 'roles' && p.operatorId === a.operatorId) ? (
                    <div class="chint">{t('tower.roles.changeWaiting')}</div>
                  ) : !named ? null : changing?.operatorId === a.operatorId ? (
                    <>
                      <RolePicker value={changing.roles} onChange={(roles) => setChanging({ operatorId: a.operatorId, roles })} hint="tower.roles.changeHint" />
                      <span class="twr-panelend">
                        <button
                          type="button"
                          class="cbtn cbtn--primary cbtn--sm"
                          disabled={busy === `roles:${a.operatorId}` || !changing.roles.length || changing.roles.join() === rolesOf(a.roles).join()}
                          onClick={() => void askRoles(a, changing.roles)}
                        >
                          {t('tower.roles.askChange')}
                        </button>
                        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setChanging(null)}>
                          {t('tower.presence.cancel')}
                        </button>
                      </span>
                    </>
                  ) : (
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" style="margin-top:6px;display:block" onClick={() => setChanging({ operatorId: a.operatorId, roles: rolesOf(a.roles) })}>
                      {t('tower.roles.change')}
                    </button>
                  )}
                </td>
                <td class="ctbl__sub">
                  <span class="ctbl__lbl">{t('tower.staff.col.lastSeen')}</span>
                  {a.passwordLinkUntil ? (
                    <>
                      <span class="ctag ctag--warn">{t('tower.staff.noPassword')}</span>
                      <span class="chint">{linkWords(a.passwordLinkUntil, Date.now(), t, (iso) => new Date(iso).toLocaleString())}</span>
                      <button type="button" class="cbtn cbtn--ghost cbtn--sm" style="margin-top:6px" disabled={busy === `link:${a.operatorId}`} onClick={() => void sendLink(a)}>
                        {t('tower.staff.sendLink')}
                      </button>
                    </>
                  ) : a.lastSeenAt ? (
                    new Date(a.lastSeenAt).toLocaleString()
                  ) : (
                    t('tower.staff.never')
                  )}
                </td>
                <td class="ctbl__sub">
                  <span class="ctbl__lbl">{t('tower.staff.col.password')}</span>
                  {a.passwordChangedAt ? new Date(a.passwordChangedAt).toLocaleDateString() : t('tower.staff.never')}
                </td>
                {/* Two-step sign-in, and the reset two OTHER people make when somebody loses their phone: the first
                    asks, a second completes. The server refuses the person themselves and a single pair of hands. */}
                <td class="ctbl__sub">
                  <span class="ctbl__lbl">{t('tower.staff.col.twoStep')}</span>
                  {a.twoStep ? <span class="ctag ctag--ok">{t('tower.twoStep.on')}</span> : <span class="ctag ctag--warn">{t('tower.twoStep.off')}</span>}
                  {a.twoStepResetAskedBy ? <span class="chint">{t('tower.staff.resetAsked', { name: a.twoStepResetAskedBy })}</span> : null}
                  {a.twoStep ? (
                    <button
                      type="button"
                      class="cbtn cbtn--ghost cbtn--sm"
                      style="margin-top:6px"
                      disabled={busy === `reset:${a.operatorId}`}
                      onClick={async () => {
                        if (!client) return;
                        setBusy(`reset:${a.operatorId}`);
                        setError(null);
                        const r = await resetTwoStep(client, a.operatorId);
                        setBusy(null);
                        if (r.error) setError(r.error.detail || r.error.title);
                        else await load();
                      }}
                    >
                      {a.twoStepResetAskedBy ? t('tower.staff.resetApprove') : t('tower.staff.resetAsk')}
                    </button>
                  ) : null}
                </td>
                {/* NOT ctbl__num: a cell of buttons is not a figure, and that class's nowrap would stop a
                    label from wrapping — the trap the required-papers row fell into. */}
                <td>
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
    </ConsoleFold>
  );
}
