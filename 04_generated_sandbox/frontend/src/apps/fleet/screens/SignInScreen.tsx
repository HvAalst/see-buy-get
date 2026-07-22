import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Card, Checklist, ErrorNote, ReadAloud } from '../../../shared/ui';
import type { SbgError } from '../../../lib/sbg';
import type { FleetActions } from '../useFleetApp';

export interface SignInScreenProps {
  actions: FleetActions;
  error: SbgError | null;
  busy: boolean;
}

const SPOKEN = 'Type your fleet sign-in code. GLOS gave it to your company when the fleet was activated.';

/** Manager sign-in by code (FM-XXXX) — the S2 fleet login; the app then works as that fleet only. */
export function SignInScreen({ actions, error, busy }: SignInScreenProps) {
  const [code, setCode] = useState('');

  const submit = (e: JSX.TargetedEvent<HTMLFormElement>) => {
    e.preventDefault();
    void actions.signIn(code);
  };

  return (
    <form class="scr" onSubmit={submit}>
      <h1 class="scr__title">Open your fleet</h1>
      <p class="scr__lede">Sign in with your fleet manager code.</p>

      {error ? <ErrorNote error={error} /> : null}

      <Card>
        <div class="field">
          <label class="field__label" for="code">
            Sign-in code
          </label>
          <input
            id="code"
            class="input input--mono"
            value={code}
            onInput={(e) => setCode(e.currentTarget.value)}
            placeholder="FM-0000"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck={false}
            enterkeyhint="go"
          />
        </div>
        <p class="card__note">GLOS issued this code when your company was activated.</p>
      </Card>

      <div class="scr__cta">
        <Button type="submit" disabled={!code.trim()} busy={busy}>
          Sign in
        </Button>
      </div>

      <Card title="What you can do here" tone="soft">
        <Checklist
          items={['Register vehicles and print their dashboard QRs', 'Onboard drivers and send their papers to GLOS', 'See who is on shift, where, with what cargo']}
        />
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => SPOKEN} label="Read this aloud" />
      </div>
    </form>
  );
}
