import { useState } from 'preact/hooks';
import { Button, ErrorNote, Icon, Note } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';
import { confirmEmailLink, type LinkConfirmed } from '../api';
import { looksLikeALinkToken } from '../emailLink';
import { roleById, roleMeta } from '../logic';

export interface YesItIsMeScreenProps {
  /** The key out of the address (#link=…). Held here only: the address bar no longer shows it. */
  token: string;
}

/**
 * THE PAGE A "YES, IT IS ME" EMAIL OPENS (the owner, 2026-11-03: "a confirmation mail will ask the user to click the 'yes it
 * is me' button").
 *
 * Asked once more, on the page, and done by a tap, never by opening it: a mail program that looks at links before its
 * reader does must not link anybody's accounts. Done, it says which account now signs in with the address, and opens its
 * app. A link that no longer works says what happened to it, and what to do — signing in sends a new one.
 */
export function YesItIsMeScreen({ token }: YesItIsMeScreenProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<LinkConfirmed | null>(null);
  const [failed, setFailed] = useState<SbgError | 'not_ours' | null>(looksLikeALinkToken(token) ? null : 'not_ours');

  const yes = async () => {
    setBusy(true);
    setFailed(null);
    const r = await confirmEmailLink(token);
    setBusy(false);
    if (r.data) return setDone(r.data);
    setFailed(r.error?.code === 'NOT_FOUND' ? 'not_ours' : r.error);
  };

  const role = done ? roleById(done.role) : undefined;
  if (done) {
    return (
      <div class="scr">
        <h1 class="scr__title">{t('home.link.doneTitle')}</h1>
        <Note tone="ok" icon="check" title={t('home.link.doneSays', { email: done.email, kind: role ? roleMeta(role, t).labelLower : done.kind })} detail={t('home.link.doneNext')} />
        {role ? (
          <div class="scr__cta">
            <a class="btn btn--primary btn--full" href={role.app}>
              {t('home.join.done.openApp', { name: roleMeta(role, t).appNoun })}
              <Icon name="chevronRight" size={20} class="btn__chev" />
            </a>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div class="scr">
      <h1 class="scr__title">{t('home.link.title')}</h1>
      {failed === 'not_ours' ? (
        <Note tone="warn" icon="info" title={t('home.link.notOurs')} detail={t('home.link.notOursNext')} />
      ) : failed?.code === 'LINK_EXPIRED' ? (
        <Note tone="warn" icon="clock" title={t('home.link.expired')} detail={t('home.link.expiredNext')} />
      ) : (
        <>
          <p class="scr__lede">{t('home.link.lede')}</p>
          {failed ? <ErrorNote error={failed} onRetry={() => void yes()} /> : null}
          <div class="scr__cta">
            <Button busy={busy} onClick={() => void yes()}>
              {t('home.link.yes')}
            </Button>
          </div>
          <p class="hint">{t('home.link.notMe')}</p>
        </>
      )}
    </div>
  );
}
