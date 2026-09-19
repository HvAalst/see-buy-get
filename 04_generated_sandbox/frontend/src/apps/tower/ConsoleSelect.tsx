import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { Icon } from '../../shared/ui';

export interface ConsoleSelectOption {
  value: string;
  label: string;
}

export interface ConsoleSelectProps {
  /** Named for the screen reader, and for the list itself when it is open. */
  label: string;
  options: ConsoleSelectOption[];
  chosen: string[];
  onChange: (next: string[]) => void;
  /** Shown on the closed control when nothing is chosen — a prompt, not a value. */
  placeholder: string;
  /** Shown on the closed control when something is: the caller phrases it, because counting is plural. */
  summary: string;
  /** The word on the little cross beside each chosen chip. */
  removeLabel: (label: string) => string;
  id?: string;
}

/**
 * THE CONSOLE'S MANY-FROM-A-LIST CONTROL.
 *
 * A clearing agent picks what they clear out of twelve options, and the screen was drawing all twelve
 * at once as chips that wrapped across four lines: the tallest thing in the panel, and the reason the
 * form beneath it had no shape. This states the answer in one line and opens when asked.
 *
 * KEYBOARD FIRST, because this surface is worked in all day (shared/console.css, rule 4). The trigger
 * opens on Enter, Space or ArrowDown and focus moves INTO the list; Up and Down walk it; Enter or Space
 * toggles without closing, because choosing several things is the whole point; Escape closes and puts
 * focus back where it started, so the tab order never loses its place. A click anywhere else closes it
 * too — and mousedown, not click, so pressing a button elsewhere on the panel both closes this and
 * presses that, rather than costing two clicks.
 *
 * Nothing here is disabled while open and nothing is removed from the list once chosen: the same row
 * turns the choice off again, in the place the eye already knows.
 */
export function ConsoleSelect({ label, options, chosen, onChange, placeholder, summary, removeLabel, id }: ConsoleSelectProps) {
  const auto = useId();
  const listId = id ?? `cselect-${auto}`;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const pop = useRef<HTMLDivElement | null>(null);

  // Closing on an outside press is registered only while the list is open: a document listener that
  // outlives the thing it serves is how a screen ends up with forty of them.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  // Focus follows the list open, so the next key press lands in it rather than on the page behind it.
  useEffect(() => {
    if (open) pop.current?.querySelector<HTMLButtonElement>('.cselect__opt')?.focus();
  }, [open]);

  const shut = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const toggle = (value: string) => onChange(chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value]);

  const step = (from: HTMLElement, by: 1 | -1) => {
    const all = [...(pop.current?.querySelectorAll<HTMLButtonElement>('.cselect__opt') ?? [])];
    const next = all[all.indexOf(from as HTMLButtonElement) + by];
    (next ?? all[by === 1 ? 0 : all.length - 1])?.focus();
  };

  return (
    <div class={`cselect${open ? ' cselect--open' : ''}`} ref={root}>
      <button
        type="button"
        ref={trigger}
        class="cselect__btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            setOpen(false);
          }
        }}
      >
        <span class={`cselect__val${chosen.length === 0 ? ' cselect__val--none' : ''}`}>{chosen.length === 0 ? placeholder : summary}</span>
        <Icon name="chevronRight" size={16} class="cselect__caret" />
      </button>

      {open ? (
        <div class="cselect__pop" id={listId} role="listbox" aria-multiselectable="true" aria-label={label} ref={pop}>
          {options.map((o) => {
            const on = chosen.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                class={`cselect__opt${on ? ' cselect__opt--on' : ''}`}
                onClick={() => toggle(o.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    step(e.currentTarget as HTMLElement, e.key === 'ArrowDown' ? 1 : -1);
                  } else if (e.key === 'Escape' || e.key === 'Tab') {
                    // Tab closes as well as Escape: leaving the control is leaving the control.
                    if (e.key === 'Escape') e.preventDefault();
                    shut();
                  }
                }}
              >
                <span class="cselect__tick" aria-hidden="true">
                  <Icon name="check" size={12} />
                </span>
                {o.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {chosen.length > 0 ? (
        <div class="cselect__chosen">
          {/* In the ORDER OF THE LIST rather than the order they were pressed, so the same set of
              choices always reads the same way twice. */}
          {options
            .filter((o) => chosen.includes(o.value))
            .map((o) => (
              <span key={o.value} class="cselect__chip">
                {o.label}
                <button type="button" class="cselect__chipx" aria-label={removeLabel(o.label)} onClick={() => toggle(o.value)}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
        </div>
      ) : null}
    </div>
  );
}
