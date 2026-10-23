import { SignInHelp } from '../../../shared/account/TroubleSheet';
import { AllAppsLink, SignUpLink } from '../../../shared/ui/AllAppsLink';
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Card, ErrorNote, ReadAloud, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';
import type { VendorState, VendorActions } from '../useVendorApp';
import { ConfirmDevice } from '../../../shared/account/ConfirmDevice';

export interface SignInScreenProps {
  state: VendorState;
  actions: VendorActions;
  error: SbgError | null;
}

/**
 * STORE SIGN-IN: AN EMAIL AND A PASSWORD (the user, 2026-10-09: "store needs a email and password account setup").
 *
 * A store used to open its console with its store ID and its SIGNING SECRET — a machine credential doing a person's
 * job, kept on the device, and gone for good if it was lost. A store now has an account like a shop's: an email, a
 * password it can change, and a code to the address when the password is forgotten. The secret is for the store's own
 * systems and signs nobody in.
 *
 * The old door stays for ONE purpose: a store that was registered before this, and has set no account up yet, signs in
 * with its ID and secret one last time and is asked to set one up. Once it has, that door refuses it.
 */
export function SignInScreen({ state, actions, error }: SignInScreenProps) {
  const t = useT();
  const [email, setEmail] = useState(() => actions.readEmail() ?? '');
  const [password, setPassword] = useState('');
  const [bySecret, setBySecret] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [secret, setSecret] = useState('');
  const [forgetting, setForgetting] = useState(false);

  const submit = (e: JSX.TargetedEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (bySecret) void actions.signInWithSecret(vendorId, secret);
    else void actions.signIn(email, password);
  };

  // Round 40 — a browser new to the store: the code to its number, or first a number to send it to.
  if (state.deviceAsk) return <ConfirmDevice ask={state.deviceAsk} party="store" busy={state.busy === 'signin'} error={error} onConfirm={(code) => void actions.confirmDevice(code)} onGivePhone={(phone) => void actions.giveDevicePhone(phone)} onBack={actions.cancelDeviceAsk} />;

  return (
    <form class="scr" onSubmit={submit}>
      <h1 class="scr__title">{t('vendor.signin.title')}</h1>
      <p class="scr__lede">{t(bySecret ? 'vendor.signin.secretLede' : 'vendor.signin.lede')}</p>

      {error ? <ErrorNote error={error} showDetail /> : null}

      {bySecret ? (
        <Card>
          <div class="field">
            <label class="field__label" for="vid">
              {t('vendor.signin.storeId')}
            </label>
            <input id="vid" class="input input--mono" value={vendorId} onInput={(e) => setVendorId(e.currentTarget.value)} placeholder="ven_…" autocapitalize="none" autocomplete="off" spellcheck={false} enterkeyhint="next" />
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="vsecret">
              {t('vendor.signin.storeSecret')}
            </label>
            <input id="vsecret" class="input input--mono" type="password" value={secret} onInput={(e) => setSecret(e.currentTarget.value)} placeholder="whsec_…" autocomplete="off" enterkeyhint="go" />
          </div>
        </Card>
      ) : (
        <Card>
          <div class="field">
            <label class="field__label" for="vemail">
              {t('vendor.signin.email')}
            </label>
            <input id="vemail" class="input" type="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} placeholder="orders@yourstore.com" autocapitalize="none" autocomplete="username" spellcheck={false} enterkeyhint="next" />
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="vpass">
              {t('vendor.signin.password')}
            </label>
            <input id="vpass" class="input" type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} autocomplete="current-password" enterkeyhint="go" />
          </div>
        </Card>
      )}

      <div class="scr__cta">
        <Button type="submit" disabled={bySecret ? !vendorId.trim() || !secret.trim() : !email.trim() || !password} busy={state.busy === 'signin'}>
          {t('vendor.signin.signIn')}
        </Button>
      </div>
      {/* The other door, with the form it stands in for: a store registered before stores had an email and password. */}
      <Button variant="link" onClick={() => setBySecret(!bySecret)}>
        {t(bySecret ? 'vendor.signin.byEmail' : 'vendor.signin.bySecret')}
      </Button>

      {/* The same foot as every sign-in screen. */}
      <div class="scr__foot">
        {bySecret ? null : (
          <Button variant="link" full={false} onClick={() => setForgetting(true)}>
            {t('vendor.signin.forgot')}
          </Button>
        )}
        <SignInHelp app="vendor" />
        {/* One form makes a store: the front page's, like every other sign-up (the user, 2026-10-23). */}
        <SignUpLink role="vendor" />
        <AllAppsLink />
        <ReadAloud text={() => t('vendor.signin.spoken')} label={t('vendor.readAloud')} />
      </div>

      <ForgotSheet open={forgetting} onClose={() => setForgetting(false)} actions={actions} email={email} />
    </form>
  );
}

/**
 * Forgotten: a code to the store's address, then a new password. In a sandbox the code is handed back and shown,
 * because no email leaves the building there; anywhere else it only ever arrives by email.
 */
function ForgotSheet({ open, onClose, actions, email: initial }: { open: boolean; onClose: () => void; actions: VendorActions; email: string }) {
  const t = useT();
  const [email, setEmail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [token, setToken] = useState('');
  const [issued, setIssued] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (open) setEmail(initial);
  }, [open, initial]);

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
    <Sheet open={open} onClose={close} title={t('vendor.signin.resetTitle')}>
      {error ? <ErrorNote error={error} showDetail /> : null}
      {done ? (
        <>
          <p class="t-body">{t('vendor.signin.resetDone')}</p>
          <Button chevron={false} onClick={close}>
            {t('vendor.signin.backToSignIn')}
          </Button>
        </>
      ) : !sent ? (
        <>
          <p class="t-body">{t('vendor.signin.resetLede')}</p>
          <div class="field">
            <label class="field__label" for="vfp-email">
              {t('vendor.signin.email')}
            </label>
            <input id="vfp-email" class="input" type="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} autocomplete="username" autocapitalize="none" />
          </div>
          <Button chevron={false} busy={busy} disabled={!email.trim()} onClick={() => void request()}>
            {t('vendor.signin.sendReset')}
          </Button>
        </>
      ) : (
        <>
          <p class="card__note">{issued ? t('vendor.signin.sandboxCode', { code: issued }) : t('vendor.signin.checkEmail')}</p>
          <div class="field">
            <label class="field__label" for="vfp-token">
              {t('vendor.signin.resetCode')}
            </label>
            <input id="vfp-token" class="input input--mono" value={token} onInput={(e) => setToken(e.currentTarget.value)} placeholder="RST-…" autocapitalize="characters" spellcheck={false} />
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="vfp-pass">
              {t('vendor.signin.newPassword')}
            </label>
            <input id="vfp-pass" class="input" type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} autocomplete="new-password" />
          </div>
          <Button chevron={false} busy={busy} disabled={!token.trim() || password.length < 8} onClick={() => void apply()}>
            {t('vendor.signin.resetCta')}
          </Button>
        </>
      )}
      <Button variant="link" onClick={close}>
        {t('vendor.signin.goBack')}
      </Button>
    </Sheet>
  );
}
