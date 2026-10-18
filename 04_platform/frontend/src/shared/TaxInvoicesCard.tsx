import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Icon } from './ui';
import { formatMoney, useT } from './i18n';
import { fiscalStanding, fiscalTitle, printable, type FiscalInvoiceRow } from './fiscal';
import { openPage } from './openPage';

/** Whatever a persona's client answers: read here as the invoice rows and the page they are. */
type Answer = Promise<{ data?: unknown; error?: unknown }>;

/**
 * A BUYER'S OWN TAX INVOICES (KRA eTIMS, Kenya only) — a shop's or a store's, what it claims its VAT back with, or one
 * person's for their own send. Shows nothing where there are none: every shop, store and person outside Kenya. Printed
 * only once KRA has recorded it; the first opening is the original, every one after it a copy (KRA's rules for a till).
 */
export function TaxInvoicesCard({ load, page, title }: { load: () => Answer; page: (invoiceId: string) => Answer; title?: string }) {
  const t = useT();
  const [rows, setRows] = useState<FiscalInvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The newest few first: a shop has one for every parcel, and a phone is not a filing cabinet.
  const [all, setAll] = useState(false);

  useEffect(() => {
    void load().then((r) => setRows(r.error || !Array.isArray(r.data) ? [] : (r.data as FiscalInvoiceRow[])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!rows || rows.length === 0) return null;

  const print = async (invoiceId: string) => {
    setError(null);
    const r = await page(invoiceId);
    if (r.error || typeof r.data !== 'string') return setError(t('fiscal.gone'));
    openPage(r.data);
  };

  return (
    <Card title={title ?? t('fiscal.mine')} aside={<span class="row__count">{rows.length}</span>}>
      <p class="hint">{t('fiscal.original')}</p>
      {rows.some((r) => r.etims.receipt?.sandbox) ? <p class="hint">{t('fiscal.sandbox')}</p> : null}
      {error ? (
        <div class="note note--warn" role="alert">
          <p class="note__t">{error}</p>
        </div>
      ) : null}
      {(all ? rows : rows.slice(0, SHOWN)).map((row) => (
        <div class="row row--static" key={row.invoiceId}>
          <span class="row__ic">
            <Icon name="printer" size={24} />
          </span>
          <span class="row__body">
            <span class="row__t">{fiscalTitle(row, t)}</span>
            <span class="row__s">{row.line.description}</span>
            <span class="row__meta">
              {new Date(row.at).toLocaleDateString()} · {fiscalStanding(row, t)}
            </span>
          </span>
          <span class="row__end">
            <b>{formatMoney(row.line.gross, row.currency)}</b>
            {printable(row) ? (
              <Button variant="link" full={false} onClick={() => void print(row.invoiceId)}>
                {t('fiscal.print')}
              </Button>
            ) : (
              <span class="row__meta">{t('fiscal.notYet')}</span>
            )}
          </span>
        </div>
      ))}
      {!all && rows.length > SHOWN ? (
        <Button variant="link" full={false} onClick={() => setAll(true)}>
          {t('fiscal.showAll', { n: rows.length })}
        </Button>
      ) : null}
    </Card>
  );
}

const SHOWN = 10;
