import { HelpLink } from '../../../shared/guide/HelpLink';
import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Card, Checklist, CodeBoxes, ErrorNote, Icon, NeedsSignalNote, ReadAloud, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';
import type { AgentActions, AgentState } from '../useAgentApp';
import { StaffSignIn } from './StaffSignIn';

export interface SignInScreenProps {
  actions: AgentActions;
  error: SbgError | null;
  busy: boolean;
  /** This phone is new to the shop: the code step, in place of the email and password. */
  deviceAsk?: AgentState['deviceAsk'];
}

/**
 * The real S2 sign-in (email + password → an actor token), not a pasted DID: a shop's
 * account carries money, so it gets the credential the backend actually verifies.
 */
export function SignInScreen({ actions, error, busy, deviceAsk }: SignInScreenProps) {
  // The shop's own sign-in, or one of its people signing in as themselves (the user, 2026-10-18: "own phone + PIN").
  const [asStaff, setAsStaff] = useState(false);
  if (asStaff) return <StaffSignIn onBack={() => setAsStaff(false)} onSession={actions.enterAsStaff} />;
  if (deviceAsk) return <ConfirmPhone actions={actions} error={error} busy={busy} ask={deviceAsk} />;
  return <EmailAndPassword actions={actions} error={error} busy={busy} onStaff={() => setAsStaff(true)} />;
}

/**
 * A NEW PHONE FOR THE SHOP (the user, 2026-10-18: "who is at the counter"). The password was right; the shop's sign-in
 * works only on its own phones, so a code went to the shop's number. Typed here, this phone is one of the shop's.
 */
function ConfirmPhone({ actions, error, busy, ask }: { actions: AgentActions; error: SbgError | null; busy: boolean; ask: NonNullable<AgentState['deviceAsk']> }) {
  const t = useT();
  const [code, setCode] = useState('');
  return (
    <form
      class="scr"
      onSubmit={(e) => {
        e.preventDefault();
        void actions.confirmDevice(code);
      }}
    >
      <h1 class="scr__title">{t('agent.signin.deviceTitle')}</h1>
      <p class="scr__lede">{t('agent.signin.deviceLede', { sentTo: ask.sentTo })}</p>
      <NeedsSignalNote title={t('common.needsSignal.signInTitle')} detail={t('common.needsSignal.signInDetail')} />
      {error ? <ErrorNote error={error} /> : null}
      <Card>
        <div class="field">
          <span class="field__label">{t('agent.signin.deviceCode')}</span>
          <CodeBoxes id="shop-device-code" label={t('agent.signin.deviceCode')} length={6} value={code} onInput={setCode} disabled={busy} />
          {ask.code ? <p class="hint">{t('account.safety.testCode', { code: ask.code })}</p> : null}
        </div>
      </Card>
      <p class="hint">{t('agent.signin.deviceWhy')}</p>
      <Button type="submit" chevron={false} busy={busy} disabled={busy || code.length !== 6}>
        {t('agent.signin.deviceConfirm')}
      </Button>
      <Button variant="link" onClick={() => actions.cancelDeviceAsk()}>
        {t('common.back')}
      </Button>
    </form>
  );
}

function EmailAndPassword({ actions, error, busy, onStaff }: { actions: AgentActions; error: SbgError | null; busy: boolean; onStaff: () => void }) {
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
      <h1 class="scr__title">{t('agent.signin.title')}</h1>
      <p class="scr__lede">{t('agent.signin.lede')}</p>

      <NeedsSignalNote title={t('common.needsSignal.signInTitle')} detail={t('common.needsSignal.signInDetail')} />
      {error ? <ErrorNote error={error} /> : null}

      <Card>
        <div class="field">
          <label class="field__label" for="email">
            {t('agent.signin.email')}
          </label>
          <input
            id="email"
            class="input"
            type="email"
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
            placeholder="shop@example.com"
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
            enterkeyhint="next"
          />
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="password">
            {t('agent.signin.password')}
          </label>
          <input
            id="password"
            class="input"
            type="password"
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
            placeholder={t('agent.signin.passwordPh')}
            autocomplete="current-password"
            enterkeyhint="go"
          />
        </div>
      </Card>

      <div class="scr__cta">
        <Button type="submit" disabled={!email.trim() || !password} busy={busy}>
          {t('agent.signin.signIn')}
        </Button>
      </div>

      {/* Not the shop's password: the people at its counter sign in as themselves. */}
      <button type="button" class="row" onClick={onStaff}>
        <span class="row__ic">
          <Icon name="person" size={24} />
        </span>
        <span class="row__body">
          <span class="row__t">{t('agent.staff.entry')}</span>
          <span class="row__s">{t('agent.staff.entrySub')}</span>
        </span>
        <span class="row__end">
          <Icon name="chevronRight" size={22} />
        </span>
      </button>

      <Card title={t('agent.signin.safeTitle')} tone="soft">
        <Checklist
          items={[t('agent.signin.safe1'), t('agent.signin.safe2'), t('agent.signin.safe3')]}
        />
      </Card>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => setHelp(true)}>
          {t('agent.signin.forgot')}
        </Button>
        <HelpLink app="agent" label="signin" />
        <ReadAloud text={() => t('agent.signin.spoken')} label={t('agent.readAloud')} />
      </div>

      <ForgotSheet open={help} onClose={() => setHelp(false)} actions={actions} email={email} />
    </form>
  );
}

/**
 * Forgot/reset in one sheet. The sandbox returns the reset token in the response (no email
 * infra), so the flow completes on-device: request → token shown → new password → done.
 */
function ForgotSheet({ open, onClose, actions, email: initial }: { open: boolean; onClose: () => void; actions: AgentActions; email: string }) {
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
    <Sheet open={open} onClose={close} title={t('agent.signin.resetTitle')}>
      {error ? <ErrorNote error={error} /> : null}
      {done ? (
        <>
          <p class="t-body">{t('agent.signin.resetDone')}</p>
          <Button chevron={false} onClick={close}>
            {t('agent.signin.backToSignIn')}
          </Button>
        </>
      ) : !sent ? (
        <>
          <div class="field">
            <label class="field__label" for="fp-email">
              {t('agent.signin.email')}
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
            {t('agent.signin.sendReset')}
          </Button>
        </>
      ) : (
        <>
          {issued ? <p class="hint">{t('agent.signin.sandboxCode', { code: issued })}</p> : <p class="hint">{t('agent.signin.checkEmail')}</p>}
          <div class="field">
            <label class="field__label" for="fp-token">
              {t('agent.signin.resetCode')}
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
              {t('agent.signin.newPassword')}
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
          <Button chevron={false} busy={busy} disabled={!token.trim() || password.length < 8} onClick={() => void apply()}>
            {t('agent.signin.setPassword')}
          </Button>
        </>
      )}
    </Sheet>
  );
}
