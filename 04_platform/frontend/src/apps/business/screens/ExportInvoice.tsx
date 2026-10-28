import { useState } from 'preact/hooks';
import { abbrName } from '../../../shared/abbr';
import { DocumentButton } from '../../../shared/ui';
import { countryNameIn } from '../../../shared/documents/documents';
import { useT, type MessageKey } from '../../../shared/i18n';
import type { BusinessClient } from '../api';
import { CurrencySelect } from '../../tower/screens/CurrencySelect';
import { ConsolePick } from '../../tower/ConsolePick';
import { INVOICE_REASONS, invoiceBody, invoiceForm, moneyWords, PAYMENT_TERM_WORDS, PAYMENT_TERMS, paymentTermOf, SLI_INCOTERMS, utcWords, type ExportDetail, type InvoiceForm, type InvoiceReason, type PaymentTermKey } from '../exports';

type Problem = { detail?: string; title: string } | null | undefined;

const TERM_WORD: Record<PaymentTermKey, MessageKey> = {
  advance: 'business.exports.invoice.terms.advance',
  lc_sight: 'business.exports.invoice.terms.lc_sight',
  lc_deferred: 'business.exports.invoice.terms.lc_deferred',
  cad: 'business.exports.invoice.terms.cad',
  dad: 'business.exports.invoice.terms.dad',
  open_30: 'business.exports.invoice.terms.open_30',
  open_60: 'business.exports.invoice.terms.open_60',
  open_90: 'business.exports.invoice.terms.open_90',
  consignment: 'business.exports.invoice.terms.consignment',
};

const REASON_WORD: Record<InvoiceReason, MessageKey> = {
  sale: 'business.exports.invoice.reason.sale',
  sample: 'business.exports.invoice.reason.sample',
  gift: 'business.exports.invoice.reason.gift',
  repair: 'business.exports.invoice.reason.repair',
  return: 'business.exports.invoice.reason.return',
  other: 'business.exports.invoice.reason.other',
};

/**
 * THE COMMERCIAL INVOICE (the user, 2026-10-28: "a flexible document since it is virtually different in every nation").
 * Its lines and prices are the packing list's. The core is the same everywhere; what the destination asks for besides —
 * particulars by their own names, declarations in its own words, the list's own columns — the exporter adds, and its
 * next invoice to that country starts from it. Signed, it is kept exactly as signed.
 */
export function ExportInvoice({ d, client, mine, signatory, onDetail }: { d: ExportDetail; client: BusinessClient; mine: boolean; signatory: string; onDetail: (next: ExportDetail) => void | Promise<void> }) {
  const t = useT();
  const c = d.consignment;
  const inv = d.invoice;
  const last = inv.versions[inv.versions.length - 1];
  // The destination by its name, in the reader's words — never only its two letters.
  const dest = countryNameIn(c.destCountry, 'en');
  const [editing, setEditing] = useState(!last);
  const [form, setForm] = useState<InvoiceForm>(() => invoiceForm(inv, d.sli.draft, new Date().toISOString().slice(0, 10)));
  const [who, setWho] = useState(signatory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (patch: Partial<InvoiceForm>) => setForm({ ...form, ...patch });
  // Payment terms are chosen; "Other" opens a field for the exporter's own words.
  const [otherTerms, setOtherTerms] = useState(() => paymentTermOf(form.paymentTerms) === 'other');
  const termChoice = otherTerms ? 'other' : paymentTermOf(form.paymentTerms);
  const cur = form.currency || inv.currencyFromList || '';

  const call = async (fn: () => Promise<{ data?: unknown; error?: unknown }>) => {
    const r = await fn();
    if (r.error) {
      setError((r.error as Problem)?.detail || (r.error as Problem)?.title || '');
      return undefined;
    }
    return r.data as ExportDetail | undefined;
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    const next = await call(() => client.exports.saveInvoice(c.exportId, invoiceBody(form)));
    setBusy(false);
    if (!next) return;
    setDone(t('business.exports.invoice.saved'));
    await onDetail(next);
  };
  const sign = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    // What is on the screen is what is signed: saved first, then signed.
    const saved = await call(() => client.exports.saveInvoice(c.exportId, invoiceBody(form)));
    const next = saved ? await call(() => client.exports.signInvoice(c.exportId, who.trim())) : undefined;
    setBusy(false);
    if (!next) return;
    setDone(t('business.exports.invoice.signedNote', { n: inv.versions.length + 1 }));
    setEditing(false);
    await onDetail(next);
  };
  const input = (label: string, value: string, onInput: (v: string) => void, opts: { max?: number; type?: string; placeholder?: string } = {}) => (
    <label class="cfield">
      <span class="cfield__label">{label}</span>
      <input class="cinput" type={opts.type ?? 'text'} maxLength={opts.max ?? 160} placeholder={opts.placeholder} value={value} onInput={(e) => onInput((e.target as HTMLInputElement).value)} />
    </label>
  );

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.exports.invoice.title')}</span>
        <span class={`ctag ctag--${last ? (inv.stale ? 'warn' : 'ok') : 'warn'}`}>{t(last ? (inv.stale ? 'business.exports.sli.tagStale' : 'business.exports.sli.tagSigned') : 'business.exports.sli.tagNone')}</span>
      </div>
      <p class="chint">{t(mine ? 'business.exports.invoice.lede' : 'business.exports.invoice.ledeRead')}</p>
      {done ? <p class="cnote">{done}</p> : null}
      {error ? <p class="cerr">{error}</p> : null}
      {inv.stale && last ? <p class="cerr">{t('business.exports.invoice.stale', { n: last.version })}</p> : null}
      {inv.totals.lines ? (
        <p class="cons__lede">{t('business.exports.invoice.totals', { lines: inv.totals.lines, goods: moneyWords(cur, inv.totals.goods), total: moneyWords(cur, inv.totals.total) })}</p>
      ) : null}
      {mine
        ? inv.notes.map((n) => (
            <p class="chint" key={n}>
              {n}
            </p>
          ))
        : null}

      {inv.versions.length ? (
        <div class="crows">
          {[...inv.versions].reverse().map((v) => (
            <div class="crow" key={v.version}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">{t('business.exports.sli.version', { n: v.version })}</span>
                  {v.version === last?.version && !inv.stale ? <span class="ctag ctag--ok">{t('business.exports.sli.current')}</span> : <span class="ctag ctag--quiet">{t('business.exports.sli.earlier')}</span>}
                </span>
                <span class="crow__sub">{t('business.exports.invoice.versionLine', { who: v.signedBy, when: utcWords(v.signedAt), total: moneyWords(v.currency, v.total) })}</span>
                <span class="twr-panelend">
                  <DocumentButton label={t('business.exports.sli.open')} title={t('business.exports.sli.version', { n: v.version })} fetch={() => client.exports.invoicePage(c.exportId, { version: v.version })} />
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : !mine ? (
        <p class="cons__empty">{t('business.exports.invoice.noneYet')}</p>
      ) : null}

      {mine && !editing ? (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setEditing(true)}>
            {t('business.exports.invoice.change')}
          </button>
        </div>
      ) : null}

      {mine && editing ? (
        <>
          {!inv.draft && inv.template ? <p class="cnote">{t('business.exports.invoice.fromTemplate', { country: dest, code: inv.template.fromExport })}</p> : null}
          <h3 class="cons__sub">{t('business.exports.invoice.core')}</h3>
          <div class="biz-two">
            {input(t('business.exports.invoice.number'), form.number, (v) => set({ number: v }), { max: 40 })}
            {input(t('business.exports.invoice.date'), form.date, (v) => set({ date: v }), { type: 'date' })}
          </div>
          <div class="biz-two">
            <CurrencySelect api={client.api as never} value={form.currency} onChange={(currency) => set({ currency })} label={t('business.exports.invoice.currency')} near={[c.originCountry, c.destCountry]} also={inv.currencyFromList ? [inv.currencyFromList] : []} />
            <ConsolePick
              label={t('business.exports.invoice.paymentTerms')}
              value={termChoice}
              placeholder={t('business.exports.sli.choose')}
              options={[...PAYMENT_TERMS.map((k) => ({ value: k, label: t(TERM_WORD[k]) })), { value: 'other', label: t('business.exports.invoice.terms.other') }]}
              onChange={(value) => {
                const v = value as PaymentTermKey | 'other' | '';
                setOtherTerms(v === 'other');
                set({ paymentTerms: v && v !== 'other' ? PAYMENT_TERM_WORDS[v] : v === 'other' && paymentTermOf(form.paymentTerms) === 'other' ? form.paymentTerms : '' });
              }}
            />
          </div>
          {termChoice === 'other' ? input(t('business.exports.invoice.termsOther'), form.paymentTerms, (v) => set({ paymentTerms: v }), { max: 200 }) : null}
          <div class="biz-two">
            <ConsolePick
              label={t('business.exports.sli.incoterm')}
              value={form.incoterm}
              options={[{ value: '', label: t('business.exports.sli.incotermNone') }, ...SLI_INCOTERMS.map((code) => ({ value: code, label: `${code} — ${t(abbrName(code))}` }))]}
              onChange={(incoterm) => set({ incoterm })}
            />
            {form.incoterm ? input(t('business.exports.sli.incotermPlace'), form.incotermPlace, (v) => set({ incotermPlace: v }), { max: 80 }) : <span />}
          </div>
          <ConsolePick label={t('business.exports.invoice.reason')} value={form.reason} options={INVOICE_REASONS.map((r) => ({ value: r, label: t(REASON_WORD[r]) }))} onChange={(reason) => set({ reason: reason as InvoiceReason })} />

          <h3 class="cons__sub">{t('business.exports.invoice.buyer')}</h3>
          <div class="biz-two">
            {input(t('business.exports.invoice.buyerName'), form.buyer.name, (v) => set({ buyer: { ...form.buyer, name: v } }))}
            {input(t('business.exports.invoice.buyerTax'), form.buyer.taxId, (v) => set({ buyer: { ...form.buyer, taxId: v } }), { max: 60 })}
          </div>
          <label class="cfield">
            <span class="cfield__label">{t('business.exports.invoice.buyerAddress')}</span>
            <textarea class="cinput" rows={2} maxLength={400} value={form.buyer.address} onInput={(e) => set({ buyer: { ...form.buyer, address: (e.target as HTMLTextAreaElement).value } })} />
          </label>
          <label class="cfield--check">
            <input type="checkbox" checked={form.consigneeIsBuyer} onChange={() => set({ consigneeIsBuyer: !form.consigneeIsBuyer })} />
            <span>{t('business.exports.invoice.consigneeIsBuyer')}</span>
          </label>

          <h3 class="cons__sub">{t('business.exports.invoice.charges')}</h3>
          <p class="chint">{t('business.exports.invoice.chargesHint')}</p>
          {form.charges.map((ch, i) => (
            <div class="biz-two" key={`c${i}`}>
              {input(t('business.exports.invoice.chargeLabel'), ch.label, (v) => set({ charges: form.charges.map((x, n) => (n === i ? { ...x, label: v } : x)) }), { max: 60, placeholder: t('business.exports.invoice.chargePh') })}
              <div class="biz-paperline">
                {input(t('business.exports.invoice.amount', { currency: cur || '—' }), ch.amount, (v) => set({ charges: form.charges.map((x, n) => (n === i ? { ...x, amount: v } : x)) }), { type: 'number' })}
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => set({ charges: form.charges.filter((_, n) => n !== i) })}>
                  {t('business.exports.invoice.remove')}
                </button>
              </div>
            </div>
          ))}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={form.charges.length >= 12} onClick={() => set({ charges: [...form.charges, { label: '', amount: '' }] })}>
              {t('business.exports.invoice.addCharge')}
            </button>
          </div>

          <h3 class="cons__sub">{t('business.exports.invoice.particulars', { country: dest })}</h3>
          <p class="chint">{t('business.exports.invoice.particularsHint', { country: dest })}</p>
          {form.fields.map((f, i) => (
            <div class="biz-two" key={`f${i}`}>
              {input(t('business.exports.invoice.fieldLabel'), f.label, (v) => set({ fields: form.fields.map((x, n) => (n === i ? { ...x, label: v } : x)) }), { max: 60, placeholder: t('business.exports.invoice.fieldPh') })}
              <div class="biz-paperline">
                {input(t('business.exports.invoice.fieldValue'), f.value, (v) => set({ fields: form.fields.map((x, n) => (n === i ? { ...x, value: v } : x)) }), { max: 200 })}
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => set({ fields: form.fields.filter((_, n) => n !== i) })}>
                  {t('business.exports.invoice.remove')}
                </button>
              </div>
            </div>
          ))}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={form.fields.length >= 30} onClick={() => set({ fields: [...form.fields, { label: '', value: '' }] })}>
              {t('business.exports.invoice.addField')}
            </button>
          </div>

          <h3 class="cons__sub">{t('business.exports.invoice.declarations')}</h3>
          <p class="chint">{t('business.exports.invoice.declarationsHint', { country: dest })}</p>
          <p class="cons__lede">{inv.truth}</p>
          {form.declarations.map((text, i) => (
            <div key={`d${i}`}>
              <label class="cfield">
                <span class="cfield__label">{t('business.exports.invoice.declaration', { n: i + 1 })}</span>
                <textarea class="cinput" rows={2} maxLength={1200} value={text} onInput={(e) => set({ declarations: form.declarations.map((x, n) => (n === i ? (e.target as HTMLTextAreaElement).value : x)) })} />
              </label>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => set({ declarations: form.declarations.filter((_, n) => n !== i) })}>
                  {t('business.exports.invoice.remove')}
                </button>
              </div>
            </div>
          ))}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={form.declarations.length >= 10} onClick={() => set({ declarations: [...form.declarations, ''] })}>
              {t('business.exports.invoice.addDeclaration')}
            </button>
          </div>

          {inv.listColumns.length ? (
            <>
              <h3 class="cons__sub">{t('business.exports.invoice.columns')}</h3>
              {inv.listColumns.map((col) => (
                <label class="cfield--check" key={col}>
                  <input type="checkbox" checked={form.columns.includes(col)} onChange={() => set({ columns: form.columns.includes(col) ? form.columns.filter((x) => x !== col) : [...form.columns, col] })} />
                  <span>{col}</span>
                </label>
              ))}
            </>
          ) : null}

          {inv.gaps.length ? <p class="chint">{t('business.exports.sli.gaps', { what: inv.gaps.join('; ') })}</p> : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => void save()}>
              {t('business.exports.sli.save')}
            </button>
            {inv.draft ? <DocumentButton label={t('business.exports.sli.preview')} title={t('business.exports.sli.preview')} fetch={() => client.exports.invoicePage(c.exportId, { draft: true })} /> : null}
          </div>
          <div class="biz-two">
            {input(t('business.exports.sli.signatory'), who, setWho, { max: 120 })}
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy || who.trim().length < 2} onClick={() => void sign()}>
                {t('business.exports.sli.sign', { n: inv.versions.length + 1 })}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
