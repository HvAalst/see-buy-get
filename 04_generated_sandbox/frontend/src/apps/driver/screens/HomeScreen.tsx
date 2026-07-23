import { useState } from 'preact/hooks';
import { Button, Card, Checklist, ErrorNote, GlanceNumber, Icon, Note, Pill, QrBlock, ReadAloud, ScanField, Sheet } from '../../../shared/ui';
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
  const notice = driverStatusNotice(state.driver?.status);
  const ready = canStartShift(state.driver?.status);

  return (
    <div class="scr">
      <h1 class="scr__title">Start your shift</h1>
      <p class="scr__lede">Scan the QR sticker on the dashboard of the vehicle you are driving today.</p>

      {notice ? <Note tone="warn" icon="clock" title="Not activated yet" detail={notice} /> : null}
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      <Card>
        <ScanField
          id="qr"
          label="Vehicle QR"
          value={state.form.vehicleQr}
          onValue={(v) => actions.setForm({ vehicleQr: v.trim() })}
          expect="vehicle"
          placeholder="Scan the code on the dashboard"
          enterKeyHint="go"
        />
        <p class="card__note">Scanning the dashboard sticker couples you to that vehicle for the day.</p>
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.startShift()} disabled={!ready} busy={state.busy === 'start'}>
          Start shift
        </Button>
      </div>

      <Card title="What happens when you scan" tone="soft">
        <Checklist
          items={[
            'This van becomes yours for the day',
            'You can pick up loads on your route',
            'End the shift to hand the van back',
          ]}
        />
      </Card>

      <div class="scr__foot">
        <ReadAloud text={offShiftSummary} label="Read this aloud" />
        <Button variant="link" full={false} onClick={actions.signOut}>
          Not you? Sign out
        </Button>
      </div>
    </div>
  );
}

/* =============================================================== on shift == */

function OnShift({ state, actions }: HomeScreenProps) {
  const [confirm, setConfirm] = useState<'end' | 'rate' | null>(null);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const v = state.vehicle!;
  const band = rateBand(v.pricePerKm, state.rates?.benchmark);
  const pct = usedPercent(v.capacityKg, state.remaining);

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      {/* The one big number: how much room is left, readable at arm's length. */}
      <GlanceNumber
        label="Space left on the van"
        value={state.remaining}
        unit="kg"
        percent={pct}
        alert={isFull(state.remaining)}
        sub={capacitySubLine(state.remaining, v.capacityKg, state.claims.length)}
      />

      <Card
        label="Your vehicle"
        aside={v.verified ? <Pill tone="ok">Checked</Pill> : <Pill tone="idle">Not checked</Pill>}
      >
        <p class="plate">{v.plate}</p>
        <p class="veh__class">
          {v.vehicleClass}
          {v.truckSubtype ? ` · ${v.truckSubtype.replace(/_/g, ' ')}` : ''}
          {` · carries up to ${v.capacityKg} kg`}
        </p>
        <Button variant="link" full={false} danger onClick={() => setConfirm('end')}>
          End my shift
        </Button>
      </Card>

      {band ? (
        <Card title="Your price" label="Your per-kilometre price">
          <p class="t-body">{band.headline}</p>
          <p class="card__note">{band.detail}</p>
          {band.showMatch ? (
            <Button variant="link" full={false} onClick={() => setConfirm('rate')}>
              {band.matchLabel} per km
            </Button>
          ) : null}
        </Card>
      ) : null}

      <div class="scr__cta">
        <Button onClick={() => actions.go('route')}>Find work on my route</Button>
      </div>

      {state.route ? (
        <Button variant="outline" busy={state.busy === 'suggest'} onClick={() => void actions.repeatRoute()}>
          {`Repeat: ${state.route.fromLabel} → ${state.route.toLabel}`}
        </Button>
      ) : null}

      <button type="button" class="row" onClick={() => actions.go('loads')}>
        <span class="row__ic">
          <Icon name="box" size={24} />
        </span>
        <span class="row__body">
          <span class="row__t">My loads</span>
          <span class="row__s">Claimed shipments — load them on</span>
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
            <span class="row__t">Show my badge</span>
            <span class="row__s">For the shop or hub to scan at pick-up</span>
          </span>
          <span class="row__end">
            <Icon name="chevronRight" size={22} />
          </span>
        </button>
      ) : null}

      <div class="scr__foot">
        <ReadAloud text={() => shiftSummary(v.plate, state.remaining, state.claims.length)} />
      </div>

      <Sheet open={badgeOpen} onClose={() => setBadgeOpen(false)} title="Your driver badge">
        <p class="t-body">Hold this up at the counter. The shop or hub scans it to hand you their parcels.</p>
        <QrBlock
          value={qrPayload('badge', state.driver!.badgeId!)}
          size={188}
          caption={state.driver!.badgeId}
          label={`Driver badge ${state.driver!.badgeId} as a scannable code`}
        />
        <Checklist items={['Works with no signal', 'They can also type the code under it']} />
        <Button variant="link" onClick={() => setBadgeOpen(false)}>
          Close
        </Button>
      </Sheet>

      <Sheet open={confirm === 'end'} onClose={() => setConfirm(null)} title="End your shift?">
        <p class="t-body">{`${v.plate} goes back to the fleet. You will not be offered any more work today.`}</p>
        <Checklist items={['Anything already on board stays your job', 'You can start a new shift any time']} />
        <Button
          chevron={false}
          busy={state.busy === 'end'}
          onClick={() => {
            setConfirm(null);
            void actions.endShift();
          }}
        >
          Yes, end my shift
        </Button>
        <Button variant="link" onClick={() => setConfirm(null)}>
          Keep driving
        </Button>
      </Sheet>

      <Sheet open={confirm === 'rate'} onClose={() => setConfirm(null)} title="Match the market price?">
        {band ? (
          <>
            <p class="t-body">{`Your price changes to ${band.matchPrice.toFixed(3)} per kilometre — what most drivers charge.`}</p>
            <Checklist items={['Shippers compare prices before offering work', 'You can change it back any time']} />
            <Button
              chevron={false}
              busy={state.busy === 'rate'}
              onClick={() => {
                setConfirm(null);
                void actions.matchRate(v.vehicleId, band.matchPrice);
              }}
            >
              {`Set ${band.matchPrice.toFixed(3)} per km`}
            </Button>
            <Button variant="link" onClick={() => setConfirm(null)}>
              Leave my price alone
            </Button>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
