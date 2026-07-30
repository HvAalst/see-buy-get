import { Icon } from './Icon';

export interface CheckGateItem {
  key: string;
  label: string;
}

export interface CheckGateProps {
  items: CheckGateItem[];
  /** The keys currently confirmed (controlled). */
  checked: string[];
  onChange: (keys: string[]) => void;
  disabled?: boolean;
}

/**
 * An INTERACTIVE, gated checklist (S33) — each item must be ticked before the parent's action can proceed
 * (unlike the display-only `Checklist`, which is reassurance, not a gate). Controlled: the parent holds the
 * confirmed-key set and enables its confirm button only when every item is checked. Big touch targets, one
 * tick per line, no free text — a driver in a cab can clear it with gloves on.
 */
export function CheckGate({ items, checked, onChange, disabled }: CheckGateProps) {
  const set = new Set(checked);
  const toggle = (key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next]);
  };
  return (
    <ul class="checkgate">
      {items.map((it) => {
        const on = set.has(it.key);
        return (
          <li key={it.key}>
            <button
              type="button"
              class={`checkgate__item${on ? ' is-on' : ''}`}
              role="checkbox"
              aria-checked={on}
              disabled={disabled}
              onClick={() => toggle(it.key)}
            >
              <span class="checkgate__box">{on ? <Icon name="check" size={18} /> : null}</span>
              <span class="checkgate__label">{it.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
