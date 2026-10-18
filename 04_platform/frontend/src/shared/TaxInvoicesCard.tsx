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
export function TaxInvoicesCard({ load, page, title, taxNumber }: { load: () => Answer; page: (invoiceId: string) => Answer; title?: string; taxNumber?: { load: () => Answer; save: (number: string) => Answer } }) {
  const t = useT();
  const [rows, setRows] = useState<FiscalInvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The newest few first: a shop has one for every parcel, and a phone is not a filing cabinet.
  const [all, setAll] = useState(false);
  // Its own tax number, where its country has one (Kenya: the KRA PIN). Where it has none, the server says so and
  // nothing about one is shown (the user, 2026-10-18: one nation's rules never interfere with another's).
  const [num, setNum] = useState<TaxNumber | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [numError, setNumError] = useState<string | null>(null);

  useEffect(() => {
    void load().then((r) => setRows(r.error || !Array.isArray(r.data) ? [] : (r.data as FiscalInvoiceRow[])));
    if (taxNumber) void taxNumber.load().then((r) => setNum(r.error ? null : (r.data as TaxNumber)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!rows || (rows.length === 0 && !num?.applies)) return null;

  const saveNumber = async (e: Event) => {
    e.preventDefault();
    setNumError(null);
    const r = await taxNumber!.save(draft.trim());
    if (r.error) return setNumError((r.error as { detail?: string; title?: string }).detail || (r.error as { title?: string }).title || t('fiscal.gone'));
    setNum(r.data as TaxNumber);
    setEditing(false);
  };

  const print = async (invoiceId: string) => {
    setError(null);
    const r = await page(invoiceId);
    if (r.error || typeof r.data !== 'string') return setError(t('fiscal.gone'));
    openPage(r.data);
  };

  return (
    <Card title={title ?? t('fiscal.mine')} aside={<span class="row__count">{rows.length}</span>}>
      {num?.applies && num.name ? (
        editing ? (
          <form class="field" onSubmit={(e) => void saveNumber(e)}>
            <label class="field__label" for="tax-number">
              {t('fiscal.number.yours', { name: num.name })}
            </label>
            <input id="tax-number" class="input input--mono" value={draft} onInput={(e) => setDraft(e.currentTarget.value)} placeholder={num.example} autocapitalize="characters" autocomplete="off" spellcheck={false} maxLength={20} />
            <p class="hint">{t('fiscal.number.emptyRemoves')}</p>
            {numError ? (
              <div class="note note--warn" role="alert">
                <p class="note__t">{numError}</p>
              </div>
            ) : null}
            <Button type="submit">{t('fiscal.number.save')}</Button>
            <Button variant="link" full={false} onClick={() => setEditing(false)}>
              {t('fiscal.number.cancel')}
            </Button>
          </form>
        ) : (
          <>
            <div class="kv">
              <span>{num.name}</span>
              <b class="mono-t">{num.number ?? t('fiscal.number.none')}</b>
            </div>
            <p class="hint">{num.number ? t('fiscal.number.carried', { name: num.name }) : t('fiscal.number.why', { name: num.name })}</p>
            <Button
              variant="link"
              full={false}
              onClick={() => {
                setDraft(num.number ?? '');
                setNumError(null);
                setEditing(true);
              }}
            >
              {num.number ? t('fiscal.number.change', { name: num.name }) : t('fiscal.number.add', { name: num.name })}
            </Button>
          </>
        )
      ) : null}
      {rows.length === 0 ? <p class="hint">{t('fiscal.noneYet')}</p> : <p class="hint">{t('fiscal.original')}</p>}
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

/** As the server says it: whether this country asks for one at all, its name there, and the one given. */
interface TaxNumber {
  applies: boolean;
  name?: string;
  example?: string;
  number?: string;
}
