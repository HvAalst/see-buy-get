import { Icon } from './Icon';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible label — required (a bare checkbox has no visible text). */
  label: string;
  /** The "some but not all" state for a select-all header checkbox. */
  indeterminate?: boolean;
}

/** A register row / select-all checkbox. A real ARIA checkbox button (no native input, to match the kit). */
export function Checkbox({ checked, onChange, label, indeterminate }: CheckboxProps) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      class={`cbx${on ? ' cbx--on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      {indeterminate ? <span class="cbx__dash" aria-hidden="true" /> : checked ? <Icon name="check" size={16} /> : null}
    </button>
  );
}
