import { BackStep } from '../../../shared/ui/BackStep';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BrandMark, Icon, StepList } from '../../../shared/ui';
import { AgreementCheck } from '../../../shared/documents/Agreement';
import type { AgreementHere } from '../../../shared/documents/documents';
import { useT, type MessageKey } from '../../../shared/i18n';
import { publicRequest } from '../../../lib/sbg';
import { uploadFailureSentence } from '../../../shared/ui/ErrorNote';
import { CountrySelect, useCountryAtlas } from '../../tower/screens/CountrySelect';
import { DOCUMENT_LABEL } from '../../tower/company';
import { businessConfig, type BusinessActivity, type NewBusiness } from '../api';
import { ACTIVITIES, SETUP_BAR, SETUP_PAPER, checkTone, setupBack, setupGaps, setupNext, type SetupStep } from '../logic';
import type { BusinessActions, BusinessState } from '../useBusinessApp';
import { PaperAdded, PaperPicker, type PaperReady } from './PaperPicker';

// The country list is public: somebody setting up a business has no business session yet.
const atlasApi = { countryCatalogue: () => publicRequest(businessConfig(), '/v1/sbg/country-catalogue') };

export const ACTIVITY_LABEL: Record<BusinessActivity, MessageKey> = {
  shipper: 'business.activity.shipper',
  importer: 'business.activity.importer',
  expeditor: 'business.activity.expeditor',
  clearing_agent: 'business.activity.clearing_agent',
  depot: 'business.activity.depot',
  receiver: 'business.activity.receiver',
};
export const ACTIVITY_SUB: Record<BusinessActivity, MessageKey> = {
  shipper: 'business.activity.shipperSub',
  importer: 'business.activity.importerSub',
  expeditor: 'business.activity.expeditorSub',
  clearing_agent: 'business.activity.clearing_agentSub',
  depot: 'business.activity.depotSub',
  receiver: 'business.activity.receiverSub',
};
export const ROLE_LABEL: Record<'owner' | 'booker' | 'finance' | 'viewer', MessageKey> = {
  owner: 'business.role.owner',
  booker: 'business.role.booker',
  finance: 'business.role.finance',
  viewer: 'business.role.viewer',
};
export const CHECK_LABEL: Record<'unverified' | 'asked' | 'checking' | 'verified' | 'refused', MessageKey> = {
  unverified: 'business.check.tag.unverified',
  asked: 'business.check.tag.asked',
  checking: 'business.check.tag.checking',
  verified: 'business.check.tag.verified',
  refused: 'business.check.tag.refused',
};

/**
 * YOUR BUSINESSES — the ones you are in, the ones you are asked to join, and setting a new one up.
 *
 * Shown after signing in whenever there is a choice to make: more than one business and no memory of the last, an
 * invitation waiting (always — an invitation opened over is an invitation unanswered), or none at all yet.
 */
export function ChooseScreen({ state, actions }: { state: BusinessState; actions: BusinessActions }) {
  const t = useT();
  const items = state.memberships ?? [];
  const [making, setMaking] = useState(items.length === 0);
  const error = state.error ? state.error.detail || state.error.title : null;

  return (
    <div class="twr-signin biz-door">
      <div class="twr-signin__card biz-choose">
        <div class="twr-signin__brand">
          <BrandMark size={34} />
          <span class="cons__brandname">{t('business.appTitle')}</span>
        </div>

        {/* Signing a business up is the whole screen, one step at a time (2026-11-02) — and stays so once it is saved,
            for its papers and the ask, until it is done or left for later. */}
        {making || state.settingUp ? (
          <SignUpBusiness state={state} actions={actions} onCancel={items.length ? () => setMaking(false) : undefined} />
        ) : (
          <ChooseList state={state} actions={actions} error={error} onNew={() => setMaking(true)} />
        )}
      </div>
    </div>
  );
}

/** The businesses this person is in, and those they are asked to join — with the way to sign up another. */
function ChooseList({ state, actions, error, onNew }: { state: BusinessState; actions: BusinessActions; error: string | null; onNew: () => void }) {
  const t = useT();
  const items = state.memberships ?? [];
  const invited = items.filter((m) => m.state === 'invited');
  const joined = items.filter((m) => m.state === 'joined');
  return (
    <>
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}

      {invited.length ? (
        <section>
          <h2 class="cons__panelt">{t('business.choose.invitedTitle')}</h2>
          <div class="crows">
            {invited.map((m) => (
              <div class="crow" key={m.memberId}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">{m.name}</span>
                    <span class="ctag ctag--info">{t(ROLE_LABEL[m.role])}</span>
                  </span>
                  <span class="crow__sub">{t('business.choose.invitedBy', { who: m.invitedBy, country: m.country })}</span>
                </span>
                <span class="crow__tail biz-choose__acts">
                  <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={state.busy} onClick={() => void actions.accept(m.memberId)}>
                    {t('business.choose.join')}
                  </button>
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={state.busy} onClick={() => void actions.decline(m.memberId)}>
                    {t('business.choose.decline')}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {joined.length ? (
        <section>
          <h2 class="cons__panelt">{t('business.choose.yoursTitle')}</h2>
          <div class="cdos">
            {joined.map((m) => (
              <button type="button" class="cdo" key={m.memberId} disabled={state.busy} onClick={() => void actions.open(m.entityId)}>
                <span class="cdo__body">
                  <span class="cdo__t">{m.name}</span>
                  <span class="cdo__sub">
                    {t(ROLE_LABEL[m.role])} · {m.country} · <span class={`ctag ctag--${checkTone(m.checked)}`}>{t(CHECK_LABEL[m.checked])}</span>
                  </span>
                </span>
                <Icon name="chevronRight" size={16} class="cdo__go" />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <p class="twr-signin__foot">
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={onNew}>
          {t('business.choose.newLink')}
        </button>
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={actions.signOut}>
          {t('business.signOut')}
        </button>
      </p>
    </>
  );
}

/** Each step's name in the step bar. */
const SETUP_NAME: Record<Exclude<SetupStep, 'done'>, MessageKey> = {
  business: 'business.setup.step.business',
  activities: 'business.setup.step.activities',
  you: 'business.setup.step.you',
  certificate: 'business.setup.step.certificate',
  id: 'business.setup.step.id',
  ask: 'business.setup.step.ask',
};

type PaperKind = 'certificate_of_incorporation' | 'representative_id';
/** The two papers by the names the steps give them — the owner's "registration certificate", and "your ID". */
const PAPER_NAME: Record<PaperKind, MessageKey> = { certificate_of_incorporation: 'business.setup.step.certificate', representative_id: 'business.setup.step.id' };
/** A paper added during this sign-up: its file's name, and the paper as it was sent where it is a picture. */
type Added = Partial<Record<PaperKind, { name: string; preview?: string }>>;

/** Where a sign-up starts — the first step, empty, unless a test draws a later one. */
export interface SetupStart {
  step?: SetupStep;
  form?: NewBusiness;
  added?: Added;
  asked?: boolean;
}

const EMPTY: NewBusiness = { name: '', country: '', registrationNo: '', taxNo: '', activities: [], yourName: '' };

/**
 * SIGNING A BUSINESS UP, ONE STEP PER SCREEN (the owner, 2026-11-02, on a phone: "It says that it works right after it is
 * saved and that SBG staff checks the registration certificate, but there is no image upload (either camera or gallery).
 * Also when it asks for the ID, the steps of registration seem to be a list still but it is not carried to another
 * screen. Can we optimise it still for PWA?").
 *
 * The business, what it does, you: then it is SAVED, leaving "you" — the one place it is created, and only once, so Back
 * from the papers shows what was saved instead of a form that would sign up a second business. It works from that
 * moment. Then the registration certificate and your ID, each by camera or from the phone, sent by the same doors the
 * start screen uses; then the ask for SeeBuyGet's check. Any of the three can wait for the start screen: until the check
 * the business has no public page and is not listed, and the screens say so.
 *
 * The step bar is pinned at the top of the card as the step scrolls, as the front page's sign-up has it under its top bar.
 */
export function SignUpBusiness({ state, actions, onCancel, start }: { state: BusinessState; actions: BusinessActions; onCancel?: () => void; start?: SetupStart }) {
  const t = useT();
  const countries = useCountryAtlas(atlasApi);
  const [step, setStep] = useState<SetupStep>(start?.step ?? 'business');
  const [form, setForm] = useState<NewBusiness>(start?.form ?? EMPTY);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the business's country asks the person to agree to that they have not yet (2026-10-25): settled before it is sent.
  const [agreement, setAgreement] = useState<AgreementHere>(null);
  const [added, setAdded] = useState<Added>(start?.added ?? {});
  /** The paper being sent, or 'ask' while the check is asked for. */
  const [sending, setSending] = useState<string | null>(null);
  const [asked, setAsked] = useState(Boolean(start?.asked));
  // One sign-up per press, whatever the network does with the first.
  const creating = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const business = state.settingUp ? state.business : null;
  const created = Boolean(business);
  const client = business ? actions.businessClient() : null;
  const gaps = setupGaps(step, form);
  const back = setupBack(step);
  const toggle = (a: BusinessActivity) => setForm((f) => ({ ...f, activities: f.activities.includes(a) ? f.activities.filter((x) => x !== a) : [...f.activities, a] }));

  // A new step is a new screen: read from its top, its title the first thing a screen reader says.
  useEffect(() => {
    if (!moved.current) return;
    if (typeof window !== 'undefined') window.scrollTo?.(0, 0);
    titleRef.current?.focus();
  }, [step]);

  const go = (to: SetupStep) => {
    moved.current = true;
    setStep(to);
    setTried(false);
    setError(null);
  };

  const next = async (e?: Event) => {
    e?.preventDefault();
    if (state.busy || sending) return;
    setTried(true);
    if (gaps.length) return;
    const { to, create } = setupNext(step, created);
    if (create) {
      if (!agreement) return setError(t('agreement.needed'));
      if (creating.current) return;
      creating.current = true;
      const refused = await actions.create({ ...form, taxNo: form.taxNo?.trim() || undefined, ...(agreement !== 'covered' ? { agreement } : {}) });
      if (refused) {
        creating.current = false;
        return setError(refused.detail || refused.title);
      }
    }
    go(to);
  };

  /** A paper, made ready by the picker, sent as the start screen sends it — then the business read again for its check. */
  const sendPaper = async (kind: PaperKind, { file, dataUrl }: PaperReady) => {
    if (!client || !business) return;
    setSending(kind);
    setError(null);
    try {
      const r = await client.api.uploadCompanyDocument(business.entityId, { kind, title: `${t(DOCUMENT_LABEL[kind])} — ${file.name}`, dataUrl });
      if (r.error) return setError(uploadFailureSentence(r.error));
      setAdded((a) => ({ ...a, [kind]: { name: file.name, preview: dataUrl } }));
      await actions.reloadBusiness();
    } catch (err) {
      setError(uploadFailureSentence(err));
    } finally {
      setSending(null);
    }
  };

  const ask = async () => {
    if (!client) return;
    setSending('ask');
    setError(null);
    const r = await client.askForCheck();
    setSending(null);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    actions.setBusiness(r.data);
    setAsked(true);
    go('done');
  };

  const gap = (field: keyof NewBusiness) => (tried && gaps.includes(field) ? <span class="cerr">{t(`business.new.need.${field}` as MessageKey)}</span> : null);
  const title = (key: MessageKey, params?: Record<string, string>) => (
    <h1 class="cons__title" id="biz-setup-title" ref={titleRef} tabIndex={-1}>
      {t(key, params)}
    </h1>
  );
  /** What was saved, once it is: read, not a form — going forward again never signs up a second business. */
  const saved = (rows: Array<[MessageKey, string]>) => (
    <>
      <dl class="cons__facts biz-saved">
        {rows.map(([k, v]) => (
          <div class="cons__fact" key={k}>
            <dt class="cons__factk">{t(k)}</dt>
            <dd class="cons__factv">{v}</dd>
          </div>
        ))}
      </dl>
      <p class="chint">{t('business.setup.saved')}</p>
    </>
  );

  const missing = business?.check.missing ?? ['certificate_of_incorporation', 'representative_id'];
  const onRecord = (kind: PaperKind) => Boolean(added[kind]) || !missing.includes(kind);
  const checkState = business?.check.state ?? 'unverified';
  const waiting = asked || checkState === 'asked' || checkState === 'checking' || checkState === 'verified';

  const paperStep = (kind: PaperKind) => {
    const has = added[kind];
    const kept = onRecord(kind);
    return (
      <>
        {title(kind === 'representative_id' ? 'business.setup.idTitle' : 'business.setup.certTitle')}
        <p class="cons__lede">{t(kind === 'representative_id' ? 'business.setup.idLede' : 'business.setup.certLede')}</p>
        {/* The house rule for a person's ID (2026-11-01), said where the photo is taken: its file goes with staff's decision. */}
        {kind === 'representative_id' ? <p class="cnote">{t('business.setup.idKept')}</p> : null}
        {has ? <PaperAdded name={has.name} preview={has.preview} status={t('business.paper.awaiting')} /> : kept ? <p class="chint">{t('business.setup.onRecord')}</p> : null}
        {kept ? <p class="chint">{t('business.setup.replace')}</p> : <p class="chint">{t('business.setup.photoTip')}</p>}
        <div class="biz-wiz__pick">
          <PaperPicker paper={t(PAPER_NAME[kind])} primary={!kept} working={sending === kind} disabled={!client || (sending !== null && sending !== kind)} onReady={(ready) => sendPaper(kind, ready)} />
        </div>
      </>
    );
  };

  return (
    <form class="biz-new biz-wiz" onSubmit={(e) => void next(e)}>
      {/* 2026-11-02 — the phone's Back steps back through the set-up, as the Back below does (shared/ui/BackStep.tsx). */}
      {back ? <BackStep key={step} back={() => go(back)} /> : null}
      {step !== 'done' ? <StepList pinned title={t('business.setup.title')} steps={SETUP_BAR.map((s) => t(SETUP_NAME[s as Exclude<SetupStep, 'done'>]))} at={SETUP_BAR.indexOf(step)} /> : null}

      {step === 'business' ? (
        <>
          {title('business.new.title')}
          <p class="cons__lede">{t('business.new.lede')}</p>
          {business ? (
            saved([
              ['business.new.name', business.name],
              ['business.new.country', business.country],
              ['business.new.registrationNo', business.registrationNo],
              ...(business.taxNo ? ([['business.new.taxNo', business.taxNo]] as Array<[MessageKey, string]>) : []),
            ])
          ) : (
            <>
              <label class="cfield">
                <span class="cfield__label">{t('business.new.name')}</span>
                <input class="cinput" value={form.name} autocomplete="organization" onInput={(e) => setForm((prev) => ({ ...prev, name: (e.target as HTMLInputElement).value }))} />
                <span class="chint">{t('business.new.nameHint')}</span>
                {gap('name')}
              </label>

              <CountrySelect value={form.country} onChange={(country) => setForm((prev) => ({ ...prev, country }))} label={t('business.new.country')} options={countries} />
              {gap('country')}

              <div class="biz-two">
                <label class="cfield">
                  <span class="cfield__label">{t('business.new.registrationNo')}</span>
                  <input class="cinput" value={form.registrationNo} onInput={(e) => setForm((prev) => ({ ...prev, registrationNo: (e.target as HTMLInputElement).value }))} />
                  {gap('registrationNo')}
                </label>
                <label class="cfield">
                  <span class="cfield__label">{t('business.new.taxNo')}</span>
                  <input class="cinput" value={form.taxNo} onInput={(e) => setForm((prev) => ({ ...prev, taxNo: (e.target as HTMLInputElement).value }))} />
                </label>
              </div>
            </>
          )}
        </>
      ) : null}

      {step === 'activities' ? (
        <>
          {title('business.new.activities')}
          <p class="cons__lede">{t('business.setup.activitiesLede')}</p>
          {business ? (
            saved([['business.new.activities', business.activities.map((a) => t(ACTIVITY_LABEL[a])).join(', ')]])
          ) : (
            <fieldset class="cfield biz-acts" aria-labelledby="biz-setup-title">
              {ACTIVITIES.map((a) => (
                <label class="cfield--check biz-act" key={a}>
                  <input type="checkbox" checked={form.activities.includes(a)} onChange={() => toggle(a)} />
                  <span>
                    <strong>{t(ACTIVITY_LABEL[a])}</strong>
                    <span class="chint">{t(ACTIVITY_SUB[a])}</span>
                  </span>
                </label>
              ))}
              {gap('activities')}
            </fieldset>
          )}
        </>
      ) : null}

      {step === 'you' ? (
        <>
          {title('business.setup.youTitle')}
          <p class="cons__lede">{t('business.setup.youLede')}</p>
          {business ? (
            saved([['business.new.yourName', business.you.name]])
          ) : (
            <>
              <label class="cfield">
                <span class="cfield__label">{t('business.new.yourName')}</span>
                <input class="cinput" value={form.yourName} autocomplete="name" onInput={(e) => setForm((prev) => ({ ...prev, yourName: (e.target as HTMLInputElement).value }))} />
                <span class="chint">{t('business.new.yourNameHint')}</span>
                {gap('yourName')}
              </label>
              <AgreementCheck read={actions.readAgreement} country={form.country} value={agreement} onChange={setAgreement} />
              <p class="cnote">{t('business.new.checkNote')}</p>
            </>
          )}
        </>
      ) : null}

      {step === 'certificate' ? paperStep('certificate_of_incorporation') : null}
      {step === 'id' ? paperStep('representative_id') : null}

      {step === 'ask' ? (
        <>
          {title('business.setup.askTitle')}
          <p class="cons__lede">{t(waiting ? 'business.home.step.waiting' : 'business.setup.askLede')}</p>
          <div class="cdocs biz-papers">
            {(['certificate_of_incorporation', 'representative_id'] as const).map((kind) => (
              <div class="cdoc" key={kind}>
                <span class="cdoc__tile" aria-hidden="true">{onRecord(kind) ? <Icon name="check" size={16} /> : <Icon name="info" size={16} />}</span>
                <span class="cdoc__body">
                  <span class="cdoc__name">{t(PAPER_NAME[kind])}</span>
                  <span class="cdoc__meta">{t(onRecord(kind) ? 'business.setup.paperIn' : 'business.setup.paperOut')}</span>
                </span>
              </div>
            ))}
          </div>
          {missing.length && !waiting ? <p class="cnote">{t('business.setup.askMissing')}</p> : null}
        </>
      ) : null}

      {step === 'done' ? (
        <>
          {title('business.setup.doneTitle')}
          <p class="cons__lede">{t(waiting ? 'business.setup.doneAsked' : 'business.setup.doneLater')}</p>
        </>
      ) : null}

      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}

      <div class="twr-panelend biz-wiz__end">
        {back ? (
          <button type="button" class="cbtn cbtn--ghost" disabled={state.busy || sending !== null} onClick={() => go(back)}>
            {t('common.back')}
          </button>
        ) : step === 'business' && !created ? (
          onCancel ? (
            <button type="button" class="cbtn cbtn--ghost" onClick={onCancel}>
              {t('common.back')}
            </button>
          ) : (
            <button type="button" class="cbtn cbtn--ghost" onClick={actions.signOut}>
              {t('business.signOut')}
            </button>
          )
        ) : null}
        <span class="biz-wiz__go">
          {step === 'done' ? (
            <button type="button" class="cbtn cbtn--primary" onClick={actions.finishSetup}>
              {t('business.setup.open', { name: business?.name ?? form.name })}
            </button>
          ) : step === 'ask' && !waiting && !missing.length ? (
            <>
              <button type="button" class="cbtn cbtn--ghost" disabled={sending !== null} onClick={() => go('done')}>
                {t('business.setup.notNow')}
              </button>
              <button type="button" class="cbtn cbtn--primary" disabled={sending !== null || !client} onClick={() => void ask()}>
                {t('business.home.ask')}
              </button>
            </>
          ) : step === 'ask' && !waiting ? (
            <button type="button" class="cbtn cbtn--primary" onClick={() => go('done')}>
              {t('business.setup.askLater')}
            </button>
          ) : (step === 'certificate' || step === 'id') && !onRecord(SETUP_PAPER[step]!) ? (
            <button type="button" class="cbtn cbtn--ghost" disabled={sending !== null} onClick={() => go(setupNext(step, created).to)}>
              {t('business.setup.later')}
            </button>
          ) : (
            <button type="submit" class="cbtn cbtn--primary" disabled={state.busy || sending !== null}>
              {t(step === 'you' && !created ? 'business.new.cta' : 'business.setup.next')}
            </button>
          )}
        </span>
      </div>
    </form>
  );
}
