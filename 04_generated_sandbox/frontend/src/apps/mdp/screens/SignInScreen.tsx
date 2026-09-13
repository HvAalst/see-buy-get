import { HelpLink } from '../../../shared/guide/HelpLink';
import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Card, Checklist, ErrorNote, ReadAloud, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';
import type { MdpActions } from '../useMdpApp';

export interface SignInScreenProps {
  actions: MdpActions;
  error: SbgError | null;
  busy: boolean;
}

/** The real S2 sign-in (role: mdp) — the token binds to the hub's own DID. */
export function SignInScreen({ actions, error, busy }: SignInScreenProps) {
  const t = useT();
  const [email, setEmail] = useState(actions.readEmail() ?? '');
  const [password, setPassword] = useState('');
  const [help, setHelp] = useState(false);

  const submit = (e: JSX.TargetedEvent<HTMLFormElement>) => {
    e.preventDefault();
    void actions.signIn(email, password);
  };

  return (
    <form class="scr" onSubmit={submit}>
      <h1 class="scr__title">{t('mdp.signin.title')}</h1>
      <p class="scr__lede">{t('mdp.signin.lede')}</p>

      {error ? <ErrorNote error={error} /> : null}

      <Card>
        <div class="field">
          <label class="field__label" for="email">
            {t('mdp.signin.email')}
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
            {t('mdp.signin.password')}
          </label>
          <input
            id="password"
            class="input"
            type="password"
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
            placeholder={t('mdp.signin.passwordPh')}
            autocomplete="current-password"
            enterkeyhint="go"
          />
        </div>
      </Card>

      <div class="scr__cta">
        <Button type="submit" disabled={!email.trim() || !password} busy={busy}>
          {t('mdp.signin.submit')}
        </Button>
      </div>

      <Card title={t('mdp.signin.cardTitle')} tone="soft">
        <Checklist
          items={[t('mdp.signin.item1'), t('mdp.signin.item2'), t('mdp.signin.item3')]}
        />
      </Card>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => setHelp(true)}>
          {t('mdp.signin.forgot')}
        </Button>
        <HelpLink app="mdp" label="signin" />
        <ReadAloud text={() => t('mdp.signin.spoken')} label={t('mdp.readAloud')} />
      </div>

      <ForgotSheet open={help} onClose={() => setHelp(false)} actions={actions} email={email} />
    </form>
  );
}

/** Forgot/reset in one sheet — the sandbox returns the reset token in the response. */
function ForgotSheet({ open, onClose, actions, email: initial }: { open: boolean; onClose: () => void; actions: MdpActions; email: string }) {
  const t = useT();
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
    <Sheet open={open} onClose={close} title={t('mdp.signin.resetTitle')}>
      {error ? <ErrorNote error={error} /> : null}
      {done ? (
        <>
          <p class="t-body">{t('mdp.signin.resetDone')}</p>
          <Button chevron={false} onClick={close}>
            {t('mdp.signin.backToSignIn')}
          </Button>
        </>
      ) : !sent ? (
        <>
          <div class="field">
            <label class="field__label" for="fp-email">
              {t('mdp.signin.email')}
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
            {t('mdp.signin.sendReset')}
          </Button>
        </>
      ) : (
        <>
          {issued ? <p class="hint">{t('mdp.signin.sandboxCode', { code: issued })}</p> : <p class="hint">{t('mdp.signin.checkEmail')}</p>}
          <div class="field">
            <label class="field__label" for="fp-token">
              {t('mdp.signin.resetCode')}
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
              {t('mdp.signin.newPassword')}
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
            {t('mdp.signin.setNewPassword')}
          </Button>
        </>
      )}
    </Sheet>
  );
}
