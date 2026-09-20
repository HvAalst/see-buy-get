import { useState } from 'preact/hooks';
import { Icon, Sheet } from '../../shared/ui';
import { useT } from '../../shared/i18n';

export interface PickOption {
  value: string;
  label: string;
  /** The second line — what the choice MEANS, where the label alone is a code. */
  sub?: string;
  tag?: string;
}

/**
 * ONE CHOICE FROM A LIST, IN A SHEET — because a native popup does not belong to this page.
 *
 * The user, on a container at phone width: *"clicking the containertype gives an list outside the screen,
 * same for the date picker, not really suitable for mobile. also What the goods are."*
 *
 * A `<datalist>` is the worst of them: it is rendered by the browser, positioned by the browser, sized by
 * the browser, and a page cannot reach it — so twenty-four ISO descriptions painted themselves across the
 * whole window, over the sheet they belonged to. A native `<select>` is better behaved but still a popup
 * the page does not own, and at this width it opens off the edge of the thing it was opened from.
 *
 * So the list goes where every other list on this console goes: a slide-up sheet, with the console's own
 * rows, which is the same answer round three gave when the user asked for "a drop down list, custom
 * designed in the sbg style, but not like this".
 *
 * THE SEARCH APPEARS ONLY WHEN IT EARNS ITS PLACE — eleven kinds of goods do not need one, twenty-four
 * container types do. A search box over a list you can see all of is a control that adds a step.
 *
 * AND IT CAN ACCEPT SOMETHING THAT IS NOT ON THE LIST. `allowFree` turns the search box into an entry
 * field: the container type is ANY valid ISO 6346 code and the list is only the common ones, so a box
 * stencilled with something rarer must still be recordable. Offered as a row rather than accepted
 * silently, so choosing it is deliberate.
 */
export function ConsolePick({
  label,
  value,
  onChange,
  options,
  hint,
  placeholder,
  searchFrom = 12,
  allowFree,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: PickOption[];
  hint?: string;
  placeholder?: string;
  /** Show a search box once the list is at least this long. */
  searchFrom?: number;
  /** Given what was typed, the value to offer as a row of its own — or null when it is not usable. */
  allowFree?: (query: string) => string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const chosen = options.find((o) => o.value === value);
  const needle = q.trim().toLowerCase();
  // Matched on everything a reader can see, because somebody hunting for "reefer" should find the code
  // and somebody who knows the code should find it by the code.
  const found = needle ? options.filter((o) => `${o.label} ${o.sub ?? ''} ${o.tag ?? ''}`.toLowerCase().includes(needle)) : options;
  const free = allowFree?.(q.trim()) ?? null;
  const freeIsNew = free !== null && !options.some((o) => o.value === free);

  const take = (next: string) => {
    onChange(next);
    setQ('');
    setOpen(false);
  };

  return (
    <div class="cfield">
      <span class="cfield__label">{label}</span>
      <button type="button" class="cselect__btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span class={`cselect__val${chosen || value ? '' : ' cselect__val--none'}`}>
          {/* A value chosen from outside the list still shows: it is what was recorded. */}
          {chosen ? chosen.label : value || placeholder || t('tower.choose.choose')}
        </span>
        <Icon name="chevronRight" size={16} class="cselect__caret" />
      </button>
      {hint ? <span class="chint">{hint}</span> : null}

      {open ? (
        <Sheet open onClose={() => setOpen(false)} title={label}>
          {options.length >= searchFrom || allowFree ? (
            <input
              class="cinput"
              value={q}
              onInput={(e) => setQ((e.target as HTMLInputElement).value)}
              placeholder={allowFree ? t('tower.choose.searchOrType') : t('tower.choose.search')}
              aria-label={allowFree ? t('tower.choose.searchOrType') : t('tower.choose.search')}
            />
          ) : null}

          {freeIsNew ? (
            <button type="button" class="crow" onClick={() => take(free)}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">{t('tower.choose.use', { what: free })}</span>
                </span>
                <span class="crow__sub">{t('tower.choose.useSub')}</span>
              </span>
            </button>
          ) : null}

          {found.length === 0 && !freeIsNew ? (
            <p class="cons__empty">{t('tower.choose.none')}</p>
          ) : (
            <div class="crows">
              {found.map((o) => (
                <button key={o.value} type="button" class={`crow${o.value === value ? ' crow--on' : ''}`} onClick={() => take(o.value)}>
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name">{o.label}</span>
                      {o.tag ? <span class="ctag ctag--quiet">{o.tag}</span> : null}
                    </span>
                    {o.sub ? <span class="crow__sub">{o.sub}</span> : null}
                  </span>
                  <span class="crow__tail">{o.value === value ? <Icon name="check" size={16} /> : null}</span>
                </button>
              ))}
            </div>
          )}
        </Sheet>
      ) : null}
    </div>
  );
}
