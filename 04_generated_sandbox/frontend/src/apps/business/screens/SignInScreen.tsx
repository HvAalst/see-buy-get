import { useState } from 'preact/hooks';
import { HelpLink } from '../../../shared/guide/HelpLink';
import { BrandMark, CodeBoxes } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { EmailStep } from '../../../shared/account/EmailStep';
import { TroubleSheet } from '../../../shared/account/TroubleSheet';
import { NewDeviceSheet } from '../../../shared/account/NewDeviceSheet';
import { PIN_LENGTH, isNewDevice } from '../../../shared/account/pin';
import { recoveryApi } from '../../../shared/account/recovery';
import { businessConfig } from '../api';
import { digitsReady, phoneReady } from '../logic';
import type { BusinessActions, BusinessState, SignInStep } from '../useBusinessApp';

// Built once: the doors a person uses before they are signed in.
const recovery = recoveryApi(businessConfig());

const TITLE: Record<SignInStep, MessageKey> = {
  login: 'business.signIn.loginTitle',
  phone: 'business.signIn.phoneTitle',
  code: 'business.signIn.codeTitle',
  pin: 'business.signIn.pinTitle',
  email: 'business.signIn.emailTitle',
};
const LEDE: Record<Exclude<SignInStep, 'code'>, MessageKey> = {
  login: 'business.signIn.loginLede',
  phone: 'business.signIn.phoneLede',
  pin: 'business.signIn.pinLede',
  email: 'business.signIn.emailLede',
};
const CTA: Record<SignInStep, MessageKey> = {
  login: 'business.signIn.loginCta',
  phone: 'business.signIn.phoneCta',
  code: 'business.signIn.codeCta',
  pin: 'business.signIn.pinCta',
  email: 'business.signIn.emailCta',
};

/**
 * THE BUSINESS APP'S DOOR — a person, with their own phone and PIN.
 *
 * There is no company login. Everybody in a business signs in as themselves, so whatever they do carries their name and
 * an owner can take them out with one click. It is the same phone and PIN they use in any SeeBuyGet app: a shop
 * owner who also imports signs in here with the PIN they already have.
 *
 * A new device, a new person or a forgotten PIN goes the long way: a code to the phone proves it is theirs, then a PIN
 * — and, the first time a PIN is chosen, a recovery email confirmed by its own code.
 */
export function SignInScreen({ state, actions }: { state: BusinessState; actions: BusinessActions }) {
  const t = useT();
  const [trouble, setTrouble] = useState(false);
  const { step, busy } = state;
  // A PIN typed on a phone or browser no code was ever typed on: not an error, a step — the code, once.
  const [closedFor, setClosedFor] = useState<unknown>(null);
  const confirming = step === 'login' && isNewDevice(state.error) && closedFor !== state.error;
  const error = state.error && !confirming ? state.error.detail || state.error.title : null;

  const submit = (e: Event) => {
    e.preventDefault();
    if (busy) return;
    if (step === 'login' && phoneReady(state.phone) && digitsReady(state.pin, PIN_LENGTH)) void actions.submitLogin();
    else if (step === 'phone' && phoneReady(state.phone)) void actions.requestCode();
    else if (step === 'code' && digitsReady(state.code, 6)) void actions.submitCode();
    else if (step === 'pin' && digitsReady(state.pin, PIN_LENGTH)) void actions.submitPin();
    else if (step === 'email' && state.email.trim() && digitsReady(state.emailCode, 6)) void actions.submitPin();
  };

  const ready =
    step === 'login'
      ? phoneReady(state.phone) && digitsReady(state.pin, PIN_LENGTH)
      : step === 'phone'
        ? phoneReady(state.phone)
        : step === 'code'
          ? digitsReady(state.code, 6)
          : step === 'pin'
            ? digitsReady(state.pin, PIN_LENGTH)
            : Boolean(state.email.trim()) && digitsReady(state.emailCode, 6);

  return (
    <div class="twr-signin">
      <div class="twr-signin__card biz-signin">
        <div class="twr-signin__brand">
          <BrandMark size={34} />
          <span class="cons__brandname">{t('business.appTitle')}</span>
        </div>

        <form onSubmit={submit}>
          <h1 class="cons__title">{t(step === 'email' && state.emailReset ? 'account.safety.resetTitle' : TITLE[step])}</h1>
          <p class="cons__lede">{step === 'code' ? t('business.signIn.codeLede', { phone: state.phone }) : t(step === 'email' && state.emailReset ? 'account.safety.resetLede' : LEDE[step])}</p>

          {step === 'login' || step === 'phone' ? (
            state.phoneKnown && step === 'login' ? (
              <p class="twr-signin__who">
                <span class="ctbl__mono">{state.phone}</span>
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={actions.forgetPhone}>
                  {t('business.signIn.notYou')}
                </button>
              </p>
            ) : (
              <label class="cfield" style="margin-top:18px">
                <span class="cfield__label">{t('business.signIn.phone')}</span>
                <input
                  class="cinput"
                  type="tel"
                  inputMode="tel"
                  autocomplete="tel"
                  value={state.phone}
                  placeholder="+251 911 000 000"
                  onInput={(e) => actions.set({ phone: (e.target as HTMLInputElement).value })}
                />
              </label>
            )
          ) : null}

          {step === 'login' || step === 'pin' ? (
            <div class="cfield">
              <span class="cfield__label">{t(step === 'pin' ? 'business.signIn.newPin' : 'business.signIn.pin')}</span>
              <CodeBoxes id="biz-pin" label={t('business.signIn.pin')} length={PIN_LENGTH} value={state.pin} onInput={(v) => actions.set({ pin: v })} disabled={busy} mask={step === 'login'} />
            </div>
          ) : null}

          {step === 'code' ? (
            <div class="cfield">
              <span class="cfield__label">{t('business.signIn.code')}</span>
              <CodeBoxes id="biz-code" label={t('business.signIn.code')} length={6} value={state.code} onInput={(v) => actions.set({ code: v })} disabled={busy} />
              {state.devCode ? <span class="chint">{t('business.signIn.testCode', { code: state.devCode })}</span> : null}
            </div>
          ) : null}

          {step === 'email' ? (
            <div class="cfield">
              <EmailStep
                id="biz"
                email={state.email}
                code={state.emailCode}
                onEmail={(v) => actions.set({ email: v })}
                onCode={(v) => actions.set({ emailCode: v })}
                send={recovery.emailCode}
                disabled={busy}
              />
            </div>
          ) : null}

          {error ? <p class="cerr">{error}</p> : null}

          <button type="submit" class="cbtn cbtn--primary" disabled={busy || !ready} style="margin-top:8px">
            {t(CTA[step])}
          </button>
        </form>

        <p class="twr-signin__foot">
          {step === 'login' ? (
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => actions.setStep('phone')}>
              {t('business.signIn.forgot')}
            </button>
          ) : step === 'phone' ? (
            state.phoneKnown || state.phone ? (
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => actions.setStep('login')}>
                {t('business.signIn.havePin')}
              </button>
            ) : null
          ) : step === 'code' ? (
            <>
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void actions.requestCode()}>
                {t('business.signIn.newCode')}
              </button>
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => actions.setStep('phone')}>
                {t('business.signIn.changeNumber')}
              </button>
            </>
          ) : (
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => actions.setStep(step === 'email' ? 'pin' : 'phone')}>
              {t('common.back')}
            </button>
          )}
          <HelpLink app="business" label="signin" buttonClass="cbtn cbtn--ghost cbtn--sm" />
          {/* The two cases a code to the phone cannot solve: the number is gone, or somebody moved the account. */}
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setTrouble(true)}>
            {t('account.trouble.link')}
          </button>
        </p>
        <p class="chint biz-signin__same">{t('business.signIn.samePin')}</p>
      </div>
      <TroubleSheet open={trouble} onClose={() => setTrouble(false)} api={recovery} />
      <NewDeviceSheet
        open={confirming}
        onClose={() => setClosedFor(state.error)}
        api={recovery}
        phone={state.phone}
        onConfirmed={() => {
          setClosedFor(state.error);
          void actions.submitLogin();
        }}
      />
    </div>
  );
}
