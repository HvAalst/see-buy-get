import { useT } from '../../../shared/i18n';
import { countriesLine, likelyFirst, useCurrencies } from '../../../shared/currencies';
import { ConsolePick, type PickOption } from '../ConsolePick';

// The list itself is shared with the store's picker: `shared/currencies.ts`.
export { currenciesOf, currencyLabel, useCurrencies, type CurrencyOption } from '../../../shared/currencies';

type Api = { countryCatalogue: () => Promise<{ data?: unknown; error?: unknown }> };

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
  const options: PickOption[] = likelyFirst(all, near, also).map((o) => ({
    value: o.code,
    label: `${o.code} — ${o.name}`,
    sub: countriesLine(o, more),
    ...(o.likely ? { tag: t('tower.currency.likely') } : {}),
  }));
  // A value already chosen stays shown while the list is still on its way.
  if (value && !all.some((o) => o.code === value)) options.unshift({ value, label: value });
  return <ConsolePick label={label} value={value} onChange={onChange} options={options} placeholder={all.length ? t('tower.currency.choose') : t('tower.currency.reading')} />;
}
