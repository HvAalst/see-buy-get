import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Explainer, Note, Pill, ReadAloud, Sheet } from '../../../shared/ui';
import { formatDate, useT, type MessageKey } from '../../../shared/i18n';
import { RUN_BASES, ownLines, runBlocker, runMoney, runRemaining, runWaits, type RunBasis } from '../logic';
import type { DepartureBookingRow, DepartureRow, WaitingRow } from '../types';
import type { FleetActions, FleetState } from '../useFleetApp';

/**
 * F3 — THE OTHER DIRECTION OF THE MARKET.
 *
 * Everything else in this product is a shipper posting a load and carriers bidding for it. That is the
 * right shape when the load is the scarce thing, and the wrong shape for a fleet that already runs Nairobi
 * to Mombasa every Tuesday with four tonnes of air in the back. The cheapest capacity in the network is a
 * departure that is leaving regardless, and until now there was no way to sell it.
 *
 * So this screen is the fleet ADVERTISING, and the four things that follow from it: declare the run, see
 * what sold, say who is driving, and settle what a delay cost.
 *
 * It is a separate tab from Lines on purpose. Drawing a line is setup — once per road, and the network has
 * to publish it. Putting a departure on one is the weekly work, and burying this week's run under a form
 * for a route that has existed for a year gets the frequencies backwards.
 */
export function RunsScreen({ state, actions }: { state: FleetState; actions: FleetActions }) {
  const t = useT();
  // Only a PUBLISHED line can carry a departure: one still proposed routes nothing, so space sold on it is
  // space that cannot be delivered. The server refuses it; this never offers it.
  const lines = ownLines(state.corridors, state.manager?.did).filter((c) => c.status === 'active');
  const runs = state.departures;
  const open = runs.filter((r) => r.status === 'open').length;

  return (
    <div class="scr">
      <h1 class="scr__title">{t('fleet.runs.title')}</h1>
      <Explainer who={state.manager?.did} id="fleet.runs.how" text={t('fleet.runs.lede')} />

      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      {runs.length === 0 ? (
        <Card>
          <p class="hint">{t('fleet.runs.none')}</p>
        </Card>
      ) : (
        runs.map((run) => <Run key={run.departureId} run={run} state={state} actions={actions} />)
      )}

      {/* No published line, no form. Offering one would be a form whose only possible outcome is a refusal,
          so the screen says what to do instead — which is on a different tab. */}
      {lines.length === 0 ? (
        <Card title={t('fleet.runs.newTitle')}>
          <p class="hint">{t('fleet.runs.noLines')}</p>
        </Card>
      ) : (
        <NewRun state={state} actions={actions} lines={lines} />
      )}

      <div class="scr__foot">
        <ReadAloud text={() => t('fleet.runs.aloud', { count: runs.length, open })} label={t('fleet.readAloud')} />
      </div>
    </div>
  );
}

const BASIS_WORD: Record<RunBasis, MessageKey> = {
  per_trip: 'fleet.runs.basisTrip',
  per_km: 'fleet.runs.basisKm',
  per_kg: 'fleet.runs.basisKg',
};

const STATUS: Record<DepartureRow['status'], { key: MessageKey; tone: 'ok' | 'info' | 'idle' | 'warn' }> = {
  open: { key: 'fleet.runs.statusOpen', tone: 'ok' },
  closed: { key: 'fleet.runs.statusClosed', tone: 'info' },
  departed: { key: 'fleet.runs.statusDeparted', tone: 'idle' },
  cancelled: { key: 'fleet.runs.statusCancelled', tone: 'warn' },
};

function Run({ run, state, actions }: { run: DepartureRow; state: FleetState; actions: FleetActions }) {
  const t = useT();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const left = runRemaining(run);
  const money = runMoney(run);
  const aboard = run.bookings.filter((b) => b.status === 'booked');
  const waits = runWaits(run);
  const status = STATUS[run.status];
  // Anybody this fleet could put on it. A driver whose papers have lapsed is refused at the coupling
  // anyway, so the roster is deliberately not a second place to re-litigate that.
  const drivers = state.drivers;

  return (
    <Card title={run.lineName}>
      <div class="crow">
        <Pill tone={status.tone} dot>
          {t(status.key)}
        </Pill>
        <span class="hint">{t('fleet.runs.leaves', { when: formatDate(run.leavesAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
      </div>
      {/* Only when it adds something. A line the fleet never named IS "Z-B → Z-C", so printing the route
          under a heading that already says it is a row whose whole content is a repetition. */}
      {run.lineName.includes(run.originZone) && run.lineName.includes(run.destZone) ? null : (
        <p class="card__note">{t('fleet.runs.route', { from: run.originZone, to: run.destZone })}</p>
      )}
      <p class="card__note">
        {t('fleet.runs.priced', { amount: run.rate.amount, currency: run.rate.currency, basis: t(BASIS_WORD[run.rate.basis as RunBasis] ?? 'fleet.runs.basisTrip') })}
        {' · '}
        {run.waiting ? t('fleet.runs.terms', { minutes: run.waiting.freeMin, rate: run.waiting.perHour, currency: run.rate.currency }) : t('fleet.runs.noWaitingTerms')}
      </p>
      {/* WHAT IS LEFT, ON BOTH AXES — whichever runs out first is what "full" means for a vehicle. */}
      <p class="card__note">
        {left.kg <= 0 || (left.m3 != null && left.m3 <= 0)
          ? t('fleet.runs.full')
          : left.m3 != null
            ? t('fleet.runs.leftBoth', { kg: left.kg, m3: left.m3 })
            : t('fleet.runs.left', { kg: left.kg })}
        {' · '}
        {aboard.length === 0 ? t('fleet.runs.nobody') : aboard.length === 1 ? t('fleet.runs.aboardOne') : t('fleet.runs.aboard', { count: aboard.length })}
      </p>
      {run.note ? <p class="card__note">{run.note}</p> : null}

      {/* WHO IS DRIVING, and why it is not optional in practice: the waiting clock is started by the person
          standing at the gate, so until somebody is named there is nobody holding a phone who may touch it. */}
      <div class="field" style="margin-top:12px">
        <label class="field__label" for={`d-${run.departureId}`}>
          {t('fleet.runs.driver')}
        </label>
        <select
          id={`d-${run.departureId}`}
          class="select"
          value={run.driverDid ?? ''}
          disabled={run.status === 'cancelled' || state.busy === `run-driver:${run.departureId}`}
          onChange={(e) => {
            const did = e.currentTarget.value;
            if (did) void actions.assignRunDriver(run.departureId, did);
          }}
        >
          <option value="">{t('fleet.runs.pickDriver')}</option>
          {drivers.map((d) => (
            <option key={d.did} value={d.did}>
              {d.displayName}
            </option>
          ))}
        </select>
        {!run.driverDid ? <p class="hint">{t('fleet.runs.noDriverWhy')}</p> : null}
      </div>

      {aboard.length ? (
        <>
          <h3 class="scr__section">{t('fleet.runs.moneyTitle')}</h3>
          <p class="card__note">
            {t('fleet.runs.sold', { amount: money.sold, currency: money.currency })}
            {/* Waiting is shown SEPARATELY from the trip money. The trip was quoted and agreed; the waiting
                was not, and a fleet reading one total would never see which of its runs keep being held up. */}
            {money.waiting > 0 ? ` · ${t('fleet.runs.waitingOwed', { amount: money.waiting, currency: money.currency })}` : ''}
          </p>
          <div class="rows" role="list">
            {aboard.map((b) => (
              <div key={b.bookingId} class="row row--static" role="listitem">
                <span class="row__body">
                  <span class="row__t">{b.description}</span>
                  <span class="row__s">
                    {t('fleet.runs.bookingLine', {
                      kg: b.weightKg,
                      binds: t(b.binds === 'space' ? 'fleet.runs.bindsSpace' : 'fleet.runs.bindsWeight'),
                      price: b.price,
                      currency: run.rate.currency,
                    })}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {waits.length ? (
        <>
          <h3 class="scr__section">{t('fleet.runs.waitsTitle')}</h3>
          <div class="rows" role="list">
            {waits.map(({ booking, record }) => (
              <Wait key={`${booking.bookingId}:${record.where}`} run={run} booking={booking} record={record} state={state} actions={actions} />
            ))}
          </div>
        </>
      ) : null}

      <div class="crow" style="margin-top:14px">
        {run.status === 'open' ? (
          <Button variant="outline" full={false} chevron={false} busy={state.busy === `run-status:${run.departureId}`} onClick={() => void actions.setRunStatus(run.departureId, 'closed')}>
            {t('fleet.runs.close')}
          </Button>
        ) : null}
        {run.status === 'closed' ? (
          <Button variant="outline" full={false} chevron={false} busy={state.busy === `run-status:${run.departureId}`} onClick={() => void actions.setRunStatus(run.departureId, 'open')}>
            {t('fleet.runs.reopen')}
          </Button>
        ) : null}
        {run.status === 'open' || run.status === 'closed' ? (
          <>
            <Button variant="outline" full={false} chevron={false} onClick={() => void actions.setRunStatus(run.departureId, 'departed')}>
              {t('fleet.runs.depart')}
            </Button>
            <Button variant="link" full={false} onClick={() => setConfirmCancel(true)}>
              {t('fleet.runs.cancel')}
            </Button>
          </>
        ) : null}
      </div>

      {/* Calling a run off strands everyone booked on it, so it asks — unlike closing, which only stops
          new bookings and is the thing most managers actually mean. */}
      <Sheet open={confirmCancel} onClose={() => setConfirmCancel(false)} title={t('fleet.runs.cancelConfirm')}>
        <p class="t-body">{t('fleet.runs.cancelBody')}</p>
        <Button
          chevron={false}
          busy={state.busy === `run-status:${run.departureId}`}
          onClick={async () => {
            await actions.setRunStatus(run.departureId, 'cancelled');
            setConfirmCancel(false);
          }}
        >
          {t('fleet.runs.cancelCta')}
        </Button>
        <Button variant="link" onClick={() => setConfirmCancel(false)}>
          {t('common.cancel')}
        </Button>
      </Sheet>
    </Card>
  );
}

/** One billable wait, and the office's one decision about it: invoice it, or let it go with a reason. */
function Wait({
  run,
  booking,
  record,
  state,
  actions,
}: {
  run: DepartureRow;
  booking: DepartureBookingRow;
  record: WaitingRow;
  state: FleetState;
  actions: FleetActions;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <div class="row row--static" role="listitem">
      <span class="row__body">
        <span class="row__t">{t(record.where === 'loading' ? 'fleet.runs.waitAtLoading' : 'fleet.runs.waitAtDelivery')}</span>
        <span class="row__s">{booking.description}</span>
        <span class="row__s">
          {t('fleet.runs.waitLine', {
            minutes: record.billableMin,
            amount: record.amount,
            currency: run.rate.currency,
            bearer: t(record.bearer === 'shipper' ? 'fleet.runs.bearerShipper' : 'fleet.runs.bearerConsignee'),
          })}
        </span>
        {/* A WAIVED charge keeps its row. Deleting it would make the decision unarguable in the other
            direction — a shipper could never show a fleet writing off its own delays. */}
        {record.waivedReason ? <span class="row__s">{t('fleet.runs.waived', { reason: record.waivedReason })}</span> : null}
      </span>
      {!record.waivedReason && record.amount > 0 ? (
        <span class="row__end">
          <Button variant="link" full={false} onClick={() => setOpen(true)}>
            {t('fleet.runs.waive')}
          </Button>
        </span>
      ) : null}

      <Sheet open={open} onClose={() => setOpen(false)} title={t('fleet.runs.waiveTitle')}>
        <p class="t-body">{t('fleet.runs.waiveBody')}</p>
        <div class="field">
          <label class="field__label" for={`w-${booking.bookingId}-${record.where}`}>
            {t('fleet.runs.waiveReason')}
          </label>
          <input
            id={`w-${booking.bookingId}-${record.where}`}
            class="input"
            value={reason}
            placeholder={t('fleet.runs.waiveReasonPh')}
            onInput={(e) => setReason(e.currentTarget.value)}
          />
        </div>
        <Button
          chevron={false}
          disabled={!reason.trim()}
          busy={state.busy === `waive:${booking.bookingId}:${record.where}`}
          onClick={async () => {
            // Closes only on success, so a refusal stays on screen instead of vanishing unread.
            if (await actions.waiveWait(run.departureId, booking.bookingId, record.where, reason)) {
              setReason('');
              setOpen(false);
            }
          }}
        >
          {t('fleet.runs.waiveCta')}
        </Button>
        <Button variant="link" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
      </Sheet>
    </div>
  );
}

function NewRun({ state, actions, lines }: { state: FleetState; actions: FleetActions; lines: FleetState['corridors'] }) {
  const t = useT();
  const f = state.rForm;
  const blocker = runBlocker(f);

  return (
    <Card title={t('fleet.runs.newTitle')}>
      <div class="field">
        <label class="field__label" for="r-line">
          {t('fleet.runs.line')}
        </label>
        <select id="r-line" class="select" value={f.corridorId} onChange={(e) => actions.setRForm({ corridorId: e.currentTarget.value })}>
          <option value="">{t('fleet.runs.linePh')}</option>
          {lines.map((c) => (
            <option key={c.corridorId} value={c.corridorId}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div class="field" style="margin-top:12px">
        <label class="field__label" for="r-when">
          {t('fleet.runs.when')}
        </label>
        {/* A LOCAL wall-clock value, because "leaves Tuesday at six" means six where the truck is. It
            becomes an instant once, on submit, rather than being passed around half-resolved. */}
        <input id="r-when" class="input" type="datetime-local" value={f.leavesAt} onInput={(e) => actions.setRForm({ leavesAt: e.currentTarget.value })} />
      </div>

      <div class="grid2" style="margin-top:12px">
        <div class="field">
          <label class="field__label" for="r-kg">
            {t('fleet.runs.capacityKg')}
          </label>
          <input id="r-kg" class="input" inputMode="numeric" value={f.capacityKg} onInput={(e) => actions.setRForm({ capacityKg: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="r-m3">
            {t('fleet.runs.capacityM3')}
          </label>
          <input id="r-m3" class="input" inputMode="decimal" value={f.capacityM3} onInput={(e) => actions.setRForm({ capacityM3: e.currentTarget.value })} />
        </div>
      </div>
      <p class="hint">{t('fleet.runs.capacityM3Hint')}</p>

      <div class="field" style="margin-top:12px">
        <label class="field__label" for="r-basis">
          {t('fleet.runs.basis')}
        </label>
        <select id="r-basis" class="select" value={f.basis} onChange={(e) => actions.setRForm({ basis: e.currentTarget.value as RunBasis })}>
          {RUN_BASES.map((b) => (
            <option key={b} value={b}>
              {t(b === 'per_trip' ? 'fleet.runs.perTrip' : b === 'per_km' ? 'fleet.runs.perKm' : 'fleet.runs.perKg')}
            </option>
          ))}
        </select>
        <p class="hint">{t('fleet.runs.basisHint')}</p>
      </div>

      <div class="grid2" style="margin-top:12px">
        <div class="field">
          {/* THE CURRENCY IS IN THE LABEL, not left to be discovered on the published run. A fleet that
              types 450 meaning shillings and publishes 450 USD has mispriced by a hundred and thirty
              times, and nobody finds out until the invoice. */}
          <label class="field__label" for="r-amount">
            {t('fleet.runs.amountIn', { currency: state.runCurrency })}
          </label>
          <input id="r-amount" class="input" inputMode="decimal" value={f.amount} onInput={(e) => actions.setRForm({ amount: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="r-min">
            {t('fleet.runs.minCharge')}
          </label>
          <input id="r-min" class="input" inputMode="decimal" value={f.minCharge} onInput={(e) => actions.setRForm({ minCharge: e.currentTarget.value })} />
        </div>
      </div>
      {/* An ASSUMED currency is said out loud. The fleet never named a country, so this is our guess and
          not their answer — and it is the kind of guess that is invisible until it is expensive. */}
      {state.runCurrencyAssumed ? <Note tone="warn" icon="wallet" title={t('fleet.runs.currencyGuessTitle')} detail={t('fleet.runs.currencyGuess', { currency: state.runCurrency })} /> : null}
      <p class="hint">{t('fleet.runs.minChargeHint')}</p>

      {/* Only when it is actually used. A distance box on a flat-price run is a question with no answer. */}
      {f.basis === 'per_km' ? (
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="r-km">
            {t('fleet.runs.km')}
          </label>
          <input id="r-km" class="input" inputMode="numeric" value={f.km} onInput={(e) => actions.setRForm({ km: e.currentTarget.value })} />
        </div>
      ) : null}

      <h3 class="scr__section">{t('fleet.runs.waitingTitle')}</h3>
      <p class="hint">{t('fleet.runs.waitingLede')}</p>
      <div class="grid2" style="margin-top:8px">
        <div class="field">
          <label class="field__label" for="r-free">
            {t('fleet.runs.freeMin')}
          </label>
          <input id="r-free" class="input" inputMode="numeric" value={f.freeMin} onInput={(e) => actions.setRForm({ freeMin: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="r-wait">
            {t('fleet.runs.waitingPerHour')}
          </label>
          <input id="r-wait" class="input" inputMode="decimal" value={f.waitingPerHour} onInput={(e) => actions.setRForm({ waitingPerHour: e.currentTarget.value })} />
        </div>
      </div>
      <p class="hint">{t('fleet.runs.waitingHint')}</p>

      <div class="field" style="margin-top:12px">
        <label class="field__label" for="r-note">
          {t('fleet.runs.note')}
        </label>
        <input id="r-note" class="input" value={f.note} placeholder={t('fleet.runs.notePh')} onInput={(e) => actions.setRForm({ note: e.currentTarget.value })} />
      </div>

      <div style="margin-top:14px">
        <Button chevron={false} disabled={blocker !== null} busy={state.busy === 'run'} onClick={() => void actions.declareRun()}>
          {t('fleet.runs.cta')}
        </Button>
        {/* Said BEFORE the server has to. Every one of these is a refusal it would give anyway, and being
            told at the end of a long form is how a person learns to distrust the form. */}
        {blocker ? <p class="hint" style="margin-top:8px">{t(blocker)}</p> : null}
      </div>
    </Card>
  );
}
