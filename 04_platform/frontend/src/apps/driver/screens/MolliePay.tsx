import { useEffect, useRef, useState } from 'preact/hooks';
import { narrow, type Result, type SbgError } from '../../../lib/sbg';
import { CopyButton } from '../../../shared/CopyButton';
import { useT, type Translate } from '../../../shared/i18n';
import { cash } from '../../../shared/money';
import { Button, ErrorNote, Note } from '../../../shared/ui';

/**
 * 2026-11-19 — PAID AT THE HANDOVER, BY MOLLIE (the payments plan, part 2b; the owner: "Netherlands: Mollie"). On a load the
 * shipper pays directly, where the carrier connected its own Mollie account: the driver asks for the price agreed, the payment's
 * page shows as a QR code for the shipper to scan, and when Mollie says it is paid the load is paid — by Mollie's word, not the
 * driver's. The fee Mollie takes for SeeBuyGet is said before the button. Where Mollie is not connected yet, one line says how.
 */

export interface DirectPayPayment {
  paymentId: string;
  status: 'open' | 'pending' | 'authorized' | 'paid' | 'canceled' | 'expired' | 'failed';
  amount: number;
  currency: string;
  fee?: number;
  testmode: boolean;
  checkoutUrl?: string;
  qrSvg?: string;
  expiresAt?: string;
  paidAt?: string;
}

export interface DirectPayView {
  available: boolean;
  why?: 'not_direct' | 'paid' | 'no_price' | 'not_mollie' | 'not_eur' | 'not_connected' | 'office_connects';
  amount?: number;
  currency?: string;
  fee?: number;
  testmode?: boolean;
  payment?: DirectPayPayment;
}

const WAITING: ReadonlyArray<DirectPayPayment['status']> = ['open', 'pending', 'authorized'];
/** How often the screen looks again while the shipper pays. */
const LOOK_EVERY_MS = 4_000;

export function isPaidByMollie(v: DirectPayView | null): boolean {
  return Boolean(v?.payment?.status === 'paid');
}

/** Waiting for the payer: a payment still open, with its page to show. */
export function isWaiting(v: DirectPayView | null): boolean {
  return Boolean(v?.payment && WAITING.includes(v.payment.status) && v.payment.qrSvg);
}

/** The card, from what the server said — pure, so every state can be read in a test. */
export function MolliePayCard({ view, busy, onAsk, t }: { view: DirectPayView | null; busy: boolean; onAsk: () => void; t: Translate }) {
  if (!view) return null;
  const p = view.payment;
  if (isPaidByMollie(view) && p) return <Note tone="ok" icon="check" title={t('driver.mollie.paid', { amount: cash(p.amount, p.currency) })} />;
  if (!view.available) {
    if (view.why === 'not_connected') return <p class="hint">{t('driver.mollie.connect')}</p>;
    if (view.why === 'office_connects') return <p class="hint">{t('driver.mollie.office')}</p>;
    return null;
  }
  const amount = cash(view.amount ?? 0, view.currency);
  if (isWaiting(view) && p?.qrSvg && p.checkoutUrl) {
    return (
      <div class="field" style="margin-top:14px">
        <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.qrSvg)}`} width={240} height={240} alt={t('driver.mollie.qrLabel', { amount })} style="display:block;margin:0 auto;max-width:100%;height:auto;background:#fff" />
        <p class="t-body">{t('driver.mollie.show', { amount })}</p>
        <p class="hint" role="status">{t('driver.mollie.waiting')}</p>
        {p.testmode ? <p class="hint">{t('driver.mollie.test')}</p> : null}
        <CopyButton text={p.checkoutUrl} label={t('driver.mollie.copy')} copied={t('driver.mollie.copied')} share variant="link" />
      </div>
    );
  }
  const lapsed = p && !WAITING.includes(p.status);
  return (
    <div class="field" style="margin-top:14px">
      {lapsed ? <p class="hint">{t('driver.mollie.again')}</p> : null}
      {view.fee ? <p class="hint">{t('driver.mollie.fee', { fee: cash(view.fee, view.currency) })}</p> : null}
      {view.testmode ? <p class="hint">{t('driver.mollie.test')}</p> : null}
      <Button chevron={false} busy={busy} onClick={onAsk}>
        {t('driver.mollie.ask', { amount })}
      </Button>
    </div>
  );
}

/** Loads the card, asks for the payment, and looks again every few seconds while the shipper pays. */
export function MolliePay({ freightId, actions, onPaid }: { freightId: string; actions: { freightMollie: (id: string) => Promise<Result<unknown>>; askFreightMollie: (id: string) => Promise<Result<unknown>>; refresh: () => Promise<void> }; onPaid: () => void }) {
  const t = useT();
  const [view, setView] = useState<DirectPayView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const told = useRef(false);
  const take = (r: Result<unknown>) => {
    if (r.error) return setError(r.error);
    setError(null);
    if (r.data) setView(narrow<DirectPayView>(r.data));
  };
  useEffect(() => {
    told.current = false;
    setView(null);
    void actions.freightMollie(freightId).then((r) => (r.error ? undefined : take(r)));
  }, [freightId]);
  // While the shipper pays: look again every few seconds — the server asks Mollie, so no notice is needed to see it.
  useEffect(() => {
    if (!isWaiting(view)) return;
    const id = setInterval(() => void actions.freightMollie(freightId).then((r) => (r.error ? undefined : take(r))), LOOK_EVERY_MS);
    return () => clearInterval(id);
  }, [freightId, view?.payment?.paymentId, view?.payment?.status]);
  useEffect(() => {
    if (!isPaidByMollie(view) || told.current) return;
    told.current = true;
    onPaid();
    void actions.refresh();
  }, [view?.payment?.status]);
  const ask = async () => {
    setBusy(true);
    take(await actions.askFreightMollie(freightId));
    setBusy(false);
  };
  return (
    <>
      <MolliePayCard view={view} busy={busy} onAsk={() => void ask()} t={t} />
      {error ? <ErrorNote error={error} /> : null}
    </>
  );
}
