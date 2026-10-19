import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT, type MessageKey } from '../../../shared/i18n';
import { ConsoleDetail } from '../ConsoleDetail';
import { DOCUMENT_LABEL, type CompanyDocument } from '../company';
import { approveBlock, stateTone, type BusinessRow } from '../businesses';
import type { TowerActions, TowerState } from '../useTowerApp';

const STATE_LABEL: Record<BusinessRow['state'], MessageKey> = {
  unverified: 'tower.biz.state.unverified',
  asked: 'tower.biz.state.asked',
  checking: 'tower.biz.state.checking',
  verified: 'tower.biz.state.verified',
  refused: 'tower.biz.state.refused',
};
const BLOCK: Record<Exclude<ReturnType<typeof approveBlock>, null>, MessageKey> = {
  papers: 'tower.biz.block.papers',
  same: 'tower.biz.block.same',
  notAsked: 'tower.biz.block.notAsked',
  done: 'tower.biz.block.done',
};
const CHECK_PAPERS = ['certificate_of_incorporation', 'representative_id'] as const;

/**
 * B1 — CUSTOMERS' BUSINESSES, AND THE CHECK THAT TAKES TWO OF US.
 *
 * A business signs itself up and works straight away; what waits here is being shown to strangers — a public page, a
 * place in the agent finder. It is checked from two papers: the registration certificate, against the name and number
 * it gave, and the ID of the person speaking for it. Verify each paper, then approve; a second member of staff
 * approves after you. A refusal always carries a reason, which the business reads in its app and by email.
 */
export function BusinessesScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.businesses;
  const [open, setOpen] = useState<BusinessRow | null>(null);
  const waiting = rows?.filter((r) => r.state === 'asked' || r.state === 'checking') ?? [];
  const rest = rows?.filter((r) => r.state !== 'asked' && r.state !== 'checking') ?? [];

  // Keep the open detail in step with the list after a decision re-reads it.
  useEffect(() => {
    if (open) setOpen(rows?.find((r) => r.entityId === open.entityId) ?? null);
  }, [rows]);

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.biz.title')}</h1>
        <p class="cons__lede">{t('tower.biz.lede')}</p>
      </header>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.biz.waitingTitle')}</span>
          {rows ? <span class="chint">{t('tower.biz.waitingCount', { n: waiting.length })}</span> : null}
        </div>
        {rows === null ? <p class="cons__empty">{t('tower.imports.loading')}</p> : waiting.length === 0 ? <p class="cons__empty">{t('tower.biz.waitingNone')}</p> : <Rows rows={waiting} onOpen={setOpen} />}
      </section>

      {rest.length ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.biz.allTitle')}</span>
            <span class="chint">{t('tower.biz.allCount', { n: rest.length })}</span>
          </div>
          <Rows rows={rest} onOpen={setOpen} />
        </section>
      ) : null}

      {open ? <BusinessDetail row={open} state={state} actions={actions} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function Rows({ rows, onOpen }: { rows: BusinessRow[]; onOpen: (r: BusinessRow) => void }) {
  const t = useT();
  return (
    <div class="crows">
      {rows.map((r) => (
        <button type="button" class="crow" key={r.entityId} onClick={() => onOpen(r)}>
          <span class="crow__body">
            <span class="crow__top">
              <span class="crow__name">{r.name}</span>
              <span class={`ctag ctag--${stateTone(r.state)}`}>{t(STATE_LABEL[r.state])}</span>
            </span>
            <span class="crow__sub">
              {t('tower.biz.rowSub', { country: r.country, reg: r.registrationNo, who: r.createdBy, when: r.createdAt.slice(0, 10) })}
              {r.state === 'checking' && r.firstBy ? ` · ${t('tower.biz.firstBy', { who: r.firstBy })}` : ''}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function BusinessDetail({ row, state, actions, onClose }: { row: BusinessRow; state: TowerState; actions: TowerActions; onClose: () => void }) {
  const t = useT();
  const client = actions.client();
  const [papers, setPapers] = useState<CompanyDocument[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectWhy, setRejectWhy] = useState('');

  const load = useCallback(async () => {
    if (!client) return;
    const r = (await client.api.companyRecord(row.entityId)) as unknown as { data?: { documents?: CompanyDocument[] }; error?: unknown };
    setPapers(r.error ? [] : (r.data?.documents ?? []));
  }, [client, row.entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = (kind: string) => (papers ?? []).find((d) => d.kind === kind && d.status !== 'superseded');
  const papersVerified = CHECK_PAPERS.every((k) => current(k)?.status === 'verified');
  const me = state.who?.name;
  const block = approveBlock(row, me, papersVerified);

  const act = async (key: string, fn: () => Promise<{ error?: { detail?: string; title?: string } | null }>) => {
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (r.error) {
      setError(r.error.detail || r.error.title || null);
      return false;
    }
    await load();
    await actions.refresh();
    return true;
  };

  const openFile = async (doc: CompanyDocument) => {
    if (!client) return;
    const r = (await client.api.companyDocumentFile(row.entityId, doc.documentId)) as unknown as { data?: Blob; error?: unknown };
    if (r.error || !r.data) return setError(t('tower.biz.fileGone'));
    const url = URL.createObjectURL(r.data);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <ConsoleDetail openKey={row.entityId} title={row.name} onClose={onClose}>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{row.name}</span>
          <span class={`ctag ctag--${stateTone(row.state)}`}>{t(STATE_LABEL[row.state])}</span>
        </div>
        <dl class="cons__facts">
          <div class="cons__fact">
            <dt class="cons__factk">{t('tower.biz.fact.reg')}</dt>
            <dd class="cons__factv">{row.registrationNo}</dd>
          </div>
          <div class="cons__fact">
            <dt class="cons__factk">{t('tower.biz.fact.country')}</dt>
            <dd class="cons__factv">{row.country}</dd>
          </div>
          {row.taxNo ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('tower.biz.fact.tax')}</dt>
              <dd class="cons__factv">{row.taxNo}</dd>
            </div>
          ) : null}
          <div class="cons__fact">
            <dt class="cons__factk">{t('tower.biz.fact.setUp')}</dt>
            <dd class="cons__factv">{t('tower.biz.fact.setUpBy', { who: row.createdBy, when: row.createdAt.slice(0, 10), n: row.members })}</dd>
          </div>
          {row.system ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('tower.biz.fact.system')}</dt>
              <dd class="cons__factv">{row.system.hasAddress ? t('tower.biz.fact.systemCounts', { delivered: row.system.delivered, waiting: row.system.waiting, givenUp: row.system.givenUp }) : t('tower.biz.fact.systemNone')}</dd>
            </div>
          ) : null}
          {/* Round 12 — its keys for its own systems, counted. Staff read them; they make and take away none. */}
          {row.system?.keys ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('tower.biz.fact.keys')}</dt>
              <dd class="cons__factv">{t('tower.keys.counts', { live: row.system.keys.live, test: row.system.keys.test })}</dd>
            </div>
          ) : null}
          {row.askedAt ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('tower.biz.fact.asked')}</dt>
              <dd class="cons__factv">{t('tower.biz.fact.askedBy', { who: row.askedBy ?? '—', when: row.askedAt.slice(0, 10) })}</dd>
            </div>
          ) : null}
          {row.firstBy ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('tower.biz.fact.first')}</dt>
              <dd class="cons__factv">{t('tower.biz.fact.byOn', { who: row.firstBy, when: (row.firstAt ?? '').slice(0, 10) })}</dd>
            </div>
          ) : null}
          {row.verifiedBy ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('tower.biz.fact.second')}</dt>
              <dd class="cons__factv">{t('tower.biz.fact.byOn', { who: row.verifiedBy, when: (row.verifiedAt ?? '').slice(0, 10) })}</dd>
            </div>
          ) : null}
          {row.refusedBy ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('tower.biz.fact.refused')}</dt>
              <dd class="cons__factv">{t('tower.biz.fact.refusedBy', { who: row.refusedBy, reason: row.reason ?? '' })}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.biz.papersTitle')}</span>
        </div>
        <p class="cons__lede">{t('tower.biz.papersLede', { name: row.name, reg: row.registrationNo })}</p>
        {papers === null ? (
          <p class="cons__empty">{t('tower.imports.loading')}</p>
        ) : (
          <div class="cdocs">
            {CHECK_PAPERS.map((kind) => {
              const doc = current(kind);
              return (
                <div class="cdoc" key={kind}>
                  <span class="cdoc__tile" aria-hidden="true">
                    {doc ? 'PDF' : '—'}
                  </span>
                  <span class="cdoc__body">
                    <span class="cdoc__name">{t(DOCUMENT_LABEL[kind])}</span>
                    <span class="cdoc__meta">
                      {doc
                        ? doc.status === 'verified'
                          ? t('tower.biz.paper.verified', { who: doc.verifiedBy ?? '—' })
                          : doc.status === 'rejected'
                            ? t('tower.biz.paper.rejected', { reason: doc.rejectionReason ?? '' })
                            : t('tower.biz.paper.waiting', { who: doc.uploadedBy, when: doc.uploadedAt.slice(0, 10) })
                        : t('tower.biz.paper.none')}
                    </span>
                  </span>
                  {doc ? (
                    <span class="cdoc__acts">
                      <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void openFile(doc)}>
                        {t('tower.imports.paper.open')}
                      </button>
                      {doc.status === 'awaiting_verification' ? (
                        <>
                          <button
                            type="button"
                            class="cbtn cbtn--primary cbtn--sm"
                            disabled={busy !== null}
                            onClick={() => void act(`v-${doc.documentId}`, () => client!.api.verifyCompanyDocument(row.entityId, doc.documentId, me) as never)}
                          >
                            {t('tower.biz.paper.verify')}
                          </button>
                          <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy !== null} onClick={() => setRejecting(doc.documentId)}>
                            {t('tower.biz.paper.reject')}
                          </button>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {rejecting ? (
          <div class="twr-panelend">
            <input class="cinput" value={rejectWhy} placeholder={t('tower.biz.paper.rejectWhy')} onInput={(e) => setRejectWhy((e.target as HTMLInputElement).value)} />
            <button
              type="button"
              class="cbtn cbtn--danger"
              disabled={busy !== null || !rejectWhy.trim()}
              onClick={async () => {
                const ok = await act('reject', () => client!.api.rejectCompanyDocument(row.entityId, rejecting, rejectWhy.trim(), me) as never);
                if (ok) {
                  setRejecting(null);
                  setRejectWhy('');
                }
              }}
            >
              {t('tower.biz.paper.reject')}
            </button>
          </div>
        ) : null}
      </section>

      {row.state === 'asked' || row.state === 'checking' ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.biz.decideTitle')}</span>
          </div>
          {/* The one who gave the first approval is told only that the second is somebody else's — not invited to give it. */}
          {block === 'same' ? null : <p class="cons__lede">{t(row.state === 'checking' ? 'tower.biz.decideSecond' : 'tower.biz.decideFirst')}</p>}
          {block ? <p class="cons__caveat">{t(BLOCK[block])}</p> : null}
          {error ? <p class="cerr">{error}</p> : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary" disabled={busy !== null || block !== null} onClick={() => void act('approve', () => client!.api.approveBusiness(row.entityId, me) as never)}>
              {t(row.state === 'checking' ? 'tower.biz.approveSecond' : 'tower.biz.approveFirst')}
            </button>
          </div>
          <label class="cfield" style="margin-top:12px">
            <span class="cfield__label">{t('tower.biz.refuseWhy')}</span>
            <input class="cinput" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
            <span class="chint">{t('tower.biz.refuseHint')}</span>
          </label>
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn cbtn--danger"
              disabled={busy !== null || !reason.trim()}
              onClick={async () => {
                if (await act('refuse', () => client!.api.refuseBusiness(row.entityId, reason.trim(), me) as never)) setReason('');
              }}
            >
              {t('tower.biz.refuse')}
            </button>
          </div>
        </section>
      ) : error ? (
        <p class="cerr">{error}</p>
      ) : null}
    </ConsoleDetail>
  );
}
