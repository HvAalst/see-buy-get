import { Icon } from './Icon';
import { hasNextPage, hasPrevPage, pageLabel } from '../register';

export interface PagerProps {
  offset: number;
  limit: number;
  total: number;
  onOffset: (offset: number) => void;
  /** While a page is in flight, disable both arrows so a second tap can't skip a page. */
  busy?: boolean;
}

/** Prev / "21–40 of 143" / Next. Renders nothing when everything fits on one page. */
export function Pager({ offset, limit, total, onOffset, busy }: PagerProps) {
  if (total <= limit) return null;
  const prev = hasPrevPage(offset);
  const next = hasNextPage(offset, limit, total);
  return (
    <nav class="pager" aria-label="Pages">
      <button type="button" class="pager__btn" disabled={!prev || busy} aria-label="Previous page" onClick={() => onOffset(Math.max(0, offset - limit))}>
        <Icon name="chevronLeft" size={22} />
      </button>
      <span class="pager__label" aria-live="polite">
        {pageLabel(offset, limit, total)}
      </span>
      <button type="button" class="pager__btn" disabled={!next || busy} aria-label="Next page" onClick={() => onOffset(offset + limit)}>
        <Icon name="chevronRight" size={22} />
      </button>
    </nav>
  );
}
