import type { GuideArticle } from './articles';
import { HelpText } from './HelpText';
import './guide.css';

/**
 * HELP ARTICLES INSIDE AN APP — the "Help" sheet signed in, and "Trouble signing in?" before it — drawn one way (the
 * review of 2026-10-23 found two layouts and the browser's own triangles). A row per article that opens in place, with a
 * chevron; inside, the summary, the steps numbered, and every button the reader must find as a chip, as the help centre
 * draws them.
 */
export function GuideArticles({ articles }: { articles: GuideArticle[] }) {
  return (
    <div class="guide">
      {articles.map((a) => (
        <details key={a.id} class="guide__item">
          <summary class="guide__t">
            <span>{a.title}</span>
            <span class="guide__chev" aria-hidden="true" />
          </summary>
          <div class="guide__body">
            <p class="guide__s">
              <HelpText text={a.summary} />
            </p>
            {a.steps?.length ? (
              <ol class="guide__steps">
                {a.steps.map((step) => (
                  <li key={step}>
                    {/* One element for the sentence: the li is a grid (badge | words), and every chip would be a cell. */}
                    <span>
                      <HelpText text={step} />
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
            {a.notes?.map((note) => (
              <p key={note} class="guide__p">
                <HelpText text={note} />
              </p>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
