import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Note } from '../../../shared/ui';
import { useT, type Translate } from '../../../shared/i18n';
import { printParcelLabel } from '../../../shared/print-label';
import { cash } from '../../../shared/money';
import type { BookingPayView } from '../types';

/** A payment still with the bank: open, waiting, or authorised but not yet paid. */
const waiting = (v: BookingPayView | null) => Boolean(v && (v.status === 'open' || v.status === 'pending' || v.status === 'authorized'));
/** How often, and how long, a phone back from the bank asks again before Mollie's notice arrives. */
const LOOK_EVERY_MS = 5_000;
const LOOKS = 24;

/** How to stick a label on, said under it on the printed page (the owner: "the instruction on how to paste it on the parcel"). */
export function stickSteps(t: Translate): string[] {
  return [t('send.pay.step1'), t('send.pay.step2'), t('send.pay.step3'), t('send.pay.step4'), t('send.pay.step5')];
}

/**
 * 2026-11-21 — PAY NOW, PRINT AT HOME (the payments plan, 5a; P5-a "netherlands first", P5-b "it stays optional"). Where it is
 * offered — the Netherlands, in euros — one tap sends the sender to their bank by iDEAL and back to this booking; the code and
 * cash at the shop stay beside it. Back from the bank before Mollie's notice, it asks again for a while. Nothing shows where
 * paying online is not offered: the code above is the way.
 */
export function PayOnlineCard({ parcelId, look, pay, onPaid }: { parcelId: string; look: (id: string) => Promise<BookingPayView | null>; pay: (id: string) => Promise<{ checkoutUrl?: string; error?: string }>; onPaid?: () => void }) {
  const t = useT();
  const [view, setView] = useState<BookingPayView | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      const v = await look(parcelId);
      if (gone) return;
      setView(v);
      if (v?.status === 'paid' || v?.why === 'paid') return onPaid?.();
      if (waiting(v) && tries++ < LOOKS) timer = setTimeout(() => void ask(), LOOK_EVERY_MS);
    };
    void ask();
    return () => {
      gone = true;
      if (timer) clearTimeout(timer);
    };
  }, [parcelId]);
  return <PayOnlineBody view={view} busy={busy} failed={failed} onPay={async () => {
    setBusy(true);
    const r = await pay(parcelId);
    setBusy(false);
    if (r.error || !r.checkoutUrl) return setFailed(r.error ?? t('send.pay.failed'));
    setFailed(null);
    globalThis.location?.assign(r.checkoutUrl);
  }} />;
}

/** The card's inside, from what the server said — pure, for the test. */
export function PayOnlineBody({ view, busy, failed, onPay }: { view: BookingPayView | null; busy: boolean; failed: string | null; onPay: () => void }) {
  const t = useT();
  if (!view) return null;
  if (waiting(view)) {
    return (
      <Card title={t('send.pay.waitingTitle')}>
        <p class="card__note">{t('send.pay.waitingBody')}</p>
        {view.checkoutUrl ? (
          <Button variant="outline" chevron={false} onClick={() => globalThis.location?.assign(view.checkoutUrl!)}>
            {t('send.pay.backToBank')}
          </Button>
        ) : null}
      </Card>
    );
  }
  if (!view.offered || view.amount == null || !view.currency) return null;
  const amount = cash(view.amount, view.currency);
  return (
    <Card title={t('send.pay.title')}>
      <p class="card__note">{t('send.pay.body', { amount })}</p>
      {view.testmode ? <Note tone="info" icon="info" title={t('send.pay.testTitle')} detail={t('send.pay.testBody')} /> : null}
      {failed ? <p class="hint">{failed}</p> : null}
      {view.status === 'failed' || view.status === 'canceled' || view.status === 'expired' ? <p class="hint">{t('send.pay.notPaid')}</p> : null}
      <Button chevron={false} busy={busy} onClick={onPay}>
        {t('send.pay.cta', { amount })}
      </Button>
      <p class="hint">{t('send.pay.orShop')}</p>
    </Card>
  );
}

/**
 * 2026-11-21 — PAID ONLINE: THE LABEL (5a). To print at home, with how to stick it on, or to show on the phone at the shop —
 * nothing more to pay there. Shown until the parcel is handed in.
 */
export function PaidLabelCard({ parcelId, svg }: { parcelId: string; svg: string }) {
  const t = useT();
  const [blocked, setBlocked] = useState(false);
  return (
    <Card title={t('send.pay.paidTitle')}>
      <p class="card__note">{t('send.pay.paidBody')}</p>
      {/* Trusted markup: the label comes from OUR backend, nothing user-authored. */}
      <div class="labelbox" dangerouslySetInnerHTML={{ __html: svg }} />
      <Button chevron={false} onClick={() => setBlocked(!printParcelLabel({ title: parcelId, svg, steps: stickSteps(t), note: t('send.pay.printNote') }))}>
        {t('send.pay.print')}
      </Button>
      {blocked ? <p class="hint">{t('send.pay.printBlocked')}</p> : null}
      <p class="hint">{t('send.pay.orShow')}</p>
    </Card>
  );
}
