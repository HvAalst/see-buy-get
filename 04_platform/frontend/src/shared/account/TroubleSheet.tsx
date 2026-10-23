import { useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Button, CodeBoxes, CodeCard, Note, RefusalNote, Sheet } from '../ui';
import { useT } from '../i18n';
import type { SbgError } from '../../lib/sbg';
import { EmailStep } from './EmailStep';
import { IdDisputeCase } from './IdDisputeCase';
import { IdDisputeOpen } from './IdDisputeOpen';
import { looksLikeIdReference } from './idDispute';
import { looksLikeReference, moveStatusSays, supportLines, type MoveAsked, type MoveStatus } from './move';
import { PIN_LENGTH } from './pin';
import { asksForNationalId, type RecoveryApi } from './recovery';
import { articlesFor, type GuideApp, type GuideArticle } from '../guide/articles';
import { frontDoorUrl } from '../ui/AllAppsLink';
import { GuideArticles } from '../guide/GuideArticles';

/** The articles about getting in — signing in, the PIN or the password, getting back in — out of an app's help. */
export function signInArticles(app: GuideApp): GuideArticle[] {
  return articlesFor(app).filter((a) => a.id.endsWith('-sign-in') || SIGN_IN_ARTICLES.includes(a.id));
}
const SIGN_IN_ARTICLES = ['which-sign-in', 'account-recovery', 'change-pin', 'change-password'];

/**
 * THE ONE HELP LINK ON A SIGN-IN SCREEN (the user, 2026-10-23). "Trouble signing in?" opens one sheet: the ways back
 * into a phone-and-PIN account where the door has them (`api`), how signing in to this app works, and writing to us.
 * `buttonClass` lets the console draw it in its own buttons.
 */
export function SignInHelp({ app, api, articles, buttonClass = 'btn btn--link' }: { app: GuideApp; api?: RecoveryApi; articles?: GuideArticle[]; buttonClass?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const sheet = <TroubleSheet open={open} onClose={() => setOpen(false)} api={api} app={app} articles={articles} />;
  return (
    <>
      <button type="button" class={buttonClass} onClick={() => setOpen(true)}>
        {t('account.trouble.link')}
      </button>
      {/* Into the page, not beside the button: on most screens the button sits inside the sign-in form, and Enter in
          one of the sheet's fields would submit the sign-in behind it. */}
      {typeof document === 'undefined' ? sheet : createPortal(sheet, document.body)}
    </>
  );
}

type Mode = 'choose' | 'gone' | 'undo' | 'staff' | 'id' | 'status' | 'done-gone' | 'done-undo';

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
 *  - NO NUMBER, NO PIN AND NO INBOX THEY CAN READ. Nothing they hold opens the account, so two members of staff
 *    move it — after checking who is asking. Here they confirm the new number, are handed a reference to give to
 *    staff, and are told who to speak to. And here they come back, with the reference, to read what became of it:
 *    nothing we send can reach them.
 *
 *  - THEY COULD NOT REGISTER AT ALL: somebody else holds their national ID. They open a dispute, send three
 *    photographs of themselves with their card, and come back with the reference — as above, and for the same
 *    reason: they may have no account for anything to be sent to.
 *
 * Somebody who still knows their PIN and only wants a new number is told where that is: signed in, in the menu.
 */
export function TroubleSheet({
  open,
  onClose,
  api,
  app,
  articles,
}: {
  open: boolean;
  onClose: () => void;
  /** The ways back into a phone-and-PIN account. Absent on a door that signs in with an email and a password. */
  api?: RecoveryApi;
  /** Whose sign-in help to show below them: this app's articles about signing in. */
  app?: GuideApp;
  /** The console's own articles, which no other app imports. */
  articles?: GuideArticle[];
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>('choose');
  const close = () => {
    setMode('choose');
    onClose();
  };
  const reading = articles ?? (app ? signInArticles(app) : []);

  return (
    <Sheet open={open} onClose={close} title={t('account.trouble.title')}>
      {mode === 'choose' && api ? (
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
            <button type="button" class="row" role="listitem" onClick={() => setMode('staff')}>
              <span class="row__body">
                <span class="row__t">{t('account.trouble.staff')}</span>
                <span class="row__s">{t('account.trouble.staffSub')}</span>
              </span>
            </button>
            <button type="button" class="row" role="listitem" onClick={() => setMode('id')}>
              <span class="row__body">
                <span class="row__t">{t('account.trouble.id')}</span>
                <span class="row__s">{t('account.trouble.idSub')}</span>
              </span>
            </button>
            <button type="button" class="row" role="listitem" onClick={() => setMode('status')}>
              <span class="row__body">
                <span class="row__t">{t('account.trouble.status')}</span>
                <span class="row__s">{t('account.trouble.statusSub')}</span>
              </span>
            </button>
          </div>
          <Note tone="info" icon="info" title={t('account.trouble.knowPinTitle')} detail={t('account.trouble.knowPin')} />
        </>
      ) : null}
      {/* HOW SIGNING IN WORKS, in the same sheet: it was a second link beside this one ("Need help signing in?") that
          opened a second sheet — the user, 2026-10-23: "a bit redundant right?". One question, one place to answer it. */}
      {/* The same section on every door, under the same heading (the review: two layouts, the browser's own triangles). */}
      {mode === 'choose' && reading.length ? (
        <>
          <h3 class="guide__h">{t('account.trouble.howTitle')}</h3>
          <GuideArticles articles={reading} />
        </>
      ) : null}
      {/* Not the console's: staff have each other. */}
      {mode === 'choose' && app && app !== 'console' ? (
        <p class="guide__more">
          <a class="btn btn--link" href={`${frontDoorUrl()}help/`} target="_blank" rel="noopener">
            {t('help.ui.allHelp')}
          </a>
          <a class="btn btn--link" href={`${frontDoorUrl()}help/contact/?from=${app}`} target="_blank" rel="noopener">
            {t('help.ui.stuckCta')}
          </a>
        </p>
      ) : null}
      {api && mode === 'gone' ? <Gone api={api} onDone={() => setMode('done-gone')} /> : null}
      {api && mode === 'undo' ? <Undo api={api} onDone={() => setMode('done-undo')} /> : null}
      {api && mode === 'staff' ? <AskStaff api={api} /> : null}
      {api && mode === 'id' ? <IdDisputeOpen api={api} /> : null}
      {api && mode === 'status' ? <MoveOutcome api={api} onAskAgain={() => setMode('staff')} /> : null}
      {mode === 'done-gone' ? <Note tone="ok" icon="check" title={t('account.trouble.goneDoneTitle')} detail={t('account.trouble.goneDone')} /> : null}
      {mode === 'done-undo' ? <Note tone="ok" icon="check" title={t('account.trouble.undoDoneTitle')} detail={t('account.trouble.undoDone')} /> : null}
      <Button variant="link" onClick={mode === 'gone' || mode === 'undo' || mode === 'staff' || mode === 'id' || mode === 'status' ? () => setMode('choose') : close}>
        {t(mode === 'gone' || mode === 'undo' || mode === 'staff' || mode === 'id' || mode === 'status' ? 'common.back' : 'account.trouble.close')}
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

  const ready = email.trim() && code.length === 6 && phone.trim() && (phoneVerified || phoneCode.length === 6) && pin.length === PIN_LENGTH && (!wantsId || nationalId.trim());

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
        <CodeBoxes id="gone-pin" label={t('account.trouble.newPin')} length={PIN_LENGTH} value={pin} onInput={setPin} disabled={busy} />
      </div>
      {error ? <RefusalNote error={error} /> : null}
      <Button chevron={false} disabled={!ready} busy={busy} onClick={() => void submit()}>
        {t('account.trouble.goneCta')}
      </Button>
    </>
  );
}

/**
 * NO NUMBER, NO PIN, NO INBOX: ask staff. The new number is confirmed by a code first — it is the one thing the
 * asker can prove here. Then the reference, shown large and said plainly to be written down: it is all they have.
 */
function AskStaff({ api }: { api: RecoveryApi }) {
  const t = useT();
  const [oldPhone, setOldPhone] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneSent, setPhoneSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [testPhoneCode, setTestPhoneCode] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [asked, setAsked] = useState<MoveAsked | null>(null);

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
    const r = await api.askStaff({ oldPhone: oldPhone.trim(), newPhone: phone.trim(), ...(nationalId.trim() ? { nationalId: nationalId.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
    setBusy(false);
    if (r.error || !r.data) return setError(r.error ?? null);
    setAsked(r.data);
  };

  if (asked) {
    return (
      <>
        <Note tone="ok" icon="check" title={t('account.move.askedTitle')} detail={t('account.move.askedDetail', { date: new Date(asked.lapsesAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) })} />
        {/* The card every code somebody has to carry is shown in: large, and it can be heard — it is read down a
            telephone, and it is all they have. */}
        <CodeCard label={t('account.move.reference')} code={asked.reference} sayLabel={t('account.move.hear')} long />
        <Note tone="info" icon="info" title={t('account.move.whoTitle')} detail={supportLines(asked.support, t as never).join(' · ')} />
      </>
    );
  }

  const ready = oldPhone.trim() && phone.trim() && (phoneVerified || phoneCode.length === 6);
  return (
    <>
      <p class="t-body">{t('account.move.lede')}</p>
      <div class="field">
        <label class="field__label" for="staff-old">
          {t('account.move.oldPhone')}
        </label>
        <input id="staff-old" class="input" type="tel" inputMode="tel" value={oldPhone} onInput={(e) => setOldPhone(e.currentTarget.value)} placeholder="+2547…" disabled={busy} />
      </div>
      <div class="field">
        <label class="field__label" for="staff-new">
          {t('account.move.newPhone')}
        </label>
        <input
          id="staff-new"
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
          <CodeBoxes id="staff-phone-code" label={t('account.safety.phoneCodeLabel')} length={6} value={phoneCode} onInput={setPhoneCode} disabled={busy || phoneVerified} />
          {testPhoneCode ? <p class="hint">{t('account.safety.testCode', { code: testPhoneCode })}</p> : null}
        </div>
      ) : null}
      <div class="field">
        <label class="field__label" for="staff-id">
          {t('account.move.nationalId')}
        </label>
        <input id="staff-id" class="input input--mono" value={nationalId} onInput={(e) => setNationalId(e.currentTarget.value)} spellcheck={false} disabled={busy} />
        <p class="hint">{t('account.move.nationalIdHint')}</p>
      </div>
      <div class="field">
        <label class="field__label" for="staff-note">
          {t('account.move.note')}
        </label>
        <input id="staff-note" class="input" maxLength={280} value={note} onInput={(e) => setNote(e.currentTarget.value)} disabled={busy} />
      </div>
      {error ? <RefusalNote error={error} /> : null}
      <Button chevron={false} disabled={!ready} busy={busy} onClick={() => void submit()}>
        {t('account.move.cta')}
      </Button>
    </>
  );
}

/** "I already asked": the reference, and what became of it — with what to do next, since nothing we send reaches them. */
function MoveOutcome({ api, onAskAgain }: { api: RecoveryApi; onAskAgain: () => void }) {
  const t = useT();
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [status, setStatus] = useState<MoveStatus | null>(null);
  const [idRef, setIdRef] = useState<string | null>(null);

  const look = async () => {
    setIdRef(null);
    setStatus(null);
    if (looksLikeIdReference(reference)) return setIdRef(reference.trim());
    setBusy(true);
    const r = await api.moveStatus(reference.trim());
    setBusy(false);
    setError(r.error ?? null);
    if (!r.error && r.data) setStatus(r.data);
  };
  const says = status ? moveStatusSays(status, t as never) : null;

  return (
    <>
      <p class="t-body">{t('account.move.statusLede')}</p>
      <div class="field">
        <label class="field__label" for="move-ref">
          {t('account.move.reference')}
        </label>
        <input id="move-ref" class="input input--mono" value={reference} onInput={(e) => setReference(e.currentTarget.value)} placeholder="MV-XXXX-XXXX · ID-XXXX-XXXX" spellcheck={false} autocapitalize="characters" disabled={busy} />
      </div>
      {error ? <RefusalNote error={error} /> : null}
      <Button chevron={false} disabled={!looksLikeReference(reference) && !looksLikeIdReference(reference)} busy={busy} onClick={() => void look()}>
        {t('account.move.statusCta')}
      </Button>
      {idRef ? <IdDisputeCase key={idRef} api={api.idDispute} reference={idRef} /> : null}
      {says && status ? (
        <>
          <Note tone={says.tone} icon={says.icon} title={says.title} detail={says.lines.join(' ')} />
          {status.state === 'asked' || status.state === 'checked' ? <Note tone="info" icon="info" title={t('account.move.whoTitle')} detail={supportLines(status.support, t as never).join(' · ')} /> : null}
          {says.canAskAgain ? (
            <Button variant="outline" chevron={false} onClick={onAskAgain}>
              {t('account.move.askAgain')}
            </Button>
          ) : null}
        </>
      ) : null}
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
  const ready = by === 'number' ? phone.trim() && pin.length === PIN_LENGTH : email.trim() && code.length === 6;

  return (
    <>
      <p class="t-body">{t('account.trouble.undoLede')}</p>
      <div class="tapset" role="group">
        <button type="button" class={`tapset__btn${by === 'number' ? ' tapset__btn--on' : ''}`} aria-pressed={by === 'number'} onClick={() => setBy('number')}>
          {t('account.trouble.undoByNumber')}
        </button>
        <button type="button" class={`tapset__btn${by === 'email' ? ' tapset__btn--on' : ''}`} aria-pressed={by === 'email'} onClick={() => setBy('email')}>
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
            <CodeBoxes id="undo-pin" label={t('account.trouble.oldPin')} length={PIN_LENGTH} value={pin} onInput={setPin} disabled={busy} mask />
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
