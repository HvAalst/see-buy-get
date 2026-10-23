import { useState } from 'preact/hooks';
import { Sheet } from '../ui';
import { useHelpWords, useT, type MessageKey } from '../i18n';
import { HELP_GROUPS, articlesFor, type GuideApp, type GuideArticle } from './articles';
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
        {helpHere ? <GroupedArticles articles={articles ?? articlesFor(app)} /> : <p class="card__note" aria-busy="true">…</p>}
        {/* This is all of this app's help — the public site holds only getting in and getting started (2026-10-23) — so
            what is left is writing to us when it did not answer. Not the console's: staff have each other. */}
        {app === 'console' || !helpHere ? null : (
          <p class="guide__more">
            <a class="btn btn--link" href={`${frontDoorUrl()}help/contact/?from=${app}`} target="_blank" rel="noopener">
              {t('help.ui.stuckCta')}
            </a>
          </p>
        )}
      </Sheet>
    </>
  );
}

/**
 * An app's help under its task headings — Getting started, Every day, Freight, When something goes wrong, Your account —
 * as the help centre groups it. Inside the app is where all of it lives now (2026-10-23), and a shop's twenty-odd
 * articles in one list was a list to scroll, not to find in. A list with one heading (the console's own) is drawn plain.
 */
function GroupedArticles({ articles }: { articles: GuideArticle[] }) {
  const t = useT();
  const groups = HELP_GROUPS.map((g) => [g, articles.filter((a) => (a.group ?? 'daily') === g)] as const).filter(([, list]) => list.length > 0);
  if (groups.length < 2) return <GuideArticles articles={articles} />;
  return (
    <>
      {groups.map(([group, list]) => (
        <section key={group} class="guide__group">
          <h3 class="guide__h">{t(`help.ui.group.${group}` as MessageKey)}</h3>
          <GuideArticles articles={list} />
        </section>
      ))}
    </>
  );
}
