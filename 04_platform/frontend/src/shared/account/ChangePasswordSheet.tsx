import { useEffect, useState } from 'preact/hooks';
import { Button, ErrorNote, Sheet } from '../ui';
import { useT } from '../i18n';
import { sbgChangePassword, type SbgConfig, type SbgError } from '../../lib/sbg';
import { passwordChangeBlocker } from './password';

/**
 * Change the password this shop, hub or courier account signs in with.
 *
 * Proven with the CURRENT password, not with the open session — a tablet left signed in at a counter is not proof
 * of who holds the account. Every other device holding the old password is signed out by the server; this device
 * is handed a fresh sign-in, which `onChanged` seeds so the person stays where they are.
 */
export function ChangePasswordSheet({
  open,
  onClose,
  config,
  email,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  config: SbgConfig;
  email: string | null | undefined;
  onChanged: (token: { access_token: string; expires_in?: number }) => Promise<void>;
}) {
  const t = useT();
  const [mail, setMail] = useState(email ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMail(email ?? '');
    setCurrent('');
    setNext('');
    setAgain('');
    setError(null);
    setDone(false);
  }, [open, email]);

  const blocker = passwordChangeBlocker({ current, next, again });

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await sbgChangePassword(config, mail.trim().toLowerCase(), current, next);
    if (r.error || !r.data) {
      setBusy(false);
      setError(r.error ?? null);
      return;
    }
    await onChanged(r.data.token);
    setBusy(false);
    setDone(true);
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('account.password.title')}>
      {done ? (
        <>
          <p class="t-body">{t('account.password.done')}</p>
          <Button chevron={false} onClick={onClose}>
            {t('account.password.close')}
          </Button>
        </>
      ) : (
        <>
          {error ? <ErrorNote error={error} /> : null}
          <div class="field">
            <label class="field__label" for="pw-email">
              {t('account.password.email')}
            </label>
            <input id="pw-email" class="input" type="email" autocomplete="username" value={mail} onInput={(e) => setMail(e.currentTarget.value)} />
          </div>
          <div class="field">
            <label class="field__label" for="pw-current">
              {t('account.password.current')}
            </label>
            <input id="pw-current" class="input" type="password" autocomplete="current-password" value={current} onInput={(e) => setCurrent(e.currentTarget.value)} />
          </div>
          <div class="field">
            <label class="field__label" for="pw-new">
              {t('account.password.new')}
            </label>
            <input id="pw-new" class="input" type="password" autocomplete="new-password" value={next} onInput={(e) => setNext(e.currentTarget.value)} />
          </div>
          <div class="field">
            <label class="field__label" for="pw-again">
              {t('account.password.again')}
            </label>
            <input id="pw-again" class="input" type="password" autocomplete="new-password" value={again} onInput={(e) => setAgain(e.currentTarget.value)} />
          </div>
          <p class="card__note">{t('account.password.note')}</p>
          {blocker && (current || next || again) ? <p class="card__note">{t(blocker)}</p> : null}
          <Button chevron={false} disabled={blocker !== null || !mail.trim()} busy={busy} onClick={() => void submit()}>
            {t('account.password.save')}
          </Button>
          <Button variant="link" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </>
      )}
    </Sheet>
  );
}
