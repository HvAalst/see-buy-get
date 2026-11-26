import { useEffect, useState } from 'preact/hooks';
import { narrow, type Result } from '../../../lib/sbg';
import { useT, type MessageKey, type Translate } from '../../../shared/i18n';
import { cash } from '../../../shared/money';
import { Abbreviated } from '../../../shared/ui';
import { ConsoleFold } from '../ConsoleFold';

/**
 * 2026-11-20 — THE PARTNER'S PAYMENT ACCOUNT, FOR OUR STAFF (the payments plan, step 4a; the owner: "a software that combines
 * PSP's and becomes actually a payment hub"). On a partner company's own page: which provider its money goes through — the
 * stand-in, test money, until its own provider is added and two of our staff switch it live — what the account holds, its
 * payments, and a try: a payment prompt to a phone, seen waiting, then paid or not.
 */
export type HubProviderId = 'stand-in' | 'telebirr' | 'mpesa-et' | 'chapa' | 'revolut' | 'mollie';
export type HubWhy = 'declined' | 'expired' | 'unreachable' | 'insufficient';

export interface HubPaymentRow {
  paymentId: string;
  kind: 'in' | 'out' | 'refund';
  reference: string;
  amount: number;
  currency: string;
  phoneEnds: string;
  /** 2026-11-25 — paid to a bank account: phoneEnds is then the account's last three digits. */
  toBank?: boolean;
  /** 2026-11-26 — asked by a page paid from a QR code (the partner's Mollie account): no phone; its code while it can be paid. */
  byQr?: boolean;
  link?: string;
  qrSvg?: string;
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
export type PayoutWait = 'no_number' | 'number_new' | 'balance' | 'refused' | 'unreachable' | 'no_bank' | 'bank_new';
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
  no_bank: 'tower.partner.pay.wait.no_bank',
  bank_new: 'tower.partner.pay.wait.bank_new',
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
  account: {
    provider: HubProviderId;
    test: boolean;
    currency: string;
    ready: HubProviderId[];
    balance?: number;
    feePct?: number;
    feeSetBy?: string;
    feeSetAt?: string;
    feeOwed: number;
    /** 2026-11-25 (route plan part 4) — how its hands are paid: the provider its country uses, its key, and whether it is live. */
    payoutProvider?: HubProviderId;
    paysTo?: 'phone' | 'bank';
    payoutTest?: boolean;
    payoutBalance?: number;
    keyEnds?: string;
    keyTest?: boolean;
    keyBy?: string;
    keyAt?: string;
    liveBy?: string;
    liveAt?: string;
    /** 2026-11-26 — the counters' payments: the partner's own Mollie account in its country, connected by the partner or not yet. */
    collectProvider?: HubProviderId;
    collect?: { connected: boolean; organizationName?: string; testmode?: boolean; canReceivePayments?: boolean; lostAt?: string; connectedBy?: string; connectedAt?: string; registrationNumber?: string; sameCompany?: 'yes' | 'no' | 'unknown'; expectedRegistration?: string };
  };
  /** 2026-11-21 — what came in, went back and went out, paid (4e). */
  totals?: { paidIn: number; givenBack: number; paidOut: number };
  payments: HubPaymentRow[];
}

const PROVIDER: Record<HubProviderId, MessageKey> = {
  'stand-in': 'tower.partner.pay.provider.standIn',
  telebirr: 'tower.partner.pay.provider.telebirr',
  'mpesa-et': 'tower.partner.pay.provider.mpesaEt',
  chapa: 'tower.partner.pay.provider.chapa',
  revolut: 'tower.partner.pay.provider.revolut',
  mollie: 'tower.partner.pay.provider.mollie',
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
/** 2026-11-26 — a page paid from a QR code may be paid for as long as Mollie keeps it open. */
const LOOK_FOR_QR_MS = 16 * 60_000;

/** Where one payment stands, in words: waiting, paid, or not paid and why. */
export function paymentState(p: HubPaymentRow, t: Translate): string {
  if (p.state === 'asked') return t(p.byQr ? 'tower.partner.pay.state.askedQr' : 'tower.partner.pay.state.asked');
  if (p.state === 'paid') return t('tower.partner.pay.state.paid');
  return p.why ? t('tower.partner.pay.state.failedWhy', { why: t(WHY[p.why]) }) : t('tower.partner.pay.state.failed');
}

/** Where the key stands, in words: none, a test key, a live key waiting for a second person, or switched live. */
export function keySays(a: PaymentAccountRead['account'], t: Translate): string {
  if (!a.keyEnds) return t('tower.partner.pay.keyNone');
  const base = { ends: a.keyEnds, by: a.keyBy ?? '', at: a.keyAt ? when(a.keyAt) : '' };
  if (a.keyTest) return t('tower.partner.pay.keyTestNow', base);
  if (!a.liveBy) return t('tower.partner.pay.keyWaiting', base);
  return t('tower.partner.pay.keyLiveNow', { ...base, liveBy: a.liveBy, liveAt: a.liveAt ? when(a.liveAt) : '' });
}

/**
 * 2026-11-25 (route plan part 4) — HOW ITS HANDS ARE PAID: to their bank accounts or their phones, through the provider its
 * country uses (Revolut Business in the European Union), with the partner's key — entered here by name, asked of the provider
 * first and kept sealed — and a live key switched on by a second person. No provider for its country: test money.
 */
export function HandsBody({ a, t, busy, onKey, onLive }: { a: PaymentAccountRead['account']; t: Translate; busy?: boolean; onKey?: (key: string, test: boolean) => void; onLive?: () => void }) {
  const [key, setKey] = useState('');
  const [test, setTest] = useState(true);
  const keyReady = /^\S{16,400}$/.test(key.trim());
  const provider = a.payoutProvider ? t(PROVIDER[a.payoutProvider]) : '';
  return (
    <>
      <p class="cfield__label">{t('tower.partner.pay.handsTitle')}</p>
      <p class="chint">{a.paysTo === 'bank' ? t('tower.partner.pay.paysToBank') : t('tower.partner.pay.paysToPhone')}</p>
      {a.payoutProvider ? (
        <>
          <div class="crow">
            <span class="crow__body">
              <span class="crow__top">
                <span class="crow__name">{provider}</span>
                <span class={`ctag ${a.payoutTest ? 'ctag--warn' : 'ctag--ok'}`}>{a.payoutTest ? t('tower.partner.pay.test') : t('tower.partner.pay.liveTag')}</span>
              </span>
              <span class="crow__sub">{keySays(a, t)}</span>
              {a.payoutBalance != null ? <span class="crow__sub">{t('tower.partner.pay.payoutHolds', { amount: cash(a.payoutBalance, a.currency) })}</span> : null}
            </span>
          </div>
          {onKey ? (
            <>
              <label class="cfield__label" for="partner-payout-key">{t('tower.partner.pay.keyLabel', { provider })}</label>
              <p class="chint"><Abbreviated text={t('tower.partner.pay.keyHint', { provider })} /></p>
              <div class="crow">
                <input id="partner-payout-key" class="cinput cinput--sm" type="password" autoComplete="off" spellcheck={false} value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} />
                <label class="checkline">
                  <input type="checkbox" checked={test} onChange={(e) => setTest((e.target as HTMLInputElement).checked)} />
                  <span>{t('tower.partner.pay.keyIsTest')}</span>
                </label>
                <button type="button" class="cbtn cbtn--sm" disabled={!keyReady || busy} onClick={() => { onKey(key.trim(), test); setKey(''); }}>
                  {t('tower.partner.pay.keySave')}
                </button>
              </div>
            </>
          ) : null}
          {onLive && a.keyEnds && !a.keyTest && !a.liveBy ? (
            <>
              <p class="chint">{t('tower.partner.pay.liveHint')}</p>
              <button type="button" class="cbtn cbtn--sm" disabled={busy} onClick={onLive}>
                {t('tower.partner.pay.liveBtn')}
              </button>
            </>
          ) : null}
        </>
      ) : (
        <p class="chint">{t('tower.partner.pay.noPayoutProvider')}</p>
      )}
    </>
  );
}

/**
 * 2026-11-26 — THE COUNTERS' PAYMENTS: in a country of the European Union, senders pay at the partner's shops from a QR code into the
 * partner's own Mollie account — connected by the partner's own people in the Partner app, never here. Said: not yet, connected to
 * which organization by whom, still checked by Mollie, or the access taken back. Nothing where the country takes them another way.
 */
export function CollectLine({ read, t }: { read: PaymentAccountRead; t: Translate }) {
  const a = read.account;
  if (!a.collectProvider) return null;
  const c = a.collect;
  const line = !c?.connected
    ? t('tower.partner.pay.collectNone')
    : c.sameCompany === 'no'
      ? t('tower.partner.pay.collectNotUsed', { name: c.organizationName ?? '', reg: c.registrationNumber ?? '', expected: c.expectedRegistration ?? '' })
      : c.lostAt
      ? t('tower.partner.pay.collectLost')
      : c.canReceivePayments === false
        ? t('tower.partner.pay.collectChecking')
        : t('tower.partner.pay.collectOn', { name: c.organizationName ?? t(PROVIDER[a.collectProvider]), by: c.connectedBy ?? '', at: c.connectedAt ? when(c.connectedAt) : '' });
  // 2026-11-26 — whose company it is: the partner's own registration, or what staff check against the contract.
  const reg = !c?.connected || c.sameCompany === 'no' ? null : c.sameCompany === 'yes' ? t('tower.partner.pay.collectRegOwn', { reg: c.registrationNumber ?? '' }) : c.registrationNumber ? t('tower.partner.pay.collectCheckReg', { reg: c.registrationNumber }) : t('tower.partner.pay.collectNoReg');
  return (
    <>
      <p class="cfield__label">{t('tower.partner.pay.collectTitle')}</p>
      <p class="chint">
        {line}
        {c?.connected && c.testmode ? <span class="ctag ctag--warn"> {t('tower.partner.pay.test')}</span> : null}
      </p>
      {reg ? <p class="chint">{reg}</p> : null}
    </>
  );
}

/** The fold's inside, from what the server said — pure, for the test. */
export function PaymentAccountBody({ read, t, busy, onTry, onFee, onKey, onLive }: { read: PaymentAccountRead; t: Translate; busy?: boolean; onTry?: (phone: string, amount: number) => void; onFee?: (pct: number) => void; onKey?: (key: string, test: boolean) => void; onLive?: () => void }) {
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [pct, setPct] = useState('');
  const pctFigure = Number(pct);
  const pctReady = pct.trim() !== '' && Number.isFinite(pctFigure) && pctFigure >= 0 && pctFigure <= 50;
  const a = read.account;
  const figure = Number(amount);
  // 2026-11-26 — on the partner's Mollie account a try is a page paid from a QR code: no phone is asked.
  const byQr = a.provider === 'mollie';
  const ready = (byQr || /^\+\d{9,15}$/.test(phone.replace(/[\s-]/g, ''))) && Number.isFinite(figure) && figure >= 1;
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
      <CollectLine read={read} t={t} />
      {read.totals ? <p class="chint">{t('tower.partner.pay.totals', { paidIn: cash(read.totals.paidIn, a.currency), givenBack: cash(read.totals.givenBack, a.currency), paidOut: cash(read.totals.paidOut, a.currency) })}</p> : null}
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
          <p class="chint">{t(byQr ? 'tower.partner.pay.tryHintQr' : 'tower.partner.pay.tryHint')}</p>
          <div class="crow">
            {byQr ? null : <input class="cinput cinput--sm" type="tel" inputMode="tel" autoComplete="off" aria-label={t('tower.partner.pay.phone')} placeholder={t('tower.partner.pay.phone')} value={phone} onInput={(e) => setPhone((e.target as HTMLInputElement).value)} />}
            <input class="cinput cinput--sm" type="number" inputMode="decimal" min={1} step="0.01" aria-label={t('tower.partner.pay.amount', { currency: a.currency })} placeholder={t('tower.partner.pay.amount', { currency: a.currency })} value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} />
            <button type="button" class="cbtn cbtn--sm" disabled={!ready || busy} onClick={() => onTry(byQr ? '' : phone.replace(/[\s-]/g, ''), Math.round(figure * 100) / 100)}>
              {t('tower.partner.pay.tryBtn')}
            </button>
          </div>
        </>
      ) : null}
      {a.paysTo ? <HandsBody a={a} t={t} busy={busy} onKey={onKey} onLive={onLive} /> : null}
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
                  {cash(p.amount, p.currency)} · {p.byQr ? t('tower.partner.pay.byQr') : p.toBank ? t('tower.partner.pay.accountEnds', { ends: p.phoneEnds }) : t('tower.partner.pay.phoneEnds', { ends: p.phoneEnds })} · {when(p.askedAt)}
                  {p.usedFor ? ` · ${t('tower.partner.pay.forParcel', { parcel: p.usedFor })}` : ''}
                  {p.fee != null ? ` · ${t('tower.partner.pay.feeOn', { amount: cash(p.fee, p.currency) })}` : ''}
                </span>
                {p.askedBy && p.byQr && p.state === 'asked' && p.qrSvg ? (
                  <span class="crow__sub">
                    <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.qrSvg)}`} width={200} height={200} alt={t('tower.partner.pay.tryScan')} style="display:block;max-width:100%;height:auto;background:#fff;margin:8px 0" />
                    {t('tower.partner.pay.tryScan')}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

type Load = (entityId: string) => Promise<Result<unknown>>;

export function PartnerPaymentFold({ entityId, load, tryIt, setFee, loadPayouts, payNow, setKey, switchLive }: { entityId: string; load: Load; tryIt: (entityId: string, phone: string, amount: number) => Promise<Result<unknown>>; setFee: (entityId: string, pct: number) => Promise<Result<unknown>>; loadPayouts: Load; payNow: (entityId: string) => Promise<Result<unknown>>; setKey?: (entityId: string, key: string, test: boolean) => Promise<Result<unknown>>; switchLive?: (entityId: string) => Promise<Result<unknown>> }) {
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
    const waiting = (read?.payments ?? []).filter((p) => p.state === 'asked').map((p) => Date.parse(p.askedAt) + (p.byQr ? LOOK_FOR_QR_MS : LOOK_FOR_MS));
    if (!waiting.length || Date.now() > Math.max(...waiting)) return;
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
  /** One staff act, then the account read again: its refusal said in the fold, as the server gave it. */
  const act = async (run: () => Promise<Result<unknown>>) => {
    setBusy(true);
    setFailed(null);
    const r = await run();
    setBusy(false);
    if (r.error) setFailed(r.error.detail || r.error.title || t('tower.partner.pay.failed'));
    await refresh();
  };
  if (!read) return null;
  const hint = read.account.test ? t('tower.partner.pay.hintTest', { provider: t(PROVIDER[read.account.provider]) }) : t(PROVIDER[read.account.provider]);
  return (
    <ConsoleFold title={t('tower.partner.pay.title')} hint={hint}>
      {failed ? <p class="cerr">{failed}</p> : null}
      <PaymentAccountBody
        read={read}
        t={t}
        busy={busy}
        onTry={(phone, amount) => void tryPayment(phone, amount)}
        onFee={(pct) => void fee(pct)}
        {...(setKey ? { onKey: (key: string, test: boolean) => void act(() => setKey(entityId, key, test)) } : {})}
        {...(switchLive ? { onLive: () => void act(() => switchLive(entityId)) } : {})}
      />
      {payouts ? <PayoutsBody payouts={payouts} t={t} busy={busy} onPayNow={() => void payOut()} /> : null}
    </ConsoleFold>
  );
}
