import type { ComponentChildren } from 'preact';
import { Icon } from './Icon';

export interface SelectionBarProps {
  count: number;
  onClear: () => void;
  /** The bulk actions (e.g. an Export button). Kept as a slot so each register supplies its own. */
  children?: ComponentChildren;
}

/** The multi-select action bar — appears once rows are selected: a clear, the count, and bulk actions. */
export function SelectionBar({ count, onClear, children }: SelectionBarProps) {
  if (count <= 0) return null;
  return (
    <div class="selbar" role="region" aria-label={`${count} selected`}>
      <button type="button" class="selbar__clear" aria-label="Clear selection" onClick={onClear}>
        <Icon name="close" size={20} />
      </button>
      <span class="selbar__count">
        {count} selected
      </span>
      <span class="selbar__acts">{children}</span>
    </div>
  );
}
