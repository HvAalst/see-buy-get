import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Button, CodeBoxes, ErrorNote, Icon, Note, RefusalNote, Sheet } from '../ui';
import type { IconName } from '../ui/Icon';
import { useT } from '../i18n';
import type { SbgError } from '../../lib/sbg';
import { CredentialAge } from './CredentialAge';
import { EmailStep } from './EmailStep';
import { IdDisputeCase } from './IdDisputeCase';
import { settingsIdSays } from './idDispute';
import { pinChangeBlocker } from './password';
import { recoveryEmailSays } from './recovery';
import type { AccountApi } from './useAccount';

type View = 'list' | 'pin' | 'email' | 'phone' | 'phone-done' | 'id';

export interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  api: AccountApi;
  /** Sign out of THIS app. A PIN change and a number change both end every session, this one included. */
  onSignOut: () => void;
  /** An app whose sign-in is an email and a password puts its own change-password sheet behind a row here. */
  onChangePassword?: () => void;
  /**
   * An app that changes the PIN its own way and STAYS signed in (the Send app is handed a fresh sign-in by the
   * server). Everywhere else the change goes through the account and the person signs back in.
   */
  pin?: { change: (current: string, next: string) => Promise<boolean>; busy: boolean; error: SbgError | null };
}

/** True when there is anything to put in Settings for this person — the row that opens it is omitted otherwise. */
export function hasSettings(api: AccountApi, onChangePassword?: () => void): boolean {
  return Boolean(api.account?.hasPin || onChangePassword || api.account?.idDispute);
}

/**
 * SETTINGS — HOW YOU SIGN IN, AND HOW YOU GET BACK IN.
 *
 * The user, 2026-10-01: *"make sure that these sort of actions live in settings."* Changing a PIN, a password, the
 * recovery email or the phone number are not things a person does in passing; they are looked for, rarely, and
 * often in a hurry. So they are in one place with one name, the same in every app, rather than as loose rows
 * between a profile photo and a public page.
 *
 * One sheet whose face changes, not a sheet over a sheet: the list, then the thing chosen, with Back to the list.
 *
 * The recovery email and the phone number need a PIN — the PIN is what proves, a second time, that the person
 * holding a signed-in phone is its owner. Somebody who signs in with a password only has no PIN and is not shown
 * rows that could do nothing for them but refuse.
 */
export function SettingsSheet({ open, onClose, api, onSignOut, onChangePassword, pin }: SettingsSheetProps) {
  const t = useT();
  const [view, setView] = useState<View>('list');
  const [saved, setSaved] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [stopError, setStopError] = useState<SbgError | null>(null);
  // Kept from the moment it is opened: once it is settled the account stops saying it, and the sheet must not go blank under the reader.
  const [idRef, setIdRef] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setView('list');
      setSaved(false);
      setStopped(false);
      setStopError(null);
    }
  }, [open]);
  const stopMove = async () => {
    setStopping(true);
    const r = await api.stopMove();
    setStopping(false);
    setStopError(r.error ?? null);
    if (!r.error) setStopped(true);
  };

  const me = api.account;
  // Once the number has moved the token is dead: every way out of the sheet is the sign-in screen.
  const close = view === 'phone-done' ? () => { onClose(); onSignOut(); } : onClose;
  const title = view === 'id' ? t('account.settings.id.viewTitle') : view === 'pin' ? t('account.menu.pin') : view === 'email' ? t('account.settings.email') : view === 'phone' || view === 'phone-done' ? t('account.settings.phone') : t('account.settings.title');
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Sheet open={open} onClose={close} title={title}>
      {view === 'list' ? (
        <>
          <p class="t-body">{t('account.settings.lede')}</p>
          {saved ? <Note tone="ok" icon="check" title={t('account.settings.emailSaved')} /> : null}
          {/* SOMEBODY ASKED STAFF TO MOVE THIS ACCOUNT. Its holder is the one person who knows whether that was them,
              and being signed in is the proof the asker said they could not give. One press ends it. */}
          {me?.moveAsked ? (
            <>
              <Note tone="warn" icon="warning" title={t('account.settings.moveAsked.title')} detail={t('account.settings.moveAsked.detail', { when: when(me.moveAsked.askedAt), ends: me.moveAsked.toEnds })} />
              <Button variant="outline" chevron={false} busy={stopping} onClick={() => void stopMove()}>
                {t('account.settings.moveAsked.stop')}
              </Button>
              <Refused error={stopError} />
            </>
          ) : null}
          {stopped ? <Note tone="ok" icon="check" title={t('account.settings.moveAsked.stoppedTitle')} detail={t('account.settings.moveAsked.stopped')} /> : null}
          {/* SOMEBODY SAYS THE NATIONAL ID ON THIS PERSON'S REGISTRATION IS THEIRS — or it went to them, and the
              registration is held. A live fact, said for as long as it is true, with the way to act on it. */}
          {me?.idDispute ? (
            <>
              <Note
                tone="warn"
                icon="warning"
                title={settingsIdSays(me.idDispute, t as never).title}
                detail={settingsIdSays(me.idDispute, t as never).detail}
              />
              <Button
                variant="outline"
                chevron={false}
                onClick={() => {
                  setIdRef(me.idDispute!.reference);
                  setView('id');
                }}
              >
                {settingsIdSays(me.idDispute, t as never).cta}
              </Button>
            </>
          ) : null}
          {/* A live fact about the account, said for as long as it is true — never something to dismiss. */}
          {me?.hasPin && recoveryEmailSays(me, t as never).bounced ? <Note tone="warn" icon="warning" title={t('account.settings.emailBounced.title')} detail={t('account.settings.emailBounced.detail', { email: me.email ?? '' })} /> : null}
          <div class="rows" role="list">
            {me?.hasPin ? (
              <Row icon="keypad" label={t('account.menu.pin')} sub={me.pinChangedAt ? undefined : t('account.menu.pinSub')} onClick={() => setView('pin')}>
                {me.pinChangedAt ? <CredentialAge iso={me.pinChangedAt} class="row__s" /> : null}
              </Row>
            ) : null}
            {onChangePassword ? <Row icon="lock" label={t('account.menu.password')} sub={t('account.menu.passwordSub')} onClick={() => { onClose(); onChangePassword(); }} /> : null}
            {me?.hasPin ? <Row icon="mail" label={t('account.settings.email')} sub={recoveryEmailSays(me, t as never).sub} onClick={() => setView('email')} /> : null}
            {me?.hasPin ? <Row icon="phone" label={t('account.settings.phone')} sub={t('account.settings.phoneSub')} onClick={() => setView('phone')} /> : null}
          </div>
          {me?.numberChange ? <Note tone="info" icon="info" title={t('account.settings.changed', { when: when(me.numberChange.at), until: when(me.numberChange.undoUntil) })} /> : null}
        </>
      ) : null}

      {view === 'pin' ? (
        <PinForm
          api={api}
          own={pin}
          onDone={() => {
            // Changed through the account: this token is dead with every other, so the person signs back in.
            if (pin) return setView('list');
            onClose();
            onSignOut();
          }}
        />
      ) : null}
      {view === 'email' ? <EmailForm api={api} onDone={() => { setSaved(true); setView('list'); }} /> : null}
      {view === 'phone' ? <PhoneForm api={api} onDone={() => setView('phone-done')} /> : null}
      {view === 'id' && idRef ? <IdDisputeCase api={api.idDispute} reference={idRef} ownId={api.ownId} onChanged={() => void api.reload()} /> : null}
      {view === 'phone-done' ? (
        <>
          <Note tone="ok" icon="check" title={t('account.settings.phoneDoneTitle')} detail={t('account.settings.phoneDone')} />
          <Button chevron={false} onClick={close}>
            {t('account.settings.signInAgain')}
          </Button>
        </>
      ) : null}

      {view === 'phone-done' ? null : (
        <Button variant="link" onClick={view === 'list' ? onClose : () => setView('list')}>
          {t(view === 'list' ? 'account.trouble.close' : 'common.back')}
        </Button>
      )}
    </Sheet>
  );
}

function Row({ icon, label, sub, onClick, children }: { icon: IconName; label: string; sub?: string; onClick: () => void; children?: ComponentChildren }) {
  return (
    <button type="button" class="row" role="listitem" onClick={onClick}>
      <span class="row__ic">
        <Icon name={icon} size={22} />
      </span>
      <span class="row__body">
        <span class="row__t">{label}</span>
        {sub ? <span class="row__s">{sub}</span> : null}
        {children}
      </span>
      <span class="row__end">
        <Icon name="chevronRight" size={20} />
      </span>
    </button>
  );
}

/** A wrong or locked PIN is said in the shared words; anything else is the server's own sentence about what was typed. */
function Refused({ error }: { error: SbgError | null }) {
  if (!error) return null;
  return error.code === 'PIN_WRONG' || error.code === 'PIN_LOCKED' ? <ErrorNote error={error} /> : <RefusalNote error={error} />;
}

/**
 * Changing the PIN ends every session it opened — including this one, necessarily, because the token
 * carries the person as its revocation key. So this says so BEFORE, and signs out AFTER. Pretending
 * otherwise would leave the app holding a dead token and failing at whatever the person did next.
 */
function PinForm({ api, own, onDone }: { api: AccountApi; own?: SettingsSheetProps['pin']; onDone: () => void }) {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const busy = own ? own.busy : api.busy;
  const error = own ? own.error : api.error;

  return (
    <>
      <p class="t-body">{t(own ? 'account.settings.pinStays' : 'account.menu.pinBody')}</p>
      <div class="field">
        <span class="field__label">{t('account.menu.currentPin')}</span>
        <CodeBoxes id="acct-pin-current" label={t('account.menu.currentPin')} length={4} value={current} onInput={setCurrent} disabled={busy} mask />
      </div>
      <div class="field">
        <span class="field__label">{t('account.menu.newPin')}</span>
        <CodeBoxes id="acct-pin-new" label={t('account.menu.newPin')} length={4} value={next} onInput={setNext} disabled={busy} />
      </div>
      {error ? <ErrorNote error={error} /> : null}
      <Button
        chevron={false}
        busy={busy}
        disabled={pinChangeBlocker({ current, next }) !== null}
        onClick={async () => {
          if (await (own ? own.change(current, next) : api.changePin(current, next))) onDone();
        }}
      >
        {t('account.menu.savePin')}
      </Button>
    </>
  );
}

/** The recovery email: the new address, the code that proves somebody reads it, and the PIN again. */
function EmailForm({ api, onDone }: { api: AccountApi; onDone: () => void }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);

  const save = async () => {
    setBusy(true);
    const r = await api.setEmail(pin, email.trim(), code);
    setBusy(false);
    setError(r.error ?? null);
    if (!r.error) onDone();
  };

  return (
    <>
      <p class="t-body">{t('account.settings.emailBody')}</p>
      {api.account?.emailBounced ? <Note tone="warn" icon="warning" title={t('account.settings.emailBounced.title')} detail={t('account.settings.emailBounced.how')} /> : null}
      <EmailStep id="acct" email={email} code={code} onEmail={setEmail} onCode={setCode} send={api.sendEmailCode} disabled={busy} label={api.account?.email ? t('account.settings.emailNew') : undefined} />
      <div class="field">
        <span class="field__label">{t('account.settings.pinToConfirm')}</span>
        <CodeBoxes id="acct-email-pin" label={t('account.settings.pinToConfirm')} length={4} value={pin} onInput={(v) => { setPin(v); setError(null); }} disabled={busy} mask />
      </div>
      <Refused error={error} />
      <Button chevron={false} busy={busy} disabled={!email.trim() || code.length !== 6 || pin.length !== 4} onClick={() => void save()}>
        {t('account.settings.emailSave')}
      </Button>
    </>
  );
}

/**
 * Moving the account to a new number: a code to the NEW number proves the person holds it, the PIN proves they
 * are who is signed in. What it costs is said first — signed out everywhere — and so is the way back.
 */
function PhoneForm({ api, onDone }: { api: AccountApi; onDone: () => void }) {
  const t = useT();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [testCode, setTestCode] = useState('');
  const [sent, setSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);

  const send = async () => {
    setBusy(true);
    const r = await api.sendPhoneCode(phone.trim());
    setBusy(false);
    setError(r.error ?? null);
    if (r.error) return;
    setSent(true);
    setVerified(false);
    setCode('');
    setTestCode(r.data?.code ?? '');
  };

  const move = async () => {
    setBusy(true);
    setError(null);
    // The code is spent when it is checked, so a wrong PIN afterwards must not ask for it a second time.
    if (!verified) {
      const v = await api.confirmPhoneCode(phone.trim(), code);
      if (v.error) {
        setBusy(false);
        return setError(v.error);
      }
      setVerified(true);
    }
    const r = await api.changeNumber(pin, phone.trim());
    setBusy(false);
    if (r.error) return setError(r.error);
    onDone();
  };

  return (
    <>
      <p class="t-body">{t('account.settings.phoneBody')}</p>
      <div class="field">
        <label class="field__label" for="acct-new-phone">
          {t('account.settings.phoneNew')}
        </label>
        <input
          id="acct-new-phone"
          class="input"
          type="tel"
          inputMode="tel"
          value={phone}
          disabled={busy}
          placeholder="+2547…"
          onInput={(e) => {
            setPhone(e.currentTarget.value);
            setSent(false);
            setVerified(false);
          }}
        />
      </div>
      <Button variant="outline" chevron={false} disabled={busy || !phone.trim()} onClick={() => void send()}>
        {t(sent ? 'account.safety.sendAgain' : 'account.safety.sendPhoneCode')}
      </Button>
      {sent ? (
        <div class="field">
          <span class="field__label">{t('account.safety.phoneCodeLabel')}</span>
          <CodeBoxes id="acct-phone-code" label={t('account.safety.phoneCodeLabel')} length={6} value={code} onInput={setCode} disabled={busy || verified} />
          {testCode ? <p class="hint">{t('account.safety.testCode', { code: testCode })}</p> : null}
        </div>
      ) : null}
      <div class="field">
        <span class="field__label">{t('account.settings.pinToConfirm')}</span>
        <CodeBoxes id="acct-phone-pin" label={t('account.settings.pinToConfirm')} length={4} value={pin} onInput={(v) => { setPin(v); setError(null); }} disabled={busy} mask />
      </div>
      <Refused error={error} />
      <Button chevron={false} busy={busy} disabled={!sent || (!verified && code.length !== 6) || pin.length !== 4} onClick={() => void move()}>
        {t('account.settings.phoneSave')}
      </Button>
    </>
  );
}
