import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Card, Checklist, ErrorNote, ReadAloud, Sheet } from '../../../shared/ui';
import type { SbgError } from '../../../lib/sbg';
import type { MdpActions } from '../useMdpApp';

export interface SignInScreenProps {
  actions: MdpActions;
  error: SbgError | null;
  busy: boolean;
}

const SPOKEN = 'Sign in with the email and password your hub uses on SeeBuyGet.';

/** The real S2 sign-in (role: mdp) — the token binds to the hub's own DID. */
export function SignInScreen({ actions, error, busy }: SignInScreenProps) {
  const [email, setEmail] = useState(actions.readEmail() ?? '');
  const [password, setPassword] = useState('');
  const [help, setHelp] = useState(false);

  const submit = (e: JSX.TargetedEvent<HTMLFormElement>) => {
    e.preventDefault();
    void actions.signIn(email, password);
  };

  return (
    <form class="scr" onSubmit={submit}>
      <h1 class="scr__title">Open the sort floor</h1>
      <p class="scr__lede">Sign in with your hub's email and password.</p>

      {error ? <ErrorNote error={error} /> : null}

      <Card>
        <div class="field">
          <label class="field__label" for="email">
            Email
          </label>
          <input
            id="email"
            class="input"
            type="email"
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
            placeholder="hub@example.com"
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
            enterkeyhint="next"
          />
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="password">
            Password
          </label>
          <input
            id="password"
            class="input"
            type="password"
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
            placeholder="Your password"
            autocomplete="current-password"
            enterkeyhint="go"
          />
        </div>
      </Card>

      <div class="scr__cta">
        <Button type="submit" disabled={!email.trim() || !password} busy={busy}>
          Sign in
        </Button>
      </div>

      <Card title="One sign-in runs the floor" tone="soft">
        <Checklist
          items={['Any worker on shift can use this tablet', 'Signing out removes the key from it', 'SeeBuyGet staff never ask for your password']}
        />
      </Card>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => setHelp(true)}>
          I forgot my password
        </Button>
        <ReadAloud text={() => SPOKEN} label="Read this aloud" />
      </div>

      <ForgotSheet open={help} onClose={() => setHelp(false)} actions={actions} email={email} />
    </form>
  );
}

/** Forgot/reset in one sheet — the sandbox returns the reset token in the response. */
function ForgotSheet({ open, onClose, actions, email: initial }: { open: boolean; onClose: () => void; actions: MdpActions; email: string }) {
  const [email, setEmail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [token, setToken] = useState('');
  const [issued, setIssued] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);

  const request = async () => {
    setBusy(true);
    setError(null);
    const r = await actions.forgot(email);
    setBusy(false);
    if (r.error) return setError(r.error);
    setSent(true);
    setIssued(r.resetToken);
    if (r.resetToken) setToken(r.resetToken);
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    const e = await actions.reset(token, password);
    setBusy(false);
    if (e) return setError(e);
    setDone(true);
  };

  const close = () => {
    setSent(false);
    setIssued(null);
    setToken('');
    setPassword('');
    setDone(false);
    setError(null);
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title="Reset your password">
      {error ? <ErrorNote error={error} /> : null}
      {done ? (
        <>
          <p class="t-body">Your password is changed. Sign in with the new one.</p>
          <Button chevron={false} onClick={close}>
            Back to sign in
          </Button>
        </>
      ) : !sent ? (
        <>
          <div class="field">
            <label class="field__label" for="fp-email">
              Email
            </label>
            <input
              id="fp-email"
              class="input"
              type="email"
              value={email}
              onInput={(e) => setEmail(e.currentTarget.value)}
              autocomplete="username"
              autocapitalize="none"
            />
          </div>
          <Button chevron={false} busy={busy} disabled={!email.trim()} onClick={() => void request()}>
            Send me a reset code
          </Button>
        </>
      ) : (
        <>
          {issued ? <p class="hint">{`Sandbox: your reset code is ${issued}`}</p> : <p class="hint">Check your email for the reset code.</p>}
          <div class="field">
            <label class="field__label" for="fp-token">
              Reset code
            </label>
            <input
              id="fp-token"
              class="input input--mono"
              value={token}
              onInput={(e) => setToken(e.currentTarget.value)}
              placeholder="RST-…"
              autocapitalize="characters"
              spellcheck={false}
            />
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="fp-pass">
              New password
            </label>
            <input
              id="fp-pass"
              class="input"
              type="password"
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
              autocomplete="new-password"
            />
          </div>
          <Button chevron={false} busy={busy} disabled={!token.trim() || password.length < 6} onClick={() => void apply()}>
            Set the new password
          </Button>
        </>
      )}
    </Sheet>
  );
}
