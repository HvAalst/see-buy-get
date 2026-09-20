import { useState } from 'preact/hooks';
import { Icon, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { CountryOption } from './CountrySelect';

/**
 * TWO HUNDRED AND FORTY-THREE COUNTRIES NEED A SEARCH.
 *
 * A native select is the right control for a handful of choices and the wrong one for the atlas: on a
 * phone it is a wheel somebody spins past Afghanistan looking for Kenya, and on a desk it is a list
 * nobody can type into. The user asked for the list with a search on top, which is what any list this
 * long needs.
 *
 * It matches on the NAME and on the CODE, because both are how people refer to a country and half the
 * trade world says "KE" out loud. The rows are the console's own list rows, so choosing a country looks
 * like choosing anything else here.
 */
export function CountryPicker({ value, onChange, label, options, hint }: { value: string; onChange: (code: string) => void; label: string; options: CountryOption[]; hint?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const chosen = options.find((c) => c.code === value);
  const needle = q.trim().toLowerCase();
  const found = needle ? options.filter((c) => c.name.toLowerCase().includes(needle) || c.code.toLowerCase() === needle) : options;

  return (
    <div class="cfield">
      <span class="cfield__label">{label}</span>
      <button type="button" class="cselect__btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span class={`cselect__val${chosen ? '' : ' cselect__val--none'}`}>{chosen ? `${chosen.name} (${chosen.code})` : t('tower.country.choose')}</span>
        <Icon name="chevronRight" size={16} class="cselect__caret" />
      </button>
      {hint ? <span class="chint">{hint}</span> : null}

      {open ? (
        <Sheet open onClose={() => setOpen(false)} title={label}>
          <input class="cinput" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder={t('tower.country.search')} aria-label={t('tower.country.search')} />
          {found.length === 0 ? (
            <p class="cons__empty">{t('tower.country.none')}</p>
          ) : (
            <div class="crows">
              {found.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  class={`crow${c.code === value ? ' crow--on' : ''}`}
                  onClick={() => {
                    onChange(c.code);
                    setQ('');
                    setOpen(false);
                  }}
                >
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name">{c.name}</span>
                      <span class="ctag ctag--quiet">{c.code}</span>
                    </span>
                  </span>
                  <span class="crow__tail">{c.code === value ? <Icon name="check" size={16} /> : null}</span>
                </button>
              ))}
            </div>
          )}
        </Sheet>
      ) : null}
    </div>
  );
}
