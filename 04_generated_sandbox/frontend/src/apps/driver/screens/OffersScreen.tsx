import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Checklist, ErrorNote, Icon, Note, OpenInMaps, Pill, ReadAloud, Sheet, SwipeDeck } from '../../../shared/ui';
import { countdownLabel, money, offerSpoken, offersSummary, priceBreakdownLines, secondsLeft } from '../logic';
import type { OfferView } from '../types';
import type { DriverActions, DriverState } from '../useDriverApp';

export interface OffersScreenProps {
  state: DriverState;
  actions: DriverActions;
}

export function OffersScreen({ state, actions }: OffersScreenProps) {
  const [confirm, setConfirm] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Offers live for 10 minutes and the server auto-expires them on read. A ticking clock is
  // the difference between "claim it now" and tapping a card that died four minutes ago.
  useEffect(() => {
    if (state.offers.length === 0) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [state.offers.length]);

  const offers = state.offers;
  const active = offers[state.offerIndex];
  const left = active ? secondsLeft(active.expiresAt, now) : 0;
  const dead = !!active && left <= 0;
  const claimKey = active ? `claim:${active.offerId}` : '';
  const ignoreKey = active ? `ignore:${active.offerId}` : '';

  // REP4 — if the driver's rating has fallen below the network floor, freight is withheld. Say so plainly (and
  // recoverably) so an empty/thin marketplace isn't a mystery.
  const pausedNote = state.driver?.freightPaused ? (
    <Note tone="warn" icon="star" title="Freight is paused" detail="Your rating is below the network minimum, so freight loads are held back. Keep your parcel runs on time — as your rating recovers, freight comes back." />
  ) : null;

  if (offers.length === 0) {
    return (
      <div class="scr">
        <h1 class="scr__title">Nothing on this route</h1>
        <p class="scr__lede">No shipments are waiting between those two places right now.</p>

        {state.error ? <ErrorNote error={state.error} /> : null}
        {pausedNote}

        <Card title="Why you might see nothing" tone="soft">
          {/* Say WHY, not just "none" — the three server filters, in plain words. */}
          <Checklist
            items={[
              'Nothing is waiting near this route',
              'The detour would be too far off your way',
              `Loads bigger than your ${state.remaining} kg of space are hidden`,
            ]}
          />
        </Card>

        <div class="scr__cta">
          <Button onClick={() => actions.go('route')}>Try another route</Button>
        </div>

        <Button variant="outline" onClick={() => actions.go('home')}>
          Back to my van
        </Button>

        <div class="scr__foot">
          <ReadAloud text={() => offersSummary(0)} />
        </div>
      </div>
    );
  }

  return (
    <div class="scr">
      <h1 class="scr__title">On your way</h1>
      <p class="scr__lede">{offersSummary(offers.length)}</p>

      {state.error ? <ErrorNote error={state.error} /> : null}
      {pausedNote}

      <SwipeDeck
        index={Math.min(state.offerIndex, offers.length - 1)}
        onIndex={actions.setOfferIndex}
        itemNoun="Load"
        label="Shipments on your route"
      >
        {offers.map((o) => (
          <OfferCard key={o.offerId} offer={o} now={now} />
        ))}
      </SwipeDeck>

      <div class="scr__cta">
        <Button
          onClick={() => setConfirm(true)}
          disabled={!active || dead}
          busy={state.busy === claimKey}
        >
          {dead ? 'This one has gone' : 'Claim this load'}
        </Button>
      </div>

      <Button
        variant="outline"
        busy={state.busy === ignoreKey}
        disabled={!active}
        onClick={() => active && void actions.answerOffer(active, false)}
      >
        Not this one
      </Button>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.go('route')}>
          Try another route
        </Button>
        <ReadAloud text={() => (active ? offerSpoken(active) : offersSummary(offers.length))} />
      </div>

      <Sheet open={confirm && !!active} onClose={() => setConfirm(false)} title="Claim this load?">
        {active ? (
          <>
            <p class="t-body">{active.message}</p>
            <Checklist
              items={[
                ...(active.price ? [`You earn about ${money(active.price.total)} — the final price locks when you claim`] : []),
                `${active.weightKg} kg — fits the space you have left`,
                `${active.detourKm} km extra driving`,
                `Drop it at ${active.destLabel}`,
              ]}
            />
            <Button
              chevron={false}
              busy={state.busy === claimKey}
              onClick={() => {
                setConfirm(false);
                void actions.answerOffer(active, true);
              }}
            >
              Yes, it is mine
            </Button>
            <Button variant="link" onClick={() => setConfirm(false)}>
              Not yet
            </Button>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}

function OfferCard({ offer, now }: { offer: OfferView; now: number }) {
  const left = secondsLeft(offer.expiresAt, now);
  return (
    <article class="offer">
      <div class="offer__top">
        <Pill tone={left <= 0 ? 'danger' : left < 120 ? 'warn' : 'info'} dot>
          {countdownLabel(left)}
        </Pill>
        <Pill tone="idle">{offer.kind === 'tote' ? 'Bag' : 'Freight'}</Pill>
      </div>

      {/* Server-composed sentence — already plain language, shown verbatim. */}
      <p class="offer__msg">{offer.message}</p>

      {/* S34 — a freight offer leads with what the driver EARNS, then the transparent breakdown behind it. */}
      {offer.price ? (
        <div class="offer__pay">
          <Icon name="wallet" size={24} class="offer__pay-ic" />
          <span class="offer__pay-amt">
            You earn <b>{money(offer.price.total)}</b>
          </span>
        </div>
      ) : null}

      <div class="offer__meta">
        <p class="meta">
          <Icon name="weight" size={21} class="meta__ic" />
          <span>
            Load <b>{offer.weightKg} kg</b>
          </span>
        </p>
        <p class="meta">
          <Icon name="pin" size={21} class="meta__ic" />
          <span>
            To <b>{offer.destLabel}</b>
          </span>
        </p>
        <p class="meta">
          <Icon name="route" size={21} class="meta__ic" />
          <span>
            Detour <b>{offer.detourKm} km</b> · about <b>{offer.minutesAway} min</b> away
          </span>
        </p>
        {priceBreakdownLines(offer.price).map((line) => (
          <p class="meta" key={line}>
            <Icon name="check" size={21} class="meta__ic" />
            <span>{line}</span>
          </p>
        ))}
      </div>

      {/* G3 — mobile-first: hand the pickup coordinate straight to the phone's maps app for turn-by-turn. */}
      <div class="offer__nav">
        <OpenInMaps point={offer.pickupLocation} label={`Navigate to ${offer.pickupLabel}`} />
      </div>
    </article>
  );
}
