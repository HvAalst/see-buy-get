import { useCallback, useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { publicPageUrl } from '../../../lib/sbg/config';
import { DOCUMENT_LABEL, type CompanyDocument } from '../../tower/company';
import type { BusinessClient, BusinessView } from '../api';
import { checkStep, mayManage, sectionsFor, type Section } from '../logic';
import type { BusinessActions } from '../useBusinessApp';
import { CHECK_LABEL } from './ChooseScreen';

/** The two papers the check is made from, in the order a business usually has them to hand. */
const CHECK_PAPERS = ['certificate_of_incorporation', 'representative_id'] as const;

const STEP_TEXT: Record<ReturnType<typeof checkStep>, MessageKey> = {
  papers: 'business.home.step.papers',
  ask: 'business.home.step.ask',
  waiting: 'business.home.step.waiting',
  refused: 'business.home.step.refused',
  done: 'business.home.step.done',
};

const STATUS_TONE: Record<CompanyDocument['status'], string> = { awaiting_verification: 'info', verified: 'ok', rejected: 'warn', superseded: 'quiet' };
const STATUS_LABEL: Record<CompanyDocument['status'], MessageKey> = {
  awaiting_verification: 'business.paper.awaiting',
  verified: 'business.paper.verified',
  rejected: 'business.paper.rejected',
  superseded: 'business.paper.superseded',
};

/**
 * THE OVERVIEW — where the check stands, what it needs from them, and the way into the work.
 *
 * The check leads until the business is verified, because it is the one thing only they can move: two papers, then
 * a request. Once verified the panel shrinks to a line and the work takes the top.
 */
export function HomeScreen({ business, actions, client }: { business: BusinessView; actions: BusinessActions; client: BusinessClient | null }) {
  const t = useT();
  const step = checkStep(business.check);
  const owner = mayManage(business.you.role);
  const [papers, setPapers] = useState<CompanyDocument[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = (await client.api.companyRecord(business.entityId)) as unknown as { data?: unknown; error?: unknown };
    setPapers(r.error || !r.data ? [] : (((r.data as unknown as { documents?: CompanyDocument[] }).documents ?? []) as CompanyDocument[]));
  }, [client, business.entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = (kind: (typeof CHECK_PAPERS)[number], file: File) => {
    if (!client) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy(kind);
      setError(null);
      const r = await client.api.uploadCompanyDocument(business.entityId, { kind, title: `${t(DOCUMENT_LABEL[kind])} — ${file.name}`, dataUrl: String(reader.result) });
      setBusy(null);
      if (r.error) return setError(r.error.detail || r.error.title);
      await load();
      await actions.reloadBusiness();
    };
    reader.readAsDataURL(file);
  };

  const ask = async () => {
    if (!client) return;
    setBusy('ask');
    setError(null);
    const r = await client.askForCheck();
    setBusy(null);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    actions.setBusiness(r.data);
    actions.say(t('business.home.asked'));
  };

  const current = (kind: string) => (papers ?? []).find((d) => d.kind === kind && d.status !== 'superseded');
  const work = sectionsFor(business.activities).filter((s) => s === 'imports' || s === 'yard');

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{business.name}</h1>
        <p class="cons__lede">{t('business.home.lede', { country: business.country, reg: business.registrationNo })}</p>
      </header>

      <section class={`cons__panel biz-check biz-check--${step}`}>
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.home.checkTitle')}</span>
          <span class={`ctag ctag--${step === 'done' ? 'ok' : step === 'refused' ? 'warn' : step === 'waiting' ? 'info' : 'quiet'}`}>{t(CHECK_LABEL[business.check.state])}</span>
        </div>
        <p class="cons__lede">{t(STEP_TEXT[step])}</p>
        {step === 'refused' && business.check.reason ? (
          <p class="cons__caveat">
            <Icon name="warning" size={16} />
            <span>{t('business.home.refusedBecause', { reason: business.check.reason })}</span>
          </p>
        ) : null}
        {step === 'done' && business.handle ? (
          <p class="chint">
            <a href={publicPageUrl(business.handle) ?? undefined} target="_blank" rel="noopener noreferrer">
              {t('business.home.page', { handle: business.handle })}
            </a>
          </p>
        ) : null}

        {step !== 'done' ? (
          <div class="cdocs biz-papers">
            {CHECK_PAPERS.map((kind) => {
              const doc = current(kind);
              return (
                <div class="cdoc" key={kind}>
                  <span class="cdoc__tile" aria-hidden="true">{doc ? <Icon name="check" size={16} /> : <Icon name="info" size={16} />}</span>
                  <span class="cdoc__body">
                    <span class="cdoc__name">{t(DOCUMENT_LABEL[kind])}</span>
                    <span class="cdoc__meta">
                      {doc ? (
                        <>
                          <span class={`ctag ctag--${STATUS_TONE[doc.status]}`}>{t(STATUS_LABEL[doc.status])}</span>{' '}
                          {doc.status === 'rejected' && doc.rejectionReason ? doc.rejectionReason : t('business.paper.added', { who: doc.uploadedBy, when: doc.uploadedAt.slice(0, 10) })}
                        </>
                      ) : (
                        t(kind === 'representative_id' ? 'business.paper.idHint' : 'business.paper.certHint')
                      )}
                    </span>
                  </span>
                  {owner ? (
                    <span class="cdoc__acts">
                      <label class={`cbtn cbtn--sm ${doc ? 'cbtn--ghost' : 'cbtn--primary'}`} aria-disabled={busy !== null}>
                        {busy === kind ? t('business.paper.uploading') : doc ? t('business.paper.replace') : t('business.paper.add')}
                        <input
                          type="file"
                          accept="application/pdf,image/png,image/jpeg"
                          class="biz-file"
                          disabled={busy !== null}
                          onChange={(e) => {
                            const file = (e.target as HTMLInputElement).files?.[0];
                            if (file) upload(kind, file);
                            (e.target as HTMLInputElement).value = '';
                          }}
                        />
                      </label>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {error ? <p class="cerr">{error}</p> : null}
        {(step === 'ask' || step === 'refused') && owner ? (
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary" disabled={busy !== null} onClick={() => void ask()}>
              {t(step === 'refused' ? 'business.home.askAgain' : 'business.home.ask')}
            </button>
          </div>
        ) : null}
        {step !== 'done' && !owner ? <p class="chint">{t('business.home.ownerDoes')}</p> : null}
      </section>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.home.workTitle')}</span>
        </div>
        <div class="cdos">
          {work.map((s) => (
            <GoRow key={s} section={s} actions={actions} />
          ))}
          <GoRow section="people" actions={actions} />
          <GoRow section="details" actions={actions} />
        </div>
        {/* Said, not hidden: what a shipper comes for is not on this screen yet. */}
        {business.activities.includes('shipper') || business.activities.includes('expeditor') ? <p class="chint">{t('business.home.loadsSoon')}</p> : null}
      </section>
    </>
  );
}

const GO: Record<Exclude<Section, 'home'>, { label: MessageKey; sub: MessageKey }> = {
  imports: { label: 'business.nav.imports', sub: 'business.home.go.imports' },
  yard: { label: 'business.nav.yard', sub: 'business.home.go.yard' },
  people: { label: 'business.nav.people', sub: 'business.home.go.people' },
  details: { label: 'business.nav.details', sub: 'business.home.go.details' },
};

function GoRow({ section, actions }: { section: Exclude<Section, 'home'>; actions: BusinessActions }) {
  const t = useT();
  return (
    <button type="button" class="cdo" onClick={() => actions.go(section)}>
      <span class="cdo__body">
        <span class="cdo__t">{t(GO[section].label)}</span>
        <span class="cdo__sub">{t(GO[section].sub)}</span>
      </span>
      <Icon name="chevronRight" size={16} class="cdo__go" />
    </button>
  );
}
