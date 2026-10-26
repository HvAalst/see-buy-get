import { useT } from '../i18n';
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
 * `labels` is off everywhere now — the console first, then every field app (user, 2026-09-24).
 *
 * The argument FOR them was that a field app is read at arm's length, in the sun, by somebody who may
 * open it once a week, and that a bare icon is a guess. What that argument missed is that the tab bar is
 * the one part of these apps nobody reads twice: five words, on every screen, above the thumb, costing a
 * line of height on a phone where the whole design problem is height. And a word is the weaker of the
 * two signals for the people this network is built for — a van, a magnifier, a box and a wallet survive
 * a reader who is not confident in English, which the words do not.
 *
 * THE LABEL DOES NOT DISAPPEAR. It becomes the button's accessible NAME and its title, so a screen
 * reader still says "Earnings" where a sighted reader now sees a wallet, and a long press still names
 * it. The active tab stays marked twice over — blue icon plus the orange indicator bar — because with
 * the words gone, which tab you are on has to be unmistakable from the icon alone.
 *
 * `labels` stays as a prop rather than being deleted: it is the seam that made this one change instead
 * of eight, and the argument above may be right again on a surface we have not built yet.
 */
export function BottomNav<K extends string>({ items, active, onSelect, labels = true }: BottomNavProps<K>) {
  const t = useT();
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
            // Without its words, a tab is named by its label — and its count with it: a name given here is all a screen
            // reader says, so a count written beside it inside the button would never be heard.
            aria-label={labels ? undefined : it.badge ? t('common.nav.withCount', { label: it.label, n: it.badge }) : it.label}
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
            {labels && it.badge ? <span class="sr-only">{t('common.nav.count', { n: it.badge })}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
