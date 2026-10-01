import { useState } from 'preact/hooks';
import { Button, CodeBoxes, Note, RefusalNote, Sheet } from '../ui';
import { useT } from '../i18n';
import type { SbgError } from '../../lib/sbg';
import { EmailStep } from './EmailStep';
import { asksForNationalId, type RecoveryApi } from './recovery';

type Mode = 'choose' | 'gone' | 'undo' | 'done-gone' | 'done-undo';

/**
 * "TROUBLE SIGNING IN?" — on every sign-in screen, the same sheet.
 *
 * A forgotten PIN is not here: the sign-in screen already sends a code to the number. This is for the two cases a
 * code to the number cannot solve.
 *
 *  - THE NUMBER IS GONE (given up, deregistered, handed to somebody else) and the PIN forgotten. The inbox is the
 *    way back: a code to the account's email, the national ID number where the account has one, a new number
 *    confirmed by its own code, a new PIN.
 *  - SOMEBODY MOVED THE ACCOUNT TO THEIR NUMBER. For 24 hours it can be put back — with the old number and the PIN
 *    as it was, or with a code to the email.
 *
 * Somebody who still knows their PIN and only wants a new number is told where that is: signed in, in the menu.
 */
export function TroubleSheet({ open, onClose, api }: { open: boolean; onClose: () => void; api: RecoveryApi }) {
  const t = useT();
  const [mode, setMode] = useState<Mode>('choose');
  const close = () => {
    setMode('choose');
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={t('account.trouble.title')}>
      {mode === 'choose' ? (
        <>
          <p class="t-body">{t('account.trouble.lede')}</p>
          <div class="rows" role="list">
            <button type="button" class="row" role="listitem" onClick={() => setMode('gone')}>
              <span class="row__body">
                <span class="row__t">{t('account.trouble.gone')}</span>
                <span class="row__s">{t('account.trouble.goneSub')}</span>
              </span>
            </button>
            <button type="button" class="row" role="listitem" onClick={() => setMode('undo')}>
              <span class="row__body">
                <span class="row__t">{t('account.trouble.undo')}</span>
                <span class="row__s">{t('account.trouble.undoSub')}</span>
              </span>
            </button>
          </div>
          <Note tone="info" icon="info" title={t('account.trouble.knowPinTitle')} detail={t('account.trouble.knowPin')} />
        </>
      ) : null}
      {mode === 'gone' ? <Gone api={api} onDone={() => setMode('done-gone')} /> : null}
      {mode === 'undo' ? <Undo api={api} onDone={() => setMode('done-undo')} /> : null}
      {mode === 'done-gone' ? <Note tone="ok" icon="check" title={t('account.trouble.goneDoneTitle')} detail={t('account.trouble.goneDone')} /> : null}
      {mode === 'done-undo' ? <Note tone="ok" icon="check" title={t('account.trouble.undoDoneTitle')} detail={t('account.trouble.undoDone')} /> : null}
      <Button variant="link" onClick={mode === 'gone' || mode === 'undo' ? () => setMode('choose') : close}>
        {t(mode === 'gone' || mode === 'undo' ? 'common.back' : 'account.trouble.close')}
      </Button>
    </Sheet>
  );
}

/** The number is gone and the PIN forgotten: the inbox, the ID where there is one, a new number, a new PIN. */
function Gone({ api, onDone }: { api: RecoveryApi; onDone: () => void }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneSent, setPhoneSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [testPhoneCode, setTestPhoneCode] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  // Asked only once the server says this account has one on record — somebody who only sends parcels gave us none.
  const [wantsId, setWantsId] = useState(false);

  const sendPhone = async () => {
    setBusy(true);
    const r = await api.phoneCode(phone.trim());
    setBusy(false);
    setError(r.error ?? null);
    if (r.error) return;
    setPhoneSent(true);
    setPhoneVerified(false);
    setPhoneCode('');
    setTestPhoneCode(r.data?.code ?? '');
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    if (!phoneVerified) {
      const v = await api.verifyPhone(phone.trim(), phoneCode);
      if (v.error) {
        setBusy(false);
        return setError(v.error);
      }
      setPhoneVerified(true);
    }
    const r = await api.recover({ email: email.trim(), code, ...(nationalId.trim() ? { nationalId: nationalId.trim() } : {}), newPhone: phone.trim(), pin });
    setBusy(false);
    if (r.error) {
      if (asksForNationalId(r.error)) setWantsId(true);
      return setError(r.error);
    }
    onDone();
  };

  const ready = email.trim() && code.length === 6 && phone.trim() && (phoneVerified || phoneCode.length === 6) && pin.length === 4 && (!wantsId || nationalId.trim());

  return (
    <>
      <p class="t-body">{t('account.trouble.goneLede')}</p>
      <EmailStep id="gone" email={email} code={code} onEmail={setEmail} onCode={setCode} send={(e) => api.accountCode(e, 'recover')} disabled={busy} label={t('account.trouble.accountEmail')} />
      {wantsId ? (
        <div class="field">
          <label class="field__label" for="gone-id">
            {t('account.trouble.nationalId')}
          </label>
          <input id="gone-id" class="input input--mono" value={nationalId} onInput={(e) => setNationalId(e.currentTarget.value)} spellcheck={false} disabled={busy} />
          <p class="hint">{t('account.trouble.nationalIdHint')}</p>
        </div>
      ) : null}
      <div class="field">
        <label class="field__label" for="gone-phone">
          {t('account.trouble.newPhone')}
        </label>
        <input
          id="gone-phone"
          class="input"
          type="tel"
          inputMode="tel"
          value={phone}
          disabled={busy}
          onInput={(e) => {
            setPhone(e.currentTarget.value);
            setPhoneSent(false);
            setPhoneVerified(false);
          }}
          placeholder="+2547…"
        />
      </div>
      <Button variant="outline" chevron={false} disabled={busy || !phone.trim()} onClick={() => void sendPhone()}>
        {t(phoneSent ? 'account.safety.sendAgain' : 'account.safety.sendPhoneCode')}
      </Button>
      {phoneSent ? (
        <div class="field">
          <span class="field__label">{t('account.safety.phoneCodeLabel')}</span>
          <CodeBoxes id="gone-phone-code" label={t('account.safety.phoneCodeLabel')} length={6} value={phoneCode} onInput={setPhoneCode} disabled={busy || phoneVerified} />
          {testPhoneCode ? <p class="hint">{t('account.safety.testCode', { code: testPhoneCode })}</p> : null}
        </div>
      ) : null}
      <div class="field">
        <span class="field__label">{t('account.trouble.newPin')}</span>
        <CodeBoxes id="gone-pin" label={t('account.trouble.newPin')} length={4} value={pin} onInput={setPin} disabled={busy} />
      </div>
      {error ? <RefusalNote error={error} /> : null}
      <Button chevron={false} disabled={!ready} busy={busy} onClick={() => void submit()}>
        {t('account.trouble.goneCta')}
      </Button>
    </>
  );
}

/** Put a moved account back: the old number and the PIN as it was, or a code to the account's email. */
function Undo({ api, onDone }: { api: RecoveryApi; onDone: () => void }) {
  const t = useT();
  const [by, setBy] = useState<'number' | 'email'>('number');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);

  const submit = async () => {
    setBusy(true);
    const r = await api.undo(by === 'number' ? { phone: phone.trim(), pin } : { email: email.trim(), code });
    setBusy(false);
    setError(r.error ?? null);
    if (!r.error) onDone();
  };
  const ready = by === 'number' ? phone.trim() && pin.length === 4 : email.trim() && code.length === 6;

  return (
    <>
      <p class="t-body">{t('account.trouble.undoLede')}</p>
      <div class="chips" role="group">
        <button type="button" class={`chip chip--tap${by === 'number' ? ' chip--on' : ''}`} aria-pressed={by === 'number'} onClick={() => setBy('number')}>
          {t('account.trouble.undoByNumber')}
        </button>
        <button type="button" class={`chip chip--tap${by === 'email' ? ' chip--on' : ''}`} aria-pressed={by === 'email'} onClick={() => setBy('email')}>
          {t('account.trouble.undoByEmail')}
        </button>
      </div>
      {by === 'number' ? (
        <>
          <div class="field">
            <label class="field__label" for="undo-phone">
              {t('account.trouble.oldPhone')}
            </label>
            <input id="undo-phone" class="input" type="tel" inputMode="tel" value={phone} onInput={(e) => setPhone(e.currentTarget.value)} placeholder="+2547…" disabled={busy} />
          </div>
          <div class="field">
            <span class="field__label">{t('account.trouble.oldPin')}</span>
            <CodeBoxes id="undo-pin" label={t('account.trouble.oldPin')} length={4} value={pin} onInput={setPin} disabled={busy} mask />
          </div>
        </>
      ) : (
        <EmailStep id="undo" email={email} code={code} onEmail={setEmail} onCode={setCode} send={(e) => api.accountCode(e, 'undo')} disabled={busy} label={t('account.trouble.accountEmail')} />
      )}
      {error ? <RefusalNote error={error} /> : null}
      <Button chevron={false} disabled={!ready} busy={busy} onClick={() => void submit()}>
        {t('account.trouble.undoCta')}
      </Button>
    </>
  );
}
