import { useEffect, useState } from 'preact/hooks';
import { Button, CodeBoxes, ErrorNote, Note, RefusalNote, Sheet, PhoneField } from '../ui';
import { useT } from '../i18n';
import type { SbgError } from '../../lib/sbg';
import { EmailStep } from './EmailStep';
import { PIN_LENGTH, pinGuessable, pinReady } from './pin';
import { PinGuessHint } from './PinGuessHint';
import { asksForEmail, isPinReset, type RecoveryApi } from './recovery';

export interface ChoosePinSheetProps {
  open: boolean;
  onClose: () => void;
  /** The doors a person uses before they are signed in — every app with a PIN sign-in already builds one. */
  api: RecoveryApi;
  /** The number already typed on the sign-in screen, if any: where this starts. */
  phone: string;
  /** A PIN was chosen for this number. The app signs the person in its own way, with what they have just typed. */
  onChosen: (phone: string, pin: string) => void;
}

type Step = 'phone' | 'code' | 'pin' | 'email' | 'done';

/**
 * "FIRST TIME HERE, OR FORGOT YOUR PIN?" — for an app whose sign-in screen has no such step of its own.
 *
 * The Fleet app asked a manager for a phone and a PIN and offered no way to get a PIN: somebody added to a fleet's
 * office by their number had to go and choose one in another app, and one who forgot theirs had to as well. This is
 * the same four steps the Driver and Send apps walk, as one sheet: a code to the phone, the code, a PIN, and — the
 * first time, or when a PIN is replaced on a phone or browser it never worked on — the email, which the server asks
 * for and this shows as the next thing to fill in, never as an error.
 *
 * It signs nobody in. A manager's sign-in is the fleet's door, with the fleet it is for; this ends with the PIN set
 * and this phone or browser confirmed, and hands both back to the screen that opened it.
 */
export function ChoosePinSheet({ open, onClose, api, phone: typed, onChosen }: ChoosePinSheetProps) {
  const t = useT();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [echoed, setEchoed] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  /** Why the email is asked: to confirm it is them (a PIN replaced on a new device), or to add one (a first PIN). */
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);

  // Opened afresh each time, from the number on the screen behind it.
  useEffect(() => {
    if (!open) return;
    setStep('phone');
    setPhone(typed);
    setCode('');
    setEchoed(null);
    setPin('');
    setEmail('');
    setEmailCode('');
    setReset(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const number = phone.trim();
  const run = async <T,>(doing: Promise<{ data?: T | null; error?: SbgError | null }>): Promise<T | true | null> => {
    setBusy(true);
    setError(null);
    const r = await doing;
    setBusy(false);
    if (r.error) {
      setError(r.error);
      return null;
    }
    return r.data ?? true;
  };

  const sendCode = async () => {
    const sent = await run(api.phoneCode(number));
    if (!sent) return;
    setEchoed(typeof sent === 'object' ? (sent.code ?? null) : null);
    setCode('');
    setStep('code');
  };
  const checkCode = async () => {
    if (await run(api.verifyPhone(number, code))) setStep('pin');
  };
  const choose = async () => {
    const onEmailStep = step === 'email';
    setBusy(true);
    setError(null);
    const r = await api.choosePin(number, pin, onEmailStep ? { email: email.trim(), code: emailCode } : undefined);
    setBusy(false);
    if (!r.error) return setStep('done');
    // The server wants the email first. That is the next step, not a refusal: the phone stays confirmed, the PIN typed.
    if (!onEmailStep && asksForEmail(r.error)) {
      setReset(isPinReset(r.error));
      return setStep('email');
    }
    setError(r.error);
  };

  return (
    <Sheet open={open} onClose={onClose} title={t(step === 'email' ? (reset ? 'account.safety.resetTitle' : 'account.safety.signupTitle') : 'account.choosePin.title')}>
      {step === 'phone' ? (
        <>
          <p class="t-body">{t('account.choosePin.lede')}</p>
          {error ? <ErrorNote error={error} showDetail /> : null}
          <div class="field">
            <label class="field__label" for="choose-phone">
              {t('account.choosePin.phone')}
            </label>
            <PhoneField id="choose-phone" value={phone} onInput={(v) => setPhone(v)} disabled={busy} inputClass="input input--mono" />
          </div>
          <Button chevron={false} busy={busy} disabled={number.replace(/\D/g, '').length < 9} onClick={() => void sendCode()}>
            {t('account.choosePin.sendCode')}
          </Button>
        </>
      ) : null}

      {step === 'code' ? (
        <>
          <p class="t-body">{t('account.choosePin.codeLede', { phone: number })}</p>
          {error ? <ErrorNote error={error} showDetail /> : null}
          <div class="field">
            <span class="field__label">{t('account.device.code')}</span>
            <CodeBoxes id="choose-code" label={t('account.device.code')} length={6} value={code} onInput={setCode} disabled={busy} />
            {echoed ? <p class="hint">{t('account.device.sandbox', { code: echoed })}</p> : null}
          </div>
          <Button chevron={false} busy={busy} disabled={code.length !== 6} onClick={() => void checkCode()}>
            {t('account.choosePin.checkCode')}
          </Button>
          <Button variant="link" full={false} onClick={() => void sendCode()}>
            {t('account.device.again')}
          </Button>
        </>
      ) : null}

      {step === 'pin' ? (
        <>
          <p class="t-body">{t('account.choosePin.pinLede')}</p>
          {error ? <ErrorNote error={error} /> : null}
          <div class="field">
            <span class="field__label">{t('account.choosePin.pin')}</span>
            <CodeBoxes id="choose-pin" label={t('account.choosePin.pin')} length={PIN_LENGTH} value={pin} onInput={(v) => { setPin(v); setError(null); }} disabled={busy} />
          </div>
          <PinGuessHint pin={pin} />
          <Button chevron={false} busy={busy} disabled={!pinReady(pin) || pinGuessable(pin)} onClick={() => void choose()}>
            {t('account.choosePin.save')}
          </Button>
        </>
      ) : null}

      {step === 'email' ? (
        <>
          <p class="t-body">{t(reset ? 'account.safety.resetLede' : 'account.safety.signupLede')}</p>
          {/* The server's own sentence: "that is not the recovery email on this account" is the message, not a detail of one. */}
          {error ? <RefusalNote error={error} /> : null}
          <EmailStep id="choose" email={email} code={emailCode} onEmail={setEmail} onCode={setEmailCode} send={api.emailCode} disabled={busy} />
          <Button chevron={false} busy={busy} disabled={!email.trim() || emailCode.length !== 6} onClick={() => void choose()}>
            {t('account.choosePin.save')}
          </Button>
        </>
      ) : null}

      {step === 'done' ? (
        <>
          <Note tone="ok" icon="check" title={t('account.choosePin.doneTitle')} detail={t('account.choosePin.done')} />
          <Button chevron={false} onClick={() => onChosen(number, pin)}>
            {t('account.choosePin.signIn')}
          </Button>
        </>
      ) : (
        <Button variant="link" full={false} onClick={onClose}>
          {t('common.cancel')}
        </Button>
      )}
    </Sheet>
  );
}
