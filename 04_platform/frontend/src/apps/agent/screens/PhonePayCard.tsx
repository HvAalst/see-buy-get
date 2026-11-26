import { useState } from 'preact/hooks';
import { Button, Card, GlanceNumber, Note, PhoneField, Pill } from '../../../shared/ui';
import { useT, type MessageKey, type Translate } from '../../../shared/i18n';
import { money } from '../logic';
import type { PhonePay, TakeInTerms } from '../types';

/**
 * 2026-11-20 — PAID BY PHONE, BEFORE THE LABEL (the payments plan, 4b; P3-c "payment by phone only" in a partner's country).
 * Where the counter takes no cash, the sender pays the partner's price by a prompt on their phone, into the partner's account;
 * the parcel is taken in, and its label printed, once the payment is paid. Said here, above the take-in button.
 */
const WHY: Record<NonNullable<PhonePay['why']>, MessageKey> = {
  declined: 'agent.accept.pay.why.declined',
  expired: 'agent.accept.pay.why.expired',
  unreachable: 'agent.accept.pay.why.unreachable',
  insufficient: 'agent.accept.pay.why.insufficient',
};

/** Where the payment for this parcel stands, in words — or nothing, before it is asked. */
export function phonePayWords(pay: PhonePay | null, t: Translate): { tone: 'info' | 'ok' | 'warn'; text: string } | null {
  if (!pay) return null;
  if (pay.state === 'asked') return { tone: 'info', text: pay.byQr ? t('agent.accept.pay.waitingQr') : t('agent.accept.pay.waiting', { ends: pay.phoneEnds }) };
  if (pay.state === 'paid') return { tone: 'ok', text: t('agent.accept.pay.paid', { amount: money(pay.amount, pay.currency) }) };
  return { tone: 'warn', text: t('agent.accept.pay.failed', { why: t(WHY[pay.why ?? 'unreachable']) }) };
}

export function PhonePayCard({ pay, terms, parcelId, senderPhone, online, busy, onAsk }: { pay: PhonePay | null; terms: TakeInTerms & { payByPhone: NonNullable<TakeInTerms['payByPhone']> }; parcelId: string; senderPhone: string; online: boolean; busy?: boolean; onAsk: (phone: string) => void }) {
  const t = useT();
  const [phone, setPhone] = useState('');
  const payer = phone || senderPhone;
  // Only the payment asked for the parcel on the sticker counts: a new sticker starts again.
  const mine = pay && pay.parcelId === parcelId.trim().toUpperCase() ? pay : null;
  const said = phonePayWords(mine, t);
  // 2026-11-26 — from a QR code (the partner's Mollie account): no phone is asked; the code is shown while the page can be paid.
  const byQr = Boolean(terms.payByPhone.qr);
  const canAsk = online && Boolean(parcelId.trim()) && (byQr || payer.replace(/\D/g, '').length >= 9) && mine?.state !== 'asked' && mine?.state !== 'paid';
  return (
    <Card label={t('agent.accept.pay.title')}>
      <GlanceNumber label={t('agent.accept.pay.amount')} value={money(terms.payByPhone.price, terms.payByPhone.currency)} sub={t(byQr ? 'agent.accept.pay.toQr' : 'agent.accept.pay.to', { to: terms.payByPhone.to })} />
      {mine?.state === 'asked' && mine.qrSvg ? (
        <div style="margin-top:12px;text-align:center">
          <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(mine.qrSvg)}`} width={240} height={240} alt={t('agent.accept.pay.qrLabel', { amount: money(mine.amount, mine.currency) })} style="display:block;margin:0 auto;max-width:100%;height:auto;background:#fff" />
          <p class="card__note">{t('agent.accept.pay.scan')}</p>
        </div>
      ) : null}
      {mine?.state === 'paid' || byQr ? null : (
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="pay-phone">
            {t('agent.accept.pay.phone')}
          </label>
          <PhoneField id="pay-phone" value={payer} onInput={setPhone} autoComplete="off" />
        </div>
      )}
      {said ? (
        <div style="margin-top:12px">
          <Pill tone={said.tone} dot={said.tone === 'info'}>
            {said.text}
          </Pill>
        </div>
      ) : null}
      {mine?.test ? <p class="card__note">{t('agent.accept.pay.test')}</p> : null}
      {!online ? <Note tone="warn" icon="warning" title={t('agent.accept.pay.needsSignal')} detail="" /> : null}
      {mine?.state === 'paid' ? null : (
        <div style="margin-top:12px">
          <Button variant="outline" chevron={false} onClick={() => onAsk(payer)} disabled={!canAsk} busy={busy}>
            {t(mine?.state === 'failed' ? 'agent.accept.pay.askAgain' : byQr ? 'agent.accept.pay.askQr' : 'agent.accept.pay.ask')}
          </Button>
        </div>
      )}
      <p class="card__note">{t('agent.accept.pay.note')}</p>
    </Card>
  );
}
