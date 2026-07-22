import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Card, Checklist, ErrorNote, ReadAloud, Sheet } from '../../../shared/ui';
import type { SbgError } from '../../../lib/sbg';
import type { VendorState, VendorActions } from '../useVendorApp';

export interface SignInScreenProps {
  state: VendorState;
  actions: VendorActions;
  error: SbgError | null;
}

const SPOKEN = 'Sign in with your store ID and the secret you were given when the store was created.';

/**
 * Store sign-in: the ID + the signing secret issued once at registration — or create a
 * new store, in which case the secret is shown EXACTLY ONCE and adopted as this device's
 * credential.
 */
export function SignInScreen({ state, actions, error }: SignInScreenProps) {
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
        <h1 class="scr__title">Save these now</h1>
        <p class="scr__lede">This is the only time the secret is shown. It is the key to your store.</p>
        <Card label="Store ID">
          <p class="cred mono-t">{reg.vendorId}</p>
        </Card>
        <Card label="Store secret">
          <p class="cred mono-t">{reg.secret}</p>
        </Card>
        <Card title="Keep it safe" tone="soft">
          <Checklist
            items={['Write both down somewhere safe', 'The secret also signs your status callbacks', 'GLOS cannot show it again — only issue a new store']}
          />
        </Card>
        <div class="scr__cta">
          <Button onClick={actions.adoptRegistration}>I saved them — open my store</Button>
        </div>
      </div>
    );
  }

  return (
    <form class="scr" onSubmit={submit}>
      <h1 class="scr__title">Open your store</h1>
      <p class="scr__lede">Sign in with your store ID and secret.</p>

      {error ? <ErrorNote error={error} /> : null}

      <Card>
        <div class="field">
          <label class="field__label" for="vid">
            Store ID
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
            Store secret
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
          Sign in
        </Button>
      </div>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => setCreating(true)}>
          New here? Create a store
        </Button>
        <ReadAloud text={() => SPOKEN} label="Read this aloud" />
      </div>

      <CreateSheet open={creating} onClose={() => setCreating(false)} state={state} actions={actions} error={error} />
    </form>
  );
}

function CreateSheet({ open, onClose, state, actions, error }: { open: boolean; onClose: () => void; state: VendorState; actions: VendorActions; error: SbgError | null }) {
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [address, setAddress] = useState('');

  return (
    <Sheet open={open} onClose={onClose} title="Create your store">
      {error ? <ErrorNote error={error} /> : null}
      <div class="field">
        <label class="field__label" for="sname">
          Store name
        </label>
        <input id="sname" class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Nairobi Threads" />
      </div>
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="scountry">
          Country
        </label>
        <input id="scountry" class="input" value={country} onInput={(e) => setCountry(e.currentTarget.value)} placeholder="KE" autocapitalize="characters" />
      </div>
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="saddress">
          Address (optional)
        </label>
        <input id="saddress" class="input" value={address} onInput={(e) => setAddress(e.currentTarget.value)} placeholder="Biashara St 12" />
      </div>
      <Button chevron={false} busy={state.busy === 'register'} disabled={!name.trim()} onClick={() => void actions.register(name, country, address)}>
        Create the store
      </Button>
      <Button variant="link" onClick={onClose}>
        Go back
      </Button>
    </Sheet>
  );
}
