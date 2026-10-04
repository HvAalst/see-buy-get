import { HelpLink } from '../../../shared/guide/HelpLink';
import { Button, Icon, Pill, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { ROLES, roleMeta } from '../logic';
import type { HomeActions } from '../useHomeApp';

export interface SignInScreenProps {
  actions: HomeActions;
}

/**
 * The router for people who already have an account. Each app owns its own sign-in (they
 * use different credentials — email+password, a fleet code, a store secret), so this
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
              <span class="row__t">{roleMeta(r, t).name}</span>
              <span class="row__s">
                {r.kind === 'vendor' ? t('home.signin.credVendor') : r.kind === 'invite' ? t('home.signin.credInvite') : t('home.signin.credSignup')}
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
            <Icon name="badge" size={24} />
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
            <Pill tone="ok">{t('home.signin.open')}</Pill>
          </span>
        </a>
      </div>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.go('welcome')}>
          {t('home.goBack')}
        </Button>
        <Button variant="link" full={false} onClick={() => actions.go('roles')}>
          {t('home.signin.noAccountYet')}
        </Button>
        <HelpLink app="home" label="signin" />
        <ReadAloud text={() => t('home.signin.aloud')} label={t('home.readAloud')} />
      </div>
    </div>
  );
}
