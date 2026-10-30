import { Abbreviated } from '../../../shared/ui/Abbr';
import { useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import type { BusinessClient, PostedLoad } from '../api';

/**
 * THE CARRIER'S RESERVATIONS AT TAKING OVER, AND THE SENDER'S ANSWER (CMR Art. 8(2): "Such reservations shall not bind
 * the sender unless he has expressly agreed to be bound by them in the consignment note"). What the driver wrote when it
 * took the goods over, in its words; agreed, or disputed in the sender's own — once. The note says which, or that an
 * unanswered reservation does not bind the sender.
 */
export function LoadReservations({ row, client, act, onChanged }: { row: PostedLoad; client: BusinessClient | null; act: boolean; onChanged: (message?: string) => void | Promise<void> }) {
  const t = useT();
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = row.reservations;
  if (!r) return null;

  const answer = async (agreed: boolean) => {
    if (!client) return;
    setBusy(true);
    setError(null);
    const res = (await client.answerReservations(row.freightId, { agreed, ...(agreed ? {} : { note: note.trim() }) })) as { error?: { detail?: string; title?: string } };
    setBusy(false);
    if (res.error) return setError(res.error.detail || res.error.title || null);
    setDisputing(false);
    await onChanged(t(agreed ? 'business.reservations.agreedDone' : 'business.reservations.disputedDone'));
  };

  const day = (iso: string) => new Date(iso).toLocaleString('en', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.reservations.title')}</span>
        <span class={`ctag ${r.answer ? (r.answer.agreed ? 'ctag--ok' : 'ctag--warn') : 'ctag--warn'}`}>{t(r.answer ? (r.answer.agreed ? 'business.reservations.tagAgreed' : 'business.reservations.tagDisputed') : 'business.reservations.tagOpen')}</span>
      </div>
      <p class="cons__lede">{t('business.reservations.said', { when: day(r.at), note: r.note })}</p>
      {r.answer ? (
        <p class="chint">{r.answer.agreed ? t('business.reservations.agreed', { when: day(r.answer.at), by: r.answer.by }) : t('business.reservations.disputed', { when: day(r.answer.at), by: r.answer.by, note: r.answer.note ?? '' })}</p>
      ) : (
        <>
          <p class="chint">{t('business.reservations.lede')}</p>
          {act ? (
            disputing ? (
              <>
                <label class="cfield">
                  <span class="cfield__label">{t('business.reservations.why')}</span>
                  <textarea class="cinput" rows={2} maxLength={500} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
                </label>
                <div class="twr-panelend">
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setDisputing(false)}>
                    {t('common.cancel')}
                  </button>
                  <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy || note.trim().length < 3} onClick={() => void answer(false)}>
                    {t('business.reservations.sendDispute')}
                  </button>
                </div>
              </>
            ) : (
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => setDisputing(true)}>
                  {t('business.reservations.dispute')}
                </button>
                <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => void answer(true)}>
                  {t('business.reservations.agree')}
                </button>
              </div>
            )
          ) : null}
        </>
      )}
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
    </section>
  );
}
