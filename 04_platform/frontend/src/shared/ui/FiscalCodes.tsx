import { useState } from 'preact/hooks';
import { Abbreviated } from './Abbr';
import { Button } from './Button';
import { Card } from './Card';
import { Choice } from './Choice';
import { Note } from './ErrorNote';
import { useLocale, useT } from '../i18n';
import { countryNameIn } from '../documents/documents';
import { EMPTY_FISCAL_ENTRY, FISCAL_CHOICES, FISCAL_CHOICE_WORDS, fiscalBody, fiscalBodyWords, fiscalCardWords, fiscalDay, fiscalFromWords, fiscalHeadWords, fiscalReady, type FiscalCard, type FiscalChoice, type FiscalCodeBody, type FiscalCountry, type FiscalForm } from '../fiscal-codes';

/**
 * 2026-11-23 — THE CODES ROMANIA AND BULGARIA FOLLOW GOODS BY, ASKED (shared/fiscal-codes.ts; the owner: "dedicated fields for both
 * Romanian UIT and Bulgarian UTN codes"): for each country a load is taken over or delivered in, the code with the day it counts
 * from, or the sender's reason that none is needed. One card for the Send app and the Shop app; the Business app draws the same
 * in the console's own fields.
 */
export function FiscalCodes({ countries, value, onChange, idPrefix, bare = false }: { countries: readonly FiscalCountry[]; value: FiscalForm; onChange: (next: FiscalForm) => void; idPrefix: string; bare?: boolean }) {
  const t = useT();
  if (!countries.length) return null;
  const set = (c: FiscalCountry, patch: Partial<FiscalForm[FiscalCountry]>) => onChange({ ...value, [c]: { ...EMPTY_FISCAL_ENTRY, ...value[c], ...patch } });
  const inner = (
    <>
      <p class="hint">
        <Abbreviated text={t('common.fiscal.lede')} />
      </p>
      {countries.map((c) => {
        const e = value[c] ?? EMPTY_FISCAL_ENTRY;
        return (
          <div key={c} class="field">
            <p class="t-body">
              <b>{t(fiscalHeadWords(c))}</b>
            </p>
            <p class="hint">
              <Abbreviated text={t(fiscalBodyWords(c))} />
            </p>
            <Choice id={`${idPrefix}-${c}`} label={t('common.fiscal.choice')} as="sheet" options={FISCAL_CHOICES[c].map((v) => ({ value: v, label: t(FISCAL_CHOICE_WORDS[v]) }))} value={e.choice} onChange={(v) => set(c, { choice: v as FiscalChoice })} />
            {e.choice === 'code' ? (
              <>
                <label class="field__label" for={`${idPrefix}-${c}-code`}>
                  {t('common.fiscal.code')}
                </label>
                <input id={`${idPrefix}-${c}-code`} class="input" maxLength={60} autoComplete="off" autoCapitalize="characters" value={e.code} onInput={(ev) => set(c, { code: ev.currentTarget.value })} />
                <label class="field__label" for={`${idPrefix}-${c}-from`}>
                  {t(fiscalFromWords(c))}
                </label>
                <input id={`${idPrefix}-${c}-from`} class="input" type="date" value={e.from} onInput={(ev) => set(c, { from: ev.currentTarget.value })} />
              </>
            ) : null}
          </div>
        );
      })}
    </>
  );
  // `bare`: inside a card that already says what this is (a load's own codes), without a second card around it.
  return bare ? (
    <div>{inner}</div>
  ) : (
    <Card title={t('common.fiscal.title')} tone="soft">
      {inner}
    </Card>
  );
}

/** Each code on a load, said: the code and its last day, or why none is needed; one that ran out or is about to, warned. */
export function FiscalCodeLines({ cards, title }: { cards?: readonly FiscalCard[]; title?: string }) {
  const t = useT();
  const locale = useLocale();
  if (!cards?.length) return null;
  return (
    <>
      {cards.map((c) => {
        const w = fiscalCardWords(c, t, countryNameIn(c.country, locale), (iso) => fiscalDay(iso, locale));
        return w.warn ? (
          <Note key={c.country} tone={w.tone === 'danger' ? 'danger' : 'warn'} icon="warning" title={w.line} detail={w.warn} />
        ) : (
          <p key={c.country} class="card__note">
            {title ? <b>{title}: </b> : null}
            <Abbreviated text={w.line} />
          </p>
        );
      })}
    </>
  );
}

/**
 * The sender gives a new code: one that ran out, or was wrong, until the goods are delivered. `save` sends what was given and
 * answers with why it was refused, or nothing.
 */
export function FiscalNewCode({ cards, idPrefix, save }: { cards?: readonly FiscalCard[]; idPrefix: string; save: (body: { ro?: FiscalCodeBody; bg?: FiscalCodeBody }) => Promise<string | null> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FiscalForm>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const countries = (cards ?? []).map((c) => c.country);
  if (!countries.length) return null;
  if (!open) {
    return (
      <>
        {saved ? <p class="card__note">{t('common.fiscal.newSaved')}</p> : null}
        <Button variant="link" full={false} onClick={() => (setForm({}), setProblem(null), setSaved(false), setOpen(true))}>
          {t('common.fiscal.newCode')}
        </Button>
      </>
    );
  }
  const body = fiscalBody(form, countries);
  return (
    <>
      <FiscalCodes countries={countries} value={form} onChange={setForm} idPrefix={idPrefix} bare />
      {problem ? (
        <p class="hint" role="alert">
          {problem}
        </p>
      ) : null}
      <Button
        busy={busy}
        disabled={!body || !countries.some((c) => fiscalReady(form, [c]))}
        onClick={async () => {
          if (!body) return;
          setBusy(true);
          const why = await save(body);
          setBusy(false);
          if (why) return setProblem(why);
          setOpen(false);
          setSaved(true);
        }}
      >
        {t('common.fiscal.newSave')}
      </Button>
      <Button variant="link" full={false} onClick={() => setOpen(false)}>
        {t('common.fiscal.cancel')}
      </Button>
    </>
  );
}
