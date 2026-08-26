import { useState } from 'preact/hooks';
import { Button, Card, Checklist, ErrorNote, GlanceNumber, Icon, Note, Pill, QrBlock, ReadAloud, ScanField, Sheet } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import { qrPayload } from '../../../shared/qr';
import {
  canStartShift,
  capacitySubLine,
  driverStatusNotice,
  isFull,
  offShiftSummary,
  rateBand,
  shiftSummary,
  usedPercent,
} from '../logic';
import type { DriverActions, DriverState } from '../useDriverApp';

export interface HomeScreenProps {
  state: DriverState;
  actions: DriverActions;
}

export function HomeScreen({ state, actions }: HomeScreenProps) {
  return state.session.active && state.vehicle ? <OnShift state={state} actions={actions} /> : <OffShift state={state} actions={actions} />;
}

/* ============================================================== off shift == */

function OffShift({ state, actions }: HomeScreenProps) {
  const t = useT();
  const notice = driverStatusNotice(state.driver?.status, t);
  const ready = canStartShift(state.driver?.status);
  // Which of this driver's usual roads they are running today. Optional: a driver who does not yet know
  // starts the shift anyway and says it later, when they look for work.
  const [legIndex, setLegIndex] = useState<number | null>(null);
  const leg = legIndex != null ? state.legs[legIndex] : undefined;
  // Which vehicle, before walking to it. A driver opens the app over a coffee; the one they drove yesterday
  // is one tap, and the dashboard QR below stays the way a NEW vehicle joins the list.
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const free = state.vehicles.filter((v) => !v.busy);

  return (
    <div class="scr">
      <h1 class="scr__title">{t('driver.home.startTitle')}</h1>
      <p class="scr__lede">{t('driver.home.startLede')}</p>

      {notice ? <Note tone="warn" icon="clock" title={t('driver.home.notActivated')} detail={notice} /> : null}
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      {/* Your own vehicles first — the morning question is "which one today?", and it has an answer before
          the driver has walked anywhere. One in use by someone else is shown and blocked, never hidden. */}
      {state.vehicles.length ? (
        <Card label={t('driver.home.whichVehicle')}>
          <div class="rows" role="list">
            {state.vehicles.map((v) => (
              <button
                key={v.vehicleId}
                type="button"
                class={`row${vehicleId === v.vehicleId ? ' row--on' : ''}`}
                role="listitem"
                aria-pressed={vehicleId === v.vehicleId}
                disabled={v.busy}
                onClick={() => setVehicleId(vehicleId === v.vehicleId ? null : v.vehicleId)}
              >
                <span class="row__ic">
                  <Icon name={vehicleId === v.vehicleId ? 'check' : 'truck'} size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t">{v.plate}</span>
                  <span class="row__s">
                    {v.vehicleClass}
                    {v.truckSubtype ? ` · ${v.truckSubtype.replace(/_/g, ' ')}` : ''}
                    {t('driver.home.carriesUpTo', { kg: v.capacityKg })}
                  </span>
                </span>
                {v.busy ? <Pill tone="warn" dot>{t('driver.home.vehicleBusy')}</Pill> : null}
              </button>
            ))}
          </div>
          {free.length === 0 ? <p class="card__note">{t('driver.home.allBusy')}</p> : null}
        </Card>
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
          placeholder={t('driver.home.qrPlaceholder')}
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
        <Button
          onClick={() => void actions.startShift(vehicleId ?? undefined, leg && { fromLabel: leg.fromLabel, from: leg.from, toLabel: leg.toLabel, to: leg.to })}
          disabled={!ready || (!vehicleId && !state.form.vehicleQr.trim())}
          busy={state.busy === 'start'}
        >
          {t('driver.home.startShift')}
        </Button>
      </div>

      <Card title={t('driver.home.whatHappens')} tone="soft">
        <Checklist
          items={[
            t('driver.home.scan1'),
            t('driver.home.scan2'),
            t('driver.home.scan3'),
          ]}
        />
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => offShiftSummary(t)} label={t('driver.readAloud')} />
        <Button variant="link" full={false} onClick={actions.signOut}>
          {t('driver.home.notYou')}
        </Button>
      </div>
    </div>
  );
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
  const work = state.session.assignment?.work;
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
      <p class="card__note">{work ? t('driver.home.headingNote') : t('driver.home.headingUnsetNote')}</p>
      <Button variant="link" full={false} onClick={() => actions.go('route')}>
        {work ? t('driver.home.headingChange') : t('driver.home.headingSet')}
      </Button>
      <Button variant="link" full={false} onClick={() => setAsk(true)}>
        {t('driver.home.snoozeNew')}
      </Button>

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

function OnShift({ state, actions }: HomeScreenProps) {
  const t = useT();
  const [confirm, setConfirm] = useState<'end' | 'rate' | null>(null);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const v = state.vehicle!;
  const band = rateBand(v.pricePerKm, state.rates?.benchmark, t);
  const pct = usedPercent(v.capacityKg, state.remaining);

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      {/* The one big number: how much room is left, readable at arm's length. */}
      <GlanceNumber
        label={t('driver.home.spaceLabel')}
        value={state.remaining}
        unit="kg"
        percent={pct}
        alert={isFull(state.remaining) || state.remainingTotes === 0}
        sub={capacitySubLine(state.remaining, v.capacityKg, state.claims.length, t, state.remainingTotes ?? undefined)}
      />

      <Card
        label={t('driver.home.yourVehicle')}
        aside={v.verified ? <Pill tone="ok">{t('driver.home.checked')}</Pill> : <Pill tone="idle">{t('driver.home.notChecked')}</Pill>}
      >
        <p class="plate">{v.plate}</p>
        <p class="veh__class">
          {v.vehicleClass}
          {v.truckSubtype ? ` · ${v.truckSubtype.replace(/_/g, ' ')}` : ''}
          {t('driver.home.carriesUpTo', { kg: v.capacityKg })}
        </p>
        <Button variant="link" full={false} danger onClick={() => setConfirm('end')}>
          {t('driver.home.endMyShift')}
        </Button>
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
          showable, not just stored. Typing it was the only way until now. */}
      {state.driver?.badgeId ? (
        <button type="button" class="row" onClick={() => setBadgeOpen(true)}>
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

      <Sheet open={badgeOpen} onClose={() => setBadgeOpen(false)} title={t('driver.home.badgeSheetTitle')}>
        <p class="t-body">{t('driver.home.badgeBody')}</p>
        <QrBlock
          value={qrPayload('badge', state.driver!.badgeId!)}
          size={188}
          caption={state.driver!.badgeId}
          label={t('driver.home.badgeQrLabel', { id: state.driver!.badgeId! })}
        />
        <Checklist items={[t('driver.home.badge1'), t('driver.home.badge2')]} />
        <Button variant="link" onClick={() => setBadgeOpen(false)}>
          {t('driver.close')}
        </Button>
      </Sheet>

      <Sheet open={confirm === 'end'} onClose={() => setConfirm(null)} title={t('driver.home.endSheetTitle')}>
        <p class="t-body">{t('driver.home.endBody', { plate: v.plate })}</p>
        <Checklist items={[t('driver.home.end1'), t('driver.home.end2')]} />
        <Button
          chevron={false}
          busy={state.busy === 'end'}
          onClick={() => {
            setConfirm(null);
            void actions.endShift();
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
            <p class="t-body">{t('driver.home.rateBody', { price: band.matchPrice.toFixed(3) })}</p>
            <Checklist items={[t('driver.home.rate1'), t('driver.home.rate2')]} />
            <Button
              chevron={false}
              busy={state.busy === 'rate'}
              onClick={() => {
                setConfirm(null);
                void actions.matchRate(v.vehicleId, band.matchPrice);
              }}
            >
              {t('driver.home.setPerKm', { price: band.matchPrice.toFixed(3) })}
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
