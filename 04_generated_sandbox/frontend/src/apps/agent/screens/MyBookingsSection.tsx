import { useEffect } from 'preact/hooks';
import { Button, Icon, Note, Pill } from '../../../shared/ui';
import { formatDate, useT, type MessageKey } from '../../../shared/i18n';
import { settleWords } from '../../../shared/settle';
import type { MyBookingRow } from '../types';
import type { AgentActions, AgentState } from '../useAgentApp';

/**
 * WHAT I BOOKED — the half of F3 that was missing.
 *
 * Space could be taken and never seen again. Three ways existed to read a departure and not one of them
 * was the shipper's: the fleet's own runs, the public offer list, and the driver's roster. So a shop
 * pressed Take it, got a toast, and the booking left their world — they could not check when it leaves,
 * show it to anybody, or find out it had been called off. The route to give the space back existed and
 * no screen could reach it.
 *
 * Nothing errored, which is why it looked finished.
 *
 * Two things this list refuses to do. It does NOT tidy itself: a cancelled booking and a finished run
 * both stay, because "did I book that Tuesday truck or only think about it" is a real question and a list
 * of live rows answers it wrongly and confidently. And it does not merge the booking's state with the
 * RUN's — goods you gave back and goods a fleet stranded are not the same thing to look back on.
 */
export function MyBookingsSection({ state, actions }: { state: AgentState; actions: AgentActions }) {
  const t = useT();

  useEffect(() => {
    if (state.myBookingsState === 'idle') void actions.loadMyBookings();
  }, [state.myBookingsState, actions]);

  if (state.myBookingsState === 'loading') {
    return (
      <>
        <h2 class="scr__section">{t('agent.mine.title')}</h2>
        <p class="scr__lede" aria-live="polite">
          {t('common.loading')}
        </p>
      </>
    );
  }

  // Nothing booked is not worth a heading and an empty card on a screen that already has two lists. The
  // offers section directly above is the answer to "why is this empty", and it is already on screen.
  if (state.myBookings.length === 0) return null;

  return (
    <>
      <h2 class="scr__section">{t('agent.mine.title')}</h2>
      <p class="hint">{t('agent.mine.lede')}</p>
      <div class="rows" role="list">
        {state.myBookings.map((b) => (
          <Booking key={b.bookingId} row={b} state={state} actions={actions} />
        ))}
      </div>
    </>
  );
}

/**
 * WHAT STATE IS THIS IN, in one pill, out of two facts that can disagree.
 *
 * The run's state wins whenever it is bad news, because it is the bigger fact: a booking still reading
 * `booked` on a run that was called off is a shipper with no truck, and leading with "Booked" would be
 * the most reassuring possible way to tell them.
 */
function statusOf(b: MyBookingRow): { key: MessageKey; tone: 'ok' | 'info' | 'idle' | 'warn' } {
  if (b.bookingStatus === 'delivered') return { key: 'agent.mine.delivered', tone: 'ok' };
  if (b.runStatus === 'cancelled') return { key: 'agent.mine.calledOff', tone: 'warn' };
  if (b.bookingStatus === 'cancelled') return { key: 'agent.mine.youCancelled', tone: 'idle' };
  if (b.runStatus === 'departed') return { key: 'agent.mine.onTheRoad', tone: 'info' };
  return { key: 'agent.mine.booked', tone: 'ok' };
}

function Booking({ row, state, actions }: { row: MyBookingRow; state: AgentState; actions: AgentActions }) {
  const t = useT();
  const status = statusOf(row);
  // Their own standing time, and only theirs — three loads on one truck and the two-hour stand at the
  // second gate belongs to one shipper.
  const owed = row.waits.reduce((n, w) => n + w.amount, 0);

  return (
    <div class="row row--static" role="listitem">
      <span class="row__ic">
        <Icon name="truck" size={22} />
      </span>
      <span class="row__body">
        <span class="row__t">{row.description}</span>
        <span class="row__s">{t('agent.mine.with', { company: row.company, from: row.originZone, to: row.destZone })}</span>
        <span class="row__s">
          {t('agent.mine.leaves', { when: formatDate(row.leavesAt, { dateStyle: 'medium', timeStyle: 'short' }) })}
          {' · '}
          {t('agent.mine.paid', { amount: row.price, currency: row.currency, kg: row.weightKg })}
        </span>

        {/* WHY IT IS OFF, on the screen rather than only in the notification. That notice went out once,
            the day it happened; the shipper looking at the wreckage of their week a fortnight later is
            reading this. */}
        {row.runStatus === 'cancelled' && row.bookingStatus !== 'cancelled' ? (
          <Note
            tone="warn"
            icon="info"
            title={t('agent.mine.strandedTitle', { company: row.company })}
            detail={row.cancelledReason || t('agent.mine.noReason')}
          />
        ) : null}

        {row.bookingStatus === 'delivered' ? (
          <span class="row__s">
            {row.receivedBy
              ? t('agent.mine.deliveredTo', { who: row.receivedBy, when: formatDate(row.deliveredAt ?? '', { dateStyle: 'medium', timeStyle: 'short' }) })
              : t('agent.mine.deliveredAt', { when: formatDate(row.deliveredAt ?? '', { dateStyle: 'medium', timeStyle: 'short' }) })}
          </span>
        ) : null}

        {/* What standing time has cost THEM. Shown whenever there is a charge, never as a silent zero:
            a shipper who is billed for a wait they were never told about has been billed by surprise. */}
        {owed > 0 ? <span class="row__s">{t('agent.mine.waitOwed', { amount: owed, currency: row.currency })}</span> : null}
        {/* Still here after the offer is long gone, which is when somebody actually asks who to pay. */}
        {row.bookingStatus !== 'cancelled' ? <span class="row__s">{settleWords(row.settle, t)}</span> : null}
      </span>
      <span class="row__end">
        <Pill tone={status.tone} dot>
          {t(status.key)}
        </Pill>
        {/* The server decides this and says so, so the button is absent rather than present-and-refusing:
            once the truck has gone there is nothing to give back. */}
        {row.cancellable ? (
          <Button variant="link" full={false} busy={state.busy === `unbook:${row.bookingId}`} onClick={() => void actions.cancelMyBooking(row.departureId, row.bookingId)}>
            {t('agent.mine.giveBack')}
          </Button>
        ) : null}
      </span>
    </div>
  );
}
