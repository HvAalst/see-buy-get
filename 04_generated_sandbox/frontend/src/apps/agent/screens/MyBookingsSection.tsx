import { useEffect, useState } from 'preact/hooks';
import { Button, ErrorNote, Icon, Note, Pill, Sheet } from '../../../shared/ui';
import { formatDate, useT, type MessageKey } from '../../../shared/i18n';
import { settleWords } from '../../../shared/settle';
import { giveBackWords } from '../../../shared/giveBack';
import { coverShortfall, coverWords } from '../../../shared/cover';
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
  // WHO gave it back. This used to read "You gave it back" for every cancelled booking — including the ones
  // the carrier gave back, which told a shipper they had done a thing that was done to them.
  if (b.bookingStatus === 'cancelled') return b.cancellation?.by === 'carrier' ? { key: 'agent.mine.givenBack', tone: 'warn' } : { key: 'agent.mine.youCancelled', tone: 'idle' };
  if (b.runStatus === 'departed') return { key: 'agent.mine.onTheRoad', tone: 'info' };
  return { key: 'agent.mine.booked', tone: 'ok' };
}

function Booking({ row, state, actions }: { row: MyBookingRow; state: AgentState; actions: AgentActions }) {
  const t = useT();
  const status = statusOf(row);
  // Their own standing time, and only theirs — three loads on one truck and the two-hour stand at the
  // second gate belongs to one shipper.
  const owed = row.waits.reduce((n, w) => n + w.amount, 0);
  // The one arithmetic worth doing here: declaring more than the carrier covers is a gap the shipper is
  // carrying, and until this screen nobody was in a position to tell them about it.
  const shortfall = coverShortfall(row.declaredValue, row.cover);

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

        {/* THE CARRIER GAVE THIS SPACE BACK, and why — kept here, not only in the notification that went
            out once. What to do next depends on the reason: goods that were not as booked can be booked
            again as what they are; anything else means another truck. */}
        {row.bookingStatus === 'cancelled' && row.cancellation?.by === 'carrier' ? (
          <Note
            tone="warn"
            icon="info"
            title={t('agent.mine.givenBackTitle', { company: row.company })}
            detail={
              giveBackWords(row.cancellation, t)
                ? `${giveBackWords(row.cancellation, t)}. ${t(row.cancellation.reason === 'goods_not_as_booked' ? 'agent.mine.givenBackRebook' : 'agent.mine.givenBackTruck')}`
                : // A booking given back before reasons were kept: the no-reason sentence already says what to do.
                  t('agent.mine.noReason')
            }
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

        {/* WHERE COVER STOOD ON THESE GOODS, read long after the offer is gone — which is when it
            matters — and beside a shortfall the shipper may never have been told about anywhere else. */}
        {row.bookingStatus !== 'cancelled' ? <span class="row__s">{coverWords(row.cover, row.currency, t)}</span> : null}
        {shortfall != null ? <span class="row__s">{t('cover.short', { amount: shortfall, currency: row.currency })}</span> : null}

        {/* THE PROOF, not just its date: the shipper is the party it exists for. And the note beside it,
            because those two together are what anybody else — a forwarder, an insurer — asks to see. */}
        {row.pod ? (
          <>
            <span class="row__s">{t('agent.mine.proof', { who: row.pod.receiverName })}</span>
            <span class="row__s">
              <a href={noteHref(row)} target="_blank" rel="noopener">
                {t('agent.mine.note')}
              </a>
            </span>
          </>
        ) : null}

        {/* A CLAIM, and the carrier’s answer. Never a decision of ours: we did not take the payment and
            we carry no cover, so what we can honestly offer is the record. */}
        {row.claim ? (
          <Note
            tone={row.claim.answer === 'accepted' ? 'ok' : row.claim.answer === 'refused' ? 'warn' : 'info'}
            icon="info"
            title={t('agent.mine.claimRaised', { when: formatDate(row.claim.raisedAt, { dateStyle: 'medium' }), what: row.claim.description })}
            detail={claimAnswer(row, t)}
          />
        ) : null}
      </span>
      <span class="row__end">
        <Pill tone={status.tone} dot>
          {t(status.key)}
        </Pill>
        {/* The server decides this and says so, so the button is absent rather than present-and-refusing:
            once the truck has gone there is nothing to give back. */}
        {row.bookingStatus === 'delivered' && row.claimable ? <ClaimIt row={row} state={state} actions={actions} /> : null}
        {row.cancellable ? (
          <Button variant="link" full={false} busy={state.busy === `unbook:${row.bookingId}`} onClick={() => void actions.cancelMyBooking(row.departureId, row.bookingId)}>
            {t('agent.mine.giveBack')}
          </Button>
        ) : null}
      </span>
    </div>
  );
}

/** Where to read the carriage document. The same page a board haul prints, on the same renderer. */
function noteHref(row: MyBookingRow): string {
  return `/v1/sbg/departures/${row.departureId}/bookings/${row.bookingId}/consignment-note.html`;
}

/**
 * What the carrier said back, or that they have not.
 *
 * Every branch ends in the same sentence: settle it between you. There is no version of this where the
 * network decides — we never held the payment and we carry no cover — and a screen that left that out
 * would let a shipper wait for a ruling that is never coming.
 */
function claimAnswer(row: MyBookingRow, t: ReturnType<typeof useT>): string {
  if (!row.claim?.answeredAt) return t('agent.mine.claimWaiting');
  const note = row.claim.answerNote ? `: ${row.claim.answerNote}` : '.';
  const said = t(row.claim.answer === 'accepted' ? 'agent.mine.claimAccepted' : 'agent.mine.claimRefused', { note });
  return `${said} ${t('agent.mine.claimBetween')}`;
}

/**
 * SOMETHING WENT WRONG — the sheet, and the sentence that has to be on it.
 *
 * This network does not decide this and does not pay it: we never held the payment and we carry no cover
 * on the goods. Saying so ON THE SHEET, before anybody types, is the difference between a record two
 * parties can use and a false expectation we created ourselves.
 *
 * What they DO get is the thing informal freight has never had: a dated claim against a consignment note,
 * beside the photograph of the load as secured and the photograph of it as delivered, with the carrier’s
 * answer on the same page. Two people arguing in a WhatsApp thread have none of that.
 */
function ClaimIt({ row, state, actions }: { row: MyBookingRow; state: AgentState; actions: AgentActions }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('damaged');
  const [what, setWhat] = useState('');
  const [amount, setAmount] = useState('');

  return (
    <>
      <Button variant="link" full={false} onClick={() => setOpen(true)}>
        {t('agent.mine.claim')}
      </Button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('agent.mine.claimTitle')}>
        <p class="hint">{t('agent.mine.claimLede', { company: row.company })}</p>

        <div class="field">
          <label class="field__label" for={`c-kind-${row.bookingId}`}>
            {t('agent.mine.claimKind')}
          </label>
          <select id={`c-kind-${row.bookingId}`} class="select" value={kind} onChange={(e) => setKind(e.currentTarget.value)}>
            <option value="damaged">{t('agent.mine.claimDamaged')}</option>
            <option value="short">{t('agent.mine.claimShort')}</option>
            <option value="not_received">{t('agent.mine.claimNotReceived')}</option>
          </select>
        </div>

        <div class="field" style="margin-top:12px">
          <label class="field__label" for={`c-what-${row.bookingId}`}>
            {t('agent.mine.claimWhat')}
          </label>
          <input
            id={`c-what-${row.bookingId}`}
            class="input"
            value={what}
            placeholder={t('agent.mine.claimWhatPh')}
            onInput={(e) => setWhat(e.currentTarget.value)}
          />
        </div>

        <div class="field" style="margin-top:12px">
          <label class="field__label" for={`c-amount-${row.bookingId}`}>
            {t('agent.mine.claimAmount', { currency: row.currency })}
          </label>
          <input id={`c-amount-${row.bookingId}`} class="input" inputMode="decimal" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} />
        </div>
        <p class="hint">{t('agent.mine.claimAmountHint')}</p>

        {state.error ? <ErrorNote error={state.error} showDetail /> : null}

        <Button
          chevron={false}
          disabled={!what.trim()}
          busy={state.busy === `claim:${row.bookingId}`}
          onClick={async () => {
            const ok = await actions.raiseBookingClaim(row.departureId, row.bookingId, {
              kind,
              description: what.trim(),
              ...(Number(amount) > 0 ? { amount: Number(amount) } : {}),
            });
            if (ok) {
              setWhat('');
              setAmount('');
              setOpen(false);
            }
          }}
        >
          {t('agent.mine.claimSend')}
        </Button>
        {!what.trim() ? <p class="hint" style="margin-top:8px">{t('agent.mine.claimNeedWords')}</p> : null}

        <Button variant="link" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
      </Sheet>
    </>
  );
}
