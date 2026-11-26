import { useT, type MessageKey, type Translate } from '../../../shared/i18n';
import type { LiveState } from '../../../shared/live';
import { cash } from '../../../shared/money';
import type { PartnerMollie, PartnerMoney, PartnerStatements } from '../api';
import type { PartnerActions, PartnerState } from '../usePartnerApp';
import { mollieBackSays, type MollieBack } from '../../../shared/account/mollie';
import type { SbgError } from '../../../lib/sbg';
import { KIND, LiveTag, when } from './HomeScreen';

/**
 * 2026-11-21 — THE PARTNER'S MONEY (the payments plan, 4e: "Paid in", "Paid out" and "Waiting", live). What senders paid into its
 * account and what went back to them, what it paid its shops, hubs and drivers and what waits — and why — what the account
 * holds, and our fee it owes. Read again as each payment or payout moves; each hand by its name, a sender never by a phone.
 */
const IN_STATE: Record<PartnerMoney['ins'][number]['state'], MessageKey> = {
  asked: 'partner.app.money.state.asked',
  paid: 'partner.app.money.state.paid',
  failed: 'partner.app.money.state.failed',
};
const WAIT: Record<NonNullable<PartnerMoney['payouts'][number]['why']>, MessageKey> = {
  no_number: 'partner.app.money.wait.no_number',
  number_new: 'partner.app.money.wait.number_new',
  no_bank: 'partner.app.money.wait.no_bank',
  bank_new: 'partner.app.money.wait.bank_new',
  balance: 'partner.app.money.wait.balance',
  refused: 'partner.app.money.wait.refused',
  unreachable: 'partner.app.money.wait.unreachable',
};

/** The screen's inside, from what the server said — pure, for the test. */
export function MoneyBody({ money, failed, live, t }: { money: PartnerMoney | null; failed: boolean; live: LiveState; t: Translate }) {
  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('partner.app.money.title')}</h1>
        <p class="cons__lede">{t('partner.app.money.lede')}</p>
      </header>
      <p class="pa-live">
        <LiveTag live={live} t={t} />
        {money?.test ? <span class="ctag ctag--warn">{t('partner.app.money.test')}</span> : null}
      </p>
      {failed ? <p class="cerr">{t('partner.app.failed')}</p> : null}
      {!money ? (
        <p class="cons__empty" aria-busy="true" />
      ) : (
        <>
          <section class="cons__panel">
            {money.balance != null ? <p class="pa-total">{t('partner.app.money.holds', { amount: cash(money.balance, money.currency) })}</p> : null}
            <div class="crows">
              <div class="crow">
                <span class="crow__body">
                  <span class="crow__name">{t('partner.app.money.paidIn')}</span>
                  {money.givenBack > 0 ? <span class="crow__sub">{t('partner.app.money.givenBack', { amount: cash(money.givenBack, money.currency) })}</span> : null}
                </span>
                <span class="crow__end">{cash(money.paidIn, money.currency)}</span>
              </div>
              <div class="crow">
                <span class="crow__body">
                  <span class="crow__name">{t('partner.app.money.paidOut')}</span>
                </span>
                <span class="crow__end">{cash(money.paidOut, money.currency)}</span>
              </div>
              <div class="crow">
                <span class="crow__body">
                  <span class="crow__name">{t('partner.app.money.waiting')}</span>
                  {money.waiting > 0 ? <span class="crow__sub">{t('partner.app.pay.waiting', { n: money.waiting, amount: cash(money.waitingAmount, money.currency) })}</span> : null}
                </span>
                <span class="crow__end">{cash(money.waitingAmount, money.currency)}</span>
              </div>
            </div>
            {money.shortAmount > 0 ? <p class="cerr">{t('partner.app.pay.short', { amount: cash(money.shortAmount, money.currency) })}</p> : null}
            <p class="chint">{t('partner.app.money.fee', { amount: cash(money.feeOwed, money.currency) })}</p>
          </section>

          <section class="cons__panel">
            <p class="cfield__label">{t('partner.app.money.insTitle')}</p>
            {money.ins.length === 0 ? (
              <p class="cons__empty">{t('partner.app.money.insNone')}</p>
            ) : (
              <div class="crows">
                {money.ins.slice(0, 50).map((p, i) => (
                  <div class="crow" key={`${p.reference}-${i}`}>
                    <span class="crow__body">
                      <span class="crow__top">
                        <span class="crow__name">{p.reference}</span>
                        <span class={`ctag ${p.state === 'paid' ? 'ctag--ok' : p.state === 'failed' ? 'ctag--warn' : 'ctag--quiet'}`}>{t(IN_STATE[p.state])}</span>
                        {p.givenBack ? <span class="ctag ctag--quiet">{t('partner.app.money.backTag')}</span> : null}
                      </span>
                      <span class="crow__sub">{when(p.at)}</span>
                    </span>
                    <span class="crow__end">{cash(p.amount, p.currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section class="cons__panel">
            <p class="cfield__label">{t('partner.app.money.outTitle')}</p>
            {money.payouts.length === 0 ? (
              <p class="cons__empty">{t('partner.app.money.outNone')}</p>
            ) : (
              <div class="crows">
                {money.payouts.slice(0, 50).map((o) => (
                  <div class="crow" key={o.payoutId}>
                    <span class="crow__body">
                      <span class="crow__top">
                        <span class="crow__name">{money.names[o.payeeId] ?? o.payeeId}</span>
                        <span class="ctag ctag--quiet">{t(KIND[o.payeeKind])}</span>
                        <span class={`ctag ${o.state === 'paid' ? 'ctag--ok' : 'ctag--warn'}`}>{o.state === 'paid' ? t('partner.app.money.outPaid') : t('partner.app.money.outWaits', { why: t(WAIT[o.why ?? 'unreachable']) })}</span>
                      </span>
                      <span class="crow__sub">
                        {t('partner.app.hands.steps', { n: o.steps })} · {o.day}
                      </span>
                    </span>
                    <span class="crow__end">{cash(o.amount, o.currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

/**
 * 2026-11-24 — WHAT SEEBUYGET OWES YOU, WEEK BY WEEK (route plan part 4; the owner: "we owe it weekly"): for your hands' work on
 * parcels a company of ours sold, each week Sunday to Saturday, and whether it was paid, with the bank transfer's reference.
 */
export function StatementsSection({ view, t }: { view: PartnerStatements | null; t: Translate }) {
  if (!view || view.statements.length === 0) return null;
  const unpaid = Object.entries(view.unpaid).map(([currency, amount]) => cash(amount, currency));
  return (
    <section class="cons__panel">
      <p class="cfield__label">{t('partner.app.statements.title')}</p>
      <p class="chint">{unpaid.length ? t('partner.app.statements.unpaid', { amount: unpaid.join(' + ') }) : t('partner.app.statements.allPaid')}</p>
      <div class="crows">
        {view.statements.slice(0, 26).map((s) => (
          <div class="crow" key={s.statementId}>
            <span class="crow__body">
              <span class="crow__top">
                <span class="crow__name">{t('partner.app.statements.week', { from: s.weekStart, to: s.weekEnd })}</span>
                <span class={`ctag ${s.paidAt ? 'ctag--ok' : s.closed ? 'ctag--warn' : 'ctag--quiet'}`}>{s.paidAt ? t('partner.app.statements.paid', { date: s.paidAt.slice(0, 10), reference: s.paidReference ?? '' }) : t(s.closed ? 'partner.app.statements.toPay' : 'partner.app.statements.open')}</span>
              </span>
              <span class="crow__sub">{t('partner.app.statements.who', { company: s.sellerName, n: s.steps })}</span>
            </span>
            <span class="crow__end">{cash(s.amount, s.currency)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * 2026-11-26 — PAYMENTS AT YOUR COUNTERS (the weakness after route plan part 4b, fixed as recommended): in a country of the European
 * Union, senders pay at the partner's shops from a QR code, into the partner's own Mollie account. Connected here, by the partner's
 * own people — they sign in to Mollie themselves, and nobody types a key. Until it is connected, and while Mollie still checks it,
 * the counters take test money. Not shown where the counters' payments go another way.
 */
export function CounterPaymentsSection({ view, back, busy, error, onConnect, onDisconnect, t }: { view: PartnerMollie | null; back: MollieBack | null; busy: boolean; error: SbgError | null; onConnect: () => void; onDisconnect: () => void; t: Translate }) {
  if (!view || (!view.available && view.why === 'country')) return null;
  const c = view.connected;
  const said = back ? mollieBackSays(back, t as never) : null;
  return (
    <section class="cons__panel">
      <p class="cfield__label">{t('partner.app.mollie.title')}</p>
      {said ? <p class={said.tone === 'ok' ? 'chint' : 'cerr'}>{said.title}</p> : null}
      <p class="chint">{t('partner.app.mollie.body')}</p>
      {!view.available ? (
        <p class="chint">{t('partner.app.mollie.off')}</p>
      ) : c ? (
        <>
          <div class="crow">
            <span class="crow__body">
              <span class="crow__top">
                <span class="crow__name">{c.organizationName ? t('partner.app.mollie.connected', { name: c.organizationName }) : t('partner.app.mollie.connectedPlain')}</span>
                {c.testmode ? <span class="ctag ctag--warn">{t('partner.app.mollie.test')}</span> : null}
              </span>
              <span class="crow__sub">{view.connectedBy ? t('partner.app.mollie.connectedBy', { name: view.connectedBy, at: when(c.connectedAt) }) : when(c.connectedAt)}</span>
            </span>
          </div>
          {view.needsRegistration && !view.notYours ? <p class="cerr">{t('partner.app.mollie.needsRegistration')}</p> : null}
          {view.notYours ? <p class="cerr">{t('partner.app.mollie.notYours', { name: view.notYours.organizationName ?? '', reg: view.notYours.registrationNumber ?? '', expected: view.notYours.expected ?? '' })}</p> : null}
          {c.lostAt ? <p class="cerr">{t('partner.app.mollie.lost')}</p> : c.canReceivePayments === false ? <p class="chint">{t('partner.app.mollie.checking')}</p> : null}
          {c.lostAt ? (
            <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={onConnect}>
              {t('partner.app.mollie.connect')}
            </button>
          ) : (
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={onDisconnect}>
              {t('partner.app.mollie.disconnect')}
            </button>
          )}
        </>
      ) : (
        <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={onConnect}>
          {t('partner.app.mollie.connect')}
        </button>
      )}
      {error ? <p class="cerr">{error.detail ?? error.title}</p> : null}
    </section>
  );
}

export function MoneyScreen({ state, actions }: { state: PartnerState; actions: PartnerActions }) {
  const t = useT();
  return (
    <>
      <MoneyBody money={state.money} failed={state.owedFailed} live={state.live} t={t} />
      <CounterPaymentsSection view={state.mollie} back={state.mollieBack} busy={state.mollieBusy} error={state.mollieError} onConnect={() => void actions.connectMollie()} onDisconnect={() => void actions.disconnectMollie()} t={t} />
      <StatementsSection view={state.statements} t={t} />
    </>
  );
}
