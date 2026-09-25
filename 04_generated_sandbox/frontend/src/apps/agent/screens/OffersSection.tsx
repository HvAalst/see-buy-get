import { useEffect, useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Icon, Note, Pill, Sheet } from '../../../shared/ui';
import { formatDate, useT, type MessageKey } from '../../../shared/i18n';
import type { OfferRow } from '../types';
import type { AgentActions, AgentState } from '../useAgentApp';

/**
 * F3, THE SHIPPER'S SIDE — space on a run that is already going.
 *
 * It sits under the posted loads because it is the SAME DECISION made the other way round. A shop with
 * something to move can post it and wait for carriers to price it, which is right when the load is the
 * scarce thing; or it can take space on a truck that is leaving anyway, which is cheaper for everybody and
 * had no door until now. Putting the two in one place is the point — a shop choosing between them should
 * not have to know that the product thinks of them as different markets.
 *
 * THE PRICE IS SAID BEFORE ANYTHING IS TAKEN, the same rule the top-up fee is held to. The quote refuses
 * for every reason the booking would, so "only 12 m³ of space is left" arrives while the shop can still do
 * something about it rather than at the moment they press the button.
 */
export function OffersSection({ state, actions }: { state: AgentState; actions: AgentActions }) {
  const t = useT();

  // Loaded on first sight, like the posted list. A shop that never scrolls here never pays for the call.
  useEffect(() => {
    if (state.offersState === 'idle') void actions.loadOffers();
  }, [state.offersState, actions]);

  return (
    <>
      <h2 class="scr__section">{t('agent.offers.title')}</h2>
      <p class="hint">{t('agent.offers.lede')}</p>

      {state.offersState === 'loading' ? (
        <p class="scr__lede" aria-live="polite">
          {t('common.loading')}
        </p>
      ) : state.offers.length === 0 ? (
        <Card tone="soft">
          <p class="card__note">{t('agent.offers.none')}</p>
        </Card>
      ) : (
        <div class="rows" role="list">
          {state.offers.map((o) => (
            <Offer key={o.departureId} offer={o} onTake={() => actions.openOffer(o)} />
          ))}
        </div>
      )}

      <TakeSpace state={state} actions={actions} />
    </>
  );
}

const BASIS_WORD: Record<string, MessageKey> = {
  per_trip: 'agent.offers.basisTrip',
  per_km: 'agent.offers.basisKm',
  per_kg: 'agent.offers.basisKg',
};

function Offer({ offer, onTake }: { offer: OfferRow; onTake: () => void }) {
  const t = useT();
  return (
    <div class="row row--static" role="listitem">
      <span class="row__ic">
        <Icon name="truck" size={22} />
      </span>
      <span class="row__body">
        <span class="row__t">{offer.company}</span>
        <span class="row__s">{t('agent.offers.route', { from: offer.originZone, to: offer.destZone })}</span>
        <span class="row__s">{t('agent.offers.leaves', { when: formatDate(offer.leavesAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
        <span class="row__s">
          {t('agent.offers.priced', { amount: offer.rate.amount, currency: offer.rate.currency, basis: t(BASIS_WORD[offer.rate.basis] ?? 'agent.offers.basisTrip') })}
          {' · '}
          {offer.remainingM3 != null ? t('agent.offers.leftBoth', { kg: offer.remainingKg, m3: offer.remainingM3 }) : t('agent.offers.left', { kg: offer.remainingKg })}
        </span>
        {/* THE WAITING TERMS, before booking rather than after. The one thing worse than being charged for
            keeping a truck standing is being charged for it by surprise — and a shop that can read this can
            plan a loading bay around it. */}
        <span class="row__s">
          {offer.waiting ? t('agent.offers.terms', { minutes: offer.waiting.freeMin, rate: offer.waiting.perHour, currency: offer.rate.currency }) : t('agent.offers.noTerms')}
        </span>
        {offer.note ? <span class="row__s">{offer.note}</span> : null}
      </span>
      <span class="row__end">
        <Pill tone="idle">{offer.booked === 0 ? t('agent.offers.bookedNone') : t('agent.offers.booked', { count: offer.booked })}</Pill>
        <Button variant="outline" full={false} chevron={false} onClick={onTake}>
          {t('agent.offers.take')}
        </Button>
      </span>
    </div>
  );
}

/**
 * Describe the load, see what it costs, then take it.
 *
 * Two steps, not one. A shop that books and THEN learns the price has been told the price by an invoice,
 * and the whole reason the quote route exists is so that never happens.
 */
function TakeSpace({ state, actions }: { state: AgentState; actions: AgentActions }) {
  const t = useT();
  const offer = state.offerFor;
  const [what, setWhat] = useState('');
  const [kg, setKg] = useState('');
  const [m3, setM3] = useState('');

  useEffect(() => {
    if (offer) {
      setWhat('');
      setKg('');
      setM3('');
    }
  }, [offer?.departureId]);

  if (!offer) return null;

  const load = { description: what.trim(), weightKg: Number(kg), ...(Number(m3) > 0 ? { volumeM3: Number(m3) } : {}) };
  const blocker: MessageKey | null = !what.trim() ? 'agent.offers.needWhat' : !(Number(kg) > 0) ? 'agent.offers.needKg' : null;
  const quote = state.offerQuote;

  return (
    <Sheet open onClose={() => actions.openOffer(null)} title={t('agent.offers.sheetTitle', { company: offer.company })}>
      <div class="field">
        <label class="field__label" for="o-what">
          {t('agent.offers.what')}
        </label>
        <input
          id="o-what"
          class="input"
          value={what}
          placeholder={t('agent.offers.whatPh')}
          onInput={(e) => {
            setWhat(e.currentTarget.value);
            actions.clearOfferQuote();
          }}
        />
      </div>

      <div class="grid2" style="margin-top:12px">
        <div class="field">
          <label class="field__label" for="o-kg">
            {t('agent.offers.kg')}
          </label>
          <input
            id="o-kg"
            class="input"
            inputMode="decimal"
            value={kg}
            onInput={(e) => {
              setKg(e.currentTarget.value);
              actions.clearOfferQuote();
            }}
          />
        </div>
        <div class="field">
          <label class="field__label" for="o-m3">
            {t('agent.offers.m3')}
          </label>
          <input
            id="o-m3"
            class="input"
            inputMode="decimal"
            value={m3}
            onInput={(e) => {
              setM3(e.currentTarget.value);
              actions.clearOfferQuote();
            }}
          />
        </div>
      </div>
      <p class="hint">{t('agent.offers.m3Hint')}</p>

      {/* A refusal belongs BESIDE the fields that caused it — "only 12 m³ is left" is an answer to the
          question just asked, not a page-level failure. */}
      {state.offerQuoteError ? <ErrorNote error={state.offerQuoteError} showDetail /> : null}

      {quote ? (
        <Note
          tone="info"
          icon="wallet"
          title={t('agent.offers.quoted', { price: quote.price, currency: quote.currency })}
          detail={t(quote.binds === 'space' ? 'agent.offers.bindsSpace' : 'agent.offers.bindsWeight')}
        />
      ) : null}

      {quote ? (
        <Button chevron={false} busy={state.busy === 'book-offer'} onClick={() => void actions.bookOffer(load)}>
          {t('agent.offers.book')}
        </Button>
      ) : (
        <Button chevron={false} disabled={blocker !== null} busy={state.busy === 'quote-offer'} onClick={() => void actions.quoteOffer(load)}>
          {t('agent.offers.quote')}
        </Button>
      )}
      {blocker ? <p class="hint" style="margin-top:8px">{t(blocker)}</p> : null}

      <Button variant="link" onClick={() => actions.openOffer(null)}>
        {t('common.cancel')}
      </Button>
    </Sheet>
  );
}
