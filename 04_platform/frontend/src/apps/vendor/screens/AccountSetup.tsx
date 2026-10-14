import { useState } from 'preact/hooks';
import { Button, ErrorNote, Note, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';
import { accountBlocker, needsAccount } from '../logic';
import type { VendorActions, VendorState } from '../useVendorApp';

/**
 * A STORE THAT STILL SIGNS IN WITH ITS SECRET IS ASKED TO SET UP ITS ACCOUNT — on whatever screen it is on.
 *
 * A store registered before stores had accounts opens its console with the store ID and the signing secret one last
 * time. This is said above every screen until it is done, because the one place such a store will certainly be is
 * wherever it landed, and a card on the Store tab is a card somebody has to go looking for. Once the account exists
 * the secret signs nobody in, and this is gone.
 */
export function AccountSetup({ state, actions }: { state: VendorState; actions: VendorActions }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  if (!needsAccount(state.vendor)) return null;
  const blocker = accountBlocker(email, password);

  const save = async () => {
    setBusy(true);
    setError(null);
    const failed = await actions.setUpAccount(email, password);
    setBusy(false);
    if (failed) return setError(failed);
    setOpen(false);
  };

  return (
    <div class="acctsetup">
      <Note tone="warn" icon="lock" title={t('vendor.account.setupTitle')} detail={t('vendor.account.setupDetail')} />
      <Button variant="outline" chevron={false} onClick={() => setOpen(true)}>
        {t('vendor.account.setupCta')}
      </Button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('vendor.account.sheetTitle')}>
        <p class="t-body">{t('vendor.account.sheetLede')}</p>
        {error ? <ErrorNote error={error} showDetail /> : null}
        <div class="field">
          <label class="field__label" for="acct-email">
            {t('vendor.signin.email')}
          </label>
          <input id="acct-email" class="input" type="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} placeholder="orders@yourstore.com" autocapitalize="none" autocomplete="username" spellcheck={false} />
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="acct-pass">
            {t('vendor.signin.newPassword')}
          </label>
          <input id="acct-pass" class="input" type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} autocomplete="new-password" />
          <p class="card__note">{t(blocker && (email || password) ? blocker : 'vendor.account.passwordNote')}</p>
        </div>
        <Button chevron={false} busy={busy} disabled={blocker !== null} onClick={() => void save()}>
          {t('vendor.account.save')}
        </Button>
        <Button variant="link" onClick={() => setOpen(false)}>
          {t('vendor.signin.goBack')}
        </Button>
      </Sheet>
    </div>
  );
}
