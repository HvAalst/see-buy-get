import { useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { quoteFigure, type QuoteView } from '../../../shared/quote';
import { ConsoleFold } from '../ConsoleFold';
import { tabAtTheTap } from '../../../shared/openPage';

type Api = {
  attachProforma: (quoteId: string, body: { dataUrl: string; fileName?: string }) => Promise<{ data?: unknown; error?: { detail?: string; title?: string } | null }>;
  proformaFile: (quoteId: string) => Promise<{ data?: unknown; error?: unknown }>;
  setQuoteStatus: (quoteId: string, body: { status: 'open' | 'paid'; reference?: string }) => Promise<{ data?: unknown; error?: { detail?: string; title?: string } | null }>;
};

/**
 * ONE QUOTATION, in full — the figure, who asked whom, the proforma, and open or paid as a party confirms it.
 *
 * The user, 2026-10-04: "we do handle quotations for anyone ... the user needs to confirm open/paid. That keeps all vital
 * information in one place." Shown wherever a price lives: an agent's fee on an import, a carrier's price on a
 * business's load or booking. Nothing here moves money; "paid" is somebody saying so, and the panel says who.
 *
 * `canChange` is whether this reader is a party who may act (a viewer and network staff read only). The server holds
 * the same rule; this only stops offering what would be refused.
 */
export function QuotePanel({ quote, api, canChange, onChanged }: { quote: QuoteView; api: Api | null; canChange: boolean; onChanged: () => void | Promise<void> }) {
  const t = useT();
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<{ error?: { detail?: string; title?: string } | null }>) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.error) return setError(r.error.detail || r.error.title || '');
    setReference('');
    await onChanged();
  };

  const attach = (file: File) => {
    if (!api) return;
    const reader = new FileReader();
    reader.onload = () => void act(() => api.attachProforma(quote.quoteId, { dataUrl: String(reader.result), fileName: file.name }));
    reader.readAsDataURL(file);
  };

  const open = async () => {
    if (!api) return;
    const tab = tabAtTheTap();
    try {
      const r = await api.proformaFile(quote.quoteId);
      if (r.error || !r.data) return setError(t('quote.proformaGone'));
      tab.show(r.data as Blob);
    } finally {
      tab.cancel();
    }
  };

  return (
    <div class="twr-quote">
      <dl class="cons__facts">
        <div class="cons__fact">
          <dt class="cons__factk">{t('quote.figure')}</dt>
          <dd class="cons__factv">
            <b>{quoteFigure(quote)}</b>
            {quote.reference ? <span class="chint"> · {t('quote.theirRef', { ref: quote.reference })}</span> : null}
          </dd>
        </div>
        <div class="cons__fact">
          <dt class="cons__factk">{t('quote.between')}</dt>
          <dd class="cons__factv">{t('quote.fromTo', { from: quote.issuer.name, to: quote.payer.name })}</dd>
        </div>
        {quote.note ? (
          <div class="cons__fact">
            <dt class="cons__factk">{t('quote.note')}</dt>
            <dd class="cons__factv">{quote.note}</dd>
          </div>
        ) : null}
        <div class="cons__fact">
          <dt class="cons__factk">{t('quote.proforma')}</dt>
          <dd class="cons__factv">
            {quote.proforma ? (
              <>
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void open()}>
                  {quote.proforma.fileName}
                </button>
                <span class="chint"> {t('quote.proformaBy', { who: quote.proforma.addedBy, when: quote.proforma.addedAt.slice(0, 10) })}</span>
              </>
            ) : (
              <span class="chint">{t('quote.noProforma')}</span>
            )}
            {canChange ? (
              <label class="cbtn cbtn--ghost cbtn--sm twr-quote__file">
                {quote.proforma ? t('quote.replaceProforma') : t('quote.addProforma')}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  disabled={busy}
                  onChange={(e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) attach(file);
                    (e.target as HTMLInputElement).value = '';
                  }}
                />
              </label>
            ) : null}
          </dd>
        </div>
        <div class="cons__fact">
          <dt class="cons__factk">{t('quote.status')}</dt>
          <dd class="cons__factv">
            {quote.status === 'paid' ? (
              <span class="ctag ctag--ok">{t('quote.paidBy', { who: quote.paidBy ?? '—', when: (quote.paidAt ?? '').slice(0, 10) })}</span>
            ) : (
              <span class="ctag ctag--warn">{t('quote.open')}</span>
            )}
            {quote.paidReference ? <span class="chint"> · {t('quote.paidRef', { ref: quote.paidReference })}</span> : null}
          </dd>
        </div>
      </dl>

      {canChange ? (
        quote.status === 'open' ? (
          <div class="twr-panelend">
            <input class="cinput" value={reference} placeholder={t('quote.paidRefPlaceholder')} onInput={(e) => setReference((e.target as HTMLInputElement).value)} />
            <button type="button" class="cbtn cbtn--primary" disabled={busy || !api} onClick={() => void act(() => api!.setQuoteStatus(quote.quoteId, { status: 'paid', ...(reference.trim() ? { reference: reference.trim() } : {}) }))}>
              {t('quote.markPaid')}
            </button>
          </div>
        ) : (
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost" disabled={busy || !api} onClick={() => void act(() => api!.setQuoteStatus(quote.quoteId, { status: 'open' }))}>
              {t('quote.markOpen')}
            </button>
          </div>
        )
      ) : null}
      <p class="chint">{t('quote.ours')}</p>
      {error ? <p class="cerr">{error}</p> : null}

      <ConsoleFold title={t('quote.historyTitle')} hint={t('quote.historyCount', { n: quote.history.length })}>
        <ul class="twr-checklist">
          {[...quote.history].reverse().map((h, i) => (
            <li key={`${h.at}-${i}`}>
              {t(`quote.event.${h.what}` as never, { who: h.by })}
              {h.note ? ` — ${h.note}` : ''}
              <span class="chint"> {h.at.slice(0, 16).replace('T', ' ')}</span>
            </li>
          ))}
        </ul>
      </ConsoleFold>
    </div>
  );
}
