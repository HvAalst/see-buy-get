import { useCallback, useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { EMPTY_BORDER_FORM, borderFormBlocker, crossingLine, formFromRule, toBorderBody, type BorderForm, type BorderRuleRow } from '../borders';
import { countryNameOf, type CatalogueCountry } from '../presence';
import type { TowerActions, TowerState } from '../useTowerApp';
import { FieldObservationsPanel } from './FieldObservationsPanel';
import { ConsolePick } from '../ConsolePick';

/**
 * CA6 — THE RULES OF CROSSING A BORDER.
 *
 * Where a border may be crossed and when, what a vehicle must carry, what a crossing allows, and whether a foreign
 * vehicle may carry loads inside a country at all. Dispatch asks these at every offer, claim and accepted price;
 * the absence of a rule is not permission, and this screen says so above everything else.
 */
export function BordersScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const who = state.who?.name;
  const [rules, setRules] = useState<BorderRuleRow[] | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueCountry[]>(state.catalogue ?? []);
  const [form, setForm] = useState<BorderForm>({ ...EMPTY_BORDER_FORM });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const [list, countries] = await Promise.all([client.api.borderRules(), catalogue.length ? Promise.resolve(null) : client.api.countryCatalogue()]);
    if (list.error) setError(list.error.detail || list.error.title);
    else setRules(((list.data as unknown as { items?: BorderRuleRow[] })?.items ?? []) as BorderRuleRow[]);
    if (countries && !countries.error) setCatalogue(((countries.data as unknown as { items?: CatalogueCountry[] })?.items ?? []) as CatalogueCountry[]);
  }, [client, catalogue.length]);

  useEffect(() => {
    void load();
  }, [load]);

  const blocker = borderFormBlocker(form, catalogue);
  const name = (code: string) => countryNameOf(code, catalogue);

  const save = async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    setDone(null);
    const r = await client.api.setBorderRule({ ...toBorderBody(form), ...(who ? { by: who } : {}) });
    setBusy(false);
    if (r.error) {
      setError(r.error.detail || r.error.title);
      return;
    }
    setDone(t('tower.borders.saved'));
    setForm({ ...EMPTY_BORDER_FORM });
    await load();
  };

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.borders.title')}</h1>
        <p class="cons__lede">{t('tower.borders.lede')}</p>
      </header>

      <p class="cons__caveat">
        <Icon name="info" size={16} />
        <span>
          <b>{t('tower.borders.caveatT')}</b> {t('tower.borders.caveat')}
        </span>
      </p>

      {done ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {done}
        </p>
      ) : null}
      {error ? <p class="cerr">{error}</p> : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{rules === null ? t('tower.queues.loading') : t('tower.borders.count', { n: rules.length })}</span>
        </div>
        {rules === null ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : rules.length === 0 ? (
          <p class="cons__empty">{t('tower.borders.none')}</p>
        ) : (
          <table class="ctbl ctbl--stack">
            <thead>
              <tr>
                <th>{t('tower.borders.col.direction')}</th>
                <th>{t('tower.borders.col.crossings')}</th>
                <th>{t('tower.borders.col.carry')}</th>
                <th>{t('tower.borders.col.limits')}</th>
                <th>{t('tower.borders.col.cabotage')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={`${rule.from}>${rule.to}`}>
                  <td>
                    <div class="ctbl__strong">
                      {name(rule.from)} → {name(rule.to)}
                    </div>
                    <div class="ctbl__sub">{t('tower.borders.by', { who: rule.setBy })}</div>
                    {rule.note ? <div class="ctbl__sub">{rule.note}</div> : null}
                  </td>
                  <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.borders.col.crossings')}</span>{rule.crossings.length ? rule.crossings.map((c) => <div key={c.name}>{crossingLine(c)}</div>) : t('tower.borders.nothing')}</td>
                  <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.borders.col.carry')}</span>{[...rule.permits, ...rule.regionalInsurance].join(', ') || t('tower.borders.nothing')}</td>
                  <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.borders.col.limits')}</span>{rule.maxWeightKg ? t('tower.borders.maxKg', { kg: rule.maxWeightKg.toLocaleString() }) : t('tower.borders.nothing')}</td>
                  <td><span class="ctbl__lbl">{t('tower.borders.col.cabotage')}</span>
                    <span class={`ctag ${rule.cabotage === 'allowed' ? 'ctag--ok' : 'ctag--quiet'}`}>{t(rule.cabotage === 'allowed' ? 'tower.borders.cabotage.allowed' : 'tower.borders.cabotage.forbidden')}</span>
                  </td>
                  <td>
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setForm(formFromRule(rule))}>
                      {t('tower.borders.edit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* CL5 — the rules above are ours; this is what people were actually asked for. Kept apart on
          purpose: merging them would assert a requirement on the strength of one driver's afternoon. */}
      <FieldObservationsPanel actions={actions} isOperator={state.who?.mode === 'operator'} catalogue={catalogue} />

      <section class="cons__panel twr-corridornew">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.borders.formTitle')}</span>
        </div>
        <div class="twr-corridorform">
          {(['from', 'to'] as const).map((key) => (
            <ConsolePick
              key={key}
              label={t(key === 'from' ? 'tower.borders.f.from' : 'tower.borders.f.to')}
              value={form[key]}
              onChange={(v) => setForm({ ...form, [key]: v })}
              placeholder={t('tower.borders.f.choose')}
              options={catalogue.map((c) => ({ value: c.code, label: c.name, tag: c.code }))}
            />
          ))}
          <ConsolePick
            label={t('tower.borders.f.cabotage')}
            value={form.cabotage}
            onChange={(v) => setForm({ ...form, cabotage: v as 'allowed' | 'forbidden' })}
            options={[
              { value: 'forbidden', label: t('tower.borders.cabotage.forbidden') },
              { value: 'allowed', label: t('tower.borders.cabotage.allowed') },
            ]}
          />
          <label class="cfield">
            <span class="cfield__label">{t('tower.borders.f.crossings')}</span>
            <textarea class="cinput" rows={3} value={form.crossings} onInput={(e) => setForm({ ...form, crossings: e.currentTarget.value })} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.borders.f.permits')}</span>
            <input class="cinput" value={form.permits} onInput={(e) => setForm({ ...form, permits: e.currentTarget.value })} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.borders.f.insurance')}</span>
            <input class="cinput" value={form.regionalInsurance} onInput={(e) => setForm({ ...form, regionalInsurance: e.currentTarget.value })} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.borders.f.maxWeight')}</span>
            <input class="cinput" type="number" value={form.maxWeightKg} onInput={(e) => setForm({ ...form, maxWeightKg: e.currentTarget.value })} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.borders.f.note')}</span>
            <input class="cinput" value={form.note} onInput={(e) => setForm({ ...form, note: e.currentTarget.value })} />
          </label>
        </div>
        <div class="twr-corridorsave">
          <button type="button" class="cbtn cbtn--primary" disabled={blocker !== null || busy} onClick={() => void save()}>
            {t('tower.borders.save')}
          </button>
          {blocker ? <span class="chint">{t(blocker)}</span> : null}
        </div>
      </section>
    </>
  );
}
