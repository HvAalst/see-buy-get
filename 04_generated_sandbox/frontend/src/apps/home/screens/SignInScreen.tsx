import { Button, Icon, Pill, ReadAloud } from '../../../shared/ui';
import { ROLES } from '../logic';
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
  return (
    <div class="scr">
      <h1 class="scr__title">Open your app</h1>
      <p class="scr__lede">Pick the one you work with.</p>

      <div class="rows" role="list">
        {ROLES.map((r) => (
          <a key={r.id} class="row" href={r.app}>
            <span class="row__ic">
              <Icon name={r.icon} size={24} />
            </span>
            <span class="row__body">
              <span class="row__t">{r.label.replace('A ', '').replace('An ', '')}</span>
              <span class="row__s">
                {r.kind === 'vendor' ? 'Store ID and secret' : r.kind === 'invite' ? 'Fleet sign-in code' : 'Email and password'}
              </span>
            </span>
            <span class="row__end">
              <Icon name="chevronRight" size={22} />
            </span>
          </a>
        ))}
        <a class="row" href="/send/">
          <span class="row__ic">
            <Icon name="send" size={24} />
          </span>
          <span class="row__body">
            <span class="row__t">Just sending or tracking</span>
            <span class="row__s">No account needed</span>
          </span>
          <span class="row__end">
            <Pill tone="ok">Open</Pill>
          </span>
        </a>
      </div>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.go('welcome')}>
          Go back
        </Button>
        <Button variant="link" full={false} onClick={() => actions.go('roles')}>
          I do not have an account yet
        </Button>
        <ReadAloud text={() => 'Pick the app you work with: shop, driver, sort hub, online store, or fleet office.'} label="Read this aloud" />
      </div>
    </div>
  );
}
