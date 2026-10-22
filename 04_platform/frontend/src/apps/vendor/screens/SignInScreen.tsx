import { HelpLink } from '../../../shared/guide/HelpLink';
import { AllAppsLink } from '../../../shared/ui/AllAppsLink';
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Card, Checklist, ErrorNote, ReadAloud, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { accountBlocker } from '../logic';
import type { SbgError } from '../../../lib/sbg';
import type { VendorState, VendorActions } from '../useVendorApp';
import { ConfirmDevice } from '../../../shared/account/ConfirmDevice';
import { PhoneVerify } from '../../../shared/account/PhoneVerify';
import { fetchCountries, vendorConfig, type OperatingCountry } from '../api';

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
  const [creating, setCreating] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const reg = state.registered;

  const submit = (e: JSX.TargetedEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (bySecret) void actions.signInWithSecret(vendorId, secret);
    else void actions.signIn(email, password);
  };

  // Round 40 — a browser new to the store: the code to its number, or first a number to send it to.
  if (state.deviceAsk) return <ConfirmDevice ask={state.deviceAsk} party="store" busy={state.busy === 'signin'} error={error} onConfirm={(code) => void actions.confirmDevice(code)} onGivePhone={(phone) => void actions.giveDevicePhone(phone)} onBack={actions.cancelDeviceAsk} />;

  if (reg) {
    return (
      <div class="scr">
        <h1 class="scr__title">{t('vendor.signin.saveTitle')}</h1>
        <p class="scr__lede">{t('vendor.signin.saveLede', { email: reg.email ?? '' })}</p>
        {/* Each said by name, in words on the page: a card's `label` is only read by a screen reader. */}
        <Card label={t('vendor.signin.storeId')}>
          <p class="t-label">{t('vendor.signin.storeId')}</p>
          <p class="cred mono-t">{reg.vendorId}</p>
        </Card>
        <Card label={t('vendor.secret.title')}>
          <p class="t-label">{t('vendor.secret.title')}</p>
          <p class="cred mono-t">{reg.secret}</p>
        </Card>
        <Card title={t('vendor.signin.keepSafeTitle')} tone="soft">
          <Checklist items={[t('vendor.signin.keep1'), t('vendor.signin.keep2'), t('vendor.signin.keep3')]} />
        </Card>
        <div class="scr__cta">
          <Button onClick={() => void actions.adoptRegistration()}>{t('vendor.signin.saved')}</Button>
        </div>
      </div>
    );
  }

  return (
    <form class="scr" onSubmit={submit}>
      <h1 class="scr__title">{t('vendor.signin.title')}</h1>
      <p class="scr__lede">{t(bySecret ? 'vendor.signin.secretLede' : 'vendor.signin.lede')}</p>
      <HelpLink app="vendor" label="signin" />

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

      <div class="scr__foot">
        {bySecret ? null : (
          <Button variant="link" full={false} onClick={() => setForgetting(true)}>
            {t('vendor.signin.forgot')}
          </Button>
        )}
        <Button variant="link" full={false} onClick={() => setCreating(true)}>
          {t('vendor.signin.createLink')}
        </Button>
        <Button variant="link" full={false} onClick={() => setBySecret(!bySecret)}>
          {t(bySecret ? 'vendor.signin.byEmail' : 'vendor.signin.bySecret')}
        </Button>
        <AllAppsLink />
        <ReadAloud text={() => t('vendor.signin.spoken')} label={t('vendor.readAloud')} />
      </div>

      <CreateSheet open={creating} onClose={() => setCreating(false)} state={state} actions={actions} error={error} />
      <ForgotSheet open={forgetting} onClose={() => setForgetting(false)} actions={actions} email={email} />
    </form>
  );
}

function CreateSheet({ open, onClose, state, actions, error }: { open: boolean; onClose: () => void; state: VendorState; actions: VendorActions; error: SbgError | null }) {
  const t = useT();
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Round 40 — the store's number, verified by its code before the store is made: new browsers are confirmed by a code to it.
  const [ownerPhone, setOwnerPhone] = useState('');
  // Where the network can actually take a store on. Loaded when the sheet opens rather than on mount — a
  // merchant signing IN never needs it, and it is the one thing this form cannot sensibly guess.
  const [countries, setCountries] = useState<OperatingCountry[] | null>(null);
  useEffect(() => {
    if (!open || countries) return;
    void fetchCountries().then((r) => {
      const list = r.data ?? [];
      setCountries(list);
      if (list.length === 1) setCountry(list[0].country); // one answer is not a choice
    });
  }, [open, countries]);
  const choices = countries ?? [];
  const account = accountBlocker(email, password);

  return (
    <Sheet open={open} onClose={onClose} title={t('vendor.signin.createTitle')}>
      {error ? <ErrorNote error={error} showDetail /> : null}
      <div class="field">
        <label class="field__label" for="sname">
          {t('vendor.signin.storeName')}
        </label>
        <input id="sname" class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Nairobi Threads" />
      </div>
      {choices.length > 1 ? (
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="scountry">
            {t('vendor.signin.country')}
          </label>
          <select id="scountry" class="input" value={country} onChange={(e) => setCountry(e.currentTarget.value)}>
            <option value="">{t('vendor.signin.countryChoose')}</option>
            {choices.map((c) => (
              <option key={c.country} value={c.country}>
                {c.name} ({c.country}){c.settles === false ? ` · ${t('vendor.signin.countryNoMoney')}` : ''}
              </option>
            ))}
          </select>
          <p class="card__note">{t('vendor.signin.countryNote')}</p>
        </div>
      ) : null}
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="saddress">
          {t('vendor.signin.address')}
        </label>
        <input id="saddress" class="input" value={address} onInput={(e) => setAddress(e.currentTarget.value)} placeholder="Biashara St 12" />
      </div>
      {/* HOW ITS PEOPLE SIGN IN from now on: asked here, in the same act, so no store is made without a way back in. */}
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="semail">
          {t('vendor.signin.email')}
        </label>
        <input id="semail" class="input" type="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} placeholder="orders@yourstore.com" autocapitalize="none" autocomplete="username" spellcheck={false} />
      </div>
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="spass">
          {t('vendor.signin.newPassword')}
        </label>
        <input id="spass" class="input" type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} autocomplete="new-password" />
        <p class="card__note">{t(account && (email || password) ? account : 'vendor.account.passwordNote')}</p>
      </div>
      <PhoneVerify config={vendorConfig()} verified={ownerPhone} onVerified={setOwnerPhone} label={t('account.bound.phone', { party: t('account.bound.party.store') })} />
      <Button chevron={false} busy={state.busy === 'register'} disabled={!name.trim() || (choices.length > 1 && !country) || account !== null || !ownerPhone} onClick={() => void actions.register(name, country, address, email, password, ownerPhone)}>
        {t('vendor.signin.createCta')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('vendor.signin.goBack')}
      </Button>
    </Sheet>
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
