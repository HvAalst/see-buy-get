import { useMemo, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import type { EntityRow } from '../money';

/**
 * WHICH COMPANY AM I LOOKING AT — one control, used by Money and Rates.
 *
 * It replaces a wrapping grid of bordered boxes that had grown to sixteen companies over four rows, which
 * an operator described as making them dizzy. The fault was not the styling: a picker drawn as a wall of
 * equal boxes says every entry is equally likely to be the one you want, and stops being a control the
 * moment there are more entries than a glance can hold. Sixteen is already past that, and a sandbox full
 * of probe companies is the shape a real group will take on its own.
 *
 * So: TYPE TO NARROW, and the list is capped at two rows and scrolls. Borderless, because sixteen borders
 * are sixteen things to look at before reading a single name — the chosen one is marked and the rest get
 * out of the way. The mother company is pinned first and the rest are ordered by jurisdiction then name,
 * so position means something instead of being whatever order the server answered in.
 *
 * Deliberately NOT a <select>: the jurisdiction and currency belong beside the name (an operator picking
 * between two Djibouti entities is choosing on exactly that), and a native select shows one line at a time
 * on a desktop and hides what the alternatives were.
 */
export function EntityPicker({
  entities,
  chosen,
  onChoose,
  label,
}: {
  entities: EntityRow[];
  chosen: string | null;
  onChoose: (entityId: string) => void;
  label: string;
}) {
  const t = useT();
  const [q, setQ] = useState('');

  const ordered = useMemo(() => {
    const rows = [...entities];
    rows.sort((a, b) => {
      // The mother company first: it is the one entry that is not one of a set.
      if (a.kind === 'group' !== (b.kind === 'group')) return a.kind === 'group' ? -1 : 1;
      return (a.jurisdiction ?? '').localeCompare(b.jurisdiction ?? '') || a.name.localeCompare(b.name);
    });
    return rows;
  }, [entities]);

  const needle = q.trim().toLowerCase();
  // Name, jurisdiction and currency all match: an operator looking for "the Ethiopian one" types ET, and
  // one looking for a named company types the name. Both are the same question.
  const shown = needle
    ? ordered.filter((e) => `${e.name} ${e.jurisdiction ?? ''} ${e.currency ?? ''}`.toLowerCase().includes(needle))
    : ordered;

  return (
    <div class="twr-pick">
      <div class="twr-pick__bar">
        <input
          class="cinput twr-pick__q"
          type="search"
          value={q}
          placeholder={t('tower.pick.search')}
          aria-label={t('tower.pick.search')}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
        {/* The count is the honest answer to "did my filter do anything", and it is also how somebody
            learns there are more companies below the fold of a two-row list. */}
        <span class="twr-pick__count">{needle ? t('tower.pick.matching', { shown: shown.length, all: ordered.length }) : t('tower.pick.total', { n: ordered.length })}</span>
      </div>

      <nav class="twr-pick__list" aria-label={label}>
        {shown.map((e) => (
          <button
            key={e.entityId}
            type="button"
            class={`twr-pick__one${chosen === e.entityId ? ' twr-pick__one--on' : ''}`}
            aria-pressed={chosen === e.entityId}
            onClick={() => onChoose(e.entityId)}
          >
            <span class="twr-pick__n">{e.name}</span>
            <span class="twr-pick__m">{e.kind === 'group' ? t('tower.rates.group') : `${e.jurisdiction ?? '—'} · ${e.currency ?? '—'}`}</span>
          </button>
        ))}
        {/* A filter that matches nothing must say so, or it reads as a console that lost its companies. */}
        {shown.length === 0 ? <p class="twr-pick__none">{t('tower.pick.none', { q: q.trim() })}</p> : null}
      </nav>
    </div>
  );
}
