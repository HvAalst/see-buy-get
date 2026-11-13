import { Abbreviated } from '../../../shared/ui/Abbr';
import { useState } from 'preact/hooks';
import { AgreementBlock } from '../../../shared/documents/Agreement';
import { countryOfNumber } from '../../../shared/phone/dial';
import { BrandMark, CodeBoxes, PhoneField, StepList } from '../../../shared/ui';
import { AllAppsLink, frontDoorLink } from '../../../shared/ui/AllAppsLink';
import { useT, type MessageKey } from '../../../shared/i18n';
import { EmailStep } from '../../../shared/account/EmailStep';
import { SignInHelp } from '../../../shared/account/TroubleSheet';
import { NewDeviceSheet } from '../../../shared/account/NewDeviceSheet';
import { PIN_LENGTH, isNewDevice, pinGuessable } from '../../../shared/account/pin';
import { PinGuessHint } from '../../../shared/account/PinGuessHint';
import { recoveryApi } from '../../../shared/account/recovery';
import { UnlockFirst, useUnlockFirst } from '../../../shared/account/UnlockFirst';
import { SignedOutBar } from '../../../shared/ui/SignedOutBar';
import { useWideScreen } from '../../../shared/useWideScreen';
import { businessConfig } from '../api';
import { TestingAsk } from '../../../shared/opening/TestingAsk';
import { PHONE_MAX, digitsReady, phoneReady } from '../logic';
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
/**
 * SETTING UP A SIGN-IN, STEP BY STEP (the owner, 2026-11-01: "give phone number, confirm sim, set device pin, give email,
 * confirm email. An indicator of the steps and how far you are … can be more clear"). The email is asked the first time
 * only, and its name says so; signing in with a PIN already chosen is one screen and has no list.
 */
const SETUP: Array<Exclude<SignInStep, 'login'>> = ['phone', 'code', 'pin', 'email'];
const SETUP_NAME: Record<Exclude<SignInStep, 'login'>, MessageKey> = {
  phone: 'business.signIn.steps.phone',
  code: 'business.signIn.steps.code',
  pin: 'business.signIn.steps.pin',
  email: 'business.signIn.steps.email',
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
export function SignInScreen({ state, actions, narrow }: { state: BusinessState; actions: BusinessActions; /** A phone's width, where the caller knows it (a test); otherwise read from the screen. */ narrow?: boolean }) {
  const t = useT();
  const { step, busy } = state;
  // A phone: the card is the whole screen (business.css), and the bar before signing in is pinned to its bottom.
  const wide = useWideScreen(PHONE_MAX + 1);
  const phone = narrow ?? !wide;
  // A PIN typed on a phone or browser no code was ever typed on: not an error, a step — the code, once.
  const [closedFor, setClosedFor] = useState<unknown>(null);
  const confirming = step === 'login' && isNewDevice(state.error) && closedFor !== state.error;
  const error = state.error && !confirming ? state.error.detail || state.error.title : null;
  const unlock = useUnlockFirst(state.phone);

  const submit = (e: Event) => {
    e.preventDefault();
    if (busy) return;
    if (step === 'login' && phoneReady(state.phone) && digitsReady(state.pin, PIN_LENGTH)) void actions.submitLogin();
    else if (step === 'phone' && phoneReady(state.phone)) void actions.requestCode();
    else if (step === 'code' && digitsReady(state.code, 6)) void actions.submitCode();
    else if (step === 'pin' && digitsReady(state.pin, PIN_LENGTH) && !pinGuessable(state.pin) && state.agreement) void actions.submitPin();
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
            ? digitsReady(state.pin, PIN_LENGTH) && !pinGuessable(state.pin) && Boolean(state.agreement)
            : Boolean(state.email.trim()) && digitsReady(state.emailCode, 6);

  return (
    <div class="twr-signin biz-door">
      <div class="twr-signin__card biz-signin">
        <div class="twr-signin__brand">
          {/* The mark goes home: the front page, in this tab (the user, 2026-10-22). */}
          <a {...frontDoorLink()} aria-label={t('common.frontDoor')} title={t('common.frontDoor')}>
            <BrandMark size={34} />
          </a>
          <span class="cons__brandname">{t('business.appTitle')}</span>
        </div>

        <form onSubmit={submit}>
          {/* 2026-11-02 — the step bar PINNED, on a phone and at a desk alike (the owner, of the business sign-up on a phone:
              "the steps of registration seem to be a list still"): one bar at the top of the card that stays in sight as the
              step scrolls, and opens to the whole list on a tap. One look everywhere — the card is the whole screen on a
              phone, and a desk loses nothing to a bar it can open. */}
          {step !== 'login' ? <StepList pinned title={t('business.signIn.steps.title')} steps={SETUP.map((s) => t(SETUP_NAME[s]))} at={SETUP.indexOf(step)} /> : null}
          <h1 class="cons__title">{t(step === 'email' && state.emailReset ? 'account.safety.resetTitle' : TITLE[step])}</h1>
          <p class="cons__lede">{step === 'code' ? t('business.signIn.codeLede', { phone: state.phone }) : t(step === 'email' && state.emailReset ? 'account.safety.resetLede' : LEDE[step])}</p>
          {/* What to have ready, before the first code is sent (2026-11-01). */}
          {step === 'phone' ? <p class="chint">{t('business.signIn.ready')}</p> : null}

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
                <PhoneField id="biz-phone" value={state.phone} onInput={(v) => actions.set({ phone: v })} inputClass="cinput" />
              </label>
            )
          ) : null}

          {step === 'login' ? (
            // 2026-11-02 — where the fingerprint or face was turned on for this number here, it is the first choice; the PIN is one tap away.
            <UnlockFirst state={unlock} phone={state.phone} config={businessConfig()} busy={busy} look="console" onTicket={(ticket) => actions.submitLogin(ticket)}>
              <div class="cfield">
                <span class="cfield__label">{t('business.signIn.pin')}</span>
                <CodeBoxes id="biz-pin" label={t('business.signIn.pin')} length={PIN_LENGTH} value={state.pin} onInput={(v) => actions.set({ pin: v })} disabled={busy} mask />
                {/* 2026-11-02 — the PIN's own way round, under the PIN, as the phone apps now have it. */}
                <p class="twr-signin__alt">
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => actions.setStep('phone')}>
                    {t('business.signIn.forgot')}
                  </button>
                </p>
              </div>
            </UnlockFirst>
          ) : step === 'pin' ? (
            <div class="cfield">
              <span class="cfield__label">{t('business.signIn.newPin')}</span>
              <CodeBoxes id="biz-pin" label={t('business.signIn.pin')} length={PIN_LENGTH} value={state.pin} onInput={(v) => actions.set({ pin: v })} disabled={busy} mask={false} />
              <PinGuessHint pin={state.pin} />
            </div>
          ) : null}
          {/* Choosing a first PIN is where the person's account is made: everybody signing up agrees here (2026-10-25). */}
          {step === 'pin' ? <AgreementBlock agreed={state.agreement} onChange={(agreement) => actions.set({ agreement })} countries={[countryOfNumber(state.phone)]} /> : null}

          {step === 'code' ? (
            <div class="cfield">
              <span class="cfield__label">{t('business.signIn.code')}</span>
              <CodeBoxes id="biz-code" label={t('business.signIn.code')} length={6} value={state.code} onInput={(v) => actions.set({ code: v })} disabled={busy} />
              {state.devCode ? <span class="chint">{t('business.signIn.testCode', { code: state.devCode })}</span> : null}
              {/* 2026-11-02 — the code's own way round, under the code. */}
              <p class="twr-signin__alt">
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void actions.requestCode()}>
                  {t('business.signIn.newCode')}
                </button>
              </p>
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

          {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
          <TestingAsk error={state.error} kind="store" config={businessConfig()} />

          {step === 'login' && unlock.offered ? null : (
            <button type="submit" class="cbtn cbtn--primary" disabled={busy || !ready} style="margin-top:8px">
              {t(CTA[step])}
            </button>
          )}
          {/* Under the button, with the form: signing up, the call for somebody with no account yet — or, on the phone
              step, the other door. Forgot-PIN and sign-up are the same step here — a code to the phone, then a PIN — but
              they are two questions, so two links: the first is under the PIN. */}
          {step === 'login' ? (
            <p class="twr-signin__alt">
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => actions.setStep('phone')}>
                {t('common.signUp')}
              </button>
            </p>
          ) : step === 'phone' ? (
            // Always: a browser that remembers no number opens on this step, and somebody who already has a PIN —
            // from this app or any other SeeBuyGet app — must see the way to use it before typing anything.
            <p class="twr-signin__alt">
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => actions.setStep('login')}>
                {t('business.signIn.havePin')}
              </button>
            </p>
          ) : null}
        </form>

        {/* 2026-11-02 — what the phone apps pin to the bottom of the screen before signing in (the owner: "that clutter
            would be better off in a sticky footer"), kept here in the card AT A DESK: a desk's card is the whole screen, its
            foot always in sight. The same things as the phone apps' bar — the way back where a step has one, "Trouble
            signing in?", the other apps — and nothing else, in this app's own buttons.
            ON A PHONE the card is the whole screen and as long as its step, so its foot scrolled out of sight under a PIN's
            boxes and the terms: there the bar is the phone apps' own, pinned to the bottom, as every other app's sign-in has
            it — and somebody who uses the shop's app on the same phone finds Help where they always do. */}
        {phone ? null : (
          <p class="twr-signin__foot">
            {step === 'code' ? (
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => actions.setStep('phone')}>
                {t('business.signIn.changeNumber')}
              </button>
            ) : step === 'pin' || step === 'email' ? (
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => actions.setStep(step === 'email' ? 'pin' : 'phone')}>
                {t('common.back')}
              </button>
            ) : null}
            <SignInHelp app="business" api={recovery} buttonClass="cbtn cbtn--ghost cbtn--sm" />
            <AllAppsLink buttonClass="cbtn cbtn--ghost cbtn--sm" />
          </p>
        )}
        <p class="chint biz-signin__same">{t('business.signIn.samePin')}</p>
        {phone ? (
          <SignedOutBar
            onBack={step === 'code' || step === 'pin' ? () => actions.setStep('phone') : step === 'email' ? () => actions.setStep('pin') : undefined}
            backKey={step}
            help={{ app: 'business', api: recovery }}
            aloud={() => `${t(step === 'email' && state.emailReset ? 'account.safety.resetTitle' : TITLE[step])}. ${step === 'code' ? t('business.signIn.codeLede', { phone: state.phone }) : t(step === 'email' && state.emailReset ? 'account.safety.resetLede' : LEDE[step])}`}
          />
        ) : null}
      </div>
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
