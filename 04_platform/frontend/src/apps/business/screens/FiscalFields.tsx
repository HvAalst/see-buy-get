import { useState } from 'preact/hooks';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { useLocale, useT } from '../../../shared/i18n';
import { countryNameIn } from '../../../shared/documents/documents';
import { EMPTY_FISCAL_ENTRY, FISCAL_CHOICES, FISCAL_CHOICE_WORDS, FISCAL_COMPLIANCE_WORDS, fiscalBody, fiscalBodyWords, fiscalCardWords, fiscalDay, fiscalFromWords, fiscalHeadWords, fiscalMoment, fiscalReady, type FiscalChoice, type FiscalCountry, type FiscalForm } from '../../../shared/fiscal-codes';
import type { BusinessClient, PostedLoad } from '../api';

/**
 * 2026-11-23 — THE CODES ROMANIA AND BULGARIA FOLLOW GOODS BY, in the console's own fields (shared/fiscal-codes.ts; the owner:
 * "dedicated fields for both Romanian UIT and Bulgarian UTN codes"): for each country the load is taken over or delivered in, the
 * code and the day it counts from, or the business's reason that none is needed.
 */
export function FiscalFields({ countries, value, onChange, idPrefix = 'fiscal' }: { countries: readonly FiscalCountry[]; value: FiscalForm; onChange: (next: FiscalForm) => void; idPrefix?: string }) {
  const t = useT();
  if (!countries.length) return null;
  const set = (c: FiscalCountry, patch: Partial<FiscalForm[FiscalCountry]>) => onChange({ ...value, [c]: { ...EMPTY_FISCAL_ENTRY, ...value[c], ...patch } });
  return (
    <div class="cfield">
      <span class="cfield__label">{t('common.fiscal.title')}</span>
      <span class="chint">
        <Abbreviated text={t('common.fiscal.lede')} />
      </span>
      {countries.map((c) => {
        const e = value[c] ?? EMPTY_FISCAL_ENTRY;
        return (
          <fieldset key={c} class="cfield">
            <legend class="cfield__label">{t(fiscalHeadWords(c))}</legend>
            <span class="chint">
              <Abbreviated text={t(fiscalBodyWords(c))} />
            </span>
            {FISCAL_CHOICES[c].map((v) => (
              <label key={v} class="cfield--check">
                <input type="radio" name={`${idPrefix}-${c}`} checked={e.choice === v} onChange={() => set(c, { choice: v as FiscalChoice })} />
                <span>{t(FISCAL_CHOICE_WORDS[v])}</span>
              </label>
            ))}
            {e.choice === 'code' ? (
              <div class="biz-two">
                <label class="cfield">
                  <span class="cfield__label">{t('common.fiscal.code')}</span>
                  <input class="cinput" maxLength={60} autoComplete="off" value={e.code} onInput={(ev) => set(c, { code: (ev.target as HTMLInputElement).value })} />
                </label>
                <label class="cfield">
                  <span class="cfield__label">{t(fiscalFromWords(c))}</span>
                  <input class="cinput" type="date" value={e.from} onInput={(ev) => set(c, { from: (ev.target as HTMLInputElement).value })} />
                </label>
              </div>
            ) : null}
          </fieldset>
        );
      })}
      {/* 2026-11-24 — the business's certification (the owner: "a required tick"). */}
      <label class="cfield--check">
        <input type="checkbox" checked={value.indemnity === true} onChange={(ev) => onChange({ ...value, indemnity: (ev.target as HTMLInputElement).checked })} />
        <span>{t('common.fiscal.indemnity')}</span>
      </label>
    </div>
  );
}

/**
 * A posted load's codes: each said, one that ran out or is about to warned, and a new one given until the goods are delivered.
 * The driver holding the load is told.
 */
export function LoadFiscal({ row, client, act, onChanged }: { row: PostedLoad; client: BusinessClient | null; act: boolean; onChanged: (message?: string) => void | Promise<void> }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FiscalForm>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cards = row.fiscalCodes ?? [];
  if (!cards.length) return null;
  const countries = cards.map((c) => c.country);
  const mayWrite = act && Boolean(client) && ['scheduled', 'available', 'ordered', 'claimed', 'in_transit'].includes(row.status);
  const body = fiscalBody(form, countries);
  const save = async () => {
    if (!client || !body) return;
    setBusy(true);
    setError(null);
    const r = await client.shipping.setFreightFiscalCodes(row.freightId, body);
    setBusy(false);
    if (r.error) return setError((r.error as { detail?: string; title?: string }).detail || (r.error as { title?: string }).title || '');
    setOpen(false);
    await onChanged(t('common.fiscal.newSaved'));
  };
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('common.fiscal.title')}</span>
        {cards.some((c) => c.status === 'expired') ? <span class="ctag ctag--warn">{t('common.fiscal.newCode')}</span> : null}
      </div>
      {row.fiscalCompliance ? <p class="cons__lede">{t(FISCAL_COMPLIANCE_WORDS[row.fiscalCompliance])}</p> : null}
      {cards.map((c) => {
        const w = fiscalCardWords(c, t, countryNameIn(c.country, locale), (iso) => fiscalDay(iso, locale), (iso) => fiscalMoment(iso, locale));
        return (
          <p class="cons__lede" key={c.country}>
            <Abbreviated text={w.line} />
            {w.warn ? (
              <>
                {' '}
                <b>{w.warn}</b>
              </>
            ) : null}
          </p>
        );
      })}
      {!mayWrite ? null : !open ? (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => (setForm({}), setError(null), setOpen(true))}>
            {t('common.fiscal.newCode')}
          </button>
        </div>
      ) : (
        <>
          <FiscalFields countries={countries} value={form} onChange={setForm} idPrefix={`fiscal-${row.freightId}`} />
          {error ? (
            <p class="cerr">
              <Abbreviated text={error} />
            </p>
          ) : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary" disabled={busy || !body || !countries.some((c) => fiscalReady(form, [c]))} onClick={() => void save()}>
              {t('common.fiscal.newSave')}
            </button>
            <button type="button" class="cbtn cbtn--ghost" onClick={() => setOpen(false)}>
              {t('common.fiscal.cancel')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
