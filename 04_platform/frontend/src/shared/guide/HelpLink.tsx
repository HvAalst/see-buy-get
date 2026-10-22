import { useState } from 'preact/hooks';
import { Sheet } from '../ui';
import { useT } from '../i18n';
import { articlesFor, type GuideApp, type GuideArticle } from './articles';
import './guide.css';

/**
 * The Help link: a button that opens this app's help in a sheet. A sheet rather than a screen so it works where there
 * is no navigation yet — above all on a sign-in screen, which is where people most need it.
 *
 * `label="signin"` says "Need help signing in?"; the console passes its own button class.
 */
/**
 * `open` / `onOpenChange` make this CONTROLLABLE, for a caller that wants the help sheet without the
 * button beside it — the console's account menu opens it from a row in a dropdown. Left uncontrolled it
 * behaves exactly as it always has: its own state, its own button.
 */
export function HelpLink({
  app,
  label = 'link',
  buttonClass = 'btn btn--link',
  open: openFromParent,
  onOpenChange,
  articles,
}: {
  app: GuideApp;
  /** The articles to show instead of the app's own list — the console passes its own (staff-articles.ts), which no other app imports. */
  articles?: GuideArticle[];
  label?: 'link' | 'signin';
  buttonClass?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = openFromParent !== undefined;
  const open = controlled ? openFromParent : ownOpen;
  const setOpen = (next: boolean) => (controlled ? onOpenChange?.(next) : setOwnOpen(next));

  return (
    <>
      {controlled ? null : (
        <button type="button" class={buttonClass} onClick={() => setOpen(true)}>
          {t(label === 'signin' ? 'guide.signinLink' : 'guide.link')}
        </button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title={t('guide.title')}>
        <p class="card__note">{t('guide.lede')}</p>
        <div class="guide">
          {(articles ?? articlesFor(app)).map((a) => (
            <details key={a.id} class="guide__item">
              <summary class="guide__t">{a.title}</summary>
              <p class="guide__s">{a.summary}</p>
              {a.steps?.length ? (
                <ol class="guide__steps">
                  {a.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : null}
              {a.notes?.map((note) => (
                <p key={note} class="guide__p">
                  {note}
                </p>
              ))}
            </details>
          ))}
        </div>
      </Sheet>
    </>
  );
}
