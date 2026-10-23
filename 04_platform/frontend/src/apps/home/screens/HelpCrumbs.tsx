import { useT } from '../../../shared/i18n';

/**
 * THE ONE TRAIL OVER A HELP PAGE — the article's and the contact page's alike (the user, 2026-10-23: "help pages are a
 * mess with different styles and double links"). The site's own top bar carries the mark and Help, so the trail starts at
 * Help and never repeats the bar; the last step is where you are, and is not a link.
 */
export function HelpCrumbs({ steps }: { steps: Array<{ label: string; href?: string }> }) {
  const t = useT();
  return (
    <nav class="hc__crumbs" aria-label={t('help.ui.crumbsLabel')}>
      {steps.map((s, i) => (
        <span key={`${i}-${s.label}`} class="hc__crumb">
          {i > 0 ? (
            <span class="hc__crumbsep" aria-hidden="true">
              ›
            </span>
          ) : null}
          {s.href && i < steps.length - 1 ? <a href={s.href}>{s.label}</a> : <span aria-current={i === steps.length - 1 ? 'page' : undefined}>{s.label}</span>}
        </span>
      ))}
    </nav>
  );
}
