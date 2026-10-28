import { useMemo, useState } from 'preact/hooks';
import { Icon } from './Icon';
import { SearchInput } from './SearchInput';
import { Sheet } from './Sheet';
import { useT } from '../i18n';

/** One option, in words the calling app has already translated. */
export interface ChoiceOption {
  value: string;
  label: string;
  /** The line under the label in the sheet: what the option means, where the label alone does not say it. */
  detail?: string;
}

export interface ChoiceProps {
  /** The question — the field label above the control, and the sheet's heading. */
  label: string;
  options: ChoiceOption[];
  value: string;
  onChange: (value: string) => void;
  /** What the closed sheet control reads when nothing is chosen. */
  placeholder?: string;
  /** A stable id: the label's is `${id}-label`. */
  id: string;
  /** Chips beside each other, or a sheet to open. By default chips up to seven options, a sheet beyond. */
  as?: 'chips' | 'sheet';
  /** Show a search box in the sheet once the list is at least this long. */
  searchFrom?: number;
  disabled?: boolean;
}

/**
 * ONE CHOICE, NEVER THE PHONE'S OWN LIST (the user, 2026-10-28: "move them both" — the store app's dropdowns, after
 * the Business app's). A native `<select>` is a popup the page does not own: at phone width it opens off the edge of
 * what opened it, it shows a column of words one line at a time, and it carries no explanation.
 *
 * So a short list is TAPPED where it stands — chips in a row, the pattern the fleet's call-off and the counter already
 * use — and needs no second sheet even inside a filter sheet. A long one (eleven statuses, a list of shops) opens the
 * SHEET the illustrated truck-body picker opens, with the same rows and a search once it earns its place; each row can
 * say what it means. The label is the field's own, so a screen reader hears the question and then the answer.
 */
export function Choice({ label, options, value, onChange, placeholder, id, as, searchFrom = 12, disabled }: ChoiceProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const labelId = `${id}-label`;
  const chosen = options.find((o) => o.value === value);
  const chips = (as ?? (options.length <= 7 ? 'chips' : 'sheet')) === 'chips';

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(q));
  }, [options, query]);

  if (chips) {
    return (
      <>
        <span class="field__label" id={labelId}>
          {label}
        </span>
        <div class="choice__chips" role="radiogroup" aria-labelledby={labelId}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={o.value === value}
              disabled={disabled}
              class={`chip chip--tap${o.value === value ? ' chip--on' : ''}`}
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <span class="field__label" id={labelId}>
        {label}
      </span>
      <button
        type="button"
        id={id}
        class="optpick"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        // The question, then the answer: pointing at the label alone would replace the name with it.
        aria-labelledby={`${labelId} ${id}`}
        onClick={() => {
          setQuery('');
          setOpen(true);
        }}
      >
        <span class={`optpick__value${chosen ? '' : ' optpick__value--empty'}`}>{chosen ? chosen.label : (placeholder ?? t('common.choose'))}</span>
        <Icon name="chevronRight" size={20} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        {options.length >= searchFrom ? (
          <div class="choice__search">
            <SearchInput value={query} onInput={setQuery} placeholder={t('common.searchOptions')} label={label} />
          </div>
        ) : null}
        {shown.length ? (
          <div class="optpick__list" role="listbox" aria-label={label}>
            {shown.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                class={`optpick__row${o.value === value ? ' optpick__row--on' : ''}`}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span class="opthelp__text">
                  <span class="opthelp__label">{o.label}</span>
                  {o.detail ? <span class="choice__detail">{o.detail}</span> : null}
                </span>
                {o.value === value ? <Icon name="check" size={20} class="optpick__tick" /> : null}
              </button>
            ))}
          </div>
        ) : (
          <p class="hint">{t('common.noMatches')}</p>
        )}
      </Sheet>
    </>
  );
}
