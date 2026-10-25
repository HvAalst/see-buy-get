import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Button, CodeBoxes, ErrorNote, Icon, Note, RefusalNote, Sheet, PhoneField } from '../ui';
import type { IconName } from '../ui/Icon';
import { useT } from '../i18n';
import type { SbgError } from '../../lib/sbg';
import { ContractCompany } from './ContractCompany';
import { hasContract } from './contract';
import { CredentialAge } from './CredentialAge';
import { canForgetOthers, deviceLine, devicesLede, type PinDevices, type PinDevicesApi } from './devices';
import { PARTY_WORD } from './ConfirmDevice';
import { EmailStep } from './EmailStep';
import { IdDisputeCase } from './IdDisputeCase';
import { settingsIdSays } from './idDispute';
import { pinChangeBlocker } from './password';
import { PIN_LENGTH } from './pin';
import { PinGuessHint } from './PinGuessHint';
import { hasPayoutNumber, payoutNumberSub, payoutSavedSays, type PayoutNumberSaved } from './payoutNumber';
import { oldNumberSays, recoveryEmailSays } from './recovery';
import type { AccountApi, ClosingStanding } from './useAccount';

type View = 'list' | 'pin' | 'email' | 'phone' | 'phone-done' | 'old-number' | 'id' | 'contract' | 'devices' | 'payout' | 'mute' | 'close' | 'closed';

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
  /**
   * THE PHONES THIS SIGN-IN WORKS ON, for an app whose sign-in is not a PIN: a shop's own phones (the user, 2026-10-18:
   * "who is at the counter"), forgotten with the password. Omitted, the PIN's list shows where there is a PIN.
   */
  devices?: PinDevicesApi;
}

/** True when there is anything to put in Settings for this person — the row that opens it is omitted otherwise. */
export function hasSettings(api: AccountApi, onChangePassword?: () => void, devices?: PinDevicesApi): boolean {
  return Boolean(api.account?.hasPin || onChangePassword || devices || api.account?.idDispute || hasContract(api.contract) || hasPayoutNumber(api.payout));
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
export function SettingsSheet({ open, onClose, api, onSignOut, onChangePassword, pin, devices }: SettingsSheetProps) {
  const t = useT();
  const [view, setView] = useState<View>('list');
  const [saved, setSaved] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [stopError, setStopError] = useState<SbgError | null>(null);
  const [blocked, setBlocked] = useState(false);
  // Kept from the moment it is opened: once it is settled the account stops saying it, and the sheet must not go blank under the reader.
  const [idRef, setIdRef] = useState<string | null>(null);
  const [payoutSaved, setPayoutSaved] = useState<PayoutNumberSaved | null>(null);
  useEffect(() => {
    if (open) {
      setView('list');
      setSaved(false);
      setStopped(false);
      setStopError(null);
      setBlocked(false);
      setPayoutSaved(null);
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
  const close = view === 'phone-done' || view === 'closed' ? () => { onClose(); onSignOut(); } : onClose;
  const title = view === 'close' || view === 'closed' ? t('account.close.title') : view === 'mute' ? t('account.mute.title') : view === 'payout' ? t('account.payout.title') : view === 'devices' ? t('account.devices.title') : view === 'contract' ? t('account.contract.title') : view === 'old-number' ? t('account.settings.oldNumber.title') : view === 'id' ? t('account.settings.id.viewTitle') : view === 'pin' ? t('account.menu.pin') : view === 'email' ? t('account.settings.email') : view === 'phone' || view === 'phone-done' ? t('account.settings.phone') : t('account.settings.title');
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const old = oldNumberSays(me, t as never, when);

  return (
    <Sheet open={open} onClose={close} title={title}>
      {view === 'list' ? (
        <>
          <p class="t-body">{t('account.settings.lede')}</p>
          {/* A live fact about the account, said for as long as it is true: it rests, and nothing new reaches it. */}
          {me?.mutedAt ? <Note tone="info" icon="info" title={t('account.mute.mutedTitle')} detail={t('account.mute.mutedSince', { when: when(me.mutedAt) })} /> : null}
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
            {/* WHERE THE PIN WORKS: every phone and browser a code to the number was typed on. Seen, and forgotten, here. */}
            {devices ? <Row icon="lock" label={t('account.devices.title')} sub={t('account.shopDevices.sub', { party: t(PARTY_WORD[devices.party ?? 'shop']) })} onClick={() => setView('devices')} /> : me?.hasPin ? <Row icon="lock" label={t('account.devices.title')} sub={t('account.devices.sub')} onClick={() => setView('devices')} /> : null}
            {/* WHERE THEY ARE PAID, where their country pays to a number of their own (the user, 2026-10-18). */}
            {hasPayoutNumber(api.payout) && api.payout ? <Row icon="wallet" label={t('account.payout.title')} sub={payoutNumberSub(api.payout, t as never, when)} onClick={() => setView('payout')} /> : null}
            {/* WHO THEY CONTRACT WITH, and the papers it trades on. Omitted where no company of ours contracts with them. */}
            {hasContract(api.contract) ? <Row icon="badge" label={t('account.contract.title')} sub={api.contract?.company?.name} onClick={() => setView('contract')} /> : null}
            {/* TO REST IT (the user, 2026-10-22: "an account can be muted by the user") — and to wake it again. */}
            {me ? <Row icon="moon" label={t(me.mutedAt ? 'account.mute.unmuteTitle' : 'account.mute.title')} sub={me.mutedAt ? t('account.mute.since', { when: when(me.mutedAt) }) : t('account.mute.sub')} onClick={() => setView('mute')} /> : null}
            {/* ONLY ONCE ITS OWNER WAS TOLD: four years without a sign-in (the user, 2026-10-22). Never offered before. */}
            {me?.closableSince ? <Row icon="warning" label={t('account.close.title')} sub={t('account.close.sub')} onClick={() => setView('close')} /> : null}
          </div>
          {me?.numberChange ? <Note tone="info" icon="info" title={t('account.settings.changed', { when: when(me.numberChange.at), until: when(me.numberChange.undoUntil) })} /> : null}
          {/* THE NUMBER THEY MOVED OFF IS STILL THEIRS FOR A WEEK — the user, 2026-10-08: "the user blocks their own old
              phone number in the account". Said for as long as it is true; the button comes when the move can no longer
              be undone, because until then the old number is where the account would go back to. */}
          {old ? (
            <>
              <Note tone="info" icon="info" title={old.title} detail={old.detail} />
              {old.canBlock ? (
                <Button variant="outline" chevron={false} onClick={() => setView('old-number')}>
                  {t('account.settings.oldNumber.block')}
                </Button>
              ) : null}
            </>
          ) : null}
          {blocked ? <Note tone="ok" icon="check" title={t('account.settings.oldNumber.blockedTitle')} detail={t('account.settings.oldNumber.blocked')} /> : null}
          {payoutSaved ? <Note tone="ok" icon="check" {...payoutSavedSays(payoutSaved, t as never, when)} /> : null}
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
      {view === 'contract' ? <ContractCompany api={api} /> : null}
      {view === 'payout' ? <PayoutForm api={api} onDone={(saved) => { setPayoutSaved(saved); setView('list'); }} /> : null}
      {view === 'devices' ? <DevicesForm devices={devices ?? api.devices} onSignedOut={() => { onClose(); onSignOut(); }} /> : null}
      {view === 'old-number' ? <OldNumberForm api={api} onDone={() => { setBlocked(true); setView('list'); }} /> : null}
      {view === 'mute' ? <MuteForm api={api} onDone={() => setView('list')} /> : null}
      {view === 'close' ? <CloseForm api={api} onClosed={() => setView('closed')} /> : null}
      {view === 'closed' ? (
        <>
          <Note tone="ok" icon="check" title={t('account.close.doneTitle')} detail={t('account.close.doneBody')} />
          <Button chevron={false} onClick={close}>
            {t('account.close.ok')}
          </Button>
        </>
      ) : null}
      {view === 'id' && idRef ? <IdDisputeCase api={api.idDispute} reference={idRef} ownId={api.ownId} onChanged={() => void api.reload()} /> : null}
      {view === 'phone-done' ? (
        <>
          <Note tone="ok" icon="check" title={t('account.settings.phoneDoneTitle')} detail={t('account.settings.phoneDone')} />
          <Button chevron={false} onClick={close}>
            {t('account.settings.signInAgain')}
          </Button>
        </>
      ) : null}

      {view === 'phone-done' || view === 'closed' ? null : (
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
        <CodeBoxes id="acct-pin-current" label={t('account.menu.currentPin')} length={PIN_LENGTH} value={current} onInput={setCurrent} disabled={busy} mask />
      </div>
      <div class="field">
        <span class="field__label">{t('account.menu.newPin')}</span>
        <CodeBoxes id="acct-pin-new" label={t('account.menu.newPin')} length={PIN_LENGTH} value={next} onInput={setNext} disabled={busy} />
        <PinGuessHint pin={next} />
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

/**
 * THE PHONES AND BROWSERS THE PIN WORKS ON. Read when it is opened — it is a live fact, and another phone may have
 * been confirmed a minute ago. Two things can be done, each said in full before it is done, because both end with
 * the person signed out: forget all the others (the PIN again — a phone left unlocked is not its owner), or sign out
 * of this one and forget it (no PIN: it only takes something away from whoever is holding it).
 */
function DevicesForm({ devices, onSignedOut }: { devices: PinDevicesApi; onSignedOut: () => void }) {
  const t = useT();
  const byPassword = devices.secret === 'password';
  // Whose phones: the shop's, the hub's or the store's — said in every sentence about them.
  const party = t(PARTY_WORD[devices.party ?? 'shop']);
  const [seen, setSeen] = useState<PinDevices | null>(null);
  const [step, setStep] = useState<'list' | 'others' | 'this'>('list');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await devices.read();
      if (r.error || !r.data) return setUnread(true);
      setSeen(r.data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
  const done = async (doing: Promise<{ error?: SbgError | null }>) => {
    setBusy(true);
    setError(null);
    const r = await doing;
    setBusy(false);
    if (r.error) return setError(r.error);
    onSignedOut();
  };

  if (!seen) return unread ? <Note tone="warn" icon="warning" title={t('account.devices.unread')} /> : <p class="t-body">{t('common.loading')}</p>;

  if (step === 'others') {
    return (
      <>
        <p class="t-body">{t(byPassword ? 'account.shopDevices.forgetOthersBody' : 'account.devices.forgetOthersBody', { party })}</p>
        {byPassword ? (
          <div class="field">
            <label class="field__label" for="acct-devices-password">
              {t('account.shopDevices.passwordToConfirm', { party })}
            </label>
            <input id="acct-devices-password" class="input" type="password" autocomplete="current-password" value={pin} disabled={busy} onInput={(e) => { setPin(e.currentTarget.value); setError(null); }} />
          </div>
        ) : (
          <div class="field">
            <span class="field__label">{t('account.settings.pinToConfirm')}</span>
            <CodeBoxes id="acct-devices-pin" label={t('account.settings.pinToConfirm')} length={PIN_LENGTH} value={pin} onInput={(v) => { setPin(v); setError(null); }} disabled={busy} mask />
          </div>
        )}
        <Refused error={error} />
        <Button chevron={false} busy={busy} disabled={byPassword ? !pin : pin.length !== PIN_LENGTH} onClick={() => void done(devices.forgetOthers(pin))}>
          {t('account.devices.forgetOthersSave')}
        </Button>
        <Button variant="link" full={false} onClick={() => { setStep('list'); setPin(''); setError(null); }}>
          {t('common.cancel')}
        </Button>
      </>
    );
  }

  if (step === 'this') {
    return (
      <>
        <p class="t-body">{t(byPassword ? 'account.shopDevices.forgetThisBody' : 'account.devices.forgetThisBody', { party })}</p>
        <Refused error={error} />
        <Button chevron={false} busy={busy} onClick={() => void done(devices.forgetThis())}>
          {t('account.devices.forgetThisSave')}
        </Button>
        <Button variant="link" full={false} onClick={() => { setStep('list'); setError(null); }}>
          {t('common.cancel')}
        </Button>
      </>
    );
  }

  return (
    <>
      <p class="t-body">{devicesLede(seen, t as never, byPassword ? (devices.party ?? 'shop') : 'pin')}</p>
      {seen.devices.length ? (
        <div class="rows" role="list">
          {seen.devices.map((d, i) => {
            const line = deviceLine(d, t as never, day);
            return (
              <div class="row row--static" role="listitem" key={i}>
                <span class="row__ic">
                  <Icon name={d.here ? 'check' : 'phone'} size={22} />
                </span>
                <span class="row__body">
                  <span class="row__t">{line.title}</span>
                  <span class="row__s">{line.sub}</span>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      {/* Signed in here by something other than a PIN on a confirmed device: said, so the list is not misread. */}
      {seen.count > 0 && !seen.here ? <Note tone="info" icon="info" title={t('account.devices.notHere')} /> : null}
      {canForgetOthers(seen) ? (
        <Button variant="outline" chevron={false} onClick={() => setStep('others')}>
          {t('account.devices.forgetOthers')}
        </Button>
      ) : null}
      {seen.here ? (
        <Button variant="outline" chevron={false} onClick={() => setStep('this')}>
          {t('account.devices.forgetThis')}
        </Button>
      ) : null}
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
        <CodeBoxes id="acct-email-pin" label={t('account.settings.pinToConfirm')} length={PIN_LENGTH} value={pin} onInput={(v) => { setPin(v); setError(null); }} disabled={busy} mask />
      </div>
      <Refused error={error} />
      <Button chevron={false} busy={busy} disabled={!email.trim() || code.length !== 6 || pin.length !== PIN_LENGTH} onClick={() => void save()}>
        {t('account.settings.emailSave')}
      </Button>
    </>
  );
}

/**
 * Moving the account to a new number: a code to the NEW number proves the person holds it, the PIN proves they
 * are who is signed in. What it costs is said first — signed out everywhere — and so is the way back.
 */
/**
 * BLOCK MY OLD NUMBER. What it gives up is said before the PIN is asked: from that moment a parcel sent to the old
 * number is no longer theirs. The PIN, as for everything else here — a phone left unlocked is not its owner.
 */
function OldNumberForm({ api, onDone }: { api: AccountApi; onDone: () => void }) {
  const t = useT();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);

  const block = async () => {
    setBusy(true);
    setError(null);
    const r = await api.blockOldNumber(pin);
    setBusy(false);
    if (r.error) return setError(r.error);
    onDone();
  };

  return (
    <>
      <p class="t-body">{t('account.settings.oldNumber.blockBody')}</p>
      <div class="field">
        <span class="field__label">{t('account.settings.pinToConfirm')}</span>
        <CodeBoxes id="acct-old-pin" label={t('account.settings.pinToConfirm')} length={PIN_LENGTH} value={pin} onInput={(v) => { setPin(v); setError(null); }} disabled={busy} mask />
      </div>
      <Refused error={error} />
      <Button chevron={false} busy={busy} disabled={pin.length !== PIN_LENGTH} onClick={() => void block()}>
        {t('account.settings.oldNumber.blockSave')}
      </Button>
    </>
  );
}

/**
 * MUTE MY ACCOUNT — what it does said before it is done, in full, because it reaches every role the person owns: their
 * shop, their driving, their fleet, their store. Nothing is deleted and it is undone here, so it asks for no PIN.
 */
function MuteForm({ api, onDone }: { api: AccountApi; onDone: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const muted = Boolean(api.account?.mutedAt);

  const go = async () => {
    setBusy(true);
    setError(null);
    const r = await api.setMuted(!muted);
    setBusy(false);
    if (r.error) return setError(r.error);
    onDone();
  };

  return (
    <>
      {muted ? (
        <p class="t-body">{t('account.mute.unmuteBody')}</p>
      ) : (
        <>
          <p class="t-body">{t('account.mute.lede')}</p>
          {/* Plain sentences, one per thing it does: the sheet's own reading style, no tick — none of it is a choice. */}
          {(['account.mute.what1', 'account.mute.what2', 'account.mute.what3', 'account.mute.what4'] as const).map((k) => (
            <p key={k} class="t-body">
              {t(k)}
            </p>
          ))}
        </>
      )}
      <Refused error={error} />
      <Button variant={muted ? 'primary' : 'outline'} chevron={false} busy={busy} onClick={() => void go()}>
        {t(muted ? 'account.mute.unmute' : 'account.mute.go')}
      </Button>
    </>
  );
}

/**
 * CLOSE MY ACCOUNT — what it removes and what stays, said first; then, if anything is still open, each thing in the
 * reader's words and no PIN asked; when nothing is, the PIN and the button. It cannot be undone, so it says so.
 */
function CloseForm({ api, onClosed }: { api: AccountApi; onClosed: () => void }) {
  const t = useT();
  const [standing, setStanding] = useState<ClosingStanding | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);

  useEffect(() => {
    void api.closing().then((r) => {
      if (r.error) setError(r.error);
      else setStanding(r.data ?? { open: [] });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = async () => {
    setBusy(true);
    setError(null);
    const r = await api.closeAccount(pin);
    setBusy(false);
    if (r.error) return setError(r.error);
    onClosed();
  };

  const open = standing?.open ?? [];
  return (
    <>
      <p class="t-body">{t('account.close.lede')}</p>
      {!standing && !error ? <p class="hint">{t('account.close.reading')}</p> : null}
      {standing && open.length ? (
        <>
          <Note tone="warn" icon="warning" title={t('account.close.openTitle')} detail={t('account.close.openLede')} />
          {open.map((o) => (
            <p key={o.kind} class="t-body">
              {t(`account.close.open.${o.kind}` as never, { n: o.count ?? 1 })}
            </p>
          ))}
        </>
      ) : null}
      {standing && !open.length ? (
        <>
          <div class="field">
            <span class="field__label">{t('account.close.pin')}</span>
            <CodeBoxes id="acct-close-pin" label={t('account.close.pin')} length={PIN_LENGTH} value={pin} onInput={(v) => { setPin(v); setError(null); }} disabled={busy} mask />
          </div>
          <Refused error={error} />
          <Button chevron={false} busy={busy} disabled={pin.length !== PIN_LENGTH} onClick={() => void go()}>
            {t('account.close.go')}
          </Button>
        </>
      ) : (
        <Refused error={error} />
      )}
    </>
  );
}

/** The number payouts go to: a code texted to it, then saved. A change pauses payouts for a day (said before it is made). */
function PayoutForm({ api, onDone }: { api: AccountApi; onDone: (saved: PayoutNumberSaved) => void }) {
  const t = useT();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [testCode, setTestCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);

  const send = async () => {
    setBusy(true);
    const r = await api.sendPayoutCode(phone.trim());
    setBusy(false);
    setError(r.error ?? null);
    if (r.error) return;
    setSentTo(r.data?.masked ?? '');
    setCode('');
    setTestCode(r.data?.code ?? '');
  };
  const save = async () => {
    setBusy(true);
    const r = await api.savePayoutNumber(code);
    setBusy(false);
    if (r.error || !r.data) return setError(r.error ?? null);
    onDone(r.data);
  };

  return (
    <>
      <p class="t-body">{t('account.payout.body')}</p>
      {api.payout?.masked ? <p class="t-body">{t('account.payout.change')}</p> : null}
      <div class="field">
        <label class="field__label" for="acct-payout-phone">
          {t('account.payout.numberLabel')}
        </label>
        <PhoneField
          id="acct-payout-phone"
          value={phone}
          onInput={(v) => {
            setPhone(v);
            setSentTo('');
          }}
          disabled={busy}
        />
      </div>
      <Button variant="outline" chevron={false} disabled={busy || !phone.trim()} onClick={() => void send()}>
        {t(sentTo ? 'account.safety.sendAgain' : 'account.safety.sendPhoneCode')}
      </Button>
      {sentTo ? (
        <div class="field">
          <span class="field__label">{t('account.safety.phoneCodeLabel')}</span>
          <CodeBoxes id="acct-payout-code" label={t('account.safety.phoneCodeLabel')} length={6} value={code} onInput={(v) => { setCode(v); setError(null); }} disabled={busy} />
          {testCode ? <p class="hint">{t('account.safety.testCode', { code: testCode })}</p> : null}
        </div>
      ) : null}
      <Refused error={error} />
      <Button chevron={false} busy={busy} disabled={!sentTo || code.length !== 6} onClick={() => void save()}>
        {t('account.payout.save')}
      </Button>
    </>
  );
}

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
      <p class="t-body">{t('account.settings.phoneParcels')}</p>
      <div class="field">
        <label class="field__label" for="acct-new-phone">
          {t('account.settings.phoneNew')}
        </label>
        <PhoneField
          id="acct-new-phone"
          value={phone}
          onInput={(v) => {
            setPhone(v);
            setSent(false);
            setVerified(false);
          }}
          disabled={busy}
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
        <CodeBoxes id="acct-phone-pin" label={t('account.settings.pinToConfirm')} length={PIN_LENGTH} value={pin} onInput={(v) => { setPin(v); setError(null); }} disabled={busy} mask />
      </div>
      <Refused error={error} />
      <Button chevron={false} busy={busy} disabled={!sent || (!verified && code.length !== 6) || pin.length !== PIN_LENGTH} onClick={() => void move()}>
        {t('account.settings.phoneSave')}
      </Button>
    </>
  );
}
