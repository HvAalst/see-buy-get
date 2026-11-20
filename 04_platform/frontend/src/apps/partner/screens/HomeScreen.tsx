import { useT, type MessageKey, type Translate } from '../../../shared/i18n';
import type { LiveState } from '../../../shared/live';
import { cash } from '../../../shared/money';
import { workWords, type PartnerOwedRow } from '../../../shared/partnerOwed';
import { InstallBar } from '../../../shared/ui/InstallBar';
import type { PartnerOwed, PartnerPayouts } from '../api';
import type { PartnerState } from '../usePartnerApp';

/**
 * 2026-11-20 — WHAT WE OWE (the payments plan, 3c; the owner: "partner app with live view"). What the partner owes in all,
 * and every step newest first — which work, by whom, for which parcel or bag, and its amount — read again as each step is
 * done. Said live or not live, never left to be guessed. What is paid in and out comes with the money itself (step 4).
 */
export const KIND: Record<PartnerOwedRow['payeeKind'], MessageKey> = { shop: 'partner.app.kind.shop', hub: 'partner.app.kind.hub', driver: 'partner.app.kind.driver', fleet: 'partner.app.kind.fleet' };

export const when = (at: string) => new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Live, or not live and why the figures may be behind. */
export function LiveTag({ live, t }: { live: LiveState; t: Translate }) {
  return <span class={`ctag ctag--${live === 'live' ? 'ok' : 'quiet'}`}>{t(live === 'live' ? 'partner.app.owed.live' : 'partner.app.owed.notLive')}</span>;
}

/**
 * 2026-11-20 — ITS PAYOUTS (the payments plan, 4c; P3-d "the partner is told"): what waits for its account to hold enough,
 * first and in the warning's colour; what waits in all; what was paid out so far, and what is still to pay.
 */
export function PayoutsNote({ owed, payouts, t }: { owed: PartnerOwed; payouts: PartnerPayouts | null; t: Translate }) {
  if (!payouts) return null;
  const open = Math.round((owed.owed - payouts.paidAmount) * 100) / 100;
  return (
    <>
      {payouts.shortAmount > 0 ? <p class="cerr">{t('partner.app.pay.short', { amount: cash(payouts.shortAmount, payouts.currency) })}</p> : null}
      {payouts.waiting > 0 ? <p class="pa-total">{t('partner.app.pay.waiting', { n: payouts.waiting, amount: cash(payouts.waitingAmount, payouts.currency) })}</p> : null}
      {payouts.paidAmount > 0 ? <p class="chint">{t('partner.app.pay.paid', { amount: cash(payouts.paidAmount, payouts.currency), open: cash(Math.max(open, 0), payouts.currency) })}</p> : null}
    </>
  );
}

/** The screen's inside, from what the server said — pure, for the test and the install screenshot. */
export function OwedBody({ owed, payouts = null, failed, live, t, install }: { owed: PartnerOwed | null; payouts?: PartnerPayouts | null; failed: boolean; live: LiveState; t: Translate; /** The call to install, first on the home — left out of a test or a screenshot. */ install?: boolean }) {
  return (
    <>
      {install ? <InstallBar app="partner" /> : null}
      <header class="cons__head">
        <h1 class="cons__title">{t('partner.app.owed.title')}</h1>
        <p class="cons__lede">{t('partner.app.owed.lede')}</p>
      </header>
      <p class="pa-live">
        <LiveTag live={live} t={t} />
      </p>
      {failed ? <p class="cerr">{t('partner.app.failed')}</p> : null}
      {!owed ? (
        <p class="cons__empty" aria-busy="true" />
      ) : owed.lines.length === 0 ? (
        <p class="cons__empty">{t('partner.app.owed.none')}</p>
      ) : (
        <section class="cons__panel">
          <p class="pa-total">{t('partner.app.owed.total', { amount: cash(owed.owed, owed.currency) })}</p>
          <PayoutsNote owed={owed} payouts={payouts} t={t} />
          <p class="cfield__label">{t('partner.app.owed.latest')}</p>
          <div class="crows">
            {owed.lines.slice(0, 100).map((l) => (
              <div class="crow" key={l.lineId}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">{t(workWords(l))}</span>
                    <span class="ctag ctag--quiet">{t(KIND[l.payeeKind])}</span>
                    {l.takenBack ? <span class="ctag ctag--quiet">{t('partner.owed.takenBack')}</span> : null}
                    {l.paid ? <span class="ctag ctag--ok">{t('partner.owed.paid')}</span> : null}
                  </span>
                  <span class="crow__sub">
                    {owed.names[l.payeeId] ?? l.payeeId} · {l.reference} · {when(l.at)}
                  </span>
                </span>
                <span class="crow__end">{cash(l.amount, l.currency)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <p class="chint">{t('partner.app.pay.daily')}</p>
    </>
  );
}

export function HomeScreen({ state }: { state: PartnerState }) {
  const t = useT();
  return <OwedBody owed={state.owed} payouts={state.payouts} failed={state.owedFailed} live={state.live} t={t} install />;
}
