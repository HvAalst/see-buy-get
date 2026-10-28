import { useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { ConsolePick, type PickOption } from '../ConsolePick';

type Api = { countryCatalogue: () => Promise<{ data?: unknown; error?: unknown }> };

/** One currency, with the countries that settle in it — what the reader recognises it by. */
export interface CurrencyOption {
  code: string;
  name: string;
  countries: Array<{ code: string; name: string }>;
}

/**
 * The currencies that exist, from the country catalogue: each with its name and the countries behind it. Pure — the
 * catalogue's rows in, one option per currency out, alphabetical by code.
 */
export function currenciesOf(rows: Array<{ code: string; name: string; currency: string }>, locale = 'en'): CurrencyOption[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale, 'en'], { type: 'currency' });
  } catch {
    names = null;
  }
  const by = new Map<string, CurrencyOption>();
  for (const r of rows) {
    if (!/^[A-Z]{3}$/.test(r.currency ?? '')) continue;
    const o = by.get(r.currency) ?? { code: r.currency, name: names?.of(r.currency) ?? r.currency, countries: [] };
    o.countries.push({ code: r.code, name: r.name });
    by.set(r.currency, o);
  }
  return [...by.values()].map((o) => ({ ...o, countries: o.countries.sort((a, b) => a.name.localeCompare(b.name)) })).sort((a, b) => a.code.localeCompare(b.code));
}

/** "KES — Kenyan Shilling · Kenya" — a currency as a person recognises it; a long list of countries shortened. */
export function currencyLabel(o: CurrencyOption, more: (n: number) => string): string {
  const shown = o.countries.slice(0, 3).map((c) => c.name).join(', ');
  const rest = o.countries.length - 3;
  return `${o.code} — ${o.name} · ${shown}${rest > 0 ? ` ${more(rest)}` : ''}`;
}

let catalogue: Promise<CurrencyOption[]> | null = null;

/** The currencies, asked for once however many selects are on the screen. */
export function useCurrencies(api: Api | null): CurrencyOption[] {
  const [list, setList] = useState<CurrencyOption[]>([]);
  useEffect(() => {
    if (!api) return;
    if (!catalogue) {
      catalogue = api.countryCatalogue().then((r) => (r.error || !r.data ? [] : currenciesOf(((r.data as { items?: Array<{ code: string; name: string; currency: string }> }).items ?? []))));
    }
    let live = true;
    void catalogue.then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [api]);
  return list;
}

/**
 * A CURRENCY IS CHOSEN, NOT TYPED (the user, 2026-10-28: "currency should be an selector with country behind it to avoid
 * errors"). Each currency is shown with its name and the countries that settle in it — so "KES" and "KSH" cannot be
 * confused, and a currency that does not exist cannot be written. The likeliest come first: the countries this money
 * moves between, and any currency the shipper's own file named.
 */
export function CurrencySelect({ api, value, onChange, label, near = [], also = [] }: { api: Api | null; value: string; onChange: (code: string) => void; label: string; near?: string[]; also?: string[] }) {
  const t = useT();
  const all = useCurrencies(api);
  const more = (n: number) => t('tower.currency.more', { n });
  const nearCodes = new Set([...also.filter(Boolean), ...all.filter((o) => o.countries.some((c) => near.includes(c.code))).map((o) => o.code)]);
  const ordered = [...all.filter((o) => nearCodes.has(o.code)), ...all.filter((o) => !nearCodes.has(o.code))];
  const options: PickOption[] = ordered.map((o) => {
    const [code, rest] = currencyLabel(o, more).split(' · ');
    return { value: o.code, label: code, sub: rest, ...(nearCodes.has(o.code) ? { tag: t('tower.currency.likely') } : {}) };
  });
  // A value already chosen stays shown while the list is still on its way.
  if (value && !all.some((o) => o.code === value)) options.unshift({ value, label: value });
  return <ConsolePick label={label} value={value} onChange={onChange} options={options} placeholder={all.length ? t('tower.currency.choose') : t('tower.currency.reading')} />;
}
