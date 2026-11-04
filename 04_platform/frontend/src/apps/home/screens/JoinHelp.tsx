import { Button, Sheet } from '../../../shared/ui';
import { useHelpWords, useT } from '../../../shared/i18n';
import { siteArticles, type GuideApp, type GuideArticle } from '../../../shared/guide/articles';
import { GuideArticles } from '../../../shared/guide/GuideArticles';
import { frontDoorUrl } from '../../../shared/frontDoor';

/** Who is joining, as the help names them: the app the account opens, and the reader the help centre filters for. */
const JOINING: Record<string, { app: GuideApp; reader: string }> = {
  pudo: { app: 'agent', reader: 'shop' },
  mdp: { app: 'mdp', reader: 'hub' },
  driver: { app: 'driver', reader: 'driver' },
  fleet: { app: 'fleet', reader: 'fleet' },
  vendor: { app: 'vendor', reader: 'store' },
};

/**
 * The help about joining as this role, out of what the public help already holds: signing up itself first (`sign-up`,
 * 2026-11-02), then the papers it sends for approval where it sends any, then signing in to its app once the account is
 * made. With no role chosen yet ("What are you?"): signing up, then which app is whose and what each signs in with.
 */
export function joiningArticles(roleId: string | null, list: GuideArticle[] = siteArticles()): GuideArticle[] {
  const signUp = list.filter((a) => a.id === 'sign-up');
  const app = roleId ? JOINING[roleId]?.app : undefined;
  if (!app) return [...signUp, ...list.filter((a) => a.id === 'which-sign-in')];
  const theirs = list.filter((a) => a.apps.includes(app));
  return [...signUp, ...theirs.filter((a) => a.id.endsWith('-papers')), ...theirs.filter((a) => a.id.endsWith('-sign-in'))];
}

/**
 * HELP ON THE SIGN-UP (2026-11-02) — what Help in the bar pinned under the sign-up opens (the owner: "we have some text
 * like 'help' and 'read aloud' — that clutter would be better off in a sticky footer"). Somebody joining has no sign-in
 * to have trouble with yet, so it is not "Trouble signing in?": it is the help about joining as what they chose, drawn as
 * every app's help sheet draws its articles, then all of that reader's help and writing to us, each in a tab of its own
 * so the form stays as it was. The help's words are fetched the moment it opens, as on every screen of the front door.
 */
export function JoinHelp({ open, onClose, roleId, role }: { open: boolean; onClose: () => void; roleId: string | null; role?: string }) {
  const t = useT();
  const helpHere = useHelpWords(open);
  const reader = roleId ? JOINING[roleId]?.reader : undefined;
  return (
    <Sheet open={open} onClose={onClose} title={t('guide.title')}>
      <p class="card__note">{role ? t('home.join.help.lede', { role }) : t('home.join.help.ledeAny')}</p>
      {helpHere ? <GuideArticles articles={joiningArticles(roleId)} /> : <p class="card__note" aria-busy="true">…</p>}
      {helpHere ? (
        <p class="guide__more">
          <a class="btn btn--link" href={`${frontDoorUrl()}help/${reader ? `?for=${reader}` : ''}`} target="_blank" rel="noopener">
            {t('help.ui.allHelp')}
          </a>
          <a class="btn btn--link" href={`${frontDoorUrl()}help/contact/?from=home`} target="_blank" rel="noopener">
            {t('help.ui.stuckCta')}
          </a>
        </p>
      ) : null}
      <Button variant="link" onClick={onClose}>
        {t('common.close')}
      </Button>
    </Sheet>
  );
}
