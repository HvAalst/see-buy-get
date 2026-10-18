import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT, type MessageKey } from '../../../shared/i18n';
import { publicRequest } from '../../../lib/sbg';
import { CountrySelect, useCountryAtlas } from '../../tower/screens/CountrySelect';
import { businessConfig, type BusinessClient, type BusinessView, type PostedLoad } from '../api';
import { EMPTY_LINE, EXPORT_REASONS, invoiceBody, invoiceForm, invoiceGaps, invoiceTotals, labelsLine, money, type CommercialInvoiceView, type InvoiceForm, type InvoiceGap, type InvoiceLineForm, type PackageLabels } from '../papers';

const atlasApi = { countryCatalogue: () => publicRequest(businessConfig(), '/v1/sbg/country-catalogue') };

/** A printable page the server rendered, in a tab of its own: the same way the consignment note opens. */
function openPage(html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/*
 * THE PAPERS FOR A LOAD'S GOODS — the package labels (our code, and the business's GS1 code beside it) and the
 * commercial invoice customs reads at a border. The business's own: a member who may act writes the invoice, anybody
 * in the business reads it and prints it.
 */
export function LoadPapers({ row, client, business, act }: { row: PostedLoad; client: BusinessClient | null; business: BusinessView; act: boolean }) {
  const t = useT();
  const [labels, setLabels] = useState<PackageLabels | null>(null);
  const [invoice, setInvoice] = useState<CommercialInvoiceView | null>(null);
  const [writing, setWriting] = useState(false);
  const [said, setSaid] = useState('');
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    if (!client) return;
    const [l, i] = await Promise.all([client.packageLabels(row.freightId), client.invoice(row.freightId)]);
    setLabels(l.error ? null : (l.data ?? null));
    setInvoice(i.error ? null : (i.data ?? null));
  }, [client, row.freightId]);

  useEffect(() => {
    setWriting(false);
    setSaid('');
    void read();
  }, [read]);

  const print = async (page: () => Promise<{ data?: string | null; error?: unknown }>) => {
    setError(null);
    const r = await page();
    if (r.error || !r.data) return setError(t('business.papers.gone'));
    openPage(r.data);
  };

  const current = invoice?.current;
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.papers.title')}</span>
      </div>

      <div class="crows">
        <div class="crow">
          <span class="crow__body">
            <span class="crow__top">
              <span class="crow__name">{t('business.papers.labelsTitle')}</span>
            </span>
            {labels ? <span class="crow__sub">{labelsLine(labels, Boolean(business.gs1), t)}</span> : null}
            <span class="crow__sub">{t('business.papers.printHint')}</span>
          </span>
          <span class="crow__tail">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={!client} onClick={() => void print(() => client!.packageLabelsPage(row.freightId))}>
              {t('business.papers.print')}
            </button>
          </span>
        </div>

        <div class="crow">
          <span class="crow__body">
            <span class="crow__top">
              <span class="crow__name">{t('business.papers.invoiceTitle')}</span>
            </span>
            {current ? (
              <span class="crow__sub">{t('business.papers.invoiceLine', { number: current.number, total: money(current.currency, current.totalValue), name: current.signed.name, day: current.signed.at.slice(0, 10) })}</span>
            ) : invoice ? (
              <span class="crow__sub">{t(invoice.crossesBorder ? 'business.papers.invoiceNeeded' : 'business.papers.invoiceDomestic')}</span>
            ) : null}
            {invoice?.earlier.map((e) => (
              <span class="crow__sub" key={e.invoiceId}>
                {t('business.papers.replaced', { number: e.number, name: e.signedBy, day: e.signedAt.slice(0, 10) })}
              </span>
            ))}
          </span>
          <span class="crow__tail biz-choose__acts">
            {current ? (
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={!client} onClick={() => void print(() => client!.invoicePage(row.freightId))}>
                {t('business.papers.printCopies')}
              </button>
            ) : null}
            {act && invoice?.mayWrite && !writing ? (
              <button type="button" class={`cbtn cbtn--sm ${current ? 'cbtn--ghost' : 'cbtn--primary'}`} onClick={() => setWriting(true)}>
                {t(current ? 'business.papers.writeAgain' : 'business.papers.write')}
              </button>
            ) : null}
          </span>
        </div>
      </div>

      {writing && invoice ? (
        <InvoiceEditor
          client={client}
          row={row}
          view={invoice}
          origin={business.country}
          onCancel={() => setWriting(false)}
          onSigned={async () => {
            setWriting(false);
            setSaid(t('business.invoice.signed'));
            await read();
          }}
        />
      ) : null}
      {said ? (
        <p class="chint" role="status">
          {said}
        </p>
      ) : null}
      {error ? <p class="cerr">{error}</p> : null}
    </section>
  );
}

/** Write and sign the load's commercial invoice — or a new one in place of the last, starting from what it said. */
function InvoiceEditor({ client, row, view, origin, onCancel, onSigned }: { client: BusinessClient | null; row: PostedLoad; view: CommercialInvoiceView; origin: string; onCancel: () => void; onSigned: () => void | Promise<void> }) {
  const t = useT();
  const countries = useCountryAtlas(atlasApi);
  const [form, setForm] = useState<InvoiceForm>(() => invoiceForm(new Date().toISOString().slice(0, 10), view.current, origin));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gaps = invoiceGaps(form, row.weightKg);
  const totals = invoiceTotals(form);
  const set = (patch: Partial<InvoiceForm>) => setForm((was) => ({ ...was, ...patch }));
  const setLine = (i: number, patch: Partial<InvoiceLineForm>) => setForm((was) => ({ ...was, lines: was.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) }));
  const gap = (g: InvoiceGap) => (tried && gaps.includes(g) ? <span class="cerr">{t(`business.invoice.need.${g.startsWith('line.') ? g.split('.')[2] : g}` as MessageKey)}</span> : null);

  const sign = async (e: Event) => {
    e.preventDefault();
    setTried(true);
    if (gaps.length || !client) return;
    setBusy(true);
    setError(null);
    const r = await client.writeInvoice(row.freightId, invoiceBody(form));
    setBusy(false);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    await onSigned();
  };

  return (
    <form class="biz-invoice" onSubmit={(e) => void sign(e)}>
      <p class="cons__lede">{t('business.invoice.lede')}</p>
      <div class="biz-two">
        <label class="cfield">
          <span class="cfield__label">{t('business.invoice.number')}</span>
          <input id="inv-number" class="cinput" maxLength={40} value={form.number} onInput={(e) => set({ number: (e.target as HTMLInputElement).value })} />
          {gap('number')}
        </label>
        <label class="cfield">
          <span class="cfield__label">{t('business.invoice.issuedOn')}</span>
          <input class="cinput" type="date" value={form.issuedOn} onInput={(e) => set({ issuedOn: (e.target as HTMLInputElement).value })} />
        </label>
      </div>

      <fieldset class="cfield biz-acts">
        <legend class="cfield__label">{t('business.invoice.importer')}</legend>
        <div class="biz-two">
          <label class="cfield">
            <span class="cfield__label">{t('business.invoice.importerName')}</span>
            <input id="inv-importer" class="cinput" maxLength={120} value={form.importerName} onInput={(e) => set({ importerName: (e.target as HTMLInputElement).value })} />
            {gap('importerName')}
          </label>
          <div class="cfield">
            <CountrySelect value={form.importerCountry} onChange={(importerCountry) => set({ importerCountry })} label={t('business.invoice.importerCountry')} options={countries} />
            {gap('importerCountry')}
          </div>
        </div>
        <div class="biz-two">
          <label class="cfield">
            <span class="cfield__label">{t('business.invoice.importerAddress')}</span>
            <input class="cinput" maxLength={200} value={form.importerAddress} onInput={(e) => set({ importerAddress: (e.target as HTMLInputElement).value })} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('business.invoice.importerTaxNo')}</span>
            <input class="cinput" maxLength={60} value={form.importerTaxNo} onInput={(e) => set({ importerTaxNo: (e.target as HTMLInputElement).value })} />
          </label>
        </div>
      </fieldset>

      <div class="biz-two">
        <label class="cfield">
          <span class="cfield__label">{t('business.invoice.currency')}</span>
          <input id="inv-currency" class="cinput" maxLength={3} value={form.currency} onInput={(e) => set({ currency: (e.target as HTMLInputElement).value.toUpperCase() })} />
          <span class="chint">{t('business.invoice.currencyHint')}</span>
          {gap('currency')}
        </label>
        <label class="cfield">
          <span class="cfield__label">{t('business.invoice.reason')}</span>
          <select class="cinput" value={form.reason} onChange={(e) => set({ reason: (e.target as HTMLSelectElement).value as InvoiceForm['reason'] })}>
            {EXPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`business.invoice.reason.${r}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset class="cfield biz-acts">
        <legend class="cfield__label">{t('business.invoice.lines')}</legend>
        {form.lines.map((l, i) => (
          <div class="biz-invoice__line" key={i}>
            <div class="biz-invoice__linehead">
              <span class="crow__name">{t('business.invoice.lineN', { n: i + 1 })}</span>
              {form.lines.length > 1 ? (
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => set({ lines: form.lines.filter((_, n) => n !== i) })}>
                  {t('business.invoice.removeLine', { n: i + 1 })}
                </button>
              ) : null}
            </div>
            <label class="cfield">
              <span class="cfield__label">{t('business.invoice.description')}</span>
              <input id={`inv-desc-${i}`} class="cinput" maxLength={200} value={l.description} onInput={(e) => setLine(i, { description: (e.target as HTMLInputElement).value })} />
              {gap(`line.${i}.description`)}
            </label>
            <div class="biz-two">
              <label class="cfield">
                <span class="cfield__label">{t('business.invoice.quantity')}</span>
                <input id={`inv-qty-${i}`} class="cinput" inputMode="numeric" value={l.quantity} onInput={(e) => setLine(i, { quantity: (e.target as HTMLInputElement).value })} />
                {gap(`line.${i}.quantity`)}
              </label>
              <label class="cfield">
                <span class="cfield__label">{t('business.invoice.netKg')}</span>
                <input id={`inv-kg-${i}`} class="cinput" inputMode="decimal" value={l.netKg} onInput={(e) => setLine(i, { netKg: (e.target as HTMLInputElement).value })} />
                {gap(`line.${i}.netKg`)}
              </label>
            </div>
            <div class="biz-two">
              <label class="cfield">
                <span class="cfield__label">{t('business.invoice.unitValue')}</span>
                <input id={`inv-value-${i}`} class="cinput" inputMode="decimal" value={l.unitValue} onInput={(e) => setLine(i, { unitValue: (e.target as HTMLInputElement).value })} />
                {gap(`line.${i}.unitValue`)}
              </label>
              <label class="cfield">
                <span class="cfield__label">{t('business.invoice.hsCode')}</span>
                <input id={`inv-hs-${i}`} class="cinput" inputMode="decimal" maxLength={16} value={l.hsCode} onInput={(e) => setLine(i, { hsCode: (e.target as HTMLInputElement).value })} />
                <span class="chint">{t('business.invoice.hsHint')}</span>
                {gap(`line.${i}.hsCode`)}
              </label>
            </div>
            <div class="cfield">
              <CountrySelect value={l.originCountry} onChange={(originCountry) => setLine(i, { originCountry })} label={t('business.invoice.origin')} options={countries} />
              {gap(`line.${i}.originCountry`)}
            </div>
          </div>
        ))}
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => set({ lines: [...form.lines, { ...EMPTY_LINE, originCountry: origin }] })}>
          {t('business.invoice.addLine')}
        </button>
        {gap('lines')}
      </fieldset>

      <p class="chint">{t('business.invoice.totals', { value: form.currency.trim().length === 3 ? money(form.currency.trim().toUpperCase(), totals.value) : totals.value.toLocaleString(), kg: totals.netKg.toLocaleString(), gross: row.weightKg.toLocaleString() })}</p>
      {gap('overweight')}
      <label class="cfield cfield--check">
        <input id="inv-declare" type="checkbox" checked={form.declare} onChange={(e) => set({ declare: (e.target as HTMLInputElement).checked })} />
        <span>{t('business.invoice.declare')}</span>
      </label>
      {gap('declare')}
      {error ? <p class="cerr">{error}</p> : null}
      <div class="twr-panelend">
        <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={onCancel}>
          {t('business.invoice.cancel')}
        </button>
        <button type="submit" class="cbtn cbtn--primary" disabled={busy}>
          {t('business.invoice.sign')}
        </button>
      </div>
    </form>
  );
}
