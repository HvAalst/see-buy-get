import { HelpLink } from '../../../shared/guide/HelpLink';
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Card, Checklist, ErrorNote, ReadAloud, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { fetchCountries, type OperatingCountry } from '../api';
import type { SbgError } from '../../../lib/sbg';
import type { VendorState, VendorActions } from '../useVendorApp';

export interface SignInScreenProps {
  state: VendorState;
  actions: VendorActions;
  error: SbgError | null;
}

/**
 * Store sign-in: the ID + the signing secret issued once at registration — or create a
 * new store, in which case the secret is shown EXACTLY ONCE and adopted as this device's
 * credential.
 */
export function SignInScreen({ state, actions, error }: SignInScreenProps) {
  const t = useT();
  const [vendorId, setVendorId] = useState('');
  const [secret, setSecret] = useState('');
  const [creating, setCreating] = useState(false);
  const reg = state.registered;

  const submit = (e: JSX.TargetedEvent<HTMLFormElement>) => {
    e.preventDefault();
    void actions.signIn(vendorId, secret);
  };

  if (reg) {
    return (
      <div class="scr">
        <h1 class="scr__title">{t('vendor.signin.saveTitle')}</h1>
        <p class="scr__lede">{t('vendor.signin.saveLede')}</p>
        <Card label={t('vendor.signin.storeId')}>
          <p class="cred mono-t">{reg.vendorId}</p>
        </Card>
        <Card label={t('vendor.signin.storeSecret')}>
          <p class="cred mono-t">{reg.secret}</p>
        </Card>
        <Card title={t('vendor.signin.keepSafeTitle')} tone="soft">
          <Checklist
            items={[t('vendor.signin.keep1'), t('vendor.signin.keep2'), t('vendor.signin.keep3')]}
          />
        </Card>
        <div class="scr__cta">
          <Button onClick={actions.adoptRegistration}>{t('vendor.signin.saved')}</Button>
        </div>
      </div>
    );
  }

  return (
    <form class="scr" onSubmit={submit}>
      <h1 class="scr__title">{t('vendor.signin.title')}</h1>
      <p class="scr__lede">{t('vendor.signin.lede')}</p>
      <HelpLink app="vendor" label="signin" />

      {error ? <ErrorNote error={error} /> : null}

      <Card>
        <div class="field">
          <label class="field__label" for="vid">
            {t('vendor.signin.storeId')}
          </label>
          <input
            id="vid"
            class="input input--mono"
            value={vendorId}
            onInput={(e) => setVendorId(e.currentTarget.value)}
            placeholder="ven_…"
            autocapitalize="none"
            autocomplete="username"
            spellcheck={false}
            enterkeyhint="next"
          />
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="vsecret">
            {t('vendor.signin.storeSecret')}
          </label>
          <input
            id="vsecret"
            class="input input--mono"
            type="password"
            value={secret}
            onInput={(e) => setSecret(e.currentTarget.value)}
            placeholder="whsec_…"
            autocomplete="current-password"
            enterkeyhint="go"
          />
        </div>
      </Card>

      <div class="scr__cta">
        <Button type="submit" disabled={!vendorId.trim() || !secret.trim()} busy={state.busy === 'signin'}>
          {t('vendor.signin.signIn')}
        </Button>
      </div>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => setCreating(true)}>
          {t('vendor.signin.createLink')}
        </Button>
        <ReadAloud text={() => t('vendor.signin.spoken')} label={t('vendor.readAloud')} />
      </div>

      <CreateSheet open={creating} onClose={() => setCreating(false)} state={state} actions={actions} error={error} />
    </form>
  );
}

function CreateSheet({ open, onClose, state, actions, error }: { open: boolean; onClose: () => void; state: VendorState; actions: VendorActions; error: SbgError | null }) {
  const t = useT();
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [address, setAddress] = useState('');
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

  return (
    <Sheet open={open} onClose={onClose} title={t('vendor.signin.createTitle')}>
      {error ? <ErrorNote error={error} /> : null}
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
      <Button chevron={false} busy={state.busy === 'register'} disabled={!name.trim() || (choices.length > 1 && !country)} onClick={() => void actions.register(name, country, address)}>
        {t('vendor.signin.createCta')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('vendor.signin.goBack')}
      </Button>
    </Sheet>
  );
}
