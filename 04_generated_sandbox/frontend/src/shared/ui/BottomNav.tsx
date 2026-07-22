import { Icon, type IconName } from './Icon';

export interface NavItem<K extends string = string> {
  key: K;
  label: string;
  icon: IconName;
  /** Small count on the icon (claimed loads). Omitted when zero. */
  badge?: number;
  disabled?: boolean;
}

export interface BottomNavProps<K extends string = string> {
  items: NavItem<K>[];
  active: K;
  onSelect: (key: K) => void;
}

/**
 * Fixed 68px tab bar, padded by the bottom safe-area inset so it sits above the home
 * indicator. Each tab is the full column height — far past the 48px floor, because this
 * is what gets tapped with a glove on.
 *
 * The active tab is marked twice over: blue icon + label, and a 3px ORANGE indicator bar.
 * That bar is the second and last sanctioned use of orange in the system.
 */
export function BottomNav<K extends string>({ items, active, onSelect }: BottomNavProps<K>) {
  return (
    <nav class="bnav" aria-label="Main">
      {items.map((it) => {
        const on = it.key === active;
        return (
          <button
            type="button"
            key={it.key}
            class={`bnav__item${on ? ' bnav__item--on' : ''}`}
            onClick={() => onSelect(it.key)}
            disabled={it.disabled}
            aria-current={on ? 'page' : undefined}
          >
            {on ? <span class="bnav__ind" aria-hidden="true" /> : null}
            <Icon name={it.icon} size={25} />
            <span class="bnav__label">{it.label}</span>
            {it.badge ? (
              <span class="bnav__badge" aria-hidden="true">
                {it.badge}
              </span>
            ) : null}
            {it.badge ? <span class="sr-only">{`${it.badge} items`}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
