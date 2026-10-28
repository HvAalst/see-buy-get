import { useCallback, useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { FISCAL_STATES, fiscalTitle, fiscalTone, mayResend, printable, type FiscalInvoiceList, type FiscalState } from '../../../shared/fiscal';
import { tabAtTheTap } from '../../../shared/openPage';
import { amount } from '../queues';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * TAX INVOICES, KENYA ONLY (the user, 2026-10-18: "KRA eTIMS invoices", "not registered yet", "eTIMS only for Kenya").
 * Every sale the chosen company makes, and every sale it gives back, as KRA's eTIMS knows it — or does not yet. Shown
 * only for a company whose country uses eTIMS, as the server says (`way`): no screen keeps its own list of countries.
 * Sending one again is the company's act: network staff, or the company's own admin.
 */
export function TaxInvoicesPanel({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const entityId = state.entityId;
  const [list, setList] = useState<FiscalInvoiceList | null>(null);
  const [only, setOnly] = useState<FiscalState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client || !entityId) return;
    const r = await client.api.fiscalInvoices(entityId, only ?? undefined);
    if (r.error) return setError(r.error.detail || r.error.title);
    setError(null);
    setList(r.data as unknown as FiscalInvoiceList);
  }, [client, entityId, only]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!list || list.way !== 'etims') return null;

  const print = async (invoiceId: string) => {
    setError(null);
    const tab = tabAtTheTap();
    try {
      const r = await client!.api.fiscalInvoicePage(invoiceId);
      if (r.error || !r.data) return setError(t('fiscal.gone'));
      tab.show(r.data as unknown as string);
    } finally {
      tab.cancel();
    }
  };
  const resend = async (invoiceId: string) => {
    setBusy(invoiceId);
    const r = await client!.api.retryFiscalInvoice(invoiceId);
    setBusy(null);
    if (r.error) return setError(r.error.detail || r.error.title);
    await load();
  };
  const all = FISCAL_STATES.reduce((n, s) => n + (list.counts[s] ?? 0), 0);

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.money.tax.title')}</span>
        <span class="twr-panelend">
          <button type="button" class={`cbtn cbtn--ghost cbtn--sm${only === null ? ' cbtn--on' : ''}`} aria-pressed={only === null} onClick={() => setOnly(null)}>
            {t('tower.money.tax.all', { n: all })}
          </button>
          {FISCAL_STATES.filter((s) => list.counts[s]).map((s) => (
            <button key={s} type="button" class={`cbtn cbtn--ghost cbtn--sm${only === s ? ' cbtn--on' : ''}`} aria-pressed={only === s} onClick={() => setOnly(s)}>
              {t(`tower.money.tax.only.${s}` as never, { n: list.counts[s] ?? 0 })}
            </button>
          ))}
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void load()}>
            <Icon name="refresh" size={16} />
            {t('tower.hazards.refresh')}
          </button>
        </span>
      </div>
      <p class={list.rail === 'not_set_up' ? 'chint cerr' : 'chint'}>
        {list.rail === 'kra' ? t(list.env === 'production' ? 'tower.money.tax.rail.kra' : 'tower.money.tax.rail.kraTest') : t(`tower.money.tax.rail.${list.rail}` as never)}
      </p>
      {error ? <p class="cerr">{error}</p> : null}
      {list.items.length === 0 ? (
        <p class="cons__empty">{t('tower.money.tax.empty')}</p>
      ) : (
        <table class="ctbl ctbl--stack">
          <thead>
            <tr>
              <th>{t('tower.money.tax.col.invoice')}</th>
              <th>{t('tower.money.tax.col.buyer')}</th>
              <th class="ctbl__num">{t('tower.money.tax.col.amount')}</th>
              <th>{t('tower.money.tax.col.kra')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.items.map((row) => (
              <tr key={row.invoiceId}>
                <td>
                  {row.number ? fiscalTitle(row, t) : t(row.kind === 'credit' ? 'tower.money.tax.creditNoNumber' : 'tower.money.tax.noNumber')}
                  <span class="ctbl__sub" style="display:block">
                    {new Date(row.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {row.line.description}
                  </span>
                </td>
                <td>
                  <span class="ctbl__lbl">{t('tower.money.tax.col.buyer')}</span>
                  {row.buyer.name}
                  <span class="ctbl__sub" style="display:block">{t(`tower.money.tax.buyer.${row.buyer.kind}` as never)}</span>
                </td>
                <td class="ctbl__num ctbl__strong">
                  <span class="ctbl__lbl">{t('tower.money.tax.col.amount')}</span>
                  {amount(row.line.gross, row.currency)}
                  <span class="ctbl__sub" style="display:block">{t('tower.money.tax.taxLine', { tax: amount(row.line.tax, row.currency), band: row.line.band ?? '—' })}</span>
                </td>
                <td>
                  <span class="ctbl__lbl">{t('tower.money.tax.col.kra')}</span>
                  {/* A stand-in's answer is never said to be KRA's: the line above the table says why once. */}
                  {row.etims.receipt?.sandbox ? (
                    <span class="ctag ctag--info">{t('fiscal.standIn')}</span>
                  ) : (
                    <span class={`ctag ctag--${fiscalTone(row.etims.state)}`}>{t(`fiscal.state.${row.etims.state}` as never)}</span>
                  )}
                  {row.etims.note ? <span class="ctbl__sub ctbl__sub--warn" style="display:block">{row.etims.note}</span> : null}
                  {row.etims.state === 'refused' ? <span class="ctbl__sub" style="display:block">{t('tower.money.tax.heldBehind')}</span> : null}
                  {row.etims.tries > 1 ? <span class="ctbl__sub" style="display:block">{t('tower.money.tax.tries', { count: row.etims.tries })}</span> : null}
                </td>
                <td class="ctbl__num">
                  <span class="twr-clear__act">
                    {printable(row) ? (
                      <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void print(row.invoiceId)}>
                        {t('tower.money.tax.printCopy')}
                      </button>
                    ) : null}
                    {mayResend(row) ? (
                      <button type="button" class="cbtn cbtn--sm cbtn--primary" disabled={busy === row.invoiceId} onClick={() => void resend(row.invoiceId)}>
                        {t('tower.money.tax.resend')}
                      </button>
                    ) : null}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.total > list.items.length ? <p class="chint">{t('tower.money.tax.cut', { shown: list.items.length, total: list.total })}</p> : null}
    </section>
  );
}
