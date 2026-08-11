import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Checklist, ErrorNote, Icon, Note, OpenInMaps, Pill, ReadAloud, Sheet, SwipeDeck } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { countdownLabel, money, offerSpoken, offersSummary, priceBreakdownLines, secondsLeft } from '../logic';
import type { OfferView } from '../types';
import type { DriverActions, DriverState } from '../useDriverApp';

export interface OffersScreenProps {
  state: DriverState;
  actions: DriverActions;
}

export function OffersScreen({ state, actions }: OffersScreenProps) {
  const t = useT();
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
    <Note tone="warn" icon="star" title={t('driver.offers.pausedTitle')} detail={t('driver.offers.pausedDetail')} />
  ) : null;

  if (offers.length === 0) {
    return (
      <div class="scr">
        <h1 class="scr__title">{t('driver.offers.emptyTitle')}</h1>
        <p class="scr__lede">{t('driver.offers.emptyLede')}</p>

        {state.error ? <ErrorNote error={state.error} /> : null}
        {pausedNote}

        <Card title={t('driver.offers.whyTitle')} tone="soft">
          {/* Say WHY, not just "none" — the three server filters, in plain words. */}
          <Checklist
            items={[
              t('driver.offers.why1'),
              t('driver.offers.why2'),
              t('driver.offers.why3', { kg: state.remaining }),
            ]}
          />
        </Card>

        <div class="scr__cta">
          <Button onClick={() => actions.go('route')}>{t('driver.offers.tryAnother')}</Button>
        </div>

        <Button variant="outline" onClick={() => actions.go('home')}>
          {t('driver.backToVan')}
        </Button>

        <div class="scr__foot">
          <ReadAloud text={() => offersSummary(0, t)} />
        </div>
      </div>
    );
  }

  return (
    <div class="scr">
      <h1 class="scr__title">{t('driver.offers.title')}</h1>
      <p class="scr__lede">{offersSummary(offers.length, t)}</p>

      {state.error ? <ErrorNote error={state.error} /> : null}
      {pausedNote}

      <SwipeDeck
        index={Math.min(state.offerIndex, offers.length - 1)}
        onIndex={actions.setOfferIndex}
        itemNoun={t('driver.offers.itemNoun')}
        label={t('driver.offers.deckLabel')}
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
          {dead ? t('driver.offers.gone') : t('driver.offers.claim')}
        </Button>
      </div>

      <Button
        variant="outline"
        busy={state.busy === ignoreKey}
        disabled={!active}
        onClick={() => active && void actions.answerOffer(active, false)}
      >
        {t('driver.offers.notThis')}
      </Button>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.go('route')}>
          {t('driver.offers.tryAnother')}
        </Button>
        <ReadAloud text={() => (active ? offerSpoken(active, t) : offersSummary(offers.length, t))} />
      </div>

      <Sheet open={confirm && !!active} onClose={() => setConfirm(false)} title={t('driver.offers.claimSheetTitle')}>
        {active ? (
          <>
            <p class="t-body">{active.message}</p>
            <Checklist
              items={[
                ...(active.price ? [t('driver.offers.earnAbout', { amount: money(active.price.total) })] : []),
                t('driver.offers.fits', { kg: active.weightKg }),
                t('driver.offers.detour', { km: active.detourKm }),
                t('driver.offers.dropAt', { dest: active.destLabel }),
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
              {t('driver.offers.claimConfirm')}
            </Button>
            <Button variant="link" onClick={() => setConfirm(false)}>
              {t('driver.notYet')}
            </Button>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}

function OfferCard({ offer, now }: { offer: OfferView; now: number }) {
  const t = useT();
  const left = secondsLeft(offer.expiresAt, now);
  return (
    <article class="offer">
      <div class="offer__top">
        <Pill tone={left <= 0 ? 'danger' : left < 120 ? 'warn' : 'info'} dot>
          {countdownLabel(left, t)}
        </Pill>
        <Pill tone="idle">{offer.kind === 'tote' ? t('driver.offers.bag') : t('driver.offers.freight')}</Pill>
      </div>

      {/* Server-composed sentence — already plain language, shown verbatim. */}
      <p class="offer__msg">{offer.message}</p>

      {/* S34 — a freight offer leads with what the driver EARNS, then the transparent breakdown behind it. */}
      {offer.price ? (
        <div class="offer__pay">
          <Icon name="wallet" size={24} class="offer__pay-ic" />
          <span class="offer__pay-amt">
            {t('driver.offers.youEarnLead')} <b>{money(offer.price.total)}</b>
          </span>
        </div>
      ) : null}

      <div class="offer__meta">
        <p class="meta">
          <Icon name="weight" size={21} class="meta__ic" />
          <span>
            {t('driver.offers.metaLoad')} <b>{offer.weightKg} kg</b>
          </span>
        </p>
        <p class="meta">
          <Icon name="pin" size={21} class="meta__ic" />
          <span>
            {t('driver.offers.metaTo')} <b>{offer.destLabel}</b>
          </span>
        </p>
        <p class="meta">
          <Icon name="route" size={21} class="meta__ic" />
          <span>
            {t('driver.offers.metaDetour')} <b>{offer.detourKm} km</b> {t('driver.offers.metaAbout')} <b>{offer.minutesAway} min</b> {t('driver.offers.metaAway')}
          </span>
        </p>
        {priceBreakdownLines(offer.price, t).map((line) => (
          <p class="meta" key={line}>
            <Icon name="check" size={21} class="meta__ic" />
            <span>{line}</span>
          </p>
        ))}
      </div>

      {/* G3 — mobile-first: hand the pickup coordinate straight to the phone's maps app for turn-by-turn. */}
      <div class="offer__nav">
        <OpenInMaps point={offer.pickupLocation} label={t('driver.navigateTo', { label: offer.pickupLabel })} />
      </div>
    </article>
  );
}
