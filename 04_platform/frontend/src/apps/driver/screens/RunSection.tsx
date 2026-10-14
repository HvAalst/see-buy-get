import { useState } from 'preact/hooks';
import { Button, Card, Icon, Pill, Sheet } from '../../../shared/ui';
import { Explainer } from '../../../shared/ui/Explainer';
import { formatDate, useT } from '../../../shared/i18n';
import type { DepartureBookingView, DepartureView, SafetyItem, WaitingRecordView } from '../types';
import type { DriverActions, DriverState } from '../useDriverApp';

/**
 * F3 — THE SCHEDULED RUN, AND THE CLOCK AT EACH GATE.
 *
 * A fleet sells the space on a line it already runs, and the driver is rostered onto it. Most of that is
 * the office's business and none of it belongs on a phone. One part does: when a truck arrives at the
 * appointed hour and is told to wait, somebody has to record it, and the only person standing there is
 * the driver. (The user, 2026-09-24: *"it happens pretty often that a truck comes at an appointed time for
 * loading and is then told to wait. It is usually acceptable that the place where the delay happens has to
 * pay for the waiting time."*)
 *
 * TWO TAPS, AND NO TYPING. The time is the server's, taken when the tap lands. A driver typing "I got here
 * at 08:00" is making a claim in a dispute they have a stake in; a driver tapping when they arrive is
 * making a record, and that difference is the whole reason a shipper can accept the number afterwards.
 *
 * WHAT IT DOES NOT DO is argue. The driver never sees "you are owed 40" as a thing to chase — they see the
 * clock they started, what it came to, and who it falls on. The charge is the fleet's to collect and the
 * fleet's to waive, and putting a running total in front of somebody at a loading bay would turn a record
 * into a negotiation at exactly the moment nobody needs one.
 */
export function RunSection({ state, actions }: { state: DriverState; actions: DriverActions }) {
  const t = useT();
  // A run that has been called off is not work, and one that has gone carries no more gates to clock.
  const runs = state.departures.filter((d) => d.status !== 'cancelled');
  if (runs.length === 0) return null;

  return (
    <>
      <h2 class="scr__section">{t('driver.run.title')}</h2>
      <Explainer who={state.driver?.did} id="driver.run.what" text={t('driver.run.teach')} />
      {runs.map((run) => (
        <Run key={run.departureId} run={run} state={state} actions={actions} />
      ))}
    </>
  );
}

function Run({ run, state, actions }: { run: DepartureView; state: DriverState; actions: DriverActions }) {
  const t = useT();
  const aboard = run.bookings.filter((b) => b.status === 'booked');

  return (
    <Card title={run.lineName} tone="soft">
      <p class="card__note">
        {t('driver.run.leaves', { when: formatDate(run.leavesAt, { dateStyle: 'medium', timeStyle: 'short' }), from: run.originZone, to: run.destZone })}
      </p>
      {/* The terms, in the driver's own words. They are the fleet's rule, not the driver's, and a driver
          who does not know what the free window is cannot tell a shipper why the clock is running. */}
      {run.waiting ? (
        <p class="card__note">{t('driver.run.terms', { minutes: run.waiting.freeMin, rate: run.waiting.perHour, currency: run.rate.currency })}</p>
      ) : (
        <p class="card__note">{t('driver.run.noTerms')}</p>
      )}

      {aboard.length === 0 ? (
        <p class="card__note">{t('driver.run.empty')}</p>
      ) : (
        <div class="rows" role="list">
          {aboard.map((booking) => (
            <Gate key={booking.bookingId} run={run} booking={booking} state={state} actions={actions} />
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * One load on the run, with its two gates.
 *
 * Both are shown from the start rather than revealed in sequence. A driver arriving at a delivery has not
 * necessarily clocked the loading — the phone was flat, the fleet did it, the load was already aboard — and
 * a flow that insists on the first step before offering the second strands them at the gate that matters.
 */
function Gate({ run, booking, state, actions }: { run: DepartureView; booking: DepartureBookingView; state: DriverState; actions: DriverActions }) {
  const t = useT();
  return (
    <div class="row row--static" role="listitem">
      <span class="row__ic">
        <Icon name="box" size={22} />
      </span>
      <span class="row__body">
        <span class="row__t">{booking.description}</span>
        <span class="row__s">{t('driver.run.load', { kg: booking.weightKg })}</span>
        {(['loading', 'delivery'] as const).map((where) => (
          <GateControl key={where} run={run} booking={booking} where={where} state={state} actions={actions} />
        ))}
        {/* THE ENDING. Clocking out of the delivery gate proves the truck got there and says nothing about
            whether the load came off it — which is the whole gap: the goods reached a door, somebody took
            them, and no record of that existed. This is the driver saying what they did, at the door. */}
        {/* SECURED, BEFORE PULLING AWAY — the board asks this of a haul and asked nothing of a run.
            The checklist is the SERVER’S, in the server’s own words, and it depends on the goods: a
            drum of solvent is never signed off with the checks for a box of paperbacks. */}
        {booking.status === 'booked' ? <Secure run={run} booking={booking} state={state} actions={actions} /> : null}
        {booking.status === 'delivered' ? (
          <span class="run__gate">
            <Pill tone="ok" dot>
              {booking.receivedBy
                ? t('driver.run.handedTo', { who: booking.receivedBy })
                : t('driver.run.handedOver')}
            </Pill>
          </span>
        ) : (
          <HandOver run={run} booking={booking} state={state} actions={actions} />
        )}
      </span>
    </div>
  );
}

/**
 * Handed over, and who took it.
 *
 * The name is OPTIONAL and asked for rather than demanded: often nobody gives one, and a required field
 * at a gate in the rain is how a driver learns to type "x". When it is there it is the single most useful
 * thing on the whole record two weeks later.
 */
function HandOver({ run, booking, state, actions }: { run: DepartureView; booking: DepartureBookingView; state: DriverState; actions: DriverActions }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');
  const [photo, setPhoto] = useState('');
  const [done, setDone] = useState<string[]>([]);
  const required = booking.checklists?.unload ?? [];
  const ready = who.trim().length >= 2 && photo.trim() !== '' && required.every((i) => done.includes(i.key));

  return (
    <span class="run__gate">
      <Button variant="outline" full={false} chevron={false} onClick={() => setOpen(true)}>
        {t('driver.run.handOver')}
      </Button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('driver.run.handOverTitle')}>
        <p class="hint">{t('driver.run.handOverLede', { what: booking.description })}</p>

        {/* THE UNLOAD CHECKLIST AND A PHOTOGRAPH, which the board has required of a delivery since
            FP3. This used to take a name and nothing — the same act, provable on a haul and
            unprovable on a run, and it is the driver this protects first. */}
        <Checklist items={booking.checklists?.unload ?? []} checked={done} onToggle={setDone} />

        <div class="field" style="margin-top:12px">
          <label class="field__label" for={`pod-${booking.bookingId}`}>
            {t('driver.run.podPhoto')}
          </label>
          <input id={`pod-${booking.bookingId}`} class="input" value={photo} placeholder={t('driver.run.podPhotoPh')} onInput={(e) => setPhoto(e.currentTarget.value)} />
        </div>

        <div class="field" style="margin-top:12px">
          <label class="field__label" for={`who-${booking.bookingId}`}>
            {t('driver.run.whoTook')}
          </label>
          <input id={`who-${booking.bookingId}`} class="input" value={who} placeholder={t('driver.run.whoTookPh')} onInput={(e) => setWho(e.currentTarget.value)} />
        </div>
        <p class="hint">{t('driver.run.whoTookHint')}</p>
        <Button
          chevron={false}
          disabled={!ready}
          busy={state.busy === `deliver:${booking.bookingId}`}
          onClick={async () => {
            const ok = await actions.handOver(run.departureId, booking.bookingId, {
              receiverName: who.trim(),
              photoRef: photo.trim(),
              confirmed: done,
            });
            if (ok) {
              setWho('');
              setPhoto('');
              setDone([]);
              setOpen(false);
            }
          }}
        >
          {t('driver.run.handOverCta')}
        </Button>
        <Button variant="link" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
      </Sheet>
    </span>
  );
}

function GateControl({
  run,
  booking,
  where,
  state,
  actions,
}: {
  run: DepartureView;
  booking: DepartureBookingView;
  where: 'loading' | 'delivery';
  state: DriverState;
  actions: DriverActions;
}) {
  const t = useT();
  const record = booking.waiting.find((w) => w.where === where);
  const label = t(where === 'loading' ? 'driver.run.atLoading' : 'driver.run.atDelivery');

  // Not there yet: one button, and it starts the clock.
  if (!record) {
    return (
      <span class="run__gate">
        <span class="run__where">{label}</span>
        <Button
          variant="outline"
          full={false}
          chevron={false}
          busy={state.busy === `arrive:${booking.bookingId}:${where}`}
          onClick={() => void actions.clockGate(run.departureId, booking.bookingId, where, true)}
        >
          {t('driver.run.arrived')}
        </Button>
      </span>
    );
  }

  // Standing there: the clock is running, and the way out is the second tap.
  if (!record.freeAt) {
    return (
      <span class="run__gate">
        <span class="run__where">{label}</span>
        <Pill tone="warn" dot>
          {t('driver.run.waitingSince', { at: formatDate(record.arrivedAt, { timeStyle: 'short' }) })}
        </Pill>
        <Button
          variant="outline"
          full={false}
          chevron={false}
          busy={state.busy === `free:${booking.bookingId}:${where}`}
          onClick={() => void actions.clockGate(run.departureId, booking.bookingId, where, false)}
        >
          {t(where === 'loading' ? 'driver.run.loaded' : 'driver.run.unloaded')}
        </Button>
      </span>
    );
  }

  return (
    <span class="run__gate">
      <span class="run__where">{label}</span>
      <Pill tone="ok" dot>
        {t('driver.run.done', { minutes: record.waitedMin })}
      </Pill>
      <span class="run__owed">{owedWords(record, run.rate.currency, t)}</span>
    </span>
  );
}

/**
 * What the wait came to, in a sentence a driver can read out at a gate.
 *
 * "Nothing owed" is said rather than left blank: a wait inside the free window is the ordinary outcome and
 * a silent one reads as a thing that has not finished computing. A WAIVED charge says so — the fleet let it
 * go, the wait still happened, and the driver should not be told a number that nobody is paying.
 */
function owedWords(record: WaitingRecordView, currency: string, t: ReturnType<typeof useT>): string {
  if (record.waivedReason) return t('driver.run.waived');
  if (record.amount <= 0) return t('driver.run.nothingOwed');
  return t(record.bearer === 'shipper' ? 'driver.run.owedByShipper' : 'driver.run.owedByConsignee', {
    amount: record.amount,
    currency,
    minutes: record.billableMin,
  });
}

/**
 * A checklist, in the SERVER’S words.
 *
 * The items arrive with the run rather than being written on the phone, which is the rule S33 settled
 * for the board: a driver ticking a list the client invented, against a list the server enforces, is
 * two lists that will disagree at a gate one day. Nothing here decides what is on it.
 */
function Checklist({ items, checked, onToggle }: { items: SafetyItem[]; checked: string[]; onToggle: (next: string[]) => void }) {
  if (!items.length) return null;
  return (
    <div class="rows" role="list" style="margin-top:12px">
      {items.map((item) => (
        <label key={item.key} class="row row--tap" role="listitem">
          <input
            type="checkbox"
            checked={checked.includes(item.key)}
            onChange={() => onToggle(checked.includes(item.key) ? checked.filter((k) => k !== item.key) : [...checked, item.key])}
          />
          <span class="row__body">
            <span class="row__t">{item.label}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * SECURED, BEFORE PULLING AWAY.
 *
 * The other half of the standard the board holds a haul to, and the half a run had none of. A load
 * that arrives broken is argued about at the far end of the journey; the photograph that settles it is
 * taken here, hours earlier, at a gate where the driver is already standing.
 */
function Secure({ run, booking, state, actions }: { run: DepartureView; booking: DepartureBookingView; state: DriverState; actions: DriverActions }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const [photo, setPhoto] = useState('');
  const required = booking.checklists?.load ?? [];
  const ready = required.every((i) => done.includes(i.key));

  if (booking.loadSafety) {
    return (
      <span class="run__gate">
        <Pill tone="ok" dot>
          {t('driver.run.secured')}
        </Pill>
      </span>
    );
  }

  return (
    <span class="run__gate">
      <Button variant="outline" full={false} chevron={false} onClick={() => setOpen(true)}>
        {t('driver.run.secure')}
      </Button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('driver.run.secureTitle')}>
        <p class="hint">{t('driver.run.secureLede', { what: booking.description })}</p>
        <Checklist items={required} checked={done} onToggle={setDone} />

        <div class="field" style="margin-top:12px">
          <label class="field__label" for={`sec-${booking.bookingId}`}>
            {t('driver.run.securePhoto')}
          </label>
          <input id={`sec-${booking.bookingId}`} class="input" value={photo} placeholder={t('driver.run.securePhotoPh')} onInput={(e) => setPhoto(e.currentTarget.value)} />
        </div>
        <p class="hint">{t('driver.run.securePhotoHint')}</p>

        <Button
          chevron={false}
          disabled={!ready}
          busy={state.busy === `secure:${booking.bookingId}`}
          onClick={async () => {
            if (await actions.secureBooking(run.departureId, booking.bookingId, done, photo.trim() || undefined)) {
              setDone([]);
              setPhoto('');
              setOpen(false);
            }
          }}
        >
          {t('driver.run.secureCta')}
        </Button>

        <Button variant="link" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
      </Sheet>
    </span>
  );
}
