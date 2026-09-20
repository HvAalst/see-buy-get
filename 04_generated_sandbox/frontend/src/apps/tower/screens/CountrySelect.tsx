import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';

export interface CountryOption {
  code: string;
  name: string;
}

type Api = { countryCatalogue: () => Promise<{ data?: unknown; error?: unknown }> };

/**
 * A COUNTRY IS CHOSEN, NOT TYPED.
 *
 * It was a two-character text box with a placeholder reading "KE". That asks somebody to know an ISO
 * 3166 code by heart, accepts "XX" without a murmur, and turns a country — a thing with a name — into a
 * pair of letters. The user's correction: it is not a form to fill, it is a list to select.
 *
 * WHICH LIST DEPENDS ON THE QUESTION, which is why `options` is a prop rather than something this
 * component decides. Declaring where a yard stands is asked against the ATLAS, because a yard may
 * stand anywhere and refusing a real one would be absurd. Filtering a list of yards is asked against
 * the countries that ACTUALLY HAVE YARDS, derived from the rows on the screen — a filter that can empty
 * its own list is the wall this console keeps rebuilding.
 */
export function CountrySelect({
  value,
  onChange,
  label,
  options,
  anyLabel,
}: {
  value: string;
  onChange: (code: string) => void;
  label: string;
  options: CountryOption[];
  /** Given, the list offers "no country in particular" as its first row. */
  anyLabel?: string;
}) {
  return (
    <label class="cfield">
      <span class="cfield__label">{label}</span>
      <select class="cinput" value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        {anyLabel ? <option value="">{anyLabel}</option> : <option value="">—</option>}
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name} ({c.code})
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * THE ATLAS — every country the catalogue knows, by name, alphabetically.
 *
 * Public and already on the client; nothing new is fetched for this beyond the one list. Held in a
 * module-level promise so that four selects on one screen ask once.
 */
let atlas: Promise<CountryOption[]> | null = null;

export function useCountryAtlas(api: Api | null): CountryOption[] {
  const t = useT();
  const [list, setList] = useState<CountryOption[]>([]);

  const load = useCallback(async () => {
    if (!api) return;
    if (!atlas) {
      atlas = api.countryCatalogue().then((r) => {
        if (r.error || !r.data) return [];
        const items = (r.data as { items: { code: string; name: string }[] }).items ?? [];
        return items.map((c) => ({ code: c.code, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
      });
    }
    setList(await atlas);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // The label is not this hook's business, but the empty state is: a select with nothing in it is a
  // control that cannot be answered, and saying so beats offering an empty menu.
  return list.length ? list : [{ code: '', name: t('tower.country.reading') }].filter(() => false);
}
