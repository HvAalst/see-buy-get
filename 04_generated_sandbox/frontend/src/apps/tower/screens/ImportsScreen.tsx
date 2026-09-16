import { useCallback, useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { DOCUMENT_KINDS, DOCUMENT_LABEL, shortFingerprint, type CompanyDocument } from '../company';
import {
  EMPTY_IMPORT_FORM,
  companyPapers,
  consignmentPapers,
  knownNotAsked,
  liveGrants,
  outstanding,
  outstandingCount,
  paperTone,
  publishBlocker,
  readinessOf,
  registerBlocker,
  type ImportDetailView,
  type ImportRow,
  type KnownPaper,
  type RegisterImportForm,
  type RequiredPaperView,
} from '../imports';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * CL2a — A CONTAINER, ITS PAPERS, AND THE AGENT APPOINTED TO CLEAR IT.
 *
 * One screen serving two companies, because the server already knows which side of a consignment the caller
 * is on and says so in `youAre`. The importer records the container, puts their papers on record, appoints
 * an agent and watches what is still missing; the agent publishes what they will need and ticks papers off.
 * Network staff read over the shoulder and can act on nothing, which is what an onlooker means.
 *
 * Nothing here reaches a driver. They are not a party to any of it.
 */
export function ImportsScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const who = state.who?.name;
  /** A company administrator acts as their company; network staff act as nobody and so may only read. */
  const isCompany = Boolean(state.who?.entityId);

  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [detail, setDetail] = useState<ImportDetailView | null>(null);
  const [known, setKnown] = useState<KnownPaper[]>([]);
  const [form, setForm] = useState<RegisterImportForm>({ ...EMPTY_IMPORT_FORM });
  const [agentId, setAgentId] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<Array<{ label: string; copies: string; note: string }>>([{ label: '', copies: '', note: '' }]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [upload, setUpload] = useState({ kind: 'commercial_invoice', title: '', dataUrl: '', expiresAt: '', belongs: 'consignment' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.imports();
    if (r.error) {
      setError(r.error.detail || r.error.title);
      return;
    }
    setRows(((r.data as unknown as { items?: ImportRow[] })?.items ?? []) as ImportRow[]);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every write goes through here: one busy flag, the refusal in the server's own words, then a re-read. */
  const run = async (key: string, write: () => Promise<{ error?: { detail?: string; title?: string } | null }>, message: string, after?: () => void) => {
    if (!client) return false;
    setBusy(key);
    setError(null);
    setDone(null);
    const r = await write();
    setBusy(null);
    if (r.error) {
      setError(r.error.detail || r.error.title || '');
      return false;
    }
    setDone(message);
    after?.();
    await load();
    if (detail) await openOne(detail.importId, false);
    return true;
  };

  const openOne = async (importId: string, announce = true) => {
    if (!client) return;
    if (announce) {
      setError(null);
      setDone(null);
    }
    const r = await client.api.importDetail(importId);
    if (r.error) {
      setError(r.error.detail || r.error.title);
      return;
    }
    const view = r.data as unknown as ImportDetailView;
    setDetail(view);
    // What others have been asked for at THIS port — read beside the container, because that is the only
    // place the answer is useful. A port with nothing recorded says so rather than showing an empty table.
    const k = await client.api.knownImportPapers(view.destCountry, view.destPort);
    setKnown(k.error ? [] : (((k.data as unknown as { items?: KnownPaper[] })?.items ?? []) as KnownPaper[]));
    if (view.youAre === 'agent') {
      setLines(view.required.length ? view.required.map((r2) => ({ label: r2.label, copies: r2.copies ? String(r2.copies) : '', note: r2.note ?? '' })) : [{ label: '', copies: '', note: '' }]);
    }
  };

  const registerFault = registerBlocker(form);
  const publishFault = publishBlocker(lines);
  const waiting = outstandingCount(rows);
  // Derived on every read, never stored — an empty list is not a cleared container, so `done` needs `asked`.
  const ready = detail ? readinessOf(detail) : null;

  const readFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setError(t('tower.imports.notAFile'));
    reader.onload = () => setUpload((u) => ({ ...u, dataUrl: String(reader.result ?? ''), title: u.title || file.name.replace(/\.[^.]+$/, '') }));
    reader.readAsDataURL(file);
  };

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.imports.title')}</h1>
        <p class="cons__lede">{t('tower.imports.lede')}</p>
      </header>

      <p class="cons__caveat">
        <Icon name="info" size={16} />
        <span>
          <b>{t('tower.imports.caveatT')}</b> {t('tower.imports.caveat')} {t('tower.imports.seam')}
        </span>
      </p>

      {!isCompany ? <p class="cons__caveat">{t('tower.imports.staffOnly')}</p> : null}
      {done ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {done}
        </p>
      ) : null}
      {error ? <p class="cerr">{error}</p> : null}

      {/* ---- record a container. Only a company can: staff act for nobody and have no papers to share. ---- */}
      {isCompany ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.imports.newTitle')}</span>
          </div>
          <div class="twr-knobs">
            <label class="twr-knob">
              <span>{t('tower.imports.f.goods')}</span>
              <input value={form.goodsDescription} onChange={(e) => setForm({ ...form, goodsDescription: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="twr-knob">
              <span>{t('tower.imports.f.origin')}</span>
              <input maxLength={2} value={form.originCountry} onChange={(e) => setForm({ ...form, originCountry: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="twr-knob">
              <span>{t('tower.imports.f.dest')}</span>
              <input maxLength={2} value={form.destCountry} onChange={(e) => setForm({ ...form, destCountry: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="twr-knob">
              <span>{t('tower.imports.f.port')}</span>
              <input value={form.destPort} onChange={(e) => setForm({ ...form, destPort: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="twr-knob">
              <span>{t('tower.imports.f.container')}</span>
              <input value={form.containerNo} onChange={(e) => setForm({ ...form, containerNo: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="twr-knob">
              <span>{t('tower.imports.f.carrier')}</span>
              <input value={form.carrierRef} onChange={(e) => setForm({ ...form, carrierRef: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="twr-knob">
              <span>{t('tower.imports.f.eta')}</span>
              <input type="date" value={form.etaAt} onChange={(e) => setForm({ ...form, etaAt: (e.target as HTMLInputElement).value })} />
            </label>
          </div>
          <div class="twr-panelend">
            {registerFault ? <span class="ctbl__sub">{t(registerFault)}</span> : null}
            <button
              type="button"
              class="cbtn"
              disabled={Boolean(registerFault) || busy === 'register'}
              onClick={() =>
                run(
                  'register',
                  async () => {
                    const r = await client!.api.registerImport({
                      goodsDescription: form.goodsDescription.trim(),
                      originCountry: form.originCountry.trim().toUpperCase(),
                      destCountry: form.destCountry.trim().toUpperCase(),
                      destPort: form.destPort.trim(),
                      ...(form.containerNo.trim() ? { containerNo: form.containerNo.trim() } : {}),
                      ...(form.carrierRef.trim() ? { carrierRef: form.carrierRef.trim() } : {}),
                      ...(form.etaAt.trim() ? { etaAt: form.etaAt.trim() } : {}),
                      ...(who ? { by: who } : {}),
                    });
                    if (!r.error) setDone(t('tower.imports.registered', { code: (r.data as unknown as { code?: string })?.code ?? '' }));
                    return r;
                  },
                  t('tower.imports.registered', { code: '' }),
                  () => setForm({ ...EMPTY_IMPORT_FORM }),
                )
              }
            >
              {t('tower.imports.register')}
            </button>
          </div>
        </section>
      ) : null}

      {/* ---- the containers ---- */}
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{rows === null ? t('tower.imports.loading') : t('tower.imports.count', { n: rows.length })}</span>
          {/* Said here rather than on the navigation badge: a number beside a group reads as a demand, and
              this one is only meaningful once the list has actually been read. */}
          {waiting ? <span class="ctag ctag--warn">{t('tower.imports.waitingOnYou', { n: waiting })}</span> : null}
        </div>
        {rows === null ? (
          <p class="cons__empty">{t('tower.imports.loading')}</p>
        ) : rows.length === 0 ? (
          <p class="cons__empty">{isCompany ? t('tower.imports.noneCompany') : t('tower.imports.none')}</p>
        ) : (
          <table class="ctbl">
            <thead>
              <tr>
                <th>{t('tower.imports.col.code')}</th>
                <th>{t('tower.imports.col.route')}</th>
                <th>{t('tower.imports.col.agent')}</th>
                <th>{t('tower.imports.col.papers')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.importId}>
                  <td>
                    <div class="ctbl__strong">{row.code}</div>
                    <div class="ctbl__sub">{row.goodsDescription}</div>
                    {row.containerNo ? <div class="ctbl__sub">{row.containerNo}</div> : null}
                  </td>
                  <td class="ctbl__sub">
                    <div>
                      {row.originCountry} → {row.destCountry} · {row.destPort}
                    </div>
                    {row.etaAt ? <div>{t('tower.imports.eta', { date: row.etaAt })}</div> : null}
                  </td>
                  <td class="ctbl__sub">
                    <div>{row.agentName ?? t('tower.imports.status.open')}</div>
                    <span class="ctag ctag--quiet">{t(`tower.imports.youAre.${row.youAre}` as never)}</span>
                  </td>
                  <td class="ctbl__sub">
                    {row.asked ? t('tower.imports.progress', { accepted: row.accepted, asked: row.asked }) : t('tower.imports.noneAsked')}
                    {row.waitingOnYou ? <div class="ctag ctag--warn">{t('tower.imports.waitingOnYou', { n: row.waitingOnYou })}</div> : null}
                  </td>
                  <td class="ctbl__num">
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => (detail?.importId === row.importId ? setDetail(null) : void openOne(row.importId))}>
                      {detail?.importId === row.importId ? t('tower.imports.close') : t('tower.imports.open')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {detail ? (
        <>
          {/* ---- the importer's side: appoint, share, and see what is missing ---- */}
          {detail.youAre === 'importer' ? (
            <>
              <section class="cons__panel">
                <div class="cons__panelhead">
                  <span class="cons__panelt">{detail.agentEntityId ? t('tower.imports.revokeTitle') : t('tower.imports.appointTitle')}</span>
                </div>
                <p class="cons__lede">{t('tower.imports.appointHint')}</p>
                {detail.agentEntityId ? (
                  <div class="twr-knobs">
                    <label class="twr-knob">
                      <span>{t('tower.imports.f.reason')}</span>
                      <input value={reason} onChange={(e) => setReason((e.target as HTMLInputElement).value)} />
                    </label>
                    <div class="twr-panelend">
                      <button
                        type="button"
                        class="cbtn cbtn--ghost"
                        disabled={busy === 'revoke'}
                        onClick={() =>
                          run('revoke', () => client!.api.revokeClearingAgent(detail.importId, { ...(reason.trim() ? { reason: reason.trim() } : {}), ...(who ? { by: who } : {}) }), t('tower.imports.revoked'), () =>
                            setReason(''),
                          )
                        }
                      >
                        {t('tower.imports.revoke')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div class="twr-knobs">
                    <label class="twr-knob">
                      <span>{t('tower.imports.f.agent')}</span>
                      <input value={agentId} onChange={(e) => setAgentId((e.target as HTMLInputElement).value)} />
                    </label>
                    <div class="twr-panelend">
                      <button
                        type="button"
                        class="cbtn"
                        disabled={!agentId.trim() || busy === 'appoint'}
                        onClick={() =>
                          run('appoint', () => client!.api.appointClearingAgent(detail.importId, { agentEntityId: agentId.trim(), ...(who ? { by: who } : {}) }), t('tower.imports.appointed', { name: agentId.trim() }), () =>
                            setAgentId(''),
                          )
                        }
                      >
                        {t('tower.imports.appoint')}
                      </button>
                    </div>
                  </div>
                )}
              </section>

              <section class="cons__panel">
                <div class="cons__panelhead">
                  <span class="cons__panelt">{t('tower.imports.grantsTitle')}</span>
                </div>
                {liveGrants(detail.grants).length === 0 ? (
                  <p class="cons__empty">{t('tower.imports.grantsNone')}</p>
                ) : (
                  <ul class="twr-checklist">
                    {liveGrants(detail.grants).map((g) => (
                      <li key={g.grantId}>
                        {/* The count makes a grant concrete: this is how many papers they can actually read. */}
                        <b>{t(`tower.imports.grant.${g.scope}` as never)}</b> ({g.scope === 'company' ? companyPapers(detail.documents).length : consignmentPapers(detail.documents, detail.code).length}) →{' '}
                        {g.readerEntityId}
                        <div class="ctbl__sub">{t('tower.imports.grant.since', { when: g.grantedAt.slice(0, 10), who: g.grantedBy })}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section class="cons__panel">
                <div class="cons__panelhead">
                  <span class="cons__panelt">{t('tower.imports.uploadTitle')}</span>
                </div>
                <p class="cons__lede">{t('tower.imports.uploadHint')}</p>
                <div class="twr-knobs">
                  <label class="twr-knob">
                    <span>{t('tower.imports.f.kind')}</span>
                    <select value={upload.kind} onChange={(e) => setUpload({ ...upload, kind: (e.target as HTMLSelectElement).value })}>
                      {DOCUMENT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(DOCUMENT_LABEL[k])}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="twr-knob">
                    <span>{t('tower.imports.f.belongs')}</span>
                    <select value={upload.belongs} onChange={(e) => setUpload({ ...upload, belongs: (e.target as HTMLSelectElement).value })}>
                      <option value="company">{t('tower.imports.belongs.company')}</option>
                      <option value="consignment">{t('tower.imports.belongs.consignment')}</option>
                    </select>
                  </label>
                  <label class="twr-knob">
                    <span>{t('tower.imports.f.title')}</span>
                    <input value={upload.title} onChange={(e) => setUpload({ ...upload, title: (e.target as HTMLInputElement).value })} />
                  </label>
                  <label class="twr-knob">
                    <span>{t('tower.imports.f.expires')}</span>
                    <input type="date" value={upload.expiresAt} onChange={(e) => setUpload({ ...upload, expiresAt: (e.target as HTMLInputElement).value })} />
                  </label>
                  <label class="twr-knob">
                    <span>{t('tower.imports.f.file')}</span>
                    <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => readFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
                  </label>
                </div>
                <div class="twr-panelend">
                  <button
                    type="button"
                    class="cbtn"
                    disabled={!upload.dataUrl || !upload.title.trim() || busy === 'upload'}
                    onClick={() =>
                      run(
                        'upload',
                        () =>
                          client!.api.uploadCompanyDocument(detail.importerEntityId, {
                            kind: upload.kind,
                            title: upload.title.trim(),
                            dataUrl: upload.dataUrl,
                            // A container's own paper is filed under its CODE — which is what a
                            // per-consignment grant reaches, and what keeps it out of every other container.
                            ...(upload.belongs === 'consignment' ? { relatesTo: detail.code } : {}),
                            ...(upload.expiresAt ? { expiresAt: upload.expiresAt } : {}),
                            ...(who ? { by: who } : {}),
                          }),
                        t('tower.imports.uploaded', { title: upload.title.trim() }),
                        () => setUpload({ kind: upload.kind, title: '', dataUrl: '', expiresAt: '', belongs: upload.belongs }),
                      )
                    }
                  >
                    {t('tower.imports.upload')}
                  </button>
                </div>
              </section>
            </>
          ) : null}

          {/* ---- the agent's side: publish what you need, prompted by what others were asked for ---- */}
          {detail.youAre === 'agent' ? (
            <>
              <section class="cons__panel">
                <div class="cons__panelhead">
                  <span class="cons__panelt">{t('tower.imports.publishTitle')}</span>
                </div>
                <p class="cons__lede">{t('tower.imports.publishHint')}</p>
                {lines.map((line, i) => (
                  <div class="twr-knobs" key={`line-${i}`}>
                    <label class="twr-knob">
                      <span>{t('tower.imports.f.label')}</span>
                      <input value={line.label} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, label: (e.target as HTMLInputElement).value } : l)))} />
                    </label>
                    <label class="twr-knob">
                      <span>{t('tower.imports.f.copies')}</span>
                      <input type="number" min={1} max={50} value={line.copies} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, copies: (e.target as HTMLInputElement).value } : l)))} />
                    </label>
                    <label class="twr-knob">
                      <span>{t('tower.imports.f.note')}</span>
                      <input value={line.note} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, note: (e.target as HTMLInputElement).value } : l)))} />
                    </label>
                  </div>
                ))}
                <div class="twr-panelend">
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setLines([...lines, { label: '', copies: '', note: '' }])}>
                    {t('tower.imports.addLine')}
                  </button>
                  {publishFault ? <span class="ctbl__sub">{t(publishFault)}</span> : null}
                  <button
                    type="button"
                    class="cbtn"
                    disabled={Boolean(publishFault) || busy === 'publish'}
                    onClick={() =>
                      run(
                        'publish',
                        () =>
                          client!.api.publishRequiredPapers(detail.importId, {
                            items: lines
                              .filter((l) => l.label.trim())
                              .map((l) => ({ label: l.label.trim(), ...(l.copies ? { copies: Number(l.copies) } : {}), ...(l.note.trim() ? { note: l.note.trim() } : {}) })),
                            ...(who ? { by: who } : {}),
                          }),
                        t('tower.imports.published'),
                      )
                    }
                  >
                    {t('tower.imports.publish')}
                  </button>
                </div>
              </section>

              <section class="cons__panel">
                <div class="cons__panelhead">
                  <span class="cons__panelt">{t('tower.imports.knownTitle')}</span>
                </div>
                <p class="cons__lede">{t('tower.imports.knownHint')}</p>
                {knownNotAsked(known, lines.filter((l) => l.label.trim())).length === 0 ? (
                  <p class="cons__empty">{t('tower.imports.knownNone')}</p>
                ) : (
                  <ul class="twr-checklist">
                    {knownNotAsked(
                      known,
                      lines.filter((l) => l.label.trim()),
                    ).map((k) => (
                      <li key={k.key}>
                        <b>{k.label}</b>
                        <div class="ctbl__sub">{t('tower.imports.knownRow', { agents: k.agents, times: k.times, when: k.lastAskedAt.slice(0, 10) })}</div>
                        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setLines([...lines.filter((l) => l.label.trim()), { label: k.label, copies: '', note: '' }])}>
                          {t('tower.imports.knownAdd')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : null}

          {/* ---- the list itself, read by both sides ---- */}
          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">
                {detail.code} · {t('tower.imports.requiredTitle')}
              </span>
              {ready?.done ? (
                <span class="ctag ctag--ok">{t('tower.imports.progress', { accepted: ready.accepted, asked: ready.asked })}</span>
              ) : (
                <span class="ctbl__sub">{ready?.asked ? t('tower.imports.progress', { accepted: ready.accepted, asked: ready.asked }) : t('tower.imports.noneAsked')}</span>
              )}
            </div>
            {detail.required.length === 0 ? (
              <p class="cons__empty">{detail.agentEntityId ? t('tower.imports.requiredNone') : t('tower.imports.requiredNoAgent')}</p>
            ) : (
              <table class="ctbl">
                <tbody>
                  {[...outstanding(detail), ...detail.required.filter((r) => !outstanding(detail).includes(r))].map((paper) => (
                    <PaperRow
                      key={paper.key}
                      paper={paper}
                      detail={detail}
                      t={t}
                      busy={busy}
                      pick={pick[paper.key] ?? ''}
                      onPick={(v) => setPick({ ...pick, [paper.key]: v })}
                      onSupply={() =>
                        run('supply:' + paper.key, () => client!.api.supplyRequiredPaper(detail.importId, { key: paper.key, documentId: pick[paper.key], ...(who ? { by: who } : {}) }), t('tower.imports.supplied'))
                      }
                      onAccept={() => run('accept:' + paper.key, () => client!.api.acceptRequiredPaper(detail.importId, paper.key, { ...(who ? { by: who } : {}) }), t('tower.imports.acceptDone'))}
                      onReject={(why) => run('reject:' + paper.key, () => client!.api.rejectRequiredPaper(detail.importId, paper.key, { reason: why, ...(who ? { by: who } : {}) }), t('tower.imports.rejectDone'))}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}

/** One line of the list: what it is, what happened to it, and whichever single act this reader may take. */
function PaperRow({
  paper,
  detail,
  t,
  busy,
  pick,
  onPick,
  onSupply,
  onAccept,
  onReject,
}: {
  paper: RequiredPaperView;
  detail: ImportDetailView;
  t: ReturnType<typeof useT>;
  busy: string | null;
  pick: string;
  onPick: (v: string) => void;
  onSupply: () => void;
  onAccept: () => void;
  onReject: (reason: string) => void;
}) {
  const [why, setWhy] = useState('');
  const tone = paperTone(paper);
  // The importer attaches from their OWN register — which is why there is no file input on this row.
  const choices: CompanyDocument[] = detail.documents.filter((d) => d.status !== 'superseded');

  return (
    <tr>
      <td>
        <div class="ctbl__strong">{paper.label}</div>
        {paper.copies ? <div class="ctbl__sub">{t('tower.imports.copies', { n: paper.copies })}</div> : null}
        {paper.note ? <div class="ctbl__sub">{paper.note}</div> : null}
        <div class="ctbl__sub">{t('tower.imports.by', { who: paper.addedBy })}</div>
      </td>
      <td>
        <span class={`ctag ${tone === 'ok' ? 'ctag--ok' : tone === 'bad' ? 'ctag--danger' : tone === 'warn' ? 'ctag--warn' : 'ctag--quiet'}`}>{t(`tower.imports.state.${paper.state}` as never)}</span>
        {paper.document ? (
          <div class="ctbl__sub">
            {paper.document.title} · {shortFingerprint(paper.document.fingerprint)}
          </div>
        ) : null}
        {/* Said before it is relied on — never discovered at the counter. */}
        {paper.expired ? <div class="ctbl__sub">{t('tower.imports.expired', { date: paper.document?.expiresAt ?? '' })}</div> : null}
        {paper.stale ? <div class="ctbl__sub">{t('tower.imports.stale')}</div> : null}
        {paper.rejectionReason ? <div class="ctbl__sub">{paper.rejectionReason}</div> : null}
      </td>
      <td class="ctbl__num">
        {detail.youAre === 'importer' ? (
          <>
            <select value={pick} onChange={(e) => onPick((e.target as HTMLSelectElement).value)}>
              <option value="">{t('tower.imports.pick')}</option>
              {choices.map((d) => (
                <option key={d.documentId} value={d.documentId}>
                  {d.title}
                </option>
              ))}
            </select>
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={!pick || busy === 'supply:' + paper.key} onClick={onSupply}>
              {t('tower.imports.supply')}
            </button>
          </>
        ) : detail.youAre === 'agent' && paper.documentId ? (
          <>
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy === 'accept:' + paper.key} onClick={onAccept}>
              {t('tower.imports.accept')}
            </button>
            <input placeholder={t('tower.imports.rejectDone')} value={why} onChange={(e) => setWhy((e.target as HTMLInputElement).value)} />
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={!why.trim() || busy === 'reject:' + paper.key} onClick={() => onReject(why.trim())}>
              {t('tower.imports.reject')}
            </button>
          </>
        ) : null}
      </td>
    </tr>
  );
}
