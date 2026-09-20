import { useState } from 'preact/hooks';
import { BottomNav, Icon, Sheet } from '../../shared/ui';
import { useT } from '../../shared/i18n';
import { SCREEN_META, activeGroupKey, firstScreen, groupBadge, opensSheet, type NavGroup } from './nav';
import type { Screen } from './useTowerApp';

/**
 * The console's navigation, in its two shapes.
 *
 * ONE set of groups (nav.ts), rendered twice: a sidebar where there is room for one, and a bottom bar
 * plus a slide-up sheet where there is not. They are different COMPONENTS rather than one component
 * restyled, because the two answer differently — a sidebar shows every destination at once, a bottom
 * bar shows four and asks for a second tap. A rail turned sideways, which is what this replaced, does
 * neither: it hides destinations off the edge of a strip nobody thinks to scroll.
 *
 * The counts passed in are the queue lengths. What is done with them differs by shape and is decided in
 * nav.ts, not here: the sidebar puts a number beside each queue, the bottom bar sums the group.
 */
export interface ConsoleNavProps {
  groups: NavGroup[];
  screen: Screen;
  counts: Partial<Record<Screen, number | null>>;
  onGo: (screen: Screen) => void;
}

/**
 * The sidebar (≥1100px).
 *
 * A group of several screens gets a heading with its screens beneath it; a group holding ONE screen is
 * drawn as a plain item wearing the group's own name, because a heading over a single row is a label
 * for a list that is not a list.
 */
export function ConsoleRail({ groups, screen, counts, onGo }: ConsoleNavProps) {
  const t = useT();
  return (
    <nav class="cons__rail" aria-label={t('tower.rail.heading')}>
      {groups.map((g) =>
        opensSheet(g) ? (
          <div class="cons__railgroup" key={g.key}>
            <p class="cons__railhead">{t(g.labelKey)}</p>
            {g.screens.map((s) => (
              <RailItem key={s} screen={s} label={t(SCREEN_META[s].labelKey)} icon={SCREEN_META[s].icon} count={counts[s] ?? null} on={screen === s} onGo={onGo} />
            ))}
          </div>
        ) : (
          <div class="cons__railgroup" key={g.key}>
            <RailItem
              screen={firstScreen(g)}
              label={t(g.labelKey)}
              icon={g.icon}
              count={counts[firstScreen(g)] ?? null}
              on={screen === firstScreen(g)}
              onGo={onGo}
            />
          </div>
        ),
      )}
    </nav>
  );
}

function RailItem({
  screen,
  label,
  icon,
  count,
  on,
  onGo,
}: {
  screen: Screen;
  label: string;
  icon: NavGroup['icon'];
  count: number | null;
  on: boolean;
  onGo: (s: Screen) => void;
}) {
  return (
    <button type="button" class={`cons__railitem${on ? ' cons__railitem--on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => onGo(screen)}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
      {/* null while unread: a blank count reads as zero, and zero is a different answer. */}
      {count === null ? null : <span class="cons__railcount">{count}</span>}
    </button>
  );
}

/**
 * The bottom bar and its sheet (<1100px) — the same two components the seven field apps use, so a
 * console on a tablet behaves like everything else this network puts in somebody's hand.
 *
 * Tapping a group of several screens opens the sheet; tapping a group of one goes straight there. The
 * sheet closes on the way out, so nobody arrives at a screen with a menu still over it.
 */
export function ConsolePhoneNav({ groups, screen, counts, onGo }: ConsoleNavProps) {
  const t = useT();
  const [openKey, setOpenKey] = useState<NavGroup['key'] | null>(null);
  const active = activeGroupKey(groups, screen);
  const open = groups.find((g) => g.key === openKey) ?? null;

  const select = (key: NavGroup['key']) => {
    const group = groups.find((g) => g.key === key);
    if (!group) return;
    if (opensSheet(group)) setOpenKey(key);
    else onGo(firstScreen(group));
  };

  const go = (s: Screen) => {
    setOpenKey(null);
    onGo(s);
  };

  return (
    <>
      {/* ICONS ALONE. Four one-word labels under four icons, on a surface somebody works in all day:
          after the first morning the words are not read and are still taking the room. The label is now
          the button's accessible name, so nothing is lost to a screen reader. */}
      <BottomNav
        labels={false}
        items={groups.map((g) => ({
          key: g.key,
          label: t(g.labelKey),
          icon: g.icon,
          // groupBadge returns null until something has been read, and BottomNav draws nothing for a
          // zero — between them, "up to date" and "not looked yet" both stay silent rather than both
          // showing a 0 that only one of them means.
          badge: groupBadge(g, counts) ?? undefined,
        }))}
        active={active ?? groups[0]?.key}
        onSelect={select}
      />
      <Sheet open={open !== null} onClose={() => setOpenKey(null)} title={open ? t(open.labelKey) : ''}>
        <div class="cons__sheetlist">
          {open?.screens.map((s) => {
            const count = counts[s] ?? null;
            const on = screen === s;
            return (
              <button key={s} type="button" class={`cons__sheetitem${on ? ' cons__sheetitem--on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => go(s)}>
                <Icon name={SCREEN_META[s].icon} size={22} />
                <span>{t(SCREEN_META[s].labelKey)}</span>
                {count === null ? null : <span class="cons__sheetcount">{count}</span>}
              </button>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}
