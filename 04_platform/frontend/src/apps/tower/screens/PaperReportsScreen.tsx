import { Abbreviated } from '../../../shared/ui/Abbr';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { ConsoleDetail } from '../ConsoleDetail';
import { CASE_LABEL, CASE_TONE, CATEGORY_LABEL, caseSub, isWaiting, strikeStep, type PaperCase } from '../paperReports';
import type { TowerActions, TowerState } from '../useTowerApp';
import { tabAtTheTap } from '../../../shared/openPage';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * REPORTED PAPERS — somebody connected to a company says one of its papers is not right.
 *
 * The user, 2026-10-09: a company keeps its own record once it is switched on, and "sbg should only interact at
 * dispute". This is the dispute. It is the only place staff touch such a company's papers, and they touch them in two
 * ways: ONE member of staff may dismiss a report, with the reason; STRIKING the paper takes two — one proposes with
 * the reason, a second, different one approves — and not before the company has answered or its time has run out.
 *
 * A report opens on what was said and what was attached, then on what the company answered, before it offers
 * anything to press. The paper keeps counting the whole time.
 */
export function PaperReportsScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.paperReports;
  const [open, setOpen] = useState<string | null>(null);
  const waiting = rows?.filter(isWaiting) ?? [];
  const rest = rows?.filter((r) => !isWaiting(r)) ?? [];

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.paperReport.title')}</h1>
        <p class="cons__lede">{t('tower.paperReport.lede')}</p>
      </header>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.paperReport.waitingTitle')}</span>
          {rows ? <span class="chint">{t('tower.paperReport.waitingCount', { n: waiting.length })}</span> : null}
        </div>
        {rows === null ? <p class="cons__empty">{t('tower.imports.loading')}</p> : waiting.length === 0 ? <p class="cons__empty">{t('tower.paperReport.waitingNone')}</p> : <Rows rows={waiting} onOpen={setOpen} />}
      </section>

      {rest.length ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.paperReport.doneTitle')}</span>
            <span class="chint">{t('tower.paperReport.doneCount', { n: rest.length })}</span>
          </div>
          <Rows rows={rest} onOpen={setOpen} />
        </section>
      ) : null}

      {open ? <CaseDetail caseId={open} state={state} actions={actions} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function Rows({ rows, onOpen }: { rows: PaperCase[]; onOpen: (caseId: string) => void }) {
  const t = useT();
  return (
    <div class="crows">
      {rows.map((r) => (
        <button type="button" class="crow" key={r.caseId} onClick={() => onOpen(r.caseId)}>
          <span class="crow__body">
            <span class="crow__top">
              <span class="crow__name">{r.paper.title}</span>
              <span class={`ctag ctag--${CASE_TONE[r.state]}`}>{t(CASE_LABEL[r.state])}</span>
            </span>
            <span class="crow__sub">{caseSub(r, t, day)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function CaseDetail({ caseId, state, actions, onClose }: { caseId: string; state: TowerState; actions: TowerActions; onClose: () => void }) {
  const t = useT();
  const client = actions.client();
  const me = state.who?.name;
  const [row, setRow] = useState<PaperCase | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [dismissWhy, setDismissWhy] = useState('');

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.paperReport(caseId);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || t('tower.paperReport.unread'));
    setRow(r.data as unknown as PaperCase);
  }, [client, caseId]);

  useEffect(() => {
    setRow(null);
    setError(null);
    setWhy('');
    setDismissWhy('');
    void load();
  }, [load]);

  const act = async (key: string, fn: () => Promise<{ data?: unknown; error?: { detail?: string; title?: string } | null }>) => {
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (r.error) setError(r.error.detail || r.error.title || null);
    await load();
    await actions.refresh();
    return !r.error;
  };
  /** A file, opened in its own tab: the paper itself, or what somebody attached. */
  const show = async (read: () => Promise<{ data?: unknown; error?: unknown }>) => {
    const tab = tabAtTheTap();
    try {
      const r = await read();
      const blob = r.error ? null : (r.data as Blob | null);
      if (blob) tab.show(blob);
    } finally {
      tab.cancel();
    }
  };

  if (!row) {
    return (
      <ConsoleDetail openKey={caseId} title={t('tower.paperReport.title')} onClose={onClose}>
        {error ? <p class="cerr"><Abbreviated text={error} /></p> : <p class="cons__empty">{t('tower.imports.loading')}</p>}
      </ConsoleDetail>
    );
  }
  const step = strikeStep(row, Date.now());

  return (
    <ConsoleDetail openKey={caseId} title={row.paper.title} onClose={onClose}>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.paperReport.paperTitle')}</span>
          <span class={`ctag ctag--${CASE_TONE[row.state]}`}>{t(CASE_LABEL[row.state])}</span>
        </div>
        <dl class="cons__facts">
          <Fact k={t('tower.paperReport.fact.company')} v={row.company} />
          <Fact k={t('tower.paperReport.fact.paper')} v={row.paper.title} hint={t('tower.paperReport.fact.putBy', { who: row.paper.uploadedBy, when: when(row.paper.uploadedAt) })} />
          {row.claimed ? <Fact k={t('tower.paperReport.fact.was')} v={row.claimed.was} /> : null}
          {row.claimed ? <Fact k={t('tower.paperReport.fact.now')} v={row.claimed.now} /> : null}
          <Fact k={t('tower.paperReport.fact.counts')} v={t(row.paper.status === 'declared' || row.paper.status === 'verified' ? 'tower.paperReport.fact.countsYes' : 'tower.paperReport.fact.countsNo', { status: row.paper.status.replace(/_/g, ' ') })} />
        </dl>
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void show(() => client!.api.companyDocumentFile(row.entityId, row.documentId) as never)}>
            {t('tower.paperReport.openPaper')}
          </button>
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => actions.openCompany(row.entityId)}>
            {t('tower.companies.openRecord')}
          </button>
        </div>
      </section>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.paperReport.saidTitle')}</span>
          <span class="chint">{t('tower.paperReport.saidHint')}</span>
        </div>
        {row.reports.map((r) => (
          <div key={r.reportId} class="twr-said">
            <p class="cfield__label">
              {t(CATEGORY_LABEL[r.category])} · {r.by ?? ''}
              {r.role ? `, ${r.role}` : ''} · {when(r.at)}
            </p>
            <p class="cons__lede">{r.note}</p>
            {r.evidenceId ? (
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void show(() => client!.api.paperReportEvidence(row.caseId, r.evidenceId!) as never)}>
                {t('tower.paperReport.openEvidence')}
              </button>
            ) : null}
          </div>
        ))}
      </section>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.paperReport.answerTitle')}</span>
        </div>
        {row.answer ? (
          <div class="twr-said">
            <p class="cfield__label">
              {row.answer.by} · {when(row.answer.at)}
            </p>
            <p class="cons__lede">{row.answer.note}</p>
            {row.answer.evidenceId ? (
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void show(() => client!.api.paperReportEvidence(row.caseId, row.answer!.evidenceId!) as never)}>
                {t('tower.paperReport.openEvidence')}
              </button>
            ) : null}
          </div>
        ) : (
          <p class="cons__caveat">{t(row.state === 'open' ? 'tower.paperReport.notAnswered' : 'tower.paperReport.neverAnswered', { when: day(row.answerBy) })}</p>
        )}
      </section>

      {row.state === 'open' ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.paperReport.decideTitle')}</span>
          </div>
          <p class="chint">{t('tower.paperReport.decideHint')}</p>
          {step === 'wait' ? <p class="cons__caveat">{t('tower.paperReport.waitToStrike', { when: day(row.answerBy) })}</p> : null}
          {step === 'propose' ? (
            <>
              <label class="cfield">
                <span class="cfield__label">{t('tower.paperReport.strikeWhy')}</span>
                <textarea class="cinput" rows={3} maxLength={1000} value={why} onInput={(e) => setWhy((e.target as HTMLTextAreaElement).value)} />
                <span class="chint">{t('tower.paperReport.strikeWhyHint')}</span>
              </label>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--danger" disabled={busy !== null || !why.trim()} onClick={() => void act('propose', () => client!.api.proposePaperStrike(row.caseId, why.trim(), me) as never)}>
                  {t('tower.paperReport.proposeCta')}
                </button>
              </div>
            </>
          ) : null}
          {step === 'approve' && row.proposal ? (
            <>
              <p class="cons__lede">{t('tower.paperReport.approveLede', { who: row.proposal.by, reason: row.proposal.reason })}</p>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--danger" disabled={busy !== null} onClick={() => void act('approve', () => client!.api.approvePaperStrike(row.caseId, me) as never)}>
                  {t('tower.paperReport.approveCta')}
                </button>
              </div>
            </>
          ) : null}
          {/* The one who proposed it is told the approval is somebody else's — not invited to give it. */}
          {step === 'other' && row.proposal ? <p class="cons__caveat">{t('tower.paperReport.otherApproves', { reason: row.proposal.reason })}</p> : null}
          {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
          <label class="cfield" style="margin-top:12px">
            <span class="cfield__label">{t('tower.paperReport.dismissWhy')}</span>
            <input class="cinput" maxLength={1000} value={dismissWhy} onInput={(e) => setDismissWhy((e.target as HTMLInputElement).value)} />
            <span class="chint">{t('tower.paperReport.dismissHint')}</span>
          </label>
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn cbtn--ghost"
              disabled={busy !== null || !dismissWhy.trim()}
              onClick={async () => {
                if (await act('dismiss', () => client!.api.dismissPaperReport(row.caseId, dismissWhy.trim(), me) as never)) setDismissWhy('');
              }}
            >
              {t('tower.paperReport.dismissCta')}
            </button>
          </div>
        </section>
      ) : row.decision ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.paperReport.decidedTitle')}</span>
          </div>
          <dl class="cons__facts">
            <Fact k={t('tower.paperReport.fact.decided')} v={t(row.decision.outcome === 'struck' ? 'tower.paperReport.decided.struck' : 'tower.paperReport.decided.dismissed', { who: row.decision.by ?? '', when: when(row.decision.at) })} hint={row.decision.reason} />
            {row.decision.effect ? <Fact k={t('tower.paperReport.fact.effect')} v={row.decision.effect} /> : null}
          </dl>
          {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
        </section>
      ) : null}
    </ConsoleDetail>
  );
}

function Fact({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div class="cons__fact">
      <dt class="cons__factk">{k}</dt>
      <dd class="cons__factv">
        {v}
        {hint ? <span class="chint">{hint}</span> : null}
      </dd>
    </div>
  );
}
