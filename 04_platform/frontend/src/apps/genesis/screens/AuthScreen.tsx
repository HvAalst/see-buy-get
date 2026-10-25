import { AllAppsLink } from '../../../shared/ui/AllAppsLink';
import { Button, Card, Checklist, CodeBoxes, ErrorNote, Note, ReadAloud, RefusalNote } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { canPickContact } from '../../../shared/device';
import { codeReady, phoneReady, pinBlocker } from '../logic';
import type { SendActions, SendState } from '../useSendApp';
import { useState } from 'preact/hooks';
import { EmailStep } from '../../../shared/account/EmailStep';
import { SignInHelp } from '../../../shared/account/TroubleSheet';
import { NewDeviceSheet } from '../../../shared/account/NewDeviceSheet';
import { PIN_LENGTH, isNewDevice, pinGuessable } from '../../../shared/account/pin';
import { recoveryApi } from '../../../shared/account/recovery';
import { sendConfig } from '../api';

// Built once: the doors a person uses before they are signed in.
const recovery = recoveryApi(sendConfig());

export interface AuthScreenProps {
  state: SendState;
  actions: SendActions;
}

/**
 * The consumer sign-in. Two ways in: a returning person enters their phone + 4-digit PIN (login); a
 * new person verifies their phone by a one-time code, then chooses a PIN (enroll). The PIN is the
 * everyday credential; the code is the fallback whenever the PIN is forgotten or locked. One solid
 * blue CTA per step; the mode/step switches are plain links.
 */
export function AuthScreen({ state, actions }: AuthScreenProps) {
  const t = useT();
  const busy = state.authBusy;

  return (
    <div class="scr">
      {state.invited ? <Note tone="ok" icon="person" title={t('send.auth.invitedTitle')} detail={t('send.auth.invitedDetail')} /> : null}
      {/* From a shop's checkout: the ONE thing to get right is which number — the one the shop is given. */}
      {state.following ? <Note tone="ok" icon="box" title={t('send.auth.followTitle')} detail={t('send.auth.followDetail')} /> : null}

      {state.authMode === 'login' ? (
        <LoginView state={state} actions={actions} busy={busy} />
      ) : (
        <EnrollView state={state} actions={actions} busy={busy} />
      )}

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            state.authMode === 'login'
              ? t('send.auth.aloudLogin')
              : state.authStep === 'phone'
                ? t('send.auth.aloudPhone')
                : state.authStep === 'code'
                  ? t('send.auth.aloudCode')
                  : t('send.auth.aloudPin')
          }
          label={t('send.readAloud')}
        />
      </div>
    </div>
  );
}

/** A phone-number field with the optional "pick from contacts" shortcut (Android only; hidden elsewhere). */
function PhoneField({ id, state, actions, hint }: { id: string; state: SendState; actions: SendActions; hint: 'send' | 'next' }) {
  const t = useT();
  return (
    <div class="field">
      <label class="field__label" for={id}>{t('send.auth.yourPhone')}</label>
      <input
        id={id}
        class="input"
        type="tel"
        inputMode="tel"
        autocomplete="tel"
        value={state.authPhone}
        onInput={(e) => actions.setAuthPhone(e.currentTarget.value)}
        placeholder="+254 700 000 000"
        enterkeyhint={hint}
      />
      {canPickContact() ? (
        <Button variant="link" chevron={false} onClick={() => void actions.pickContact()}>{t('send.pickContacts')}</Button>
      ) : null}
    </div>
  );
}

function LoginView({ state, actions, busy }: { state: SendState; actions: SendActions; busy: boolean }) {
  const t = useT();
  // PIN-only ONLY when the number was remembered from a prior session — never just because a digit was
  // typed (that would collapse the field mid-entry for a first-time signer).
  const known = state.phoneKnown;
  const ready = phoneReady(state.authPhone) && codeReady(state.authPin, PIN_LENGTH);
  // A PIN typed on a phone or browser no code was ever typed on: not an error, a step — the code, once.
  const [closedFor, setClosedFor] = useState<unknown>(null);
  const confirming = isNewDevice(state.authError) && closedFor !== state.authError;
  return (
    <>
      <h1 class="scr__title">{t('send.auth.loginTitle')}</h1>
      <p class="scr__lede">{known ? t('send.auth.ledeKnown') : t('send.auth.ledeNew')}</p>

      {state.authError && !confirming ? <ErrorNote error={state.authError} /> : null}

      <Card>
        {known ? (
          <div class="field">
            <span class="field__label">{t('send.auth.yourPhone')}</span>
            <p class="signedas">{state.authPhone}</p>
            <Button variant="link" chevron={false} onClick={() => actions.setAuthPhone('')}>{t('send.auth.notYou')}</Button>
          </div>
        ) : (
          <PhoneField id="auth-phone" state={state} actions={actions} hint="next" />
        )}
        <div class="field">
          <span class="field__label">{t('send.auth.pin')}</span>
          <CodeBoxes id="auth-pin" label={t('send.auth.pin')} length={PIN_LENGTH} value={state.authPin} onInput={actions.setAuthPin} disabled={busy} mask />
        </div>
      </Card>

      <div class="scr__cta">
        <Button chevron={false} onClick={() => void actions.submitLogin()} disabled={!ready} busy={busy}>
          {t('send.auth.signIn')}
        </Button>
      </div>

      {/* The same foot as every sign-in screen. Forgot-PIN and sign-up are the same step here — a code, then a PIN —
          but they are two questions, so two links. */}
      <div class="scr__foot">
        <Button variant="link" onClick={() => actions.setAuthMode('enroll')}>{t('send.auth.forgot')}</Button>
        {/* The cases a code to the number cannot solve — the number is gone, somebody moved the account — and how signing in works. */}
        <SignInHelp app="send" api={recovery} />
        <Button variant="link" onClick={() => actions.setAuthMode('enroll')}>{t('send.auth.newHere')}</Button>
        <AllAppsLink />
      </div>
      <NewDeviceSheet
        open={confirming}
        onClose={() => setClosedFor(state.authError)}
        api={recovery}
        phone={state.authPhone}
        onConfirmed={() => {
          setClosedFor(state.authError);
          void actions.submitLogin();
        }}
      />
    </>
  );
}

function EnrollView({ state, actions, busy }: { state: SendState; actions: SendActions; busy: boolean }) {
  const t = useT();
  if (state.authStep === 'code') {
    return (
      <>
        <h1 class="scr__title">{t('send.auth.codeTitle')}</h1>
        <p class="scr__lede">{t('send.auth.codeLede', { phone: state.authPhone })}</p>
        {state.authError ? <ErrorNote error={state.authError} showDetail /> : null}
        <Card>
          <div class="field">
            <span class="field__label">{t('send.auth.codeLabel')}</span>
            <CodeBoxes id="auth-otp" label={t('send.auth.codeLabel')} length={6} value={state.authCode} onInput={actions.setAuthCode} disabled={busy} />
          </div>
          {state.authDevCode ? <p class="hint">{t('send.auth.testCode', { code: state.authDevCode })}</p> : null}
        </Card>
        <div class="scr__cta">
          <Button chevron={false} onClick={() => void actions.submitCode()} disabled={!codeReady(state.authCode, 6)} busy={busy}>
            {t('send.auth.checkCode')}
          </Button>
        </div>
        <div class="scr__foot">
          <Button variant="link" onClick={() => void actions.requestCode()}>{t('send.auth.newCode')}</Button>
          <Button variant="link" onClick={() => actions.authBack()}>{t('send.auth.changeNumber')}</Button>
        </div>
      </>
    );
  }

  // A first PIN needs a recovery email: asked for only when the server says this person has none yet.
  if (state.authStep === 'email') {
    return (
      <>
        <h1 class="scr__title">{t(state.authReset ? 'account.safety.resetTitle' : 'account.safety.signupTitle')}</h1>
        <p class="scr__lede">{t(state.authReset ? 'account.safety.resetLede' : 'account.safety.signupLede')}</p>
        {/* The server's own sentence: "that is not the recovery email on this account" is the message, not a detail of one. */}
        {state.authError ? <RefusalNote error={state.authError} /> : null}
        <Card>
          <EmailStep id="auth" email={state.authEmail} code={state.authEmailCode} onEmail={actions.setAuthEmail} onCode={actions.setAuthEmailCode} send={recovery.emailCode} disabled={busy} />
        </Card>
        <div class="scr__cta">
          <Button chevron={false} onClick={() => void actions.submitEnroll()} disabled={!state.authEmail.trim() || !codeReady(state.authEmailCode, 6)} busy={busy}>
            {t(state.authReset ? 'account.safety.resetCta' : 'account.safety.signupCta')}
          </Button>
        </div>
        <div class="scr__foot">
          <Button variant="link" onClick={() => actions.authBack()}>{t('common.back')}</Button>
        </div>
      </>
    );
  }

  if (state.authStep === 'pin') {
    return (
      <>
        <h1 class="scr__title">{t('send.auth.pinTitle')}</h1>
        <p class="scr__lede">{t('send.auth.pinLede')}</p>
        {state.authError ? <ErrorNote error={state.authError} /> : null}
        <Card>
          <div class="field">
            <span class="field__label">{t('send.newPin')}</span>
            <CodeBoxes id="auth-newpin" label={t('send.newPin')} length={PIN_LENGTH} value={state.authPin} onInput={actions.setAuthPin} disabled={busy} />
          </div>
          {/* Too easy to guess: said as it is typed, not after a round trip (2026-10-25). */}
          {pinGuessable(state.authPin) ? <p class="card__note" role="status">{t('account.pin.guessable')}</p> : null}
        </Card>
        <div class="scr__cta">
          <Button chevron={false} onClick={() => void actions.submitEnroll()} disabled={Boolean(pinBlocker(state.authPin, t))} busy={busy}>
            {t('send.auth.createAccount')}
          </Button>
        </div>
        <div class="scr__foot">
          <Button variant="link" onClick={() => actions.authBack()}>{t('common.back')}</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 class="scr__title">{t('send.auth.title')}</h1>
      <p class="scr__lede">{t('send.auth.lede')}</p>
      {/* With the server's own words: "use a mobile number" and "wait 40s" are the part somebody can act on. */}
      {state.authError ? <ErrorNote error={state.authError} showDetail /> : null}
      <Card>
        <PhoneField id="enroll-phone" state={state} actions={actions} hint="send" />
      </Card>
      <div class="scr__cta">
        <Button chevron={false} onClick={() => void actions.requestCode()} disabled={!phoneReady(state.authPhone)} busy={busy}>
          {t('send.auth.sendCode')}
        </Button>
      </div>
      <Card tone="soft">
        <Checklist items={[t('send.auth.perk1'), t('send.auth.perk2'), t('send.auth.perk3')]} />
      </Card>
      <div class="scr__foot">
        <Button variant="link" onClick={() => actions.setAuthMode('login')}>{t('send.auth.haveAccount')}</Button>
        <SignInHelp app="send" api={recovery} />
        <AllAppsLink />
      </div>
    </>
  );
}
