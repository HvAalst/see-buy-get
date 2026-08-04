import { Icon } from './Icon';

export interface ChipProps {
  label: string;
  /** Toggle state (a filter facet that is on). */
  active?: boolean;
  onClick?: () => void;
  /** When given, renders a × to remove an APPLIED filter (a removable chip). */
  onRemove?: () => void;
}

/** An interactive filter chip — a toggle facet, or (with onRemove) a removable "applied filter" pill. */
export function Chip({ label, active, onClick, onRemove }: ChipProps) {
  return (
    <span class={`chip${active ? ' chip--on' : ''}`}>
      <button type="button" class="chip__label" aria-pressed={active} onClick={onClick}>
        {label}
      </button>
      {onRemove ? (
        <button type="button" class="chip__x" aria-label={`Remove ${label}`} onClick={onRemove}>
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </span>
  );
}
