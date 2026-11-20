import { useEffect, useState } from 'preact/hooks';
import { narrow, type Result } from '../../../lib/sbg';
import { useT, type MessageKey, type Translate } from '../../../shared/i18n';
import { cash } from '../../../shared/money';
import { ConsoleFold } from '../ConsoleFold';

/**
 * 2026-11-20 — THE PARTNER'S PAYMENT ACCOUNT, FOR OUR STAFF (the payments plan, step 4a; the owner: "a software that combines
 * PSP's and becomes actually a payment hub"). On a partner company's own page: which provider its money goes through — the
 * stand-in, test money, until its own provider is added and two of our staff switch it live — what the account holds, its
 * payments, and a try: a payment prompt to a phone, seen waiting, then paid or not.
 */
export type HubProviderId = 'stand-in' | 'telebirr' | 'mpesa-et' | 'chapa';
export type HubWhy = 'declined' | 'expired' | 'unreachable' | 'insufficient';

export interface HubPaymentRow {
  paymentId: string;
  kind: 'in' | 'out' | 'refund';
  reference: string;
  amount: number;
  currency: string;
  phoneEnds: string;
  state: 'asked' | 'paid' | 'failed';
  why?: HubWhy;
  test: boolean;
  askedAt: string;
  settledAt?: string;
  askedBy?: string;
  usedFor?: string;
  fee?: number;
  refundOf?: string;
}

/** 2026-11-20 — a partner's payouts to its hands (4c): what waits, and why; what was paid. */
export type PayoutWait = 'no_number' | 'number_new' | 'balance' | 'refused' | 'unreachable';
export interface PartnerPayoutsView {
  currency: string;
  waiting: number;
  waitingAmount: number;
  shortAmount: number;
  paidAmount: number;
  rows: Array<{ payoutId: string; payeeId: string; payeeKind: 'shop' | 'hub' | 'driver' | 'fleet'; amount: number; currency: string; steps: number; state: 'waiting' | 'paid'; why?: PayoutWait; day: string; paidAt?: string; askedBy?: string }>;
}

const WAIT: Record<PayoutWait, MessageKey> = {
  no_number: 'tower.partner.pay.wait.no_number',
  number_new: 'tower.partner.pay.wait.number_new',
  balance: 'tower.partner.pay.wait.balance',
  refused: 'tower.partner.pay.wait.refused',
  unreachable: 'tower.partner.pay.wait.unreachable',
};
const PAYEE: Record<PartnerPayoutsView['rows'][number]['payeeKind'], MessageKey> = { shop: 'tower.partner.kind.shop', hub: 'tower.partner.kind.hub', driver: 'tower.partner.kind.driver', fleet: 'tower.partner.kind.fleet' };

/** The partner's payouts, for our staff: what waits and why, what was paid — and paying out now, by name. */
export function PayoutsBody({ payouts, t, busy, onPayNow }: { payouts: PartnerPayoutsView; t: Translate; busy?: boolean; onPayNow?: () => void }) {
  const cur = payouts.currency;
  return (
    <>
      <p class="cfield__label">{t('tower.partner.pay.payoutsTitle')}</p>
      <p class="chint">{t('tower.partner.pay.payoutsLede')}</p>
      <p class="chint">{t('tower.partner.pay.payoutsSum', { n: payouts.waiting, amount: cash(payouts.waitingAmount, cur), paid: cash(payouts.paidAmount, cur) })}</p>
      {onPayNow ? (
        <button type="button" class="cbtn cbtn--sm" disabled={busy} onClick={onPayNow}>
          {t('tower.partner.pay.payNow')}
        </button>
      ) : null}
      {payouts.rows.length ? (
        <div class="crows">
          {payouts.rows.slice(0, 20).map((r) => (
            <div class="crow" key={r.payoutId}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">
                    {t(PAYEE[r.payeeKind])} · {r.payeeId}
                  </span>
                  <span class={`ctag ${r.state === 'paid' ? 'ctag--ok' : 'ctag--warn'}`}>{r.state === 'paid' ? t('tower.partner.pay.payoutPaid') : t('tower.partner.pay.payoutWaits', { why: t(WAIT[r.why ?? 'unreachable']) })}</span>
                </span>
                <span class="crow__sub">
                  {cash(r.amount, r.currency)} · {t('tower.partner.pay.steps', { n: r.steps })} · {r.day}
                  {r.askedBy ? ` · ${t('tower.partner.pay.payoutBy', { by: r.askedBy })}` : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

export interface PaymentAccountRead {
  account: { provider: HubProviderId; test: boolean; currency: string; ready: HubProviderId[]; balance?: number; feePct?: number; feeSetBy?: string; feeSetAt?: string; feeOwed: number };
  payments: HubPaymentRow[];
}

const PROVIDER: Record<HubProviderId, MessageKey> = {
  'stand-in': 'tower.partner.pay.provider.standIn',
  telebirr: 'tower.partner.pay.provider.telebirr',
  'mpesa-et': 'tower.partner.pay.provider.mpesaEt',
  chapa: 'tower.partner.pay.provider.chapa',
};
const KIND: Record<HubPaymentRow['kind'], MessageKey> = { in: 'tower.partner.pay.kind.in', out: 'tower.partner.pay.kind.out', refund: 'tower.partner.pay.kind.refund' };
const WHY: Record<HubWhy, MessageKey> = {
  declined: 'tower.partner.pay.why.declined',
  expired: 'tower.partner.pay.why.expired',
  unreachable: 'tower.partner.pay.why.unreachable',
  insufficient: 'tower.partner.pay.why.insufficient',
};
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');
/** Read again this often while a prompt waits, and for no longer than a prompt can wait. */
const LOOK_EVERY_MS = 3_000;
const LOOK_FOR_MS = 3 * 60_000;

/** Where one payment stands, in words: waiting, paid, or not paid and why. */
export function paymentState(p: HubPaymentRow, t: Translate): string {
  if (p.state === 'asked') return t('tower.partner.pay.state.asked');
  if (p.state === 'paid') return t('tower.partner.pay.state.paid');
  return p.why ? t('tower.partner.pay.state.failedWhy', { why: t(WHY[p.why]) }) : t('tower.partner.pay.state.failed');
}

/** The fold's inside, from what the server said — pure, for the test. */
export function PaymentAccountBody({ read, t, busy, onTry, onFee }: { read: PaymentAccountRead; t: Translate; busy?: boolean; onTry?: (phone: string, amount: number) => void; onFee?: (pct: number) => void }) {
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [pct, setPct] = useState('');
  const pctFigure = Number(pct);
  const pctReady = pct.trim() !== '' && Number.isFinite(pctFigure) && pctFigure >= 0 && pctFigure <= 50;
  const a = read.account;
  const figure = Number(amount);
  const ready = /^\+\d{9,15}$/.test(phone.replace(/[\s-]/g, '')) && Number.isFinite(figure) && figure >= 1;
  return (
    <>
      <p class="chint">{t('tower.partner.pay.lede')}</p>
      <div class="crows">
        <div class="crow">
          <span class="crow__body">
            <span class="crow__top">
              <span class="crow__name">{t(PROVIDER[a.provider])}</span>
              {a.test ? <span class="ctag ctag--warn">{t('tower.partner.pay.test')}</span> : null}
            </span>
            <span class="crow__sub">{a.balance != null ? t('tower.partner.pay.holds', { amount: cash(a.balance, a.currency) }) : t('tower.partner.pay.holdsUnknown')}</span>
          </span>
        </div>
      </div>
      {a.test ? <p class="chint">{t('tower.partner.pay.ownLater')}</p> : null}
      <p class="cfield__label">{t('tower.partner.pay.feeTitle')}</p>
      <p class="chint">{t('tower.partner.pay.feeLede')}</p>
      <p class="chint">
        {a.feePct != null ? t('tower.partner.pay.feeNow', { pct: a.feePct, by: a.feeSetBy ?? '', at: a.feeSetAt ? when(a.feeSetAt) : '' }) : t('tower.partner.pay.feeNone')} {t('tower.partner.pay.feeOwed', { amount: cash(a.feeOwed, a.currency) })}
      </p>
      {onFee ? (
        <div class="crow">
          <input class="cinput cinput--sm" type="number" inputMode="decimal" min={0} max={50} step="0.01" aria-label={t('tower.partner.pay.feePct')} placeholder={t('tower.partner.pay.feePct')} value={pct} onInput={(e) => setPct((e.target as HTMLInputElement).value)} />
          <button type="button" class="cbtn cbtn--sm" disabled={!pctReady || busy} onClick={() => onFee(Math.round(pctFigure * 100) / 100)}>
            {t('tower.partner.pay.feeSave')}
          </button>
        </div>
      ) : null}
      {onTry && a.test ? (
        <>
          <p class="cfield__label">{t('tower.partner.pay.tryTitle')}</p>
          <p class="chint">{t('tower.partner.pay.tryHint')}</p>
          <div class="crow">
            <input class="cinput cinput--sm" type="tel" inputMode="tel" autoComplete="off" aria-label={t('tower.partner.pay.phone')} placeholder={t('tower.partner.pay.phone')} value={phone} onInput={(e) => setPhone((e.target as HTMLInputElement).value)} />
            <input class="cinput cinput--sm" type="number" inputMode="decimal" min={1} step="0.01" aria-label={t('tower.partner.pay.amount', { currency: a.currency })} placeholder={t('tower.partner.pay.amount', { currency: a.currency })} value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} />
            <button type="button" class="cbtn cbtn--sm" disabled={!ready || busy} onClick={() => onTry(phone.replace(/[\s-]/g, ''), Math.round(figure * 100) / 100)}>
              {t('tower.partner.pay.tryBtn')}
            </button>
          </div>
        </>
      ) : null}
      <p class="cfield__label">{t('tower.partner.pay.paymentsTitle')}</p>
      {read.payments.length === 0 ? (
        <p class="cons__empty">{t('tower.partner.pay.none')}</p>
      ) : (
        <div class="crows">
          {read.payments.map((p) => (
            <div class="crow" key={p.paymentId}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">{p.askedBy ? t('tower.partner.pay.triedBy', { by: p.askedBy }) : `${t(KIND[p.kind])} · ${p.reference}`}</span>
                  <span class={`ctag ${p.state === 'paid' ? 'ctag--ok' : p.state === 'failed' ? 'ctag--warn' : 'ctag--quiet'}`}>{paymentState(p, t)}</span>
                  {p.test ? <span class="ctag ctag--quiet">{t('tower.partner.pay.test')}</span> : null}
                </span>
                <span class="crow__sub">
                  {cash(p.amount, p.currency)} · {t('tower.partner.pay.phoneEnds', { ends: p.phoneEnds })} · {when(p.askedAt)}
                  {p.usedFor ? ` · ${t('tower.partner.pay.forParcel', { parcel: p.usedFor })}` : ''}
                  {p.fee != null ? ` · ${t('tower.partner.pay.feeOn', { amount: cash(p.fee, p.currency) })}` : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

type Load = (entityId: string) => Promise<Result<unknown>>;

export function PartnerPaymentFold({ entityId, load, tryIt, setFee, loadPayouts, payNow }: { entityId: string; load: Load; tryIt: (entityId: string, phone: string, amount: number) => Promise<Result<unknown>>; setFee: (entityId: string, pct: number) => Promise<Result<unknown>>; loadPayouts: Load; payNow: (entityId: string) => Promise<Result<unknown>> }) {
  const t = useT();
  const [read, setRead] = useState<PaymentAccountRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [payouts, setPayouts] = useState<PartnerPayoutsView | null>(null);
  const refresh = async () => {
    const paid = await loadPayouts(entityId);
    setPayouts(paid.error || !paid.data ? null : narrow<PartnerPayoutsView>(paid.data));
    const r = await load(entityId);
    const next = r.error || !r.data ? null : narrow<PaymentAccountRead>(r.data);
    setRead(next);
    return next;
  };
  useEffect(() => {
    void refresh();
  }, [entityId]);
  // While a prompt waits, read again every few seconds — and never past the time a prompt can wait.
  useEffect(() => {
    const waiting = (read?.payments ?? []).filter((p) => p.state === 'asked').map((p) => Date.parse(p.askedAt));
    if (!waiting.length || Date.now() > Math.max(...waiting) + LOOK_FOR_MS) return;
    const timer = setTimeout(() => void refresh(), LOOK_EVERY_MS);
    return () => clearTimeout(timer);
  }, [read]);
  const tryPayment = async (phone: string, amount: number) => {
    setBusy(true);
    setFailed(null);
    const r = await tryIt(entityId, phone, amount);
    setBusy(false);
    if (r.error) setFailed(r.error.detail || r.error.title || t('tower.partner.pay.failed'));
    await refresh();
  };
  const payOut = async () => {
    setBusy(true);
    setFailed(null);
    const r = await payNow(entityId);
    setBusy(false);
    if (r.error) setFailed(r.error.detail || r.error.title || t('tower.partner.pay.failed'));
    await refresh();
  };
  const fee = async (pct: number) => {
    setBusy(true);
    setFailed(null);
    const r = await setFee(entityId, pct);
    setBusy(false);
    if (r.error) setFailed(r.error.detail || r.error.title || t('tower.partner.pay.failed'));
    await refresh();
  };
  if (!read) return null;
  const hint = read.account.test ? t('tower.partner.pay.hintTest', { provider: t(PROVIDER[read.account.provider]) }) : t(PROVIDER[read.account.provider]);
  return (
    <ConsoleFold title={t('tower.partner.pay.title')} hint={hint}>
      {failed ? <p class="cerr">{failed}</p> : null}
      <PaymentAccountBody read={read} t={t} busy={busy} onTry={(phone, amount) => void tryPayment(phone, amount)} onFee={(pct) => void fee(pct)} />
      {payouts ? <PayoutsBody payouts={payouts} t={t} busy={busy} onPayNow={() => void payOut()} /> : null}
    </ConsoleFold>
  );
}
