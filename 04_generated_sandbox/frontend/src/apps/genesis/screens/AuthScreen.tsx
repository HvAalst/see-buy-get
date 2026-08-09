import { Button, Card, Checklist, CodeBoxes, ErrorNote, Note, ReadAloud } from '../../../shared/ui';
import { canPickContact } from '../../../shared/device';
import { codeReady, phoneReady } from '../logic';
import type { SendActions, SendState } from '../useSendApp';

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
  const busy = state.authBusy;

  return (
    <div class="scr">
      {state.invited ? <Note tone="ok" icon="person" title="You've been invited to SeeBuyGet" detail="Join to send, track and collect parcels." /> : null}

      {state.authMode === 'login' ? (
        <LoginView state={state} actions={actions} busy={busy} />
      ) : (
        <EnrollView state={state} actions={actions} busy={busy} />
      )}

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            state.authMode === 'login'
              ? 'Enter your phone number and your four digit PIN to see your parcels.'
              : state.authStep === 'phone'
                ? 'Enter your phone number and we will send you a code.'
                : state.authStep === 'code'
                  ? 'Type the code we sent to your phone.'
                  : 'Choose a four digit PIN you will remember.'
          }
          label="Read this aloud"
        />
      </div>
    </div>
  );
}

/** A phone-number field with the optional "pick from contacts" shortcut (Android only; hidden elsewhere). */
function PhoneField({ id, state, actions, hint }: { id: string; state: SendState; actions: SendActions; hint: 'send' | 'next' }) {
  return (
    <div class="field">
      <label class="field__label" for={id}>Your phone number</label>
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
        <Button variant="link" chevron={false} onClick={() => void actions.pickContact()}>Pick from my contacts</Button>
      ) : null}
    </div>
  );
}

function LoginView({ state, actions, busy }: { state: SendState; actions: SendActions; busy: boolean }) {
  // PIN-only ONLY when the number was remembered from a prior session — never just because a digit was
  // typed (that would collapse the field mid-entry for a first-time signer).
  const known = state.phoneKnown;
  const ready = phoneReady(state.authPhone) && codeReady(state.authPin, 4);
  return (
    <>
      <h1 class="scr__title">Your parcels</h1>
      <p class="scr__lede">{known ? 'Enter your PIN to see everything you send and receive.' : 'Sign in with your phone and PIN.'}</p>

      {state.authError ? <ErrorNote error={state.authError} /> : null}

      <Card>
        {known ? (
          <div class="field">
            <span class="field__label">Your phone number</span>
            <p class="signedas">{state.authPhone}</p>
            <Button variant="link" chevron={false} onClick={() => actions.setAuthPhone('')}>Not you? Use a different number</Button>
          </div>
        ) : (
          <PhoneField id="auth-phone" state={state} actions={actions} hint="next" />
        )}
        <div class="field">
          <span class="field__label">Your 4-digit PIN</span>
          <CodeBoxes id="auth-pin" label="Your 4-digit PIN" length={4} value={state.authPin} onInput={actions.setAuthPin} disabled={busy} />
        </div>
      </Card>

      <div class="scr__cta">
        <Button chevron={false} onClick={() => void actions.submitLogin()} disabled={!ready} busy={busy}>
          Sign in
        </Button>
      </div>

      <div class="scr__foot">
        <Button variant="link" onClick={() => actions.setAuthMode('enroll')}>New here? Create an account</Button>
        <Button variant="link" onClick={() => actions.setAuthMode('enroll')}>Forgot your PIN?</Button>
      </div>
    </>
  );
}

function EnrollView({ state, actions, busy }: { state: SendState; actions: SendActions; busy: boolean }) {
  if (state.authStep === 'code') {
    return (
      <>
        <h1 class="scr__title">Enter the code</h1>
        <p class="scr__lede">We sent a 6-digit code to {state.authPhone}.</p>
        {state.authError ? <ErrorNote error={state.authError} showDetail /> : null}
        <Card>
          <div class="field">
            <span class="field__label">The 6-digit code</span>
            <CodeBoxes id="auth-otp" label="The 6-digit code" length={6} value={state.authCode} onInput={actions.setAuthCode} disabled={busy} />
          </div>
          {state.authDevCode ? <p class="hint">Test code: {state.authDevCode}</p> : null}
        </Card>
        <div class="scr__cta">
          <Button chevron={false} onClick={() => void actions.submitCode()} disabled={!codeReady(state.authCode, 6)} busy={busy}>
            Check the code
          </Button>
        </div>
        <div class="scr__foot">
          <Button variant="link" onClick={() => void actions.requestCode()}>Send a new code</Button>
          <Button variant="link" onClick={() => actions.authBack()}>Change the number</Button>
        </div>
      </>
    );
  }

  if (state.authStep === 'pin') {
    return (
      <>
        <h1 class="scr__title">Choose a PIN</h1>
        <p class="scr__lede">Pick 4 digits you will remember — you use it to sign in next time.</p>
        {state.authError ? <ErrorNote error={state.authError} /> : null}
        <Card>
          <div class="field">
            <span class="field__label">Your new 4-digit PIN</span>
            <CodeBoxes id="auth-newpin" label="Your new 4-digit PIN" length={4} value={state.authPin} onInput={actions.setAuthPin} disabled={busy} />
          </div>
        </Card>
        <div class="scr__cta">
          <Button chevron={false} onClick={() => void actions.submitEnroll()} disabled={!codeReady(state.authPin, 4)} busy={busy}>
            Create my account
          </Button>
        </div>
        <div class="scr__foot">
          <Button variant="link" onClick={() => actions.authBack()}>Back</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 class="scr__title">Create your account</h1>
      <p class="scr__lede">One account for everything you send and receive. We only use your number to reach you.</p>
      {state.authError ? <ErrorNote error={state.authError} /> : null}
      <Card>
        <PhoneField id="enroll-phone" state={state} actions={actions} hint="send" />
      </Card>
      <div class="scr__cta">
        <Button chevron={false} onClick={() => void actions.requestCode()} disabled={!phoneReady(state.authPhone)} busy={busy}>
          Send me a code
        </Button>
      </div>
      <Card tone="soft">
        <Checklist items={['One account for sending and receiving', 'Your number is never shown to other people', 'Sign in with a 4-digit PIN after this']} />
      </Card>
      <div class="scr__foot">
        <Button variant="link" onClick={() => actions.setAuthMode('login')}>I already have an account</Button>
      </div>
    </>
  );
}
