import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Card, Checklist, CodeBoxes, ErrorNote, Note, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';

export interface SignInScreenProps {
  /** Phone + PIN. Resolves to whether it worked. */
  onSignIn: (phone: string, pin: string) => Promise<boolean>;
  /** Send a code to the phone. Resolves to the code in a sandbox, `''` once sent, null on failure. */
  onSendCode: (phone: string) => Promise<string | null>;
  /** Verify the code, set the new PIN, sign in. */
  onSetPin: (phone: string, code: string, pin: string) => Promise<boolean>;
  error: SbgError | null;
}

type Step = 'pin' | 'phone' | 'code';

/**
 * Who is driving: the phone number the fleet registered, and a PIN.
 *
 * This screen used to take a driver ID, which is printed on the badge — anyone who had read it could drive as
 * that person, and the app minted itself a token for it. The phone and PIN are the credential now. A driver who
 * has never chosen a PIN (or forgot it, or locked it) proves the phone with a one-time code and chooses one.
 */
export function SignInScreen({ onSignIn, onSendCode, onSetPin, error }: SignInScreenProps) {
  const t = useT();
  const [step, setStep] = useState<Step>('pin');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [testCode, setTestCode] = useState('');
  const [busy, setBusy] = useState(false);

  const busyWhile = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: JSX.TargetedEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    if (step === 'pin') {
      void busyWhile(() => onSignIn(phone, pin));
    } else if (step === 'phone') {
      void busyWhile(async () => {
        const sent = await onSendCode(phone);
        if (sent === null) return;
        setTestCode(sent);
        setCode('');
        setPin('');
        setStep('code');
      });
    } else {
      void busyWhile(() => onSetPin(phone, code, pin));
    }
  };

  const back = () => {
    setStep('pin');
    setPin('');
    setCode('');
    setTestCode('');
  };

  const phoneField = (
    <div class="field">
      <label class="field__label" for="drv-phone">
        {t('driver.signin.phoneLabel')}
      </label>
      <input
        id="drv-phone"
        class="input"
        type="tel"
        value={phone}
        onInput={(e) => setPhone(e.currentTarget.value)}
        placeholder="+2547…"
        autocomplete="tel"
        inputMode="tel"
        disabled={busy || step === 'code'}
      />
    </div>
  );

  const ready = step === 'pin' ? phone.trim() !== '' && pin.length === 4 : step === 'phone' ? phone.trim() !== '' : code.length === 6 && pin.length === 4;

  return (
    <form class="scr" onSubmit={submit}>
      <h1 class="scr__title">{step === 'pin' ? t('driver.signin.title') : t('driver.signin.codeTitle')}</h1>
      <p class="scr__lede">{step === 'pin' ? t('driver.signin.lede') : t('driver.signin.codeLede')}</p>

      {/* The PIN was right but this phone drives for nobody: the generic "you cannot open that" would send a driver
          looking for a problem with their PIN, when the fix is the number their fleet registered. */}
      {error?.code === 'ROLE_NOT_HELD' ? (
        <Note tone="warn" icon="block" title={t('driver.signin.notDriver')} detail={t('driver.signin.notDriverNote')} />
      ) : error ? (
        <ErrorNote error={error} />
      ) : null}

      <Card>
        {phoneField}
        {step === 'pin' ? (
          <div class="field">
            <span class="field__label">{t('driver.signin.pinLabel')}</span>
            <CodeBoxes id="drv-pin" label={t('driver.signin.pinLabel')} length={4} value={pin} onInput={setPin} disabled={busy} />
          </div>
        ) : null}
        {step === 'code' ? (
          <>
            <div class="field">
              <span class="field__label">{t('driver.signin.codeLabel')}</span>
              <CodeBoxes id="drv-code" label={t('driver.signin.codeLabel')} length={6} value={code} onInput={setCode} disabled={busy} />
            </div>
            {testCode ? <p class="hint">{t('driver.signin.testCode', { code: testCode })}</p> : null}
            <div class="field">
              <span class="field__label">{t('driver.signin.newPinLabel')}</span>
              <CodeBoxes id="drv-new-pin" label={t('driver.signin.newPinLabel')} length={4} value={pin} onInput={setPin} disabled={busy} />
            </div>
          </>
        ) : null}
        <p class="card__note">{t('driver.signin.phoneNote')}</p>
      </Card>

      <div class="scr__cta">
        <Button type="submit" disabled={!ready} busy={busy}>
          {step === 'pin' ? t('driver.signin.continue') : step === 'phone' ? t('driver.signin.sendCode') : t('driver.signin.savePin')}
        </Button>
      </div>

      {step === 'pin' ? (
        <Card title={t('driver.signin.whyTitle')} tone="soft">
          <Checklist items={[t('driver.signin.why1'), t('driver.signin.why2'), t('driver.signin.why3')]} />
        </Card>
      ) : null}

      <div class="scr__foot">
        {step === 'pin' ? (
          <button type="button" class="btn btn--link" onClick={() => setStep('phone')} disabled={busy}>
            {t('driver.signin.firstTime')}
          </button>
        ) : (
          <button type="button" class="btn btn--link" onClick={back} disabled={busy}>
            {t('driver.signin.back')}
          </button>
        )}
        <ReadAloud text={() => t('driver.signin.aloud')} label={t('driver.readAloud')} />
      </div>
    </form>
  );
}
