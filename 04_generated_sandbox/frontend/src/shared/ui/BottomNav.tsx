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
  /** False draws the icons alone and moves the label onto the button as its accessible name. */
  labels?: boolean;
}

/**
 * Fixed 68px tab bar, padded by the bottom safe-area inset so it sits above the home
 * indicator. Each tab is the full column height — far past the 48px floor, because this
 * is what gets tapped with a glove on.
 *
 * The active tab is marked twice over: blue icon + label, and a 3px ORANGE indicator bar.
 * That bar is the second and last sanctioned use of orange in the system.
 */
/**
 * `labels` is TRUE by default and the seven field apps keep it that way: they are read at arm's length,
 * in the sun, by somebody who may use the app once a week, and a bare icon is a guess.
 *
 * The CONSOLE turns it off. Four groups of one word each, under four icons, on a surface somebody works
 * in all day — the words stop being read after the first morning and go on taking the room. The label
 * does not disappear: it becomes the button's accessible NAME, so a screen reader still says "Money"
 * where a sighted reader now sees a wallet.
 */
export function BottomNav<K extends string>({ items, active, onSelect, labels = true }: BottomNavProps<K>) {
  return (
    <nav class={`bnav${labels ? '' : ' bnav--bare'}`} aria-label="Main">
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
            aria-label={labels ? undefined : it.label}
            title={labels ? undefined : it.label}
          >
            {on ? <span class="bnav__ind" aria-hidden="true" /> : null}
            <Icon name={it.icon} size={25} />
            {labels ? <span class="bnav__label">{it.label}</span> : null}
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
