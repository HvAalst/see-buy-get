import { HelpLink } from '../../../shared/guide/HelpLink';
import { AllAppsLink } from '../../../shared/ui/AllAppsLink';
import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Card, Checklist, CodeBoxes, ErrorNote, NeedsSignalNote, Note, ReadAloud, RefusalNote } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';
import { EmailStep } from '../../../shared/account/EmailStep';
import { TroubleSheet } from '../../../shared/account/TroubleSheet';
import { NewDeviceSheet } from '../../../shared/account/NewDeviceSheet';
import { PIN_LENGTH, isNewDevice } from '../../../shared/account/pin';
import { recoveryApi } from '../../../shared/account/recovery';
import { driverConfig } from '../api';

export interface SignInScreenProps {
  /** Phone + PIN. Resolves to whether it worked. */
  onSignIn: (phone: string, pin: string) => Promise<boolean>;
  /** Send a code to the phone. Resolves to the code in a sandbox, `''` once sent, null on failure. */
  onSendCode: (phone: string) => Promise<string | null>;
  /** Verify the code, set the new PIN, sign in. `'email'`: this is a first PIN, and it needs a recovery email. */
  onSetPin: (phone: string, code: string, pin: string, recovery?: { email: string; code: string }) => Promise<'ok' | 'email' | 'email-reset' | 'failed'>;
  error: SbgError | null;
}

type Step = 'pin' | 'phone' | 'code' | 'email';

// Built once: the doors a person uses before they are signed in.
const recovery = recoveryApi(driverConfig());

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
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [trouble, setTrouble] = useState(false);
  /** The email step is "confirm it is you" (a PIN replaced on a new phone), not "add a recovery email" (a first PIN). */
  const [reset, setReset] = useState(false);
  // A PIN typed on a phone no code was ever typed on: not an error, a step — the code, once.
  const [closedFor, setClosedFor] = useState<unknown>(null);
  const confirming = step === 'pin' && isNewDevice(error) && closedFor !== error;

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
    } else if (step === 'code') {
      // A first PIN: the server answers that it wants a recovery email, and that is the next thing to fill in.
      void busyWhile(async () => {
        const next = await onSetPin(phone, code, pin);
        if (next === 'email' || next === 'email-reset') {
          // …or this phone is new to the account and the PIN is being replaced: the same step, asked for another reason.
          setReset(next === 'email-reset');
          setStep('email');
        }
      });
    } else {
      void busyWhile(() => onSetPin(phone, code, pin, { email: email.trim(), code: emailCode }));
    }
  };

  const back = () => {
    setStep('pin');
    setPin('');
    setCode('');
    setTestCode('');
    setEmail('');
    setEmailCode('');
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
        disabled={busy || step === 'code' || step === 'email'}
      />
    </div>
  );

  const ready =
    step === 'pin' ? phone.trim() !== '' && pin.length === PIN_LENGTH : step === 'phone' ? phone.trim() !== '' : step === 'code' ? code.length === 6 && pin.length === PIN_LENGTH : email.trim() !== '' && emailCode.length === 6;

  return (
    <>
    <form class="scr" onSubmit={submit}>
      <h1 class="scr__title">{step === 'pin' ? t('driver.signin.title') : step === 'email' ? t(reset ? 'account.safety.resetTitle' : 'account.safety.signupTitle') : t('driver.signin.codeTitle')}</h1>
      <p class="scr__lede">{step === 'pin' ? t('driver.signin.lede') : step === 'email' ? t(reset ? 'account.safety.resetLede' : 'account.safety.signupLede') : t('driver.signin.codeLede')}</p>

      <NeedsSignalNote title={t('common.needsSignal.signInTitle')} detail={t('common.needsSignal.signInDetail')} />
      {/* The PIN was right but this phone drives for nobody: the generic "you cannot open that" would send a driver
          looking for a problem with their PIN, when the fix is the number their fleet registered. */}
      {error?.code === 'ROLE_NOT_HELD' ? (
        <Note tone="warn" icon="block" title={t('driver.signin.notDriver')} detail={t('driver.signin.notDriverNote')} />
      ) : error?.code === 'UNAUTHORIZED' ? (
        /* The sign-in ended under them. One phone at a time means that is how a driver LEARNS somebody else signed
           in as them — so it says so, and says what undoes it, rather than a bare "sign in again". */
        <Note tone="warn" icon="lock" title={t('driver.signin.signedOutTitle')} detail={t('driver.signin.signedOutNote')} />
      ) : error && !confirming ? (
        /* On the email step the server's own sentence is the message: "that is not the recovery email on this account". */
        step === 'email' ? <RefusalNote error={error} /> : <ErrorNote error={error} />
      ) : null}

      <Card>
        {step === 'email' ? <EmailStep id="drv-mail" email={email} code={emailCode} onEmail={setEmail} onCode={setEmailCode} send={recovery.emailCode} disabled={busy} /> : phoneField}
        {step === 'pin' ? (
          <div class="field">
            <span class="field__label">{t('driver.signin.pinLabel')}</span>
            <CodeBoxes id="drv-pin" label={t('driver.signin.pinLabel')} length={PIN_LENGTH} value={pin} onInput={setPin} disabled={busy} mask />
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
              <CodeBoxes id="drv-new-pin" label={t('driver.signin.newPinLabel')} length={PIN_LENGTH} value={pin} onInput={setPin} disabled={busy} />
            </div>
          </>
        ) : null}
        {step === 'email' ? null : <p class="card__note">{t('driver.signin.phoneNote')}</p>}
      </Card>

      <div class="scr__cta">
        <Button type="submit" disabled={!ready} busy={busy}>
          {step === 'pin' ? t('driver.signin.continue') : step === 'phone' ? t('driver.signin.sendCode') : step === 'email' ? t(reset ? 'account.safety.resetCta' : 'account.safety.signupCta') : t('driver.signin.savePin')}
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
        {/* The two cases a code to the number cannot solve: the number is gone, or somebody moved the account. */}
        {step === 'pin' ? (
          <button type="button" class="btn btn--link" onClick={() => setTrouble(true)} disabled={busy}>
            {t('account.trouble.link')}
          </button>
        ) : null}
        <HelpLink app="driver" label="signin" />
        <AllAppsLink />
        <ReadAloud text={() => t('driver.signin.aloud')} label={t('driver.readAloud')} />
      </div>
    </form>
    {/* Outside the form: Enter in one of its fields must not submit the sign-in behind it. */}
    <TroubleSheet open={trouble} onClose={() => setTrouble(false)} api={recovery} />
    <NewDeviceSheet
      open={confirming}
      onClose={() => setClosedFor(error)}
      api={recovery}
      phone={phone}
      onConfirmed={() => {
        setClosedFor(error);
        void busyWhile(() => onSignIn(phone, pin));
      }}
    />
    </>
  );
}
