import { useState } from 'preact/hooks';
import { Sheet } from '../ui';
import { useT } from '../i18n';
import { articlesFor, type GuideApp } from './articles';
import './guide.css';

/**
 * The Help link: a button that opens this app's help in a sheet. A sheet rather than a screen so it works where there
 * is no navigation yet — above all on a sign-in screen, which is where people most need it.
 *
 * `label="signin"` says "Need help signing in?"; the console passes its own button class.
 */
export function HelpLink({ app, label = 'link', buttonClass = 'btn btn--link' }: { app: GuideApp; label?: 'link' | 'signin'; buttonClass?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" class={buttonClass} onClick={() => setOpen(true)}>
        {t(label === 'signin' ? 'guide.signinLink' : 'guide.link')}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('guide.title')}>
        <p class="card__note">{t('guide.lede')}</p>
        <div class="guide">
          {articlesFor(app).map((a) => (
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
