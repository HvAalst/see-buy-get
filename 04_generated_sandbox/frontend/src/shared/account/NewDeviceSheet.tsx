import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, CodeBoxes, ErrorNote, Sheet } from '../ui';
import { useT } from '../i18n';
import type { SbgError } from '../../lib/sbg';
import type { RecoveryApi } from './recovery';

export interface NewDeviceSheetProps {
  open: boolean;
  onClose: () => void;
  /** The doors a person uses before they are signed in — every app with a PIN sign-in already builds one. */
  api: RecoveryApi;
  /** The number that was typed with the PIN. */
  phone: string;
  /** The device is known now: do again what was refused — the PIN that was typed is still typed. */
  onConfirmed: () => void;
}

/**
 * THIS PHONE OR BROWSER, CONFIRMED BY A CODE — the one step between a PIN and a device it has never been used on.
 *
 * A PIN opens an account only on a device that has shown it holds the number: the server does not even look at a
 * PIN that comes from anywhere else. So the first time somebody signs in here — a new phone, another browser, the
 * office computer — the answer is not "wrong PIN", it is this: a code goes to the number, it is typed once, and from
 * then on the PIN works here. Nothing about the account changes; the PIN is the one they had.
 *
 * One sheet for every app that signs in with a PIN, opened by the app when the server says the device is new
 * (`isNewDevice`) and closed by doing again what was refused.
 */
export function NewDeviceSheet({ open, onClose, api, phone, onConfirmed }: NewDeviceSheetProps) {
  const t = useT();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  /** In a sandbox no message leaves, so the server echoes the code and it is shown — as every other code is. */
  const [echoed, setEchoed] = useState<string | null>(null);
  const askedFor = useRef('');

  const send = async () => {
    setBusy(true);
    setError(null);
    const r = await api.phoneCode(phone.trim());
    setBusy(false);
    if (r.error) return setError(r.error);
    setEchoed(r.data?.code ?? null);
  };

  // The code is sent by OPENING this, once per number: nobody should have to ask for the thing the sheet is about.
  useEffect(() => {
    if (!open) {
      askedFor.current = '';
      return;
    }
    if (askedFor.current === phone) return;
    askedFor.current = phone;
    setCode('');
    setEchoed(null);
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phone]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const checked = await api.verifyPhone(phone.trim(), code);
    if (checked.error) {
      setBusy(false);
      return setError(checked.error);
    }
    const known = await api.confirmDevice(phone.trim());
    setBusy(false);
    if (known.error) return setError(known.error);
    onConfirmed();
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('account.device.title')}>
      <p class="t-body">{t('account.device.lede', { phone })}</p>
      {error ? <ErrorNote error={error} showDetail /> : null}
      <div class="field">
        <span class="field__label">{t('account.device.code')}</span>
        <CodeBoxes id="device-code" label={t('account.device.code')} length={6} value={code} onInput={setCode} disabled={busy} />
        {echoed ? <p class="hint">{t('account.device.sandbox', { code: echoed })}</p> : null}
      </div>
      <Button chevron={false} busy={busy} disabled={code.length !== 6} onClick={() => void confirm()}>
        {t('account.device.confirm')}
      </Button>
      <p class="card__note">{t('account.device.why')}</p>
      <Button variant="link" full={false} onClick={() => void send()}>
        {t('account.device.again')}
      </Button>
      <Button variant="link" full={false} onClick={onClose}>
        {t('common.cancel')}
      </Button>
    </Sheet>
  );
}
