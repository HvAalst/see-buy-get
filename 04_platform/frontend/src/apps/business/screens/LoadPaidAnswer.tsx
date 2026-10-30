import { Abbreviated } from '../../../shared/ui/Abbr';
import { useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { ownAnswerLine, shipperPaidLine } from '../../../shared/paidDirect';
import type { BusinessClient, PostedLoad } from '../api';

/**
 * BOTH SIDES HEARD (the user, 2026-10-27: "build the shipper answer as a fair principle"): a driver said this load was not
 * paid; the business answers that it paid, with a reference the driver can check. The driver is told, and drivers deciding on
 * the business's next loads see such a load as disputed, never as unpaid. One answer, as there is one "not paid".
 */
export function LoadPaidAnswer({ row, client, act, onChanged }: { row: PostedLoad; client: BusinessClient | null; act: boolean; onChanged: (message?: string) => void | Promise<void> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!row.notPaidDirect) return null;
  const said = shipperPaidLine(row, t);

  const send = async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    const res = await client.shipping.answerNotPaid(row.freightId, reference.trim());
    setBusy(false);
    if (res.error) return setError((res.error as { detail?: string; title?: string }).detail || (res.error as { title?: string }).title || '');
    setOpen(false);
    await onChanged(t('common.paidDirect.answerDone'));
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.paid.head')}</span>
        <span class={`ctag ctag--${row.paidDirectAnswer ? 'info' : 'warn'}`}>{t(row.paidDirectAnswer ? 'business.paid.answered' : 'business.paid.saidNotPaid')}</span>
      </div>
      {said ? <p class="cons__lede">{said}</p> : null}
      {row.paidDirectAnswer ? <p class="cons__lede">{ownAnswerLine(row.paidDirectAnswer, t)}</p> : null}
      {!row.canAnswerNotPaid || !act || !client ? null : open ? (
        <>
          <label class="cfield">
            <span class="cfield__label">{t('common.paidDirect.answerLabel')}</span>
            <input class="cinput" maxLength={80} value={reference} onInput={(e) => setReference((e.target as HTMLInputElement).value)} />
          </label>
          <p class="chint">{t('common.paidDirect.answerHint')}</p>
          {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary" disabled={busy || reference.trim().length < 3} onClick={() => void send()}>
              {t('common.paidDirect.answerSend')}
            </button>
            <button type="button" class="cbtn cbtn--ghost" onClick={() => setOpen(false)}>
              {t('common.paidDirect.answerCancel')}
            </button>
          </div>
        </>
      ) : (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--primary cbtn--sm" onClick={() => setOpen(true)}>
            {t('common.paidDirect.answerAsk')}
          </button>
        </div>
      )}
    </section>
  );
}
