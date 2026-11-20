import { useT, type Translate } from '../../../shared/i18n';
import { cash } from '../../../shared/money';
import type { PartnerOwed } from '../api';
import type { PartnerState } from '../usePartnerApp';
import { KIND, LiveTag } from './HomeScreen';
import type { LiveState } from '../../../shared/live';

/**
 * 2026-11-20 — PER HAND (the payments plan, 3c): what the partner owes each shop, hub, courier and fleet in all, the most
 * first, and for how many steps — each by the name the partner knows it by. A hand whose every step was taken back is owed
 * nothing, and is not listed.
 */
export function HandsBody({ owed, live, t }: { owed: PartnerOwed | null; live: LiveState; t: Translate }) {
  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('partner.app.hands.title')}</h1>
        <p class="cons__lede">{t('partner.app.hands.lede')}</p>
      </header>
      <p class="pa-live">
        <LiveTag live={live} t={t} />
      </p>
      {!owed ? (
        <p class="cons__empty" aria-busy="true" />
      ) : owed.byPayee.length === 0 ? (
        <p class="cons__empty">{t('partner.app.hands.none')}</p>
      ) : (
        <section class="cons__panel">
          <p class="pa-total">{t('partner.app.owed.total', { amount: cash(owed.owed, owed.currency) })}</p>
          <div class="crows">
            {owed.byPayee.map((h) => (
              <div class="crow" key={h.payeeId}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">{owed.names[h.payeeId] ?? h.payeeId}</span>
                    <span class="ctag ctag--quiet">{t(KIND[h.payeeKind])}</span>
                  </span>
                  <span class="crow__sub">{t('partner.app.hands.steps', { n: h.steps })}</span>
                </span>
                <span class="crow__end">{cash(h.amount, owed.currency)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function HandsScreen({ state }: { state: PartnerState }) {
  const t = useT();
  return <HandsBody owed={state.owed} live={state.live} t={t} />;
}
