import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Card, Checklist, ErrorNote, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';

export interface SignInScreenProps {
  onSignIn: (did: string) => void;
  error: SbgError | null;
}

/**
 * Identity capture — the screen the legacy page never had.
 *
 * `driver.js` read `?driver=<did>` on every render and dead-ended without it. An installed
 * PWA launches `start_url` with no query string at all, so that page could never survive a
 * home-screen launch. Here the DID is entered (or arrives once via `?driver=` from the
 * sign-in page) and then persists.
 */
export function SignInScreen({ onSignIn, error }: SignInScreenProps) {
  const t = useT();
  const [value, setValue] = useState('');

  const submit = (e: JSX.TargetedEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSignIn(value);
  };

  return (
    <form class="scr" onSubmit={submit}>
      <h1 class="scr__title">{t('driver.signin.title')}</h1>
      <p class="scr__lede">{t('driver.signin.lede')}</p>

      {error ? <ErrorNote error={error} /> : null}

      <Card>
        <div class="field">
          <label class="field__label" for="did">
            {t('driver.signin.idLabel')}
          </label>
          <input
            id="did"
            class="input input--mono"
            value={value}
            onInput={(e) => setValue(e.currentTarget.value)}
            placeholder="did:glos:driver:…"
            autocomplete="username"
            autocapitalize="none"
            autocorrect="off"
            spellcheck={false}
            enterkeyhint="go"
            inputMode="text"
          />
        </div>
        <p class="card__note">{t('driver.signin.idNote')}</p>
      </Card>

      <div class="scr__cta">
        <Button type="submit" disabled={!value.trim()}>
          {t('driver.signin.continue')}
        </Button>
      </div>

      <Card title={t('driver.signin.whyTitle')} tone="soft">
        <Checklist
          items={[
            t('driver.signin.why1'),
            t('driver.signin.why2'),
            t('driver.signin.why3'),
          ]}
        />
      </Card>

      <div class="scr__foot">
        <a class="btn btn--link" href="../signin-driver.html">
          {t('driver.signin.noId')}
        </a>
        <ReadAloud text={() => t('driver.signin.aloud')} label={t('driver.readAloud')} />
      </div>
    </form>
  );
}
