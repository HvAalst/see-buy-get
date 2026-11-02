import { Button, Icon } from '../../../shared/ui';
import { SignedOutBar } from '../../../shared/ui/SignedOutBar';
import { useT, type MessageKey } from '../../../shared/i18n';
import { ROLES, roleMeta } from '../logic';
import type { HomeActions } from '../useHomeApp';

export interface SignInScreenProps {
  actions: HomeActions;
}

/**
 * The router for people who already have an account. Each app owns its own sign-in (they
 * use different credentials — an email and password, or a phone number and PIN), so this
 * screen's job is only to send them to the right door and say what that door asks for.
 */
export function SignInScreen({ actions }: SignInScreenProps) {
  const t = useT();
  return (
    <div class="scr">
      <h1 class="scr__title">{t('home.signin.title')}</h1>
      <p class="scr__lede">{t('home.signin.lede')}</p>

      <div class="rows" role="list">
        {ROLES.map((r) => (
          <a key={r.id} class="row" href={r.app}>
            <span class="row__ic">
              <Icon name={r.icon} size={24} />
            </span>
            <span class="row__body">
              <span class="row__t">{roleMeta(r, t).label}</span>
              <span class="row__s">
                {t(`home.signin.cred.${r.id}` as MessageKey)}
              </span>
            </span>
            <span class="row__end">
              <Icon name="chevronRight" size={22} />
            </span>
          </a>
        ))}
        {/* B1 — a customer's business has its own app, apart from the staff console and from the participant apps
            above: everybody in it signs in with their own phone and PIN. */}
        <a class="row" href="/business/">
          <span class="row__ic">
            <Icon name="box" size={24} />
          </span>
          <span class="row__body">
            <span class="row__t">{t('home.signin.business')}</span>
            <span class="row__s">{t('home.signin.businessSub')}</span>
          </span>
          <span class="row__end">
            <Icon name="chevronRight" size={22} />
          </span>
        </a>
        <a class="row" href="/send/">
          <span class="row__ic">
            <Icon name="send" size={24} />
          </span>
          <span class="row__body">
            <span class="row__t">{t('home.signin.justSending')}</span>
            <span class="row__s">{t('home.signin.noAccount')}</span>
          </span>
          <span class="row__end">
            <Icon name="chevronRight" size={22} />
          </span>
        </a>
      </div>

      {/* Signing up is the call on this screen for somebody with no account: with the doors, not in the bar. */}
      <Button variant="link" onClick={() => actions.go('roles')}>
        {t('home.signin.noAccountYet')}
      </Button>

      {/* 2026-11-02 — what every sign-in screen has, pinned to the bottom (the owner: "a sticky footer for as long as the
          page goes"): Help, which is "Trouble signing in?", and Read aloud. The top bar's arrow goes back; no All apps,
          this is where it leads. */}
      <SignedOutBar help={{ app: 'home' }} aloud={() => t('home.signin.aloud')} allApps={false} />
    </div>
  );
}
