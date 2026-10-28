import { useEffect, useState } from 'preact/hooks';

/**
 * THE CURRENCIES THAT EXIST, WITH THE COUNTRIES BEHIND THEM (the user, 2026-10-28: "currency should be an selector
 * with country behind it to avoid errors"). One list for every app — the console's picker and the store's alike —
 * from the country catalogue: a currency some country settles in, its name, and those countries. "KSH" is not on it.
 */
export interface CurrencyOption {
  code: string;
  name: string;
  countries: Array<{ code: string; name: string }>;
}

type CatalogueApi = { countryCatalogue: () => Promise<{ data?: unknown; error?: unknown }> };

/** Pure: the catalogue's rows in, one option per currency out, alphabetical by code. */
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

/** "Kenya" or "Belgium, France, Germany and 1 more" — the countries a currency is recognised by, a long list shortened. */
export function countriesLine(o: CurrencyOption, more: (n: number) => string): string {
  const shown = o.countries.slice(0, 3).map((c) => c.name).join(', ');
  const rest = o.countries.length - 3;
  return `${shown}${rest > 0 ? ` ${more(rest)}` : ''}`;
}

/** "KES — Kenyan Shilling · Kenya" — a currency as a person recognises it. */
export function currencyLabel(o: CurrencyOption, more: (n: number) => string): string {
  return `${o.code} — ${o.name} · ${countriesLine(o, more)}`;
}

/**
 * The likeliest first: those of the countries the money moves between, and any currency already named (the shipper's
 * own file, the shipment's quote). Each kept once; the rest after, alphabetical.
 */
export function likelyFirst(all: CurrencyOption[], near: string[] = [], also: string[] = []): Array<CurrencyOption & { likely: boolean }> {
  const likely = new Set([...also.filter(Boolean), ...all.filter((o) => o.countries.some((c) => near.includes(c.code))).map((o) => o.code)]);
  return [...all.filter((o) => likely.has(o.code)), ...all.filter((o) => !likely.has(o.code))].map((o) => ({ ...o, likely: likely.has(o.code) }));
}

let catalogue: Promise<CurrencyOption[]> | null = null;

/** The currencies, asked for once however many pickers are on the screen. */
export function useCurrencies(api: CatalogueApi | null): CurrencyOption[] {
  const [list, setList] = useState<CurrencyOption[]>([]);
  useEffect(() => {
    if (!api) return;
    if (!catalogue) {
      catalogue = api.countryCatalogue().then((r) => (r.error || !r.data ? [] : currenciesOf(((r.data as { items?: Array<{ code: string; name: string; currency: string }> }).items ?? []))));
      // A failed read is not kept: the next picker asks again.
      void catalogue.then((l) => {
        if (!l.length) catalogue = null;
      });
    }
    let live = true;
    void catalogue.then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [api]);
  return list;
}
