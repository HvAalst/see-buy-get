import { useEffect, useState } from 'preact/hooks';
import type { Result, SbgClient, SbgError } from '../../lib/sbg';
import { formatDate, useLocale, useT } from '../i18n';
import { Button, Icon, Note, Pill, RefusalNote, Sheet } from '../ui';
import { Markdown } from './markdown';
import {
  agreeNow,
  changedSince,
  countriesOf,
  countryNameIn,
  fetchAgreementSets,
  fetchDocument,
  numbersOf,
  readMyAgreement,
  type AgreedVersions,
  type Agreement,
  type AgreementDocument,
  type AgreementHere,
  type MyAgreement,
  type PublishedDocument,
} from './documents';

/** The same versions, whatever order they were listed in. */
function sameVersions(a: AgreedVersions, b: AgreedVersions): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/**
 * WHAT A SIGN-UP AGREES TO, ON THE SCREEN WHERE IT IS MADE (the user, 2026-10-25: "every sign up needs an agreement of
 * terms of use, use of data, storage of data, cookie statement").
 *
 * Each document is a row; tapping it opens its text right there, so nobody leaves the form half filled to read it. One
 * tick agrees to all of them, as they are on screen — the versions sent with the sign-up are the versions shown. With
 * no signal there is nothing to agree to, and the form says so rather than letting the sign-up go without.
 *
 * GENERAL, AND EACH COUNTRY'S OWN: `countries` are the ones the sign-up is in — the phone's, and the one it signs up in —
 * and each one's own documents are shown on top of the general ones. The first is the one the agreement is sent for.
 */
export function AgreementBlock({
  agreed,
  onChange,
  countries = [],
  set: given,
  changed = [],
  had,
  lede = true,
}: {
  agreed: Agreement | null;
  onChange: (agreement: Agreement | null) => void;
  countries?: ReadonlyArray<string | null | undefined>;
  /** Already read by the caller (the sheet that asks again has it): not fetched twice. */
  set?: AgreementDocument[];
  /** Documents with a version since what this person agreed to, by key: marked new. */
  changed?: string[];
  /** What they agreed to before: a document marked new that they never agreed to is new, not a new version. */
  had?: AgreedVersions;
  /** The line about signing up: the sheet that asks again after signing in says its own. */
  lede?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const codes = countriesOf(countries);
  const codesKey = codes.join(',');
  const [set, setSet] = useState<AgreementDocument[] | null>(given ?? null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = (fresh = false) => {
    setFailed(false);
    void fetchAgreementSets(codes, fresh).then((s) => {
      if (s) setSet(s);
      else setFailed(true);
    });
  };
  useEffect(() => {
    if (given) setSet(given);
    else {
      setSet(null);
      load();
    }
  }, [given, codesKey]);
  // A tick stands for the versions it was given on: a different set on screen is not agreed to until ticked again.
  useEffect(() => {
    if (agreed && set && !sameVersions(numbersOf(set), agreed.versions)) onChange(null);
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
          <div key={doc.key} class="agree__item">
            <button type="button" class="row agree__row" aria-expanded={open === doc.key} onClick={() => setOpen(open === doc.key ? null : doc.key)}>
              <span class="row__body">
                <span class="row__t">
                  {doc.title}
                  {changed.includes(doc.key) ? (
                    <>
                      {' '}
                      <Pill tone="warn">{t(had && !had[doc.key] ? 'agreement.newDocument' : 'agreement.newVersion')}</Pill>
                    </>
                  ) : null}
                </span>
                <span class="row__s">{doc.country ? t('agreement.aboutCountry', { country: countryNameIn(doc.country, locale) }) : t(`agreement.about.${doc.kind}` as const)}</span>
              </span>
              <span class="row__end">
                {t(open === doc.key ? 'agreement.hide' : 'agreement.read')}
                <Icon name={open === doc.key ? 'chevronUp' : 'chevronDown'} size={18} />
              </span>
            </button>
            {open === doc.key ? <DocumentText doc={doc} showChange={changed.includes(doc.key)} /> : null}
          </div>
        ))}
      </div>
      <label class="agree__tick">
        <input type="checkbox" checked={Boolean(agreed)} onChange={(e) => onChange(e.currentTarget.checked ? { versions: numbersOf(set), ...(codes[0] ? { country: codes[0] } : {}) } : null)} />
        <span>{t('agreement.tick')}</span>
      </label>
    </div>
  );
}

/** One document's current text, opened under its row: its version and date, and — when it is new to them — what changed. */
function DocumentText({ doc: line, showChange }: { doc: AgreementDocument; showChange: boolean }) {
  const t = useT();
  const [doc, setDoc] = useState<PublishedDocument | null | 'failed'>(null);
  useEffect(() => {
    let live = true;
    void fetchDocument(line.kind, undefined, line.country).then((d) => {
      if (live) setDoc(d ?? 'failed');
    });
    return () => {
      live = false;
    };
  }, [line.key]);
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
 * A SIGN-UP MADE UNDER SOMEBODY SIGNED IN, IN A COUNTRY — a fleet, a business. What they agreed to counts where it
 * covers what that country asks; where it does not (that country has documents of its own they have not read, or a
 * version since asks again), it is asked here, before the sign-up is sent. `value` is null until that is settled:
 * `covered` when nothing is asked, the agreement once ticked.
 */
export function AgreementCheck({
  read,
  country,
  value,
  onChange,
}: {
  /** Where the person signed in stands for a country: GET agreement/mine?country=, under their sign-in. */
  read: (country: string) => Promise<Result<MyAgreement>>;
  country: string;
  value: AgreementHere;
  onChange: (value: AgreementHere) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const code = countriesOf([country])[0] ?? '';
  const [mine, setMine] = useState<MyAgreement | 'failed' | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let live = true;
    setMine(null);
    if (!code) return;
    onChange(null);
    void read(code).then((r) => {
      if (!live) return;
      if (r.error || !r.data) {
        setMine('failed');
        return;
      }
      setMine(r.data);
      if (!r.data.needed) onChange('covered');
    });
    return () => {
      live = false;
    };
  }, [code, tries]);

  if (!code) return null;
  if (mine === null) return <p class="hint">{t('agreement.loading')}</p>;
  if (mine === 'failed') {
    return (
      <div class="agree">
        <Note tone="warn" icon="offline" title={t('agreement.unavailable')} />
        <Button variant="link" full={false} onClick={() => setTries((n) => n + 1)}>
          {t('agreement.retry')}
        </Button>
      </div>
    );
  }
  if (!mine.needed) return null;
  return (
    <div class="agree">
      <p class="agree__lede">{t('agreement.check.lede', { country: countryNameIn(code, locale) })}</p>
      <AgreementBlock
        agreed={value && value !== 'covered' ? value : null}
        onChange={(a) => onChange(a ? { ...a, country: code } : null)}
        set={mine.documents}
        countries={[code]}
        changed={changedSince(mine.documents, mine.agreed)}
        had={mine.agreed}
        lede={false}
      />
    </div>
  );
}

/**
 * ASKED AFTER SIGNING IN — somebody another person signed up (a fleet's driver, a counter colleague), anybody when a
 * version published since asks everybody to agree again, and everybody in a country that publishes documents of its
 * own. Nothing goes on until they agree; signing out is the way out. Shown by every app, over whatever it is showing,
 * and only when the server says so.
 */
/** How often an app brought back to the front asks again whether something new must be agreed to. */
const RECHECK_MS = 5 * 60_000;

export function AgreementGate({ sbg, onSignOut }: { sbg: SbgClient | null; onSignOut?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [mine, setMine] = useState<MyAgreement | null>(null);
  const [agreed, setAgreed] = useState<Agreement | null>(null);
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
    let askedAt = 0;
    const ask = () => {
      if (!sbg) return;
      askedAt = Date.now();
      void readMyAgreement(sbg).then((r) => {
        if (live && !r.error && r.data) setMine(r.data);
      });
    };
    ask();
    // An app left open is "opened" again when it comes back to the front: a version published meanwhile is asked
    // then, as its notice in the bell says — at most every few minutes, not on every glance back.
    const back = () => {
      if (globalThis.document?.visibilityState === 'visible' && Date.now() - askedAt > RECHECK_MS) ask();
    };
    globalThis.document?.addEventListener('visibilitychange', back);
    return () => {
      live = false;
      globalThis.document?.removeEventListener('visibilitychange', back);
    };
  }, [sbg]);

  if (!sbg || !mine?.needed) return null;
  const changed = changedSince(mine.documents, mine.agreed);
  // A country's own, never agreed to before: not "a new version" of something they agreed to.
  const countryFirst = mine.agreed ? mine.documents.find((d) => d.country && changed.includes(d.key) && !mine.agreed?.[d.key]) : undefined;
  const lede = countryFirst?.country
    ? t('agreement.gate.country', { country: countryNameIn(countryFirst.country, locale) })
    : t(mine.agreed ? 'agreement.gate.changed' : 'agreement.gate.first');

  return (
    <Sheet open title={t('agreement.gate.title')} onClose={() => undefined} dismissible={false}>
      <p class="agree__lede">{lede}</p>
      <AgreementBlock agreed={agreed} onChange={setAgreed} set={mine.documents} countries={[mine.country]} changed={changed} had={mine.agreed} lede={false} />
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
