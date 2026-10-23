import { useState } from 'preact/hooks';
import { Sheet } from '../ui';
import { useHelpWords, useT } from '../i18n';
import { articlesFor, type GuideApp, type GuideArticle } from './articles';
import { frontDoorUrl } from '../ui/AllAppsLink';
import { GuideArticles } from './GuideArticles';

/**
 * The Help link: a button that opens this app's help in a sheet — the "Help" in a signed-in app's menu. A sign-in
 * screen does not use it: there, "Trouble signing in?" (`SignInHelp`) holds the sign-in help with the ways back in,
 * so the screen asks one question, not two (the user, 2026-10-23: "a bit redundant right?").
 *
 * `open` / `onOpenChange` make this CONTROLLABLE, for a caller that wants the help sheet without the
 * button beside it — the console's account menu opens it from a row in a dropdown. Left uncontrolled it
 * behaves exactly as it always has: its own state, its own button.
 */
export function HelpLink({
  app,
  buttonClass = 'btn btn--link',
  open: openFromParent,
  onOpenChange,
  articles,
}: {
  app: GuideApp;
  /** The articles to show instead of the app's own list — the console passes its own (staff-articles.ts), which no other app imports. */
  articles?: GuideArticle[];
  buttonClass?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = openFromParent !== undefined;
  const open = controlled ? openFromParent : ownOpen;
  const setOpen = (next: boolean) => (controlled ? onOpenChange?.(next) : setOwnOpen(next));
  // Always here in an app; fetched when the sheet opens where it is not (useHelpWords).
  const helpHere = useHelpWords(open);

  return (
    <>
      {controlled ? null : (
        <button type="button" class={buttonClass} onClick={() => setOpen(true)}>
          {t('guide.link')}
        </button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title={t('guide.title')}>
        <p class="card__note">{t('guide.lede')}</p>
        {helpHere ? <GuideArticles articles={articles ?? articlesFor(app)} /> : <p class="card__note" aria-busy="true">…</p>}
        {/* The same help on the front door, an article to a page — and when it did not answer it, writing to us. Not the
            console's: staff have each other. */}
        {app === 'console' || !helpHere ? null : (
          <p class="guide__more">
            <a class="btn btn--link" href={`${frontDoorUrl()}help/`} target="_blank" rel="noopener">
              {t('help.ui.allHelp')}
            </a>
            <a class="btn btn--link" href={`${frontDoorUrl()}help/contact/?from=${app}`} target="_blank" rel="noopener">
              {t('help.ui.stuckCta')}
            </a>
          </p>
        )}
      </Sheet>
    </>
  );
}
