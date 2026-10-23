import type { GuideArticle } from '../../../shared/guide/articles';
import { Icon } from '../../../shared/ui';
import { articlePath } from '../help';

/**
 * ONE CARD FOR AN ARTICLE, wherever the help offers one — the most asked on the index, the results of a search, and what
 * may answer it on the contact page (the review of 2026-10-23 found two designs for the same thing). The site's own card:
 * paper, an ink edge, square corners.
 */
export function HelpCards({ list }: { list: GuideArticle[] }) {
  return (
    <ul class="hc__cards">
      {list.map((a) => (
        <li key={a.id}>
          <a href={articlePath(a.id)}>
            <span class="hc__cardt">{a.title}</span>
            <span class="hc__cardsum">{a.summary}</span>
            <span class="hc__chev" aria-hidden="true">
              <Icon name="chevronRight" size={20} />
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
