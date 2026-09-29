import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Explainer, Note, Pill, ReadAloud, Sheet } from '../../../shared/ui';
import { formatDate, useT, type MessageKey } from '../../../shared/i18n';
import { EMPTY_OWN_LOAD, RUN_BASES, ownLines, ownLoadBlocker, runBlocker, runManifest, runMoney, runRemaining, runWaits, type OwnLoadForm, type RunBasis } from '../logic';
import { settleWords } from '../../../shared/settle';
import { coverWords } from '../../../shared/cover';
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

      {/* First, above everything: nothing else on this screen matters while nobody can buy from it. The
          shipper's board drops these runs silently, so this is the one place the reason is said. (It first
          went in beside the currency note, inside the new-run form — below every run, where the one fleet
          it is for would scroll past a list of runs nobody could book before reaching it.) */}
      {state.notOffered.length ? <Note tone="danger" icon="block" title={t('fleet.runs.notOfferedTitle')} detail={t('fleet.runs.notOffered', { why: state.notOffered.join('; ') })} /> : null}

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
  const [cancelReason, setCancelReason] = useState('');
  const left = runRemaining(run);
  const money = runMoney(run);
  // Two different lists on purpose. `aboard` is what is physically on the truck and drives the count
  // and the capacity; `manifest` is the job, and keeps a delivered load rather than erasing it at the
  // moment the fleet most wants to see it.
  const aboard = run.bookings.filter((b) => b.status === 'booked');
  const manifest = runManifest(run);
  const waits = runWaits(run);
  const status = STATUS[run.status];
  // Anybody this fleet could put on it. The server refuses a driver whose papers have lapsed and names
  // the paper, so the list stays open and the refusal does the teaching — this used to say the coupling
  // caught it, which was wrong: a roster is not a coupling, and for a while nothing checked at all.
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
      {/* Which truck, and how they pay you — both read back, because a fleet looking at next Tuesday wants
          the offer it made and not the form it filled. */}
      <p class="card__note">
        {/* A run declared before a run had to name its truck has no plate. Said as nothing rather than
            "On undefined" — the data is legitimately old; printing the gap as a word was the defect. */}
        {run.plate ? (
          <>
            {t('fleet.runs.onVehicle', { plate: run.plate })}
            {' · '}
          </>
        ) : null}
        {settleWords(run.settle, t)}
      </p>
      <p class="card__note">{coverWords(run.cover, run.rate.currency, t)}</p>
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
      {run.cancelledReason ? <Note tone="warn" icon="info" title={t('fleet.runs.calledOff')} detail={run.cancelledReason} /> : null}

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

      {/* F4 — the work this fleet already had. Offered on any run that can still take a load, INCLUDING a
          closed one: closed means "I have stopped selling", not "the truck is full", and a fleet that
          closed the offer because it is filling the rest itself is the ordinary case. */}
      {run.status === 'open' || run.status === 'closed' ? <OwnLoad run={run} state={state} actions={actions} /> : null}

      {manifest.length ? (
        <>
          <h3 class="scr__section">{t('fleet.runs.moneyTitle')}</h3>
          {/* THREE FIGURES THAT ARE NEVER ADDED UP. What we sold, what the fleet charges its own people,
              and standing time — quoted by us, quoted by them, and quoted by nobody. A fleet looking at a
              thin sold beside a fat own is looking at whether this network is worth their time, and one
              total would hide exactly that.

              A figure appears when its KIND of load is aboard, not when its amount is above zero. On a run
              carrying only the fleet's own work, "0 in bookings" states a zero we did not measure — there
              are no bookings, which is a different fact and the one worth reading. */}
          <p class="card__note">
            {[
              manifest.some((b) => b.kind !== 'own') ? t('fleet.runs.sold', { amount: money.sold, currency: money.currency }) : null,
              manifest.some((b) => b.kind === 'own') ? t('fleet.runs.ownMoney', { amount: money.own, currency: money.currency }) : null,
              money.waiting > 0 ? t('fleet.runs.waitingOwed', { amount: money.waiting, currency: money.currency }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div class="rows" role="list">
            {manifest.map((b) => (
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
                  {/* Whose it is, said on the row rather than inferred from a price of zero. A fleet
                      scanning a loaded run needs to know which of these people we have any part in. */}
                  {b.kind === 'own' ? (
                    <span class="row__s">{b.price > 0 ? t('fleet.runs.ownRow', { customer: b.customer }) : t('fleet.runs.ownRowNoPrice', { customer: b.customer })}</span>
                  ) : null}
                  {/* A CLAIM AGAINST THIS LOAD. Ours to carry and nobody’s to weigh — we did not take
                      the payment and we hold no cover, so the answer is the fleet’s own. */}
                  {b.claim ? <ClaimRow run={run} booking={b} state={state} actions={actions} /> : null}
                </span>
                  {/* The ending a run did not have. Shown once the load is delivered rather than hidden,
                      because "handed over to Joseph at 14:20" is the answer to the only question anybody
                      asks about a finished run. */}
                  {b.status === 'delivered' ? (
                    <span class="row__s">
                      {b.receivedBy
                        ? t('fleet.runs.deliveredTo', { who: b.receivedBy, when: formatDate(b.deliveredAt ?? '', { dateStyle: 'medium', timeStyle: 'short' }) })
                        : t('fleet.runs.deliveredAt', { when: formatDate(b.deliveredAt ?? '', { dateStyle: 'medium', timeStyle: 'short' }) })}
                    </span>
                  ) : null}
                <span class="row__end">
                  {b.kind === 'own' ? <Pill tone="idle">{t('fleet.runs.ownPill')}</Pill> : null}
                  {b.claim ? <Pill tone={b.claim.answeredAt ? 'idle' : 'warn'}>{t('fleet.runs.claimPill')}</Pill> : null}
                  {b.status === 'delivered' ? (
                    <Pill tone="ok">{t('fleet.runs.deliveredPill')}</Pill>
                  ) : run.status !== 'cancelled' ? (
                    <Button
                      variant="link"
                      full={false}
                      busy={state.busy === `deliver:${b.bookingId}`}
                      onClick={() => void actions.markDelivered(run.departureId, b.bookingId)}
                    >
                      {t('fleet.runs.markDelivered')}
                    </Button>
                  ) : null}
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
          new bookings and is the thing most managers actually mean.

          AND IT ASKS WHY, once anybody is aboard. Every shipper on this truck is about to be told, and the
          reason is the only part of that message they can act on: "the run is off" leaves somebody ringing
          round for a lorry with nothing to tell the next carrier. Empty runs skip it — nobody planned
          anything around a departure declared by mistake. */}
      <Sheet open={confirmCancel} onClose={() => setConfirmCancel(false)} title={t('fleet.runs.cancelConfirm')}>
        <p class="t-body">{t('fleet.runs.cancelBody')}</p>
        {aboard.some((b) => b.kind !== 'own') ? (
          <>
            <Note tone="warn" icon="info" title={t('fleet.runs.cancelTold', { count: aboard.filter((b) => b.kind !== 'own').length })} />
            <div class="field" style="margin-top:12px">
              <label class="field__label" for={`why-${run.departureId}`}>
                {t('fleet.runs.cancelWhy')}
              </label>
              <input
                id={`why-${run.departureId}`}
                class="input"
                value={cancelReason}
                placeholder={t('fleet.runs.cancelWhyPh')}
                onInput={(e) => setCancelReason(e.currentTarget.value)}
              />
            </div>
          </>
        ) : null}
        <Button
          chevron={false}
          disabled={aboard.some((b) => b.kind !== 'own') && !cancelReason.trim()}
          busy={state.busy === `run-status:${run.departureId}`}
          onClick={async () => {
            if (await actions.setRunStatus(run.departureId, 'cancelled', cancelReason.trim() || undefined)) {
              setCancelReason('');
              setConfirmCancel(false);
            }
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
        {/* An own customer's wait carries NO figure, and says why rather than showing a nought. The terms
            on this run are the ones published to the market; a customer the fleet has carried for years is
            on whatever they agreed years ago, and we were never told it. The minutes are the point. */}
        <span class="row__s">
          {booking.kind === 'own'
            ? t('fleet.runs.waitLineOwn', {
                minutes: record.billableMin,
                customer: booking.customer,
              })
            : t('fleet.runs.waitLine', {
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
  // Only vehicles that can actually go out. One that is off the road is refused at the server anyway,
  // and offering it here would be a row whose only outcome is a refusal.
  const fleetVehicles = state.vehicles.filter((v) => v.status === 'ACTIVE');
  const chosen = fleetVehicles.find((v) => v.vehicleId === f.vehicleId);
  const blocker = runBlocker(f, Date.now(), chosen?.capacityKg);

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

      {/* WHICH TRUCK, and it is required where the driver is not. The space in a particular hold is what
          is being sold, so a run that names no vehicle is selling a number somebody typed — which is
          exactly what it used to be. */}
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="r-vehicle">
          {t('fleet.runs.vehicle')}
        </label>
        <select id="r-vehicle" class="select" value={f.vehicleId} onChange={(e) => actions.setRForm({ vehicleId: e.currentTarget.value })}>
          <option value="">{t('fleet.runs.vehiclePh')}</option>
          {fleetVehicles.map((v) => (
            <option key={v.vehicleId} value={v.vehicleId}>
              {t('fleet.runs.vehicleOption', { plate: v.plate, kg: v.capacityKg })}
            </option>
          ))}
        </select>
        {fleetVehicles.length === 0 ? <p class="hint">{t('fleet.runs.noVehicles')}</p> : null}
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
          <input
            id="r-kg"
            class="input"
            inputMode="numeric"
            placeholder={chosen ? String(chosen.capacityKg) : ''}
            value={f.capacityKg}
            onInput={(e) => actions.setRForm({ capacityKg: e.currentTarget.value })}
          />
          {/* Blank means the whole truck. Saying so beats a required field whose right answer is already
              on the vehicle's own record — and a fleet selling only part of it can still type less. */}
          {chosen ? <p class="hint">{t('fleet.runs.capacityFrom', { plate: chosen.plate, kg: chosen.capacityKg })}</p> : null}
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

      {/* HOW THEY PAY YOU. Not an invoice of ours and deliberately not: board freight is priced BY the
          network and books a payable at delivery, because the shipper paid us. This is your price, agreed
          directly — so money we never collected must not become a liability we pretend to hold. What was
          missing was nobody SAYING that. */}
      <h3 class="scr__section">{t('fleet.runs.settleTitle')}</h3>
      <p class="hint">{t('fleet.runs.settleLede')}</p>
      <div class="grid2">
        <div class="field">
          <label class="field__label" for="r-smethod">
            {t('fleet.runs.settleMethod')}
          </label>
          <select id="r-smethod" class="select" value={f.settleMethod} onChange={(e) => actions.setRForm({ settleMethod: e.currentTarget.value })}>
            <option value="cash">{t('settle.method.cash')}</option>
            <option value="mobile_money">{t('settle.method.mobile')}</option>
            <option value="bank">{t('settle.method.bank')}</option>
            <option value="other">{t('settle.method.other')}</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="r-swhen">
            {t('fleet.runs.settleWhen')}
          </label>
          <select id="r-swhen" class="select" value={f.settleWhen} onChange={(e) => actions.setRForm({ settleWhen: e.currentTarget.value })}>
            <option value="on_pickup">{t('settle.when.pickup')}</option>
            <option value="on_delivery">{t('settle.when.delivery')}</option>
            <option value="after_delivery">{t('settle.when.after')}</option>
          </select>
        </div>
      </div>

      {/* WHAT YOU INSURE — and we insure nothing, which is the part that has to be said rather than
          left blank. A shipper reading a price on our screens and nothing about cover assumes somebody
          is behind the goods. Zero is a real answer and a useful one: "I carry none" is exactly what a
          forwarder needs to hear, and a different fact from never having said. */}
      <h3 class="scr__section">{t('fleet.runs.coverTitle')}</h3>
      <p class="hint">{t('fleet.runs.coverLede')}</p>
      <div class="grid2">
        <div class="field">
          <label class="field__label" for="r-cover">
            {t('fleet.runs.coverLimit', { currency: state.runCurrency })}
          </label>
          <input id="r-cover" class="input" inputMode="decimal" value={f.coverLimit} onInput={(e) => actions.setRForm({ coverLimit: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="r-policy">
            {t('fleet.runs.coverPolicy')}
          </label>
          <input
            id="r-policy"
            class="input"
            value={f.coverPolicy}
            placeholder={t('fleet.runs.coverPolicyPh')}
            onInput={(e) => actions.setRForm({ coverPolicy: e.currentTarget.value })}
          />
        </div>
      </div>
      <p class="hint">{t('fleet.runs.coverHint')}</p>

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

/**
 * F4 — A LOAD THIS FLEET ALREADY HAD.
 *
 * A haulier does not arrive here empty. It arrives with customers it has been carrying for years, and
 * until now there was nowhere to put them: the only way a load got onto a truck was for somebody to buy it
 * through us. So the network saw a vehicle and never the work on it — and the remaining-space figure on
 * every offer was an advertisement rather than a fact.
 *
 * THIS IS WHAT MAKES SELLING SPACE HONEST. A fleet with existing customers had two options and both were
 * bad: stay off the offer list, or publish six tonnes while four are already spoken for. The second ends
 * with a shipper at a gate beside a full truck, and it would have been our number that sent them there.
 *
 * It is deliberately NOT a sale. No quote, no money, and the customer needs no account — they are the
 * fleet's, settled between the two of them the way they always were. The price box exists only so a run
 * sheet showing half the money is not the best this fleet can get, and it says so.
 */
function OwnLoad({ run, state, actions }: { run: DepartureRow; state: FleetState; actions: FleetActions }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<OwnLoadForm>({ ...EMPTY_OWN_LOAD });

  const left = runRemaining(run);
  const blocker = ownLoadBlocker(form, run);
  const set = (patch: Partial<OwnLoadForm>) => setForm((f) => ({ ...f, ...patch }));

  const add = async () => {
    const ok = await actions.addOwnLoad(run.departureId, {
      customer: form.customer.trim(),
      description: form.description.trim(),
      weightKg: Number(form.weightKg),
      ...(Number(form.volumeM3) > 0 ? { volumeM3: Number(form.volumeM3) } : {}),
      ...(Number(form.charge) > 0 ? { charge: Number(form.charge) } : {}),
    });
    // Only on success. A refusal leaves the sheet and everything typed into it exactly where they were.
    if (ok) {
      setForm({ ...EMPTY_OWN_LOAD });
      setOpen(false);
    }
  };

  return (
    <>
      <div style="margin: 14px 0 6px">
        <Button variant="outline" chevron={false} onClick={() => setOpen(true)}>
          {t('fleet.own.add')}
        </Button>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('fleet.own.title')}>
        <p class="hint">{t('fleet.own.lede')}</p>

        <div class="field">
          <label class="field__label" for={`own-who-${run.departureId}`}>
            {t('fleet.own.customer')}
          </label>
          <input
            id={`own-who-${run.departureId}`}
            class="input"
            value={form.customer}
            placeholder={t('fleet.own.customerPh')}
            onInput={(e) => set({ customer: e.currentTarget.value })}
          />
        </div>

        <div class="field" style="margin-top:12px">
          <label class="field__label" for={`own-what-${run.departureId}`}>
            {t('fleet.own.what')}
          </label>
          <input
            id={`own-what-${run.departureId}`}
            class="input"
            value={form.description}
            placeholder={t('fleet.own.whatPh')}
            onInput={(e) => set({ description: e.currentTarget.value })}
          />
        </div>

        <div class="grid2" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for={`own-kg-${run.departureId}`}>
              {t('fleet.own.kg')}
            </label>
            <input id={`own-kg-${run.departureId}`} class="input" inputMode="decimal" value={form.weightKg} onInput={(e) => set({ weightKg: e.currentTarget.value })} />
          </div>
          <div class="field">
            <label class="field__label" for={`own-m3-${run.departureId}`}>
              {t('fleet.own.m3')}
            </label>
            <input id={`own-m3-${run.departureId}`} class="input" inputMode="decimal" value={form.volumeM3} onInput={(e) => set({ volumeM3: e.currentTarget.value })} />
          </div>
        </div>
        {/* What is actually left, beside the boxes that have to fit inside it — rather than a refusal
            afterwards about a number the person could not see while typing. */}
        <p class="hint">{left.m3 != null ? t('fleet.own.leftBoth', { kg: left.kg, m3: left.m3 }) : t('fleet.own.left', { kg: left.kg })}</p>

        <div class="field" style="margin-top:12px">
          <label class="field__label" for={`own-charge-${run.departureId}`}>
            {t('fleet.own.charge', { currency: run.rate.currency })}
          </label>
          <input id={`own-charge-${run.departureId}`} class="input" inputMode="decimal" value={form.charge} onInput={(e) => set({ charge: e.currentTarget.value })} />
        </div>
        <p class="hint">{t('fleet.own.chargeHint')}</p>

        {state.error ? <ErrorNote error={state.error} showDetail /> : null}

        <Button chevron={false} disabled={blocker !== null} busy={state.busy === `own-load:${run.departureId}`} onClick={() => void add()}>
          {t('fleet.own.submit')}
        </Button>
        {blocker ? (
          <p class="hint" style="margin-top:8px">
            {t(blocker, { kg: left.kg, m3: left.m3 ?? 0 })}
          </p>
        ) : null}

        <Button variant="link" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
      </Sheet>
    </>
  );
}

/**
 * A CLAIM ON ONE LOAD, and the office’s answer to it.
 *
 * Not an adjudication and not a payment: the network never held this money and carries no cover on the
 * goods, so what it can offer is the record. The fleet says accepted or refused IN THEIR OWN WORDS, and
 * a refusal must carry a reason — a refusal without one is not something the other side can act on, and
 * acting on it is the entire point of writing any of this down.
 */
function ClaimRow({ run, booking, state, actions }: { run: DepartureRow; booking: DepartureBookingRow; state: FleetState; actions: FleetActions }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<'accepted' | 'refused'>('refused');
  const [note, setNote] = useState('');
  const claim = booking.claim;
  if (!claim) return null;

  return (
    <>
      <span class="row__s">
        {t('fleet.runs.claimRaised', { when: formatDate(claim.raisedAt, { dateStyle: 'medium' }), what: claim.description })}
        {claim.amount != null ? ` · ${t('fleet.runs.claimAmount', { amount: claim.amount, currency: run.rate.currency })}` : ''}
      </span>
      {claim.answeredAt ? (
        <span class="row__s">
          {t(claim.answer === 'accepted' ? 'fleet.runs.claimYouAccepted' : 'fleet.runs.claimYouRefused', { note: claim.answerNote ? `: ${claim.answerNote}` : '.' })}
        </span>
      ) : (
        <Button variant="link" full={false} onClick={() => setOpen(true)}>
          {t('fleet.runs.claimAnswer')}
        </Button>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={t('fleet.runs.claimAnswerTitle')}>
        <p class="t-body">{claim.description}</p>
        <p class="hint">{t('fleet.runs.claimAnswerLede')}</p>

        <div class="field">
          <label class="field__label" for={`a-${booking.bookingId}`}>
            {t('fleet.runs.claimYourAnswer')}
          </label>
          <select id={`a-${booking.bookingId}`} class="select" value={answer} onChange={(e) => setAnswer(e.currentTarget.value as 'accepted' | 'refused')}>
            <option value="refused">{t('fleet.runs.claimRefuse')}</option>
            <option value="accepted">{t('fleet.runs.claimAccept')}</option>
          </select>
        </div>

        <div class="field" style="margin-top:12px">
          <label class="field__label" for={`n-${booking.bookingId}`}>
            {t('fleet.runs.claimWhy')}
          </label>
          <input id={`n-${booking.bookingId}`} class="input" value={note} placeholder={t('fleet.runs.claimWhyPh')} onInput={(e) => setNote(e.currentTarget.value)} />
        </div>
        <p class="hint">{t('fleet.runs.claimWhyHint')}</p>

        <Button
          chevron={false}
          disabled={answer === 'refused' && !note.trim()}
          busy={state.busy === `claim:${booking.bookingId}`}
          onClick={async () => {
            if (await actions.answerClaim(run.departureId, booking.bookingId, answer, note)) {
              setNote('');
              setOpen(false);
            }
          }}
        >
          {t('fleet.runs.claimSend')}
        </Button>

        <Button variant="link" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
      </Sheet>
    </>
  );
}
