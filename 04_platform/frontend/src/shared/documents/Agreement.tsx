import { useEffect, useState } from 'preact/hooks';
import type { SbgClient, SbgError } from '../../lib/sbg';
import { formatDate, useT } from '../i18n';
import { Button, Icon, Note, Pill, RefusalNote, Sheet } from '../ui';
import { Markdown } from './markdown';
import {
  agreeNow,
  changedSince,
  fetchAgreementSet,
  fetchDocument,
  numbersOf,
  readMyAgreement,
  type AgreementDocument,
  type AgreementNumbers,
  type DocumentKind,
  type MyAgreement,
  type PublishedDocument,
} from './documents';

/**
 * WHAT A SIGN-UP AGREES TO, ON THE SCREEN WHERE IT IS MADE (the user, 2026-10-25: "every sign up needs an agreement of
 * terms of use, use of data, storage of data, cookie statement").
 *
 * Each document is a row; tapping it opens its text right there, so nobody leaves the form half filled to read it. One
 * tick agrees to all of them, as they are on screen — the versions sent with the sign-up are the versions shown. With
 * no signal there is nothing to agree to, and the form says so rather than letting the sign-up go without.
 */
export function AgreementBlock({
  agreed,
  onChange,
  set: given,
  changed = [],
  lede = true,
}: {
  agreed: AgreementNumbers | null;
  onChange: (numbers: AgreementNumbers | null) => void;
  /** Already read by the caller (the sheet that asks again has it): not fetched twice. */
  set?: AgreementDocument[];
  /** Documents with a version since what this person agreed to: marked new. */
  changed?: DocumentKind[];
  /** The line about signing up: the sheet that asks again after signing in says its own. */
  lede?: boolean;
}) {
  const t = useT();
  const [set, setSet] = useState<AgreementDocument[] | null>(given ?? null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<DocumentKind | null>(null);

  const load = (fresh = false) => {
    setFailed(false);
    void fetchAgreementSet(fresh).then((s) => {
      if (s) setSet(s);
      else setFailed(true);
    });
  };
  useEffect(() => {
    if (given) setSet(given);
    else load();
  }, [given]);
  // A tick stands for the versions it was given on: a newer set on screen is not agreed to until ticked again.
  useEffect(() => {
    if (agreed && set && JSON.stringify(numbersOf(set)) !== JSON.stringify(agreed)) onChange(null);
  }, [set]);

  if (!set) {
    return failed ? (
      <div class="agree">
        <Note tone="warn" icon="offline" title={t('agreement.unavailable')} />
        <Button variant="link" full={false} onClick={() => load(true)}>
          {t('agreement.retry')}
        </Button>
      </div>
    ) : (
      <p class="hint">{t('agreement.loading')}</p>
    );
  }

  return (
    <div class="agree">
      {lede ? <p class="agree__lede">{t('agreement.lede')}</p> : null}
      <div class="agree__docs">
        {set.map((doc) => (
          <div key={doc.kind} class="agree__item">
            <button type="button" class="row agree__row" aria-expanded={open === doc.kind} onClick={() => setOpen(open === doc.kind ? null : doc.kind)}>
              <span class="row__body">
                <span class="row__t">
                  {doc.title}
                  {changed.includes(doc.kind) ? (
                    <>
                      {' '}
                      <Pill tone="warn">{t('agreement.newVersion')}</Pill>
                    </>
                  ) : null}
                </span>
                <span class="row__s">{t(`agreement.about.${doc.kind}` as const)}</span>
              </span>
              <span class="row__end">
                {t(open === doc.kind ? 'agreement.hide' : 'agreement.read')}
                <Icon name={open === doc.kind ? 'chevronUp' : 'chevronDown'} size={18} />
              </span>
            </button>
            {open === doc.kind ? <DocumentText kind={doc.kind} showChange={changed.includes(doc.kind)} /> : null}
          </div>
        ))}
      </div>
      <label class="agree__tick">
        <input type="checkbox" checked={Boolean(agreed)} onChange={(e) => onChange(e.currentTarget.checked ? numbersOf(set) : null)} />
        <span>{t('agreement.tick')}</span>
      </label>
    </div>
  );
}

/** One document's current text, opened under its row: its version and date, and — when it is new to them — what changed. */
function DocumentText({ kind, showChange }: { kind: DocumentKind; showChange: boolean }) {
  const t = useT();
  const [doc, setDoc] = useState<PublishedDocument | null | 'failed'>(null);
  useEffect(() => {
    let live = true;
    void fetchDocument(kind).then((d) => {
      if (live) setDoc(d ?? 'failed');
    });
    return () => {
      live = false;
    };
  }, [kind]);
  if (doc === null) return <p class="hint agree__text">{t('agreement.loading')}</p>;
  if (doc === 'failed') return <p class="hint agree__text">{t('agreement.unavailable')}</p>;
  return (
    <div class="agree__text" tabIndex={0}>
      <p class="agree__version">{t('agreement.version', { number: doc.number, date: formatDate(doc.publishedAt) })}</p>
      {showChange ? <p class="agree__change">{t('agreement.changed', { note: doc.changeNote })}</p> : null}
      <Markdown text={doc.body} headingLevel={3} />
    </div>
  );
}

/**
 * ASKED AFTER SIGNING IN — somebody another person signed up (a fleet's driver, a counter colleague), or anybody when a
 * version published since asks everybody to agree again. Nothing goes on until they agree; signing out is the way out.
 * Shown by every app, over whatever it is showing, and only when the server says so.
 */
export function AgreementGate({ sbg, onSignOut }: { sbg: SbgClient | null; onSignOut?: () => void }) {
  const t = useT();
  const [mine, setMine] = useState<MyAgreement | null>(null);
  const [agreed, setAgreed] = useState<AgreementNumbers | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<SbgError | null>(null);

  const read = () => {
    if (!sbg) return;
    void readMyAgreement(sbg).then((r) => {
      if (!r.error && r.data) setMine(r.data);
    });
  };
  useEffect(() => {
    let live = true;
    if (sbg) {
      void readMyAgreement(sbg).then((r) => {
        if (live && !r.error && r.data) setMine(r.data);
      });
    }
    return () => {
      live = false;
    };
  }, [sbg]);

  if (!sbg || !mine?.needed) return null;
  const changed = changedSince(mine.documents, mine.agreed);

  return (
    <Sheet open title={t('agreement.gate.title')} onClose={() => undefined} dismissible={false}>
      <p class="agree__lede">{t(mine.agreed ? 'agreement.gate.changed' : 'agreement.gate.first')}</p>
      <AgreementBlock agreed={agreed} onChange={setAgreed} set={mine.documents} changed={changed} lede={false} />
      {refused ? <RefusalNote error={refused} /> : null}
      <div class="agree__go">
        <Button
          disabled={!agreed}
          busy={busy}
          onClick={async () => {
            if (!agreed) return;
            setBusy(true);
            setRefused(null);
            const r = await agreeNow(sbg, agreed);
            setBusy(false);
            if (r.error) {
              // A version published while they read: the new one is shown, and agreed to afresh.
              setRefused(r.error);
              setAgreed(null);
              read();
              return;
            }
            if (r.data) setMine(r.data);
          }}
        >
          {t('agreement.gate.agree')}
        </Button>
        {onSignOut ? (
          <Button variant="link" full={false} onClick={onSignOut}>
            {t('agreement.gate.signOut')}
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}
