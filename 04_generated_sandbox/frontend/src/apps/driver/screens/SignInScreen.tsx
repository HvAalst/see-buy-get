import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Card, Checklist, ErrorNote, ReadAloud } from '../../../shared/ui';
import type { SbgError } from '../../../lib/sbg';

export interface SignInScreenProps {
  onSignIn: (did: string) => void;
  error: SbgError | null;
}

const SPOKEN =
  'Type or scan your driver I D to sign in. It is on the back of your badge. You only do this once on this phone.';

/**
 * Identity capture — the screen the legacy page never had.
 *
 * `driver.js` read `?driver=<did>` on every render and dead-ended without it. An installed
 * PWA launches `start_url` with no query string at all, so that page could never survive a
 * home-screen launch. Here the DID is entered (or arrives once via `?driver=` from the
 * sign-in page) and then persists.
 */
export function SignInScreen({ onSignIn, error }: SignInScreenProps) {
  const [value, setValue] = useState('');

  const submit = (e: JSX.TargetedEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSignIn(value);
  };

  return (
    <form class="scr" onSubmit={submit}>
      <h1 class="scr__title">Who is driving?</h1>
      <p class="scr__lede">Enter your driver ID once. This phone will remember it.</p>

      {error ? <ErrorNote error={error} /> : null}

      <Card>
        <div class="field">
          <label class="field__label" for="did">
            Driver ID
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
        <p class="card__note">It is printed on the back of your fleet badge.</p>
      </Card>

      <div class="scr__cta">
        <Button type="submit" disabled={!value.trim()}>
          Continue
        </Button>
      </div>

      <Card title="Why we ask once" tone="soft">
        <Checklist
          items={[
            'Your ID stays on this phone only',
            'You will not have to type it again',
            'The office can see you are on shift',
          ]}
        />
      </Card>

      <div class="scr__foot">
        <a class="btn btn--link" href="../signin-driver.html">
          I do not know my ID
        </a>
        <ReadAloud text={() => SPOKEN} label="Read this aloud" />
      </div>
    </form>
  );
}
