import { CredentialAge } from '../../../shared/account/CredentialAge';
import { pinChangeBlocker } from '../../../shared/account/password';
import { useState, useEffect } from 'preact/hooks';
import { Button, Card, ErrorNote, ExplainerReset, Icon, Note, PhotoField, PlaceMap, Pill, ReadAloud, Sheet } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import type { SbgClient, SbgError } from '../../../lib/sbg';
import { systemApi, systemSummary, type SystemView } from '../system';
import { StandstillCard } from './StandstillCard';
import { ageWords, signalState, dashboardSummary, fleetMap, hazardWords, hoursLabel, paperDay, paperKindLabel, paperLine, paperLineClass, papersAloud, stopDetail, vehicleDetail } from '../logic';
import { vehicleWord } from '../../driver/vehicle-words';
import type { PapersReport } from '../types';
import type { FleetActions, FleetState, OwnPaperKind, OwnPapers } from '../useFleetApp';

export interface DashboardScreenProps {
  state: FleetState;
  actions: FleetActions;
  sbg?: SbgClient | null;
}

/** The live fleet: counts, GPS positions, working hours and cargo in motion. */
export function DashboardScreen({ state, actions, sbg }: DashboardScreenProps) {
  const t = useT();
  const [bigMap, setBigMap] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const d = state.dashboard;
  const sessions = d?.sessions.list ?? [];
  const cargo = d?.cargo.items ?? [];
  const map = fleetMap(sessions, cargo, state.hazards, t);
  const vehicles = map.pins.filter((p) => p.id.startsWith('v:'));
  const pins = vehicles;
  const vehicle = picked?.startsWith('v:') ? vehicleDetail(picked.slice(2), sessions, cargo, d?.hours?.limit) : null;
  const hazard = picked?.startsWith('h:') ? state.hazards.find((h) => `h:${h.constraintId}` === picked) ?? null : null;
  const stop = picked?.startsWith('s:') ? stopDetail(picked.slice(2), sessions, cargo) : null;
  // A line belongs to its vehicle: tapping it opens the same sheet, which names the stop the line ends at.
  const mapProps = { pins: map.pins, lines: map.lines, selectedId: picked, onPick: (id: string) => setPicked(id.startsWith('n:') ? `v:${id.slice(2)}` : id) };

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      <div class="tiles tiles--5">
        <Tile value={`${d?.vehicles.active ?? 0}/${d?.vehicles.total ?? 0}`} label={t('fleet.dash.tileVehicles')} />
        <Tile value={`${d?.drivers.onShift ?? 0}/${d?.drivers.total ?? 0}`} label={t('fleet.dash.tileOnShift')} />
        <Tile value={String(d?.sessions.active ?? 0)} label={t('fleet.dash.tileSessions')} />
        <Tile value={`${d?.cargo.count ?? 0}·${d?.cargo.totalKg ?? 0}kg`} label={t('fleet.dash.tileCargo')} />
        <Tile value={hoursLabel(d?.sessions.todayHours)} label={t('fleet.dash.tileHours')} />
      </div>

      {/* Round 16 — a vehicle standing still longer than the fleet allows, away from any reason to: read first. */}
      <StandstillCard sbg={sbg ?? null} did={state.manager?.did} />

      {/* FP4 — what is off the road and what is running out. Read from the same rules the six-hourly sweep
          enforces, so this card and the email the fleet gets cannot disagree. Absent entirely (not empty) when the
          server has no report, so an old backend does not read as "all in date". */}
      {d?.papers ? <PapersCard report={d.papers} /> : null}
      {state.ownPapers ? <CompanyPapersCard own={state.ownPapers} state={state} actions={actions} /> : null}

      {/* FP5 — the office puts a load on a driver. Reached from here and from a shift row, never a sixth tab. */}
      <Card title={t('fleet.dispatch.cardTitle')} aside={<Button variant="link" full={false} onClick={() => actions.openDispatch()}>{t('fleet.dispatch.cardOpen')}</Button>}>
        <p class="card__note">{t('fleet.dispatch.cardBody', { n: d?.drivers.onShift ?? 0 })}</p>
      </Card>

      {/* FP1 — the one thing a fleet owner asks first, and the one screen this app never had. */}
      <Card title={t('fleet.notes.cardTitle')} aside={<Button variant="link" full={false} onClick={() => actions.go('notes')}>{t('fleet.notes.cardOpen')}</Button>}>
        <p class="hint">{t('fleet.notes.cardHint')}</p>
      </Card>

      <Card title={t('fleet.earn.cardTitle')} aside={<Button variant="link" full={false} onClick={() => actions.go('earnings')}>{t('fleet.earn.cardOpen')}</Button>}>
        <p class="card__note">{t('fleet.earn.cardBody')}</p>
      </Card>

      {/* Round 11 — its own transport system, told of its work: whether it is set up, and whether messages are arriving. */}
      <SystemCard sbg={sbg ?? null} did={state.manager?.did} onOpen={() => actions.go('system')} />

{/* A REAL map, and one that renders whether or not anything is on it.

          It used to be a bespoke dot-plot projected onto an abstract grid, which meant that with nothing
          reporting there was nothing to see — an empty grid says less than no map at all. A manager
          opening this app at six in the morning, before a single driver has started, should still see
          the place they operate in. The shared map handles that already: no pins simply means the
          operating area at city zoom, and it falls back to the plot when the tiles cannot load.

          A vehicle opens what an office asks next: who drives it, what it carries, where it goes next and the
          hours left. A line runs to that next stop — straight, because nothing here knows the road — and ends at a
          ring named for the place, which opens who is heading there. Red
          diamonds are what drivers reported on the roads around the vehicles. It reads itself again every
          45 seconds while this screen is open. */}
      <FleetCodeCard state={state} actions={actions} />

      <Card title={t('fleet.dash.mapTitle')} label={t('fleet.dash.mapLabel')}>
        <p class="card__note">{pins.length === 0 ? t('fleet.dash.mapNoneNote') : t('fleet.dash.mapNote')}</p>
        <PlaceMap
          {...mapProps}
          label={pins.length === 1 ? t('fleet.dash.mapAriaOne', { count: pins.length }) : t('fleet.dash.mapAriaMany', { count: pins.length })}
        />
        <MapKey lines={map.lines.length} hazards={state.hazards.length} readAt={state.mapReadAt} />
        {/* Its own control rather than a tap on the surface: the map underneath pans and zooms, and a
            surface that both moves under your finger and opens something is a surface that does the
            wrong one of those about half the time. */}
        <div style="margin-top:12px">
          <Button variant="outline" chevron={false} onClick={() => setBigMap(true)}>
            {t('fleet.dash.mapExpand')}
          </Button>
        </div>
      </Card>

      {/* Mounted only while open, so Leaflet initialises once and against a box that already has its
          real height — a map built inside a closed sheet comes up sized to nothing. */}
      <Sheet open={bigMap} onClose={() => setBigMap(false)} title={t('fleet.dash.mapTitle')}>
        {bigMap ? (
          <>
            <PlaceMap
              tall
              {...mapProps}
              label={pins.length === 1 ? t('fleet.dash.mapAriaOne', { count: pins.length }) : t('fleet.dash.mapAriaMany', { count: pins.length })}
            />
            <p class="card__note">{pins.length === 0 ? t('fleet.dash.mapNoneNote') : t('fleet.dash.mapNote')}</p>
            <MapKey lines={map.lines.length} hazards={state.hazards.length} readAt={state.mapReadAt} />
          </>
        ) : null}
      </Sheet>

      {/* WHAT A TAP OPENS. A vehicle: the driver, the hours left, each load and where it goes next. A stop: who is
          heading there and what each does there, a tap from their vehicle. A hazard: what was reported, how many
          agree, and whether somebody says it is gone. */}
      <Sheet open={Boolean(vehicle)} onClose={() => setPicked(null)} title={vehicle ? `${vehicle.session.plate} · ${vehicle.session.driverName}` : ''}>
        {vehicle ? (
          <>
            <p class="t-body">
              {vehicleWord(vehicle.session.vehicleClass, t)} · {t('fleet.map.onDuty', { hours: hoursLabel(vehicle.session.hoursOnDuty) })}
              {vehicle.hoursLeft != null ? ` · ${t('fleet.map.hoursLeft', { hours: hoursLabel(vehicle.hoursLeft) })}` : ''}
            </p>
            {vehicle.signal.kind === 'dark' ? <p class="hint">{t('fleet.map.dark', { age: ageWords(vehicle.signal.minutes) })}</p> : null}
            {vehicle.next ? <p class="t-body">{t(vehicle.next.what === 'pickup' ? 'fleet.map.nextPickup' : 'fleet.map.nextDrop', { place: vehicle.next.label })}</p> : null}
            {vehicle.loads.length === 0 ? (
              <p class="hint">{t('fleet.map.noLoad')}</p>
            ) : (
              <ul class="rows">
                {vehicle.loads.map((l) => (
                  <li key={l.ref} class="row row--static">
                    <span class="row__body">
                      <span class="row__t">
                        {l.ref} · {l.weightKg} kg
                      </span>
                      <span class="row__s">
                        {l.nextStop ? t(l.nextStop.what === 'pickup' ? 'fleet.map.loadPickup' : 'fleet.map.loadDrop', { place: l.nextStop.label }) : l.destLabel}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Button variant="link" onClick={() => setPicked(null)}>
              {t('common.close')}
            </Button>
          </>
        ) : null}
      </Sheet>
      <Sheet open={Boolean(stop)} onClose={() => setPicked(null)} title={stop?.label ?? ''}>
        {stop ? (
          <>
            <p class="hint">{t('fleet.map.stopNote', { count: stop.vehicles.length })}</p>
            <div class="rows" role="list">
              {stop.vehicles.map((v) => (
                <button key={v.session.driverDid} type="button" class="row" role="listitem" onClick={() => setPicked(`v:${v.session.driverDid}`)}>
                  <span class="row__body">
                    <span class="row__t">
                      {v.session.plate} · {v.session.driverName}
                    </span>
                    <span class="row__s">
                      {v.loads.map((l) => t(l.nextStop?.what === 'pickup' ? 'fleet.map.stopCollects' : 'fleet.map.stopDelivers', { ref: l.ref, kg: l.weightKg })).join(', ')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <Button variant="link" onClick={() => setPicked(null)}>
              {t('common.close')}
            </Button>
          </>
        ) : null}
      </Sheet>
      <Sheet open={Boolean(hazard)} onClose={() => setPicked(null)} title={hazard ? hazardWords(hazard, t) : ''}>
        {hazard ? (
          <>
            <p class="t-body">{t('fleet.map.hazardReported', { day: formatDate(hazard.reportedAt), agree: hazard.confirmations })}</p>
            {hazard.status === 'disputed' ? <p class="hint">{t('fleet.map.hazardDisputedDetail', { count: hazard.refutations })}</p> : null}
            <p class="hint">{t('fleet.map.hazardBasis')}</p>
            <Button variant="link" onClick={() => setPicked(null)}>
              {t('common.close')}
            </Button>
          </>
        ) : null}
      </Sheet>

      <Card title={t('fleet.dash.hoursTitle')}>
        {/* FP8 — the limits every figure below is read against, said once. */}
        {d?.hours ? <p class="hint">{t('fleet.dash.hoursLimits', { limit: d.hours.limit, rest: d.hours.rest })}</p> : null}
        {sessions.length === 0 ? (
          <p class="hint">{t('fleet.dash.noDrivers')}</p>
        ) : (
          <div class="rows" role="list">
            {sessions.map((s) => (
              <div key={`${s.plate}:${s.driverName}`} class="row row--static" role="listitem">
                <span class="row__ic">
                  <Icon name="person" size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t">{s.driverName}</span>
                  <span class="row__s">{t('fleet.dash.onDutyRow', { plate: s.plate, cls: s.vehicleClass, hours: hoursLabel(s.hoursOnDuty) })}</span>
                  {/* FP8 — over the limit: they finish what is aboard; the office puts nothing more on them. */}
                  {s.overLimit ? <span class="row__s row__s--danger">{t('fleet.dash.overLimit', { limit: d?.hours?.limit ?? 13 })}</span> : null}
                </span>
                <span class="row__end">
                  {/* Located means heard from lately. A vehicle silent for ten minutes is said to be dark, with how long:
                      a manager phoning a driver who is in a valley is not helped by a green dot. */}
                  {(() => {
                    const signal = signalState(s.lastLocatedAt);
                    const kind = s.location ? signal.kind : 'never';
                    return (
                      <Pill tone={kind === 'live' ? 'ok' : kind === 'dark' ? 'warn' : 'idle'} dot>
                        {kind === 'live' ? t('fleet.dash.seenAgo', { age: ageWords(signal.minutes) }) : kind === 'dark' ? t('fleet.dash.darkFor', { age: ageWords(signal.minutes) }) : t('fleet.dash.noSignal')}
                      </Pill>
                    );
                  })()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={t('fleet.dash.cargoTitle')}>
        {cargo.length === 0 ? (
          <p class="hint">{t('fleet.dash.noCargo')}</p>
        ) : (
          <div>
            {cargo.map((c) => (
              <div key={c.ref} class="kv">
                <span>
                  <span class="mono">{c.ref}</span>
                  {` · ${c.weightKg} kg → ${c.destLabel}`}
                </span>
                <b>{c.driver}</b>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div class="scr__foot">
        <ReadAloud
          text={() => (d ? dashboardSummary(d, t) + papersAloud(d.papers, t) : t('fleet.dash.aloudLoading'))}
          label={t('fleet.readAloud')}
        />
        {/* The way back for anything put away on the other screens — invisible until there is something. */}
        <ExplainerReset who={state.manager?.did} />
      </div>
    </div>
  );
}

function PapersCard({ report }: { report: PapersReport }) {
  const t = useT();
  const rows = [...report.lapsed, ...report.due];
  return (
    <Card title={t('fleet.papers.cardTitle')}>
      <p class="card__note">{t('fleet.papers.cardNote')}</p>
      {rows.length === 0 ? (
        <p class="hint">{t('fleet.papers.clear')}</p>
      ) : (
        <div class="rows" role="list">
          {rows.map((r) => (
            <div key={r.subject + ':' + r.id + ':' + r.kind} class="row row--static" role="listitem">
              <span class="row__ic">
                <Icon name={r.subject === 'vehicle' ? 'truck' : 'person'} size={24} />
              </span>
              <span class="row__body">
                <span class="row__t">{r.label}</span>
                <span class={paperLineClass(r.state)}>{paperLine(r, t)}</span>
                {/* Still driving on it: for a lapsed paper that is the shift the next check ends. */}
                {r.onShift ? <span class="row__s">{t(r.state === 'lapsed' ? 'fleet.papers.onShiftEnds' : 'fleet.papers.onShift')}</span> : null}
                {/* The driver has done their part: this row now waits on the office, and says where. */}
                {r.cardSent ? <span class="row__s row__s--warn">{t('fleet.papers.cardSentRow')}</span> : null}
              </span>
              <span class="row__end">
                <Pill tone={r.state === 'lapsed' ? 'danger' : 'warn'} dot>
                  {r.state === 'lapsed' ? t('fleet.papers.offRoad') : t('fleet.papers.runningOut')}
                </Pill>
              </span>
            </div>
          ))}
        </div>
      )}
      <p class="hint" style="margin-top:8px">{t('fleet.papers.counts', { inDate: report.inDate, unrecorded: report.unrecorded })}</p>
    </Card>
  );
}

/**
 * THE COMPANY'S OWN PAPERS — its transport licence and its cover, beside its lorries' and drivers'.
 *
 * Only SeeBuyGet's staff record these dates (a company does not type the date on the licence that says
 * whether it may trade). What the office CAN do is send the renewed document from here — an image and the
 * date it read off it — and this card is also where the answer comes back, because the fleet app has no
 * inbox: waiting, or turned down with the staff member's own reason.
 *
 * It also says whether the company behind the fleet ENFORCES them: "lapsed" means something very different
 * when it is costing the fleet work than when it is only a warning, and a fleet must be able to tell.
 */
function CompanyPapersCard({ own, state, actions }: { own: OwnPapers; state: FleetState; actions: FleetActions }) {
  const t = useT();
  const [sending, setSending] = useState<OwnPaperKind | null>(null);
  const enforced = own.enforced.map((k) => paperKindLabel(k as never, t)).join(', ');
  return (
    <Card title={t('fleet.ownPapers.cardTitle')}>
      <div class="rows" role="list">
        {own.papers.map((p) => {
          const kind = p.kind as OwnPaperKind;
          const sent = own.sent?.[kind];
          const refused = own.refused?.[kind];
          return (
            <div key={p.kind} class="row row--static" role="listitem">
              <span class="row__ic">
                <Icon name="badge" size={24} />
              </span>
              {/* Titled by the NUMBER, the way the card above titles a vehicle by its plate — the line under it
                  already names the paper. Titled by the paper instead, every row said its own name twice. */}
              <span class="row__body">
                <span class="row__t">{p.reference ?? paperKindLabel(p.kind, t)}</span>
                <span class={paperLineClass(p.state)}>{paperLine(p, t)}</span>
                {sent ? (
                  <span class="row__s">{t('fleet.ownPapers.waiting', { date: formatDate(sent.sentAt), expires: paperDay(sent.expiresAt) })}</span>
                ) : refused ? (
                  // The staff member's own sentence, written for this office — shown as it was written.
                  <span class="row__s row__s--warn">{t('fleet.ownPapers.refused', { reason: refused.reason })}</span>
                ) : null}
                <Button variant="link" onClick={() => setSending(kind)}>
                  {t(sent ? 'fleet.ownPapers.sendAgain' : refused ? 'fleet.ownPapers.sendNew' : 'fleet.ownPapers.send')}
                </Button>
              </span>
            </div>
          );
        })}
      </div>
      <p class="hint" style="margin-top:8px">
        {own.enforced.length ? t('fleet.ownPapers.enforced', { papers: enforced }) : t('fleet.ownPapers.notEnforced')}
      </p>
      {sending ? <SendPaperSheet kind={sending} state={state} actions={actions} onClose={() => setSending(null)} /> : null}
    </Card>
  );
}

/**
 * SEND ONE RENEWED DOCUMENT: the image, the expiry read off it, and its number.
 *
 * The same sheet a courier sends a renewed licence from, because it is the same act. The date is the
 * office's reading and says so — staff type their own reading off the same image, and only theirs counts.
 * A date already past is not let through: the server refuses it as the misreading it is.
 */
function SendPaperSheet({ kind, state, actions, onClose }: { kind: OwnPaperKind; state: FleetState; actions: FleetActions; onClose: () => void }) {
  const t = useT();
  const [photo, setPhoto] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<SbgError | null>(null);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const ready = Boolean(photo) && Boolean(expiresAt) && expiresAt >= tomorrow;
  const label = paperKindLabel(kind, t);

  return (
    <Sheet open onClose={onClose} title={t('fleet.ownPapers.sheetTitle', { paper: label })}>
      <p class="t-body">{t(kind === 'operator_licence' ? 'fleet.ownPapers.sheetBodyLicence' : 'fleet.ownPapers.sheetBodyInsurance')}</p>
      {error ? <ErrorNote error={error} showDetail /> : null}
      <PhotoField
        id={`own-paper-${kind}`}
        value={photo}
        label={t('fleet.ownPapers.photo', { paper: label })}
        upload={(file) => actions.uploadPhoto(kind === 'operator_licence' ? 'kyc_licence' : 'kyc_insurance', file)}
        onCapture={setPhoto}
      />
      <label class="field">
        <span class="field__label">{t('fleet.ownPapers.expires')}</span>
        <input class="input" type="date" min={tomorrow} value={expiresAt} onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)} />
      </label>
      <label class="field">
        <span class="field__label">{t(kind === 'operator_licence' ? 'fleet.ownPapers.licenceNumber' : 'fleet.ownPapers.policyNumber')}</span>
        <input class="input" value={reference} autoComplete="off" onInput={(e) => setReference((e.target as HTMLInputElement).value)} />
      </label>
      <Button
        chevron={false}
        disabled={!ready}
        busy={state.busy === 'ownPaper'}
        onClick={async () => {
          setError(null);
          const failed = await actions.sendOwnPaper({ kind, copyRef: photo, expiresAt, ...(reference.trim() ? { reference: reference.trim() } : {}) });
          if (failed) return setError(failed);
          onClose();
        }}
      >
        {t('fleet.ownPapers.submit')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('fleet.ownPapers.notNow')}
      </Button>
    </Sheet>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div class="tile">
      <span class="tile__v tile__v--sm">{value}</span>
      <span class="tile__l">{label}</span>
    </div>
  );
}

/**
 * The fleet's sign-in code, shown to the fleet itself — hidden until asked for, because a code read over a
 * shoulder is a code somebody else has. Rotate it whenever it may have been seen; it only names the fleet, so
 * nobody is signed out. And the manager's own PIN, changed with the current one.
 */
function FleetCodeCard({ actions }: DashboardScreenProps) {
  const t = useT();
  const [code, setCode] = useState<string | null>(null);
  const [changedAt, setChangedAt] = useState<string | undefined>(undefined);
  const [shown, setShown] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const pinBlocker = pinChangeBlocker({ current, next });

  useEffect(() => {
    void actions.loadFleetCode().then((loaded) => {
      setCode(loaded?.code ?? null);
      setChangedAt(loaded?.changedAt);
    });
  }, [actions.loadFleetCode]);

  return (
    <>
      <Card title={t('fleet.code.title')}>
        <p class="card__note">{t('fleet.code.note')}</p>
        <p class="mono-t" style="font-size:1.25rem;letter-spacing:.08em">
          {code === null ? t('fleet.code.loading') : shown ? code : '••••••••'}
        </p>
        {note ? <p class="card__note">{note}</p> : null}
        <CredentialAge iso={changedAt} machine />
        <div class="btnrow">
          <Button variant="link" full={false} disabled={code === null} onClick={() => setShown((s) => !s)}>
            {t(shown ? 'fleet.code.hide' : 'fleet.code.show')}
          </Button>
          {confirm ? (
            <>
              <Button
                variant="link"
                full={false}
                busy={rotating}
                onClick={async () => {
                  setRotating(true);
                  const fresh = await actions.rotateFleetCode();
                  setRotating(false);
                  setConfirm(false);
                  if (fresh) {
                    setCode(fresh);
                    setChangedAt(new Date().toISOString());
                    setShown(true);
                    setNote(t('fleet.code.rotated'));
                  }
                }}
              >
                {t('fleet.code.rotateConfirm')}
              </Button>
              <Button variant="link" full={false} onClick={() => setConfirm(false)}>
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <Button variant="link" full={false} onClick={() => setConfirm(true)}>
              {t('fleet.code.rotate')}
            </Button>
          )}
        </div>
        {confirm ? <p class="card__note">{t('fleet.code.rotateWarn')}</p> : null}
        <div class="btnrow">
          <Button
            variant="link"
            full={false}
            onClick={() => {
              setPhone('');
              setCurrent('');
              setNext('');
              setPinOpen(true);
            }}
          >
            {t('fleet.code.changePin')}
          </Button>
        </div>
      </Card>

      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title={t('fleet.code.pinTitle')}>
        <div class="field">
          <label class="field__label" for="pin-phone">
            {t('fleet.signin.phoneLabel')}
          </label>
          <input id="pin-phone" class="input input--mono" type="tel" autocomplete="username" value={phone} onInput={(e) => setPhone(e.currentTarget.value)} />
        </div>
        <div class="field">
          <label class="field__label" for="pin-current">
            {t('fleet.code.currentPin')}
          </label>
          <input id="pin-current" class="input input--mono" type="password" inputMode="numeric" autocomplete="current-password" value={current} onInput={(e) => setCurrent(e.currentTarget.value)} />
        </div>
        <div class="field">
          <label class="field__label" for="pin-new">
            {t('fleet.code.newPin')}
          </label>
          <input id="pin-new" class="input input--mono" type="password" inputMode="numeric" autocomplete="new-password" value={next} onInput={(e) => setNext(e.currentTarget.value)} />
        </div>
        {pinBlocker && (current || next) ? <p class="card__note">{t(pinBlocker)}</p> : null}
        <Button
          chevron={false}
          disabled={pinBlocker !== null || !phone.trim()}
          busy={pinBusy}
          onClick={async () => {
            setPinBusy(true);
            const ok = await actions.changeMyPin(phone, current, next);
            setPinBusy(false);
            if (ok) {
              setPinOpen(false);
              setNote(t('fleet.code.pinDone'));
            }
          }}
        >
          {t('fleet.code.savePin')}
        </Button>
        <Button variant="link" onClick={() => setPinOpen(false)}>
          {t('common.cancel')}
        </Button>
      </Sheet>
    </>
  );
}

/** Its own system, in one line: not set up, where it goes, or how many messages have not arrived. Opens the screen. */
function SystemCard({ sbg, did, onOpen }: { sbg: SbgClient | null; did?: string; onOpen: () => void }) {
  const t = useT();
  const [view, setView] = useState<SystemView | null>(null);
  useEffect(() => {
    if (!sbg || !did) return;
    void systemApi(sbg, did)
      .view()
      .then((r) => setView(r.data ?? null));
  }, [sbg, did]);
  const line = systemSummary(view, t);
  return (
    <Card title={t('fleet.system.cardTitle')} aside={<Button variant="link" full={false} onClick={onOpen}>{t('fleet.system.cardOpen')}</Button>}>
      {line.warn ? <Note tone="warn" icon="warning" title={line.text} /> : <p class="card__note">{line.text}</p>}
    </Card>
  );
}

/** What the lines and the diamonds are, said where they are drawn — and when the map was read. */
function MapKey({ lines, hazards, readAt }: { lines: number; hazards: number; readAt: string | null }) {
  const t = useT();
  return (
    <p class="hint">
      {[lines ? t('fleet.map.keyLines') : '', hazards ? t('fleet.map.keyHazards', { count: hazards }) : t('fleet.map.keyNoHazards'), readAt ? t('fleet.map.readAt', { time: formatDate(readAt, { hour: '2-digit', minute: '2-digit' }) }) : '']
        .filter(Boolean)
        .join(' ')}
    </p>
  );
}
