import { DarkSpellNote } from './DarkSpellNote';
import { useState } from 'preact/hooks';
import { Button, Card, Checklist, CodeBoxes, ErrorNote, Explainer, ExplainerBlock, GlanceNumber, Icon, Note, PhotoField, Pill, PushPrompt, QrBlock, ReadAloud, RefusalNote, ScanField, Sheet } from '../../../shared/ui';
import type { SbgError } from '../../../lib/sbg';
import { PIN_LENGTH } from '../../../shared/account/pin';
import { formatDate, useT } from '../../../shared/i18n';
import { paperDay } from '../../../shared/papers';
import { qrPayload } from '../../../shared/qr';
import { printQrSheet } from '../../../shared/print-qr';
import { isRidden, namedVehicleClass, stickerPlace, vehicleWord } from '../vehicle-words';
import {
  canStartShift,
  capacitySubLine,
  cardReader,
  cardWords,
  type CardReader,
  driverStatusNotice,
  afterShiftLine,
  odometerOf,
  badgeToShow,
  hoursWords,
  restSays,
  isFull,
  minEarnFilter,
  offShiftSummary,
  rateBand,
  removalWords,
  removedLine,
  shiftSummary,
  usedPercent,
} from '../logic';
import type { RecentVehicleView } from '../types';
import { ReportDefectSheet, VehicleCheckSheet } from './VehicleCheck';
import { BreakdownSheet, TakeOverLink } from './Breakdown';
import { IdPhotoCard } from './IdPhotoCard';
import { DeclarationCard } from '../../../shared/DeclarationCard';
import type { SbgClient } from '../../../lib/sbg';
import type { DriverActions, DriverState } from '../useDriverApp';

export interface HomeScreenProps {
  state: DriverState;
  actions: DriverActions;
  /** Open "Your fleet" — where a fleet's offer is answered. The sheet belongs to the shell, beside the account menu. */
  onOpenFleet?: () => void;
  /** Round 39 — for the security declaration: a rider in no fleet signs their own; a fleet's driver is covered by the fleet. */
  sbg?: SbgClient | null;
}

export function HomeScreen({ state, actions, onOpenFleet, sbg }: HomeScreenProps) {
  return state.session.active && state.vehicle ? <OnShift state={state} actions={actions} onOpenFleet={onOpenFleet} sbg={sbg} /> : <OffShift state={state} actions={actions} onOpenFleet={onOpenFleet} sbg={sbg} />;
}

/**
 * A FLEET WANTS THIS DRIVER — said on the screen they are already on, both faces of it.
 *
 * The offer is answered in "Your fleet", which lives behind the account menu: the right home for it and the last
 * place anybody looks. A notification says it once; this says it for as long as the offer is open.
 */
function FleetOfferNote({ state, onOpenFleet }: Pick<HomeScreenProps, 'state' | 'onOpenFleet'>) {
  const t = useT();
  const offer = state.fleetOffers[0];
  if (!offer) return null;
  return (
    <>
      <Note
        tone="info"
        icon="truck"
        title={state.fleetOffers.length > 1 ? t('driver.home.offersTitle', { count: state.fleetOffers.length }) : t('driver.home.offerTitle', { company: offer.companyName })}
        detail={t('driver.home.offerDetail', { day: formatDate(offer.expiresAt, { day: 'numeric', month: 'short' }) })}
      />
      {onOpenFleet ? (
        <Button variant="outline" chevron={false} onClick={onOpenFleet}>
          {t('driver.home.offerSee')}
        </Button>
      ) : null}
    </>
  );
}

/**
 * The notification ask — on the OFF-SHIFT face only, and that is not a compromise.
 *
 * It went on both faces first, reasoning that a driver might open the app at either. Measured on shift it
 * cost 350px in the middle of the working screen and pushed the vehicle and "End my shift" under the
 * fold, which is a bad trade for a question, and the argument for it was wrong anyway: **you cannot be on
 * shift without having been off shift first.** The off-shift home is the first screen of every working
 * day, because a shift has to be started from it — so nobody is missed by asking only there, and it is
 * the better moment regardless. A driver at the coffee table can think about a question; a driver
 * mid-shift is working, and the reason we would give them (a load near you goes to whoever takes it
 * first) is most persuasive before the day starts rather than in the middle of it.
 */
function PushAsk({ actions }: { actions: DriverActions }) {
  const t = useT();
  return (
    <PushPrompt
      api={actions.notifications}
      title={t('driver.push.title')}
      reason={t('driver.push.reason')}
      turnOn={t('driver.push.turnOn')}
      notNow={t('driver.push.notNow')}
      storageKey="glos-driver-push-asked"
    />
  );
}

/* ============================================================== off shift == */

function OffShift({ state, actions, onOpenFleet, sbg }: HomeScreenProps) {
  const t = useT();
  const notice = driverStatusNotice(state.driver?.status, t, Boolean(state.driver?.managerDid));
  // FP4 — a lapsed licence stops the shift before the walk to the yard, in the server's own words (the same
  // ones the coupling would refuse with). A licence running out is said here too, once, where it can be acted on.
  const offRoad = state.driver?.offRoad ?? [];
  const licenceDue = (state.driver?.papers ?? []).find((p) => p.kind === 'licence' && p.state === 'due');
  // Who records their licence decides what the note can tell them to do, and who a card sent from here goes
  // to: their fleet's office, or — for a courier who rides on their own — the network.
  // BETWEEN FLEETS: a fleet took them off and none has taken them on. Not their own boss — nobody contracted them
  // as one — and no office is theirs, so there is nobody to send a card to, and no shift can start until a
  // fleet offers them a place.
  const removed = state.driver && !state.driver.managerDid ? state.driver.removedFrom : undefined;
  const reader = cardReader(state.driver);
  const words = cardWords(reader ?? 'office');
  // Once the new card is sent, the notes keep their FACTS (how long is left, why no shift can start) and
  // drop the instruction to send it — the note below says it has been, and telling somebody to do what
  // they have just done reads as "it did not go through".
  const cardSent = reader !== null && Boolean(state.driver?.licenceRenewal);
  // Signed up before SeeBuyGet opened in their country: no shift until the day it does (the server refuses one too).
  const notOpenIn = state.driver?.notOpenIn;
  const ready = canStartShift(state.driver?.status) && offRoad.length === 0 && !removed && !notOpenIn;
  // THE PIN, asked at the start of a shift: that is where who-is-driving is written down, and an app left signed
  // in — in a cab, on a depot charger — is not proof of who is holding the phone.
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [odo, setOdo] = useState('');
  const [checkOpen, setCheckOpen] = useState(false);
  const [refused, setRefused] = useState<SbgError | null>(null);
  // Which of this driver's usual roads they are running today. Optional: a driver who does not yet know
  // starts the shift anyway and says it later, when they look for work.
  const [legIndex, setLegIndex] = useState<number | null>(null);
  const leg = legIndex != null ? state.legs[legIndex] : undefined;
  // Which vehicle, before walking to it. A driver opens the app over a coffee; the one they drove yesterday
  // is one tap, and the dashboard QR below stays the way a NEW vehicle joins the list.
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const free = state.vehicles.filter((v) => !v.busy && !v.offRoad?.length);
  // The vehicles no fleet owns — the server sends a dashboard code only for those, so this is both
  // "which are mine" and "which stickers am I allowed to see" in one read.
  const mine = state.vehicles.filter((v) => Boolean(v.qr));
  /*
   * WHAT THIS DRIVER ACTUALLY RIDES, and the sticker instruction that follows from it.
   *
   * "Put it on the dashboard, where it can be scanned from the driver's seat" is good instruction in a
   * truck and nonsense on a bicycle. The sticker sheet is per-VEHICLE (a courier can own more than one),
   * so its copy follows the vehicle being shown; everything else on this screen follows the one the app
   * is named after. The user spotted this one before it was built.
   */
  const namedClass = namedVehicleClass(state.vehicle, state.vehicles);
  const vehicle = vehicleWord(namedClass, t);
  const rest = restSays(state.session.hours, t, (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }));
  const [sticker, setSticker] = useState<RecentVehicleView | null>(null);
  // A courier's own vehicle has the upkeep a fleet's office keeps for its own: off the road and back, readings,
  // services, the daily check's defects and a breakdown's ending (2026-10-25 — the server had it all, no screen did).
  const [careFor, setCareFor] = useState<RecentVehicleView | null>(null);
  // The sheet and its words come when it is first opened (OwnUpkeep.tsx): most drivers never open it.
  const [CareSheet, setCareSheet] = useState<(typeof import('./OwnUpkeep'))['VehicleCareSheet'] | null>(null);
  const openCare = (v: RecentVehicleView) =>
    void import('./OwnUpkeep').then(
      (m) => {
        setCareSheet(() => m.VehicleCareSheet);
        setCareFor(v);
      },
      () => setCareFor(null), // no signal and not yet saved on the phone: the button simply waits for one
    );
  const [printBlocked, setPrintBlocked] = useState(false);
  const stickerRidden = isRidden(sticker?.vehicleClass);

  return (
    <div class="scr">
      <h1 class="scr__title">{t('driver.home.startTitle')}</h1>
      <Explainer who={state.driver?.did} id="driver.shift.how" text={t('driver.home.startLede', { place: stickerPlace(namedClass, t) })} />

      <FleetOfferNote state={state} onOpenFleet={onOpenFleet} />
      {removed ? (
        <Note tone="warn" icon="truck" title={t('driver.home.betweenTitle')} detail={`${removedLine(removed, formatDate(removed.at, { day: 'numeric', month: 'short' }), t)} ${removalWords(removed, t, Boolean(state.rideAlone?.offered))}`} />
      ) : null}
      {notice ? <Note tone="warn" icon="clock" title={t('driver.home.notActivated')} detail={notice} /> : null}
      {notOpenIn ? <Note tone="info" icon="clock" title={t('opening.title', { country: notOpenIn })} detail={t('opening.driver')} /> : null}
      <Clearance state={state} actions={actions} />
      {offRoad.length ? (
        <Note tone="danger" icon="clock" title={t('driver.home.offRoadTitle')} detail={offRoad.join('. ') + '.' + (cardSent ? '' : ' ' + t(words.offRoad))} />
      ) : null}
      {!offRoad.length && licenceDue ? (
        <Note
          tone="warn"
          icon="clock"
          title={t('driver.home.licenceDueTitle', { days: licenceDue.daysLeft ?? 0 })}
          detail={cardSent ? undefined : t(words.due)}
        />
      ) : null}
      {reader ? <LicenceRenewal state={state} actions={actions} reader={reader} needed={offRoad.length > 0 || Boolean(licenceDue)} /> : null}
      {/* Round 39 — a light courier whose ID nobody has seen: here, where they are on shift or not, a photo of it to send. */}
      {/* Round 39 — the security declaration, while it asks for their hand: at joining, and every year. */}
      {state.driver && !state.driver.managerDid ? <DeclarationCard sbg={sbg ?? null} /> : null}
      {state.custodyCap?.idUnseen ? <IdPhotoCard state={state} actions={actions} /> : null}
      {/* A refused start names the paper (FP4) — that sentence was written for the driver, so it is shown. */}
      {/* FP8 — and a refused start after a working day names the rest owed (HOURS_EXCEEDED), the same way. */}
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} showDetail={state.error.code === 'CANNOT_COUPLE' || state.error.code === 'HOURS_EXCEEDED'} /> : null}
      {/* RESTING — said before they try. Until now the only way to learn when the next shift could start was to start
          one and be refused. "Tell me when" is theirs to press: for most working days that moment is in the night,
          and only somebody waiting for it wants to hear it. */}
      {rest ? (
        <>
          <Note tone="info" icon="clock" title={rest.title} detail={rest.detail} />
          {rest.asked ? null : (
            <Button variant="outline" chevron={false} busy={state.busy === 'rest'} onClick={() => void actions.tellWhenRested()}>
              {t('driver.home.restTellMe')}
            </Button>
          )}
        </>
      ) : null}
      <DarkSpellNote />

      {/* Before the walk to the yard, which is the one calm moment in a driver's day. Below the notices,
          because a lapsed licence is not a thing to read second. */}
      <PushAsk actions={actions} />

      {/* Your own vehicles first — the morning question is "which one today?", and it has an answer before
          the driver has walked anywhere. One in use by someone else is shown and blocked, never hidden. */}
      {/* `title`, not `label`: `label` is only the section's aria-label and renders nothing, so this card
          asked "Which vehicle?" of nobody at all — the fourth instance of that same defect. */}
      {state.vehicles.length ? (
        <Card title={t('driver.home.whichVehicle')}>
          <div class="rows" role="list">
            {state.vehicles.map((v) => (
              <button
                key={v.vehicleId}
                type="button"
                class={`row${vehicleId === v.vehicleId ? ' row--on' : ''}`}
                role="listitem"
                aria-pressed={vehicleId === v.vehicleId}
                disabled={v.busy || Boolean(v.offRoad?.length)}
                onClick={() => setVehicleId(vehicleId === v.vehicleId ? null : v.vehicleId)}
              >
                <span class="row__ic">
                  {/* The glyph follows the CLASS, so a bicycle in this list looks like one. */}
                  <Icon name={vehicleId === v.vehicleId ? 'check' : isRidden(v.vehicleClass) ? 'bike' : 'truck'} size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t">{v.plate}</span>
                  <span class="row__s">
                    {v.vehicleClass}
                    {v.truckSubtype ? ` · ${v.truckSubtype.replace(/_/g, ' ')}` : ''}
                    {t('driver.home.carriesUpTo', { kg: v.capacityKg })}
                  </span>
                  {/* FP4 — why it cannot be taken today, in the words the office and the driver both see. */}
                  {v.offRoad?.length ? <span class="row__s">{v.offRoad.join(' · ')}</span> : null}
                </span>
                {v.offRoad?.length ? (
                  <Pill tone="danger" dot>
                    {t('driver.home.vehicleOffRoad')}
                  </Pill>
                ) : v.busy ? (
                  <Pill tone="warn" dot>
                    {t('driver.home.vehicleBusy')}
                  </Pill>
                ) : null}
              </button>
            ))}
          </div>
          {/* Nothing to pick: say which reason, because "out with someone else" is untrue of a vehicle off the road. */}
          {free.length === 0 ? <p class="card__note">{t(state.vehicles.every((v) => v.busy) ? 'driver.home.allBusy' : 'driver.home.allOffRoad')}</p> : null}

          {/*
            * THE DASHBOARD STICKER, FOR A VAN THAT IS THEIR OWN.
            *
            * A shift starts by scanning the sticker on the dashboard, and a fleet prints those for its
            * vehicles. A courier who registered their own van at signup had nowhere to get one — the code
            * was on the record and on no screen they could reach. They can start by tapping the van above,
            * so this is not the way in; it is how the sticker gets onto the dashboard in the first place,
            * for the mornings when scanning is quicker and for anyone else who ever drives it.
            *
            * Only for a vehicle no fleet owns: the server withholds the code for a fleet's van, because a
            * sticker is a physical thing and handing its code to a phone is a coupling from anywhere.
            */}
          {mine.length ? (
            <Button variant="link" full={false} onClick={() => setSticker(mine[0])}>
              {t(mine.length === 1 ? 'driver.home.stickerOne' : 'driver.home.stickerMany', { vehicle })}
            </Button>
          ) : null}
          {/* Its upkeep, for each vehicle that is the courier's own — the same sheet a fleet's office has. */}
          {mine.map((v) => (
            <Button key={`care-${v.vehicleId}`} variant="link" full={false} onClick={() => openCare(v)}>
              {t('driver.home.upkeep', { plate: v.plate })}
            </Button>
          ))}
        </Card>
      ) : null}

      {CareSheet ? <CareSheet vehicle={careFor} sbg={sbg ?? null} onClose={() => setCareFor(null)} onChanged={() => actions.refresh()} uploadPhoto={actions.uploadPhoto} office={false} /> : null}

      {sticker ? (
        <Sheet open onClose={() => setSticker(null)} title={t('driver.home.stickerTitle', { plate: sticker.plate })}>
          <p class="t-body">{t(stickerRidden ? 'driver.home.stickerBodyRidden' : 'driver.home.stickerBody')}</p>
          <div class="stickerqr">
            <QrBlock value={qrPayload('vehicle', sticker.qr!)} size={196} caption={sticker.qr} label={t('driver.home.stickerQrLabel', { plate: sticker.plate })} />
          </div>
          {/* A code meant to live on a dashboard is not finished until it is on paper. Prints ONE clean
              sheet — the code at a fixed 62mm, the plate above it, the instruction below — rather than
              the app around it. A blocked pop-up says so rather than looking like a dead button. */}
          <Button
            variant="outline"
            chevron={false}
            onClick={() => {
              const svg = document.querySelector('.stickerqr svg');
              const ok = printQrSheet({
                title: sticker.plate,
                caption: sticker.qr,
                note: t(stickerRidden ? 'driver.home.stickerPrintNoteRidden' : 'driver.home.stickerPrintNote'),
                svg: svg as SVGElement | null,
              });
              setPrintBlocked(!ok);
            }}
          >
            <span class="btn__row">
              <Icon name="printer" size={20} />
              {t('driver.home.stickerPrint')}
            </span>
          </Button>
          {printBlocked ? <p class="hint">{t('driver.home.stickerPrintBlocked')}</p> : null}
          {mine.length > 1 ? (
            <div class="rows" role="list">
              {mine.map((v) => (
                <button key={v.vehicleId} type="button" class={`row${v.vehicleId === sticker.vehicleId ? ' row--on' : ''}`} onClick={() => setSticker(v)}>
                  <span class="row__ic">
                    <Icon name={isRidden(v.vehicleClass) ? 'bike' : 'truck'} size={24} />
                  </span>
                  <span class="row__body">
                    <span class="row__t">{v.plate}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <Button variant="link" onClick={() => setSticker(null)}>
            {t('driver.close')}
          </Button>
        </Sheet>
      ) : null}

      <Card label={state.vehicles.length ? t('driver.home.orScan') : undefined}>
        <ScanField
          id="qr"
          label={t('driver.home.qrLabel')}
          value={state.form.vehicleQr}
          onValue={(v) => {
            actions.setForm({ vehicleQr: v.trim() });
            if (v.trim()) setVehicleId(null); // a scanned dashboard wins over a remembered plate
          }}
          expect="vehicle"
          placeholder={t('driver.home.qrPlaceholder', { place: stickerPlace(namedClass, t) })}
          enterKeyHint="go"
        />
        <p class="card__note">{t('driver.home.qrNote')}</p>
      </Card>

      {/* Where the shift is going. It is what decides which loads reach this driver at all — near is only
          half the question, and the roads they already run are one tap instead of naming two places. */}
      {state.legs.length ? (
        <Card label={t('driver.home.whereToday')}>
          <div class="rows" role="list">
            {state.legs.map((l, i) => (
              <button
                key={`${l.fromLabel}-${l.toLabel}`}
                type="button"
                class={`row${legIndex === i ? ' row--on' : ''}`}
                role="listitem"
                aria-pressed={legIndex === i}
                onClick={() => setLegIndex(legIndex === i ? null : i)}
              >
                <span class="row__ic">
                  <Icon name={legIndex === i ? 'check' : 'route'} size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t">{t('driver.home.legLine', { from: l.fromLabel, to: l.toLabel })}</span>
                </span>
              </button>
            ))}
          </div>
          <p class="card__note">{t('driver.home.whereTodayNote')}</p>
        </Card>
      ) : null}

      <div class="scr__cta">
        {/* THE DAILY CHECK: any time before the shift, and on its own where the fleet asks for one. */}
        <Button variant="outline" chevron={false} disabled={!vehicleId && !state.form.vehicleQr.trim()} onClick={() => setCheckOpen(true)}>
          {t('driver.check.open')}
        </Button>
        <Button
          onClick={() => {
            setPin('');
            setRefused(null);
            setPinOpen(true);
          }}
          disabled={!ready || (!vehicleId && !state.form.vehicleQr.trim())}
          busy={state.busy === 'start'}
        >
          {t('driver.home.startShift')}
        </Button>
      </div>

      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title={t('driver.home.pinTitle')}>
        <p class="t-body">{t('driver.home.pinWhy')}</p>
        {/* The server's own sentence for a refused start (a lapsed paper, rest owed, somebody else's vehicle); our
            own words for a wrong PIN, which say what the next wrong one costs. */}
        {refused ? refused.code === 'PIN_WRONG' || refused.code === 'PIN_LOCKED' ? <ErrorNote error={refused} /> : <RefusalNote error={refused} /> : null}
        {refused?.code === 'PIN_LOCKED' ? <p class="hint">{t('driver.home.pinLocked')}</p> : null}
        {/* THE ODOMETER, read as the day starts: optional, and how the office knows when a service is due. */}
        <div class="field">
          <label class="field__label" for="shift-odo">
            {t('driver.home.odoLabel')}
          </label>
          <input id="shift-odo" class="input input--mono" inputMode="numeric" autoComplete="off" value={odo} placeholder={t('driver.home.odoPh')} onInput={(e) => setOdo(e.currentTarget.value)} />
          <span class="hint">{t('driver.home.odoHint')}</span>
        </div>
        <div class="field">
          <span class="field__label">{t('driver.home.pinLabel')}</span>
          <CodeBoxes id="shift-pin" label={t('driver.home.pinLabel')} length={PIN_LENGTH} value={pin} onInput={setPin} disabled={state.busy === 'start'} mask />
        </div>
        <Button
          chevron={false}
          disabled={pin.length !== PIN_LENGTH}
          busy={state.busy === 'start'}
          onClick={async () => {
            const failed = await actions.startShift(pin, vehicleId ?? undefined, leg && { fromLabel: leg.fromLabel, from: leg.from, toLabel: leg.toLabel, to: leg.to }, odometerOf(odo));
            setPin('');
            // The fleet asks for a check first: the check opens, instead of a refusal to read.
            if ((failed as SbgError | null)?.code === 'VEHICLE_CHECK_NEEDED') {
              setPinOpen(false);
              setCheckOpen(true);
              return;
            }
            setRefused(failed);
            if (!failed) {
              setPinOpen(false);
              setOdo('');
            }
          }}
        >
          {t('driver.home.startShift')}
        </Button>
        <Button variant="link" onClick={() => setPinOpen(false)}>
          {t('driver.close')}
        </Button>
      </Sheet>

      <VehicleCheckSheet open={checkOpen} pick={vehicleId ? { vehicleId } : { vehicleQr: state.form.vehicleQr.trim() }} actions={actions} onClose={() => setCheckOpen(false)} />

      <ExplainerBlock who={state.driver?.did} id="driver.shift.what">
        <Card title={t('driver.home.whatHappens')} tone="soft">
          <Checklist
            items={[
              t('driver.home.scan1', { vehicle }),
              t('driver.home.scan2'),
              t('driver.home.scan3', { vehicle }),
            ]}
          />
        </Card>
      </ExplainerBlock>

      {/* HELP, "STOP SHOWING ME THIS" AND SIGN OUT USED TO SIT HERE, loose, at the bottom of a screen a
          driver had to scroll to — and again on the other face of it, arranged differently. They belong
          to the person rather than to the shift, so they are in the account menu in the bar now.
          READ ALOUD STAYS: it reads out what is on THIS screen, so it is a control of the screen. */}
      <div class="scr__foot">
        <ReadAloud text={() => offShiftSummary(t)} label={t('driver.readAloud')} />
      </div>
    </div>
  );
}

/**
 * GETTING CLEARED, FOR SOMEBODY WHO HAS NOBODY TO DO IT FOR THEM.
 *
 * Anything heavier than a motorcycle puts a courier in the heavy registry, which starts at DRAFT and
 * needs an ID copy and a licence copy read by network staff. A fleet driver's office sends those. An
 * INDEPENDENT courier has no office — and until this card there was nothing on their screen but a
 * sentence telling them to wait for one, which is why signing up on your own looked impossible.
 *
 * Shown only to a courier with no fleet behind them, and only while they are not yet cleared. A driver
 * whose documents are with staff sees that they are, and no button: sending them twice is not an action.
 */
function Clearance({ state, actions }: HomeScreenProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [idCopy, setIdCopy] = useState('');
  const [licenceCopy, setLicenceCopy] = useState('');
  const driver = state.driver;
  // A fleet driver's papers are their office's business; a SUSPENDED one is not a paperwork problem.
  if (!driver || driver.managerDid || driver.removedFrom || driver.status === 'ACTIVE' || driver.status === 'SUSPENDED') return null;

  if (driver.status === 'KYC_PENDING') {
    return <Note tone="info" icon="check" title={t('driver.clearance.pendingTitle')} detail={t('driver.clearance.pendingBody')} />;
  }

  return (
    <>
      <Note tone="warn" icon="badge" title={t('driver.clearance.needTitle')} detail={t('driver.clearance.needBody')} />
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t('driver.clearance.send')}
      </Button>

      {open ? (
        <Sheet open onClose={() => setOpen(false)} title={t('driver.clearance.send')}>
          <p class="t-body">{t('driver.clearance.sheetBody')}</p>
          <PhotoField id="kyc-id" value={idCopy} label={t('driver.clearance.idPhoto')} upload={(file) => actions.uploadPhoto('kyc_id', file)} onCapture={setIdCopy} />
          <PhotoField id="kyc-licence" value={licenceCopy} label={t('driver.clearance.licencePhoto')} upload={(file) => actions.uploadPhoto('kyc_licence', file)} onCapture={setLicenceCopy} />
          <Button
            chevron={false}
            disabled={!idCopy || !licenceCopy}
            busy={state.busy === 'clearance'}
            onClick={async () => {
              const ok = await actions.sendClearance({ idCopyRef: idCopy, licenceCopyRef: licenceCopy });
              if (!ok) return;
              setOpen(false);
              setIdCopy('');
              setLicenceCopy('');
            }}
          >
            {t('driver.clearance.submit')}
          </Button>
          <Button variant="link" onClick={() => setOpen(false)}>
            {t('driver.notYet')}
          </Button>
        </Sheet>
      ) : null}
    </>
  );
}

/**
 * FP4 — THE RENEWED CARD, sent from here: by a courier who rides on their own to the network's staff, and
 * by a fleet's driver to their own fleet's office. The same card, the same button, the same three states;
 * only the name of who reads it changes (cardWords).
 *
 * A courier was once told to "show the fleet office", which they do not have. A fleet driver was told the
 * same, and had one — which then typed a date off a card it may never have seen. So the card travels as a
 * photograph, with the date its owner read off it, and waits until whoever records their licence reads the
 * same photograph.
 *
 * Shown only when there is something to do or something to know: a licence running out or lapsed, a card
 * waiting to be checked, or a card that was not accepted and why. A driver whose licence is fine sees
 * nothing here at all.
 */
function LicenceRenewal({ state, actions, needed, reader }: HomeScreenProps & { needed: boolean; reader: CardReader }) {
  const t = useT();
  const words = cardWords(reader);
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [number, setNumber] = useState('');
  const pending = state.driver?.licenceRenewal;
  const refusal = state.driver?.licenceRenewalRefusal;
  if (!pending && !refusal && !needed) return null;
  // The server refuses a date already past as the typo it is; the form says so by not letting it through.
  const ready = Boolean(photo) && Boolean(expiresAt) && expiresAt > isoDay(new Date());

  return (
    <>
      {pending ? (
        <Note tone="info" icon="check" title={t('driver.licence.pendingTitle', { date: formatDate(pending.sentAt) })} detail={t(words.pending, { expires: paperDay(pending.expiresAt) })} />
      ) : refusal ? (
        // The reason is the own sentence of whoever read the card, written for this driver — shown as it was written.
        <Note tone="warn" icon="warning" title={t('driver.licence.refusedTitle')} detail={refusal.reason} />
      ) : null}
      <Button variant={pending ? 'link' : 'outline'} full={!pending} onClick={() => setOpen(true)}>
        {t(pending ? 'driver.licence.sendAgain' : refusal ? 'driver.licence.sendNew' : 'driver.licence.send')}
      </Button>

      {open ? (
        <Sheet open onClose={() => setOpen(false)} title={t('driver.licence.send')}>
          <p class="t-body">{t(words.sheetBody)}</p>
          <PhotoField id="licence-photo" value={photo} label={t('driver.licence.photo')} upload={(file) => actions.uploadPhoto('kyc_licence', file)} onCapture={setPhoto} />
          <label class="field">
            <span class="field__label">{t('driver.licence.expires')}</span>
            <input class="input" type="date" min={isoDay(new Date(Date.now() + 86_400_000))} value={expiresAt} onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field">
            <span class="field__label">{t('driver.licence.number')}</span>
            <input class="input" value={number} autoComplete="off" onInput={(e) => setNumber((e.target as HTMLInputElement).value)} />
          </label>
          <Button
            chevron={false}
            disabled={!ready}
            busy={state.busy === 'licence'}
            onClick={async () => {
              const ok = await actions.sendLicenceRenewal({ copyRef: photo, expiresAt, ...(number.trim() ? { number: number.trim() } : {}) });
              if (!ok) return;
              setOpen(false);
              setPhoto('');
              setExpiresAt('');
              setNumber('');
            }}
          >
            {t('driver.licence.submit')}
          </Button>
          <Button variant="link" onClick={() => setOpen(false)}>
            {t('driver.notYet')}
          </Button>
        </Sheet>
      ) : null}
    </>
  );
}

/** A calendar day as the phone reckons it, in the form a date input and the server both read. */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * How this shift takes work, and the one control that stops it for a while.
 *
 * The declaration and the snooze belong on the same card because they answer the same question — what will
 * reach me right now — and a driver who wants to be left alone should not have to hunt for it in a settings
 * screen. The duration is chosen at the moment of snoozing: it is the only moment anyone knows how long they
 * need, and picking it there is also what lets most snoozes end by themselves.
 */
function WorkCard({ state, actions }: HomeScreenProps) {
  const t = useT();
  const [ask, setAsk] = useState(false);
  const [askFloor, setAskFloor] = useState(false);
  const [floorDraft, setFloorDraft] = useState('');
  const work = state.session.assignment?.work;
  const quiet = state.session.quiet;
  const until = state.session.assignment?.snoozedUntil;
  const snoozed = !!until && new Date(until).getTime() > Date.now();

  if (snoozed) {
    return (
      <Card label={t('driver.home.snoozeLabel')}>
        <p class="t-body">{t('driver.home.snoozedUntil', { time: formatDate(until!, { timeStyle: 'short' }) })}</p>
        {/* Say what it does NOT stop: a driver holding a bag must never wonder if they have abandoned it. */}
        <p class="card__note">{t('driver.home.snoozedNote')}</p>
        <Button variant="outline" chevron={false} busy={state.busy === 'snooze'} onClick={() => void actions.resumeWork()}>
          {t('driver.home.resumeNow')}
        </Button>
      </Card>
    );
  }

  return (
    <Card label={t('driver.home.headingLabel')}>
      <p class="t-body">
        {work?.kind === 'area'
          ? t('driver.home.workArea', { km: work.radiusKm })
          : work
            ? t('driver.home.legLine', { from: work.fromLabel, to: work.toLabel })
            : t('driver.home.headingUnset')}
      </p>
      {/* Whose road this is. An inference shown as the driver's own decision is a lie about who chose, so a
          road we worked out says so and carries its own way out — a switch, not a question, because taking
          the load already answered the question and asking again in a moving vehicle spends an
          interruption on something we know. */}
      <p class="card__note">
        {work?.kind === 'leg' && work.source === 'derived'
          ? t('driver.home.headingDerivedNote')
          : work
            ? t('driver.home.headingNote')
            : t('driver.home.headingUnsetNote')}
      </p>
      {work?.kind === 'leg' && work.source === 'derived' ? (
        <Button variant="outline" chevron={false} full={false} busy={state.busy === 'derived-leg'} onClick={() => void actions.setDerivedLeg(false)}>
          {t('driver.home.headingDerivedOff')}
        </Button>
      ) : null}
      {/* The way back, for a driver who switched it off and changed their mind. Only shown once it IS off,
          so it is never a control looking for a problem. */}
      {state.session.assignment?.derivedLegOff ? (
        <Button variant="link" full={false} busy={state.busy === 'derived-leg'} onClick={() => void actions.setDerivedLeg(true)}>
          {t('driver.home.headingDerivedOn')}
        </Button>
      ) : null}
      <Button variant="link" full={false} onClick={() => actions.go('route')}>
        {work ? t('driver.home.headingChange') : t('driver.home.headingSet')}
      </Button>
      {/* FP8 — the shift clock, where the shift is. A limit nobody can see coming is a refusal nobody understands. */}
      {state.session.hours ? <p class={state.session.hours.over ? 'card__note row__s--danger' : 'card__note'}>{hoursWords(state.session.hours, t)}</p> : null}
      {/* Round 11 — their fleet's own system is told where they are. The fleet's choice; said to the driver for as long as it applies. */}
      {state.session.positionsToFleetSystem ? (
        <p class="card__note">{t('driver.home.positionsToFleet', { fleet: state.session.positionsToFleetSystem.fleetName, n: state.session.positionsToFleetSystem.everyMin })}</p>
      ) : null}
      {/* Round 16 — the fleet's watch on a vehicle standing still: said to the one it watches, while it watches. */}
      {state.session.active && state.session.standstillWatchMin ? <p class="card__note">{t('driver.home.standstillWatch', { n: state.session.standstillWatchMin })}</p> : null}
      {/* Round 17 — and its watch on a phone gone silent: the driver learns the app must stay open to be heard. */}
      {state.session.active && state.session.silentWatchMin ? <p class="card__note">{t('driver.home.silentWatch', { n: state.session.silentWatchMin })}</p> : null}
      {/* The standing floor, and — the half that makes it safe to be standing — what it kept quiet today.
          A silencer nobody can see working is how somebody hears nothing for a week and blames us, so the
          setting and its effect are one line, never a number buried in a settings screen. */}
      <p class="card__note">
        {quiet?.floor ? t('driver.home.minEarnSet', { amount: String(quiet.floor) }) : t('driver.home.minEarnUnset')}
        {quiet?.floor && quiet.belowFloor > 0
          ? ` ${quiet.belowFloor === 1 ? t('driver.home.minEarnQuietedOne') : t('driver.home.minEarnQuietedMany', { count: quiet.belowFloor })}`
          : ''}
      </p>
      {/* The OTHER silence, and the one nobody was ever told about: priced above what shippers will pay.
          Said as a consequence for THEM, never as a benchmark against anybody else — an average rate
          pushed at independent operators is price signalling however kindly it is worded, and warning only
          the dear ones would be the network leaning on prices in its own favour. Shown only once enough
          loads have been refused for it to mean anything, and only to the driver who actually holds the
          lever: a fleet driver's rate belongs to their manager. */}
      {quiet?.rateLooksHigh && quiet.rateIsYours ? (
        <Note
          tone="warn"
          icon="wallet"
          title={t('driver.home.rateHighTitle', { count: quiet.overBudget })}
          detail={quiet.ratePerKm ? t('driver.home.rateHighDetail', { rate: String(quiet.ratePerKm) }) : t('driver.home.rateHighDetailNoRate')}
        />
      ) : null}
      <Button
        variant="link"
        full={false}
        onClick={() => {
          setFloorDraft(quiet?.floor ? String(quiet.floor) : '');
          setAskFloor(true);
        }}
      >
        {quiet?.floor ? t('driver.home.minEarnChange') : t('driver.home.minEarnSetCta')}
      </Button>
      <Button variant="link" full={false} onClick={() => setAsk(true)}>
        {t('driver.home.snoozeNew')}
      </Button>

      <Sheet open={askFloor} onClose={() => setAskFloor(false)} title={t('driver.home.minEarnSheetTitle')}>
        <p class="t-body">{t('driver.home.minEarnSheetBody')}</p>
        <div class="field">
          <label class="field__label" for="nudge-min-earn">
            {t('driver.home.minEarnFieldLabel')}
          </label>
          <input
            id="nudge-min-earn"
            class="input"
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={floorDraft}
            placeholder={t('driver.home.minEarnPlaceholder')}
            onInput={(e) => setFloorDraft(e.currentTarget.value)}
          />
        </div>
        {/* Clearing is the same control, not a different screen — a driver must never have to hunt for the
            way out of a setting that is making their phone quiet. */}
        {/* The SAME parser the work-search box uses. Two boxes a driver types a minimum into must not
            disagree about what "0", a blank or a stray minus sign mean — and this one is the parser that
            already refuses a negative before the backend's @Min(0) can 400 on it. */}
        <Button
          busy={state.busy === 'min-earn'}
          chevron={false}
          onClick={() => {
            setAskFloor(false);
            void actions.setMinEarn(minEarnFilter(floorDraft));
          }}
        >
          {minEarnFilter(floorDraft) ? t('driver.home.minEarnSave') : t('driver.home.minEarnClear')}
        </Button>
      </Sheet>

      <Sheet open={ask} onClose={() => setAsk(false)} title={t('driver.home.snoozeSheetTitle')}>
        <p class="t-body">{t('driver.home.snoozeSheetBody')}</p>
        <div class="rows">
          {[
            { minutes: 30, key: 'driver.home.snooze30' as const },
            { minutes: 60, key: 'driver.home.snooze60' as const },
            { minutes: undefined, key: 'driver.home.snoozeOpen' as const },
          ].map((choice) => (
            <button
              key={choice.key}
              type="button"
              class="row"
              onClick={() => {
                setAsk(false);
                void actions.snoozeWork(choice.minutes);
              }}
            >
              <span class="row__ic"><Icon name="clock" size={24} /></span>
              <span class="row__body"><span class="row__t">{t(choice.key)}</span></span>
              <span class="row__end"><Icon name="chevronRight" size={22} /></span>
            </button>
          ))}
        </div>
        <p class="card__note">{t('driver.home.snoozeSheetNote')}</p>
        <Button variant="link" onClick={() => setAsk(false)}>{t('driver.notYet')}</Button>
      </Sheet>
    </Card>
  );
}

/* =============================================================== on shift == */

function OnShift({ state, actions, onOpenFleet, sbg }: HomeScreenProps) {
  const t = useT();
  const [confirm, setConfirm] = useState<'end' | 'rate' | null>(null);
  const [endOdo, setEndOdo] = useState('');
  const [defectOpen, setDefectOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const shown = badgeToShow(state.session, state.driver?.badgeId);
  const v = state.vehicle!;
  const band = rateBand(v.pricePerKm, state.rates?.benchmark, t, state.rates?.currency);
  const pct = usedPercent(v.capacityKg, state.remaining);

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}
      {/* Round 39 — on shift too: a load is refused without it, and the refusal says it is signed here. */}
      {state.driver && !state.driver.managerDid ? <DeclarationCard sbg={sbg ?? null} /> : null}
      <FleetOfferNote state={state} onOpenFleet={onOpenFleet} />
      <DarkSpellNote />
      {/* FP8 — over the shift limit: said once, at the top, with what still happens (deliveries) and what does not
          (new loads). The board and the offers say it again in their own place. */}
      {state.session.hours?.over ? (
        <Note tone="danger" icon="clock" title={t('driver.home.hoursOverTitle')} detail={t('driver.home.hoursOverDetail', { limit: state.session.hours.limit, rest: state.session.hours.restHours })} />
      ) : null}

      {/* The one big number: how much room is left, readable at arm's length. */}
      <GlanceNumber
        label={t('driver.home.spaceLabel', { vehicle: vehicleWord(v.vehicleClass, t) })}
        value={state.remaining}
        unit="kg"
        percent={pct}
        alert={isFull(state.remaining) || state.remainingTotes === 0}
        sub={capacitySubLine(state.remaining, v.capacityKg, state.claims.length, t, state.remainingTotes ?? undefined, vehicleWord(v.vehicleClass, t))}
      />

      <Card
        title={t('driver.home.yourVehicle')}
        aside={v.verified ? <Pill tone="ok">{t('driver.home.checked')}</Pill> : <Pill tone="idle">{t('driver.home.notChecked')}</Pill>}
      >
        <p class="plate">{v.plate}</p>
        <p class="veh__class">
          {v.vehicleClass}
          {v.truckSubtype ? ` · ${v.truckSubtype.replace(/_/g, ' ')}` : ''}
          {t('driver.home.carriesUpTo', { kg: v.capacityKg })}
        </p>
        <Button variant="link" full={false} onClick={() => setDefectOpen(true)}>
          {t('driver.defect.open')}
        </Button>
        <Button variant="link" full={false} onClick={() => setBreakdownOpen(true)}>
          {t('driver.brk.open')}
        </Button>
        <TakeOverLink actions={actions} courier={!state.driver?.managerDid} />
        <Button variant="link" full={false} danger onClick={() => setConfirm('end')}>
          {t('driver.home.endMyShift')}
        </Button>
        <ReportDefectSheet open={defectOpen} actions={actions} onClose={() => setDefectOpen(false)} />
        <BreakdownSheet open={breakdownOpen} actions={actions} onClose={() => setBreakdownOpen(false)} courier={!state.driver?.managerDid} />
      </Card>

      {band ? (
        <Card title={t('driver.home.priceTitle')} label={t('driver.home.priceLabel')}>
          <p class="t-body">{band.headline}</p>
          <p class="card__note">{band.detail}</p>
          {band.showMatch ? (
            <Button variant="link" full={false} onClick={() => setConfirm('rate')}>
              {t('driver.home.matchPerKm', { label: band.matchLabel })}
            </Button>
          ) : null}
        </Card>
      ) : null}

      {/* How this shift takes work — the thing that decides which loads are pushed at this driver. Shown
          because a stale declaration is worse than none: after turning round, or stopping for lunch, it must
          be easy to see and to change. */}
      <WorkCard state={state} actions={actions} />

      <div class="scr__cta">
        <Button onClick={() => actions.go('route')}>{t('driver.home.findWork')}</Button>
      </div>

      {state.route ? (
        <Button variant="outline" busy={state.busy === 'suggest'} onClick={() => void actions.repeatRoute()}>
          {t('driver.repeat', { from: state.route.fromLabel, to: state.route.toLabel })}
        </Button>
      ) : null}

      <button type="button" class="row" onClick={() => actions.go('loads')}>
        <span class="row__ic">
          <Icon name="box" size={24} />
        </span>
        <span class="row__body">
          <span class="row__t">{t('driver.nav.loads')}</span>
          <span class="row__s">{t('driver.home.myLoadsSub')}</span>
        </span>
        <span class="row__end">
          {state.claims.length ? <span class="row__count">{state.claims.length}</span> : null}
          <Icon name="chevronRight" size={22} />
        </span>
      </button>

      {/* The badge is what a shop or hub scans to hand parcels over — it must be
          showable, not just stored. What it shows is this shift's pass, never the bare number. */}
      {shown ? (
        <button
          type="button"
          class="row"
          onClick={() => {
            setBadgeOpen(true);
            // A counter that got the code wrong five times has had it replaced: show the one in force.
            void actions.refresh();
          }}
        >
          <span class="row__ic">
            <Icon name="badge" size={24} />
          </span>
          <span class="row__body">
            <span class="row__t">{t('driver.home.showBadge')}</span>
            <span class="row__s">{t('driver.home.showBadgeSub')}</span>
          </span>
          <span class="row__end">
            <Icon name="chevronRight" size={22} />
          </span>
        </button>
      ) : null}

      <div class="scr__foot">
        <ReadAloud text={() => shiftSummary(v.plate, state.remaining, state.claims.length, t)} />
      </div>

      <Sheet open={badgeOpen && Boolean(shown)} onClose={() => setBadgeOpen(false)} title={t('driver.home.badgeSheetTitle')}>
        <p class="t-body">{t('driver.home.badgeBody')}</p>
        {shown ? (
          <QrBlock value={qrPayload('badge', shown.pass)} size={188} caption={shown.pass} label={t('driver.home.badgeQrLabel', { id: shown.pass })} />
        ) : null}
        <Checklist items={[t('driver.home.badgeShift'), t('driver.home.badge1'), t('driver.home.badge2')]} />
        <Button variant="link" onClick={() => setBadgeOpen(false)}>
          {t('driver.close')}
        </Button>
      </Sheet>

      <Sheet open={confirm === 'end'} onClose={() => setConfirm(null)} title={t('driver.home.endSheetTitle')}>
        <p class="t-body">{t('driver.home.endBody', { plate: v.plate })}</p>
        <Checklist items={[t('driver.home.end1'), afterShiftLine(state.session.hours, t)]} />
        <div class="field">
          <label class="field__label" for="end-odo">
            {t('driver.home.odoEndLabel')}
          </label>
          <input id="end-odo" class="input input--mono" inputMode="numeric" autoComplete="off" value={endOdo} placeholder={t('driver.home.odoPh')} onInput={(e) => setEndOdo(e.currentTarget.value)} />
          <span class="hint">{t('driver.home.odoEndHint')}</span>
        </div>
        <Button
          chevron={false}
          busy={state.busy === 'end'}
          onClick={() => {
            setConfirm(null);
            void actions.endShift(odometerOf(endOdo));
            setEndOdo('');
          }}
        >
          {t('driver.home.endConfirm')}
        </Button>
        <Button variant="link" onClick={() => setConfirm(null)}>
          {t('driver.home.keepDriving')}
        </Button>
      </Sheet>

      <Sheet open={confirm === 'rate'} onClose={() => setConfirm(null)} title={t('driver.home.rateSheetTitle')}>
        {band ? (
          <>
            <p class="t-body">{t('driver.home.rateBody', { price: band.matchText })}</p>
            <Checklist items={[t('driver.home.rate1'), t('driver.home.rate2')]} />
            <Button
              chevron={false}
              busy={state.busy === 'rate'}
              onClick={() => {
                setConfirm(null);
                void actions.matchRate(v.vehicleId, band.matchPrice);
              }}
            >
              {t('driver.home.setPerKm', { price: band.matchText })}
            </Button>
            <Button variant="link" onClick={() => setConfirm(null)}>
              {t('driver.home.leavePrice')}
            </Button>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
