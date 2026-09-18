import { useCallback, useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { DOCUMENT_KINDS, DOCUMENT_LABEL, shortFingerprint, type CompanyDocument } from '../company';
import {
  EMPTY_FEE_FORM,
  EMPTY_IMPORT_FORM,
  EMPTY_RECEIPT_FORM,
  EMPTY_ROAD_FORM,
  companyPapers,
  consignmentPapers,
  feeQuoteBlocker,
  feeTone,
  knownNotAsked,
  receiptBlocker,
  roadBlocker,
  type FeeQuoteForm,
  type ReceiptForm,
  type RoadLegForm,
  CUSTOMS_HOLD_KINDS,
  holdDisputed,
  type CustomsHoldKind,
  type ClearanceRecordView,
  CLEARANCE_SPECIALISMS,
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
  const [feeForm, setFeeForm] = useState<FeeQuoteForm>({ ...EMPTY_FEE_FORM });
  const [receiptForm, setReceiptForm] = useState<ReceiptForm>({ ...EMPTY_RECEIPT_FORM });
  const [roadForm, setRoadForm] = useState<RoadLegForm>({ ...EMPTY_ROAD_FORM });
  const [holdForm, setHoldForm] = useState<{ kind: CustomsHoldKind; note: string }>({ kind: 'inspection_selected', note: '' });
  const [holdNote, setHoldNote] = useState<Record<string, string>>({});
  /** This company's own clearance record — null until read, absent for one that clears nothing. */
  const [mine, setMine] = useState<{ record: ClearanceRecordView; measured: string; handle?: string; offer?: { specialisms: string[]; places: string[]; words?: string } } | null>(null);
  /** Their own advertisement, loaded from their page so the form starts where their claim already is. */
  const [offerForm, setOfferForm] = useState<{ specialisms: string[]; places: string; words: string }>({ specialisms: [], places: '', words: '' });
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

    // Their own record, read here because this is where an agent works. A company that has never been
    // appointed gets nothing rather than a panel of zeroes, which would read as a bad record.
    const entityId = state.who?.entityId;
    if (entityId) {
      const mineR = await client.api.clearanceRecord(entityId);
      const got = mineR.error
        ? null
        : (mineR.data as unknown as { record: ClearanceRecordView; measured: string; handle?: string; offer?: { specialisms: string[]; places: string[]; words?: string } });
      setMine(got);
      // Their advertisement comes back WITH their record — one read, one source. A form loaded from
      // somewhere other than the object a shipper reads is a form that can silently disagree with it.
      if (got?.offer) setOfferForm({ specialisms: got.offer.specialisms, places: got.offer.places.join(', '), words: got.offer.words ?? '' });
    }
  }, [client, state.who?.entityId]);

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

      {/* ---- CL4 item 1: this company's OWN clearance record, if they clear anything ---- */}
      {mine && mine.record.appointed > 0 ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.imports.recordTitle')}</span>
          </div>
          {/* THE SAME OBJECT A SHIPPER READS at /@handle, field for field. Reciprocal visibility is the
              condition that makes publishing a bad figure fair: a record handed down is a verdict, one
              both parties hold is an account. So this is their copy, not a private version of it. */}
          <p class="cons__lede">{t('tower.imports.recordMine')}</p>
          <p class="cons__caveat">{mine.measured}</p>
          <ul class="twr-checklist">
            <li>{t('tower.imports.recordAppointed', { n: mine.record.appointed })}</li>
            <li>{t('tower.imports.recordListed', { n: mine.record.listed })}</li>
            <li>{t('tower.imports.recordCleared', { n: mine.record.cleared })}</li>
            {mine.record.listedLate > 0 ? (
              <li>
                <span class="ctag ctag--warn">{t('tower.imports.recordLate', { n: mine.record.listedLate, papers: mine.record.latePapers })}</span>
              </li>
            ) : (
              <li>{t('tower.imports.recordNoLate')}</li>
            )}
            {mine.record.thin ? (
              <li class="ctbl__sub">{t('tower.imports.recordThin', { n: mine.record.ratesNeed })}</li>
            ) : (
              <>
                {mine.record.listHours != null ? <li>{t('tower.imports.recordListHours', { h: mine.record.listHours })}</li> : null}
                {mine.record.checkHours != null ? <li>{t('tower.imports.recordCheckHours', { h: mine.record.checkHours })}</li> : null}
              </>
            )}
            {/* Counted, labelled, and not subtracted from anything above it. */}
            {mine.record.holds.recorded > 0 ? (
              <li class="ctbl__sub">{t('tower.imports.recordHolds', { holds: mine.record.holds.recorded, disputed: mine.record.holds.disputed })}</li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {/* ---- CL6: what this company SAYS it clears. Their advertisement, and their words ---- */}
      {isCompany ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.imports.offerTitle')}</span>
            {mine?.handle ? <span class="ctag ctag--quiet">@{mine.handle}</span> : null}
          </div>
          {/* The one asserted thing in this design, and the hint says so: everything else about them is
              derived from the record, and a claim shown as a finding would undo the page's whole worth. */}
          <p class="cons__lede">{t('tower.imports.offerHint')}</p>

          <div class="twr-pick__list" style="max-height:none">
            {CLEARANCE_SPECIALISMS.map((sp) => {
              const on = offerForm.specialisms.includes(sp);
              return (
                <button
                  key={sp}
                  type="button"
                  class={`twr-pick__one${on ? ' twr-pick__one--on' : ''}`}
                  onClick={() =>
                    setOfferForm({
                      ...offerForm,
                      specialisms: on ? offerForm.specialisms.filter((x) => x !== sp) : [...offerForm.specialisms, sp],
                    })
                  }
                >
                  <span class="twr-pick__n">{t(`home.agents.spec.${sp}` as never)}</span>
                </button>
              );
            })}
          </div>

          <div class="twr-knobs">
            <label class="twr-knob">
              <span>{t('tower.imports.f.offerPlaces')}</span>
              <input value={offerForm.places} onChange={(e) => setOfferForm({ ...offerForm, places: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="twr-knob">
              <span>{t('tower.imports.f.offerWords')}</span>
              <input value={offerForm.words} onChange={(e) => setOfferForm({ ...offerForm, words: (e.target as HTMLInputElement).value })} />
            </label>
          </div>

          <div class="twr-panelend">
            {offerForm.specialisms.length === 0 ? <span class="ctbl__sub">{t('tower.imports.offerNeedOne')}</span> : null}
            <button
              type="button"
              class="cbtn"
              disabled={offerForm.specialisms.length === 0 || busy === 'offer'}
              onClick={() =>
                run(
                  'offer',
                  () =>
                    client!.api.setClearanceOffer(state.who!.entityId!, {
                      specialisms: offerForm.specialisms,
                      places: offerForm.places
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean),
                      ...(offerForm.words.trim() ? { words: offerForm.words.trim() } : {}),
                      ...(who ? { by: who } : {}),
                    }),
                  t('tower.imports.offerSaved'),
                )
              }
            >
              {t('tower.imports.offerSave')}
            </button>
          </div>
        </section>
      ) : null}
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
          {/* CL2b — said the moment the container is opened, never saved up for the moment somebody pays. */}
          {detail.money.why ? (
            <p class="cons__caveat">
              <Icon name="info" size={16} />
              <span>{detail.money.why}</span>
            </p>
          ) : null}

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

          {/* ---- CL2b: what the agent charges ---- */}
          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.imports.feeTitle')}</span>
              <span class={`ctag ${feeTone(detail.feeState) === 'ok' ? 'ctag--ok' : feeTone(detail.feeState) === 'warn' ? 'ctag--warn' : 'ctag--quiet'}`}>
                {t(`tower.imports.fee.${detail.feeState}` as never)}
              </span>
            </div>
            <p class="cons__lede">{t('tower.imports.feeHint')}</p>

            {detail.fee ? (
              <ul class="twr-checklist">
                <li>
                  <b>
                    {detail.fee.amount.toLocaleString()} {detail.fee.currency}
                  </b>
                  {detail.fee.note ? <div class="ctbl__sub">{detail.fee.note}</div> : null}
                  <div class="ctbl__sub">{t('tower.imports.feeBy', { who: detail.fee.quotedBy })}</div>
                  {detail.fee.paidAt ? <div class="ctbl__sub">{t('tower.imports.feePaid', { when: detail.fee.paidAt.slice(0, 10), reference: detail.fee.reference ?? '' })}</div> : null}
                  {/* Owed, and not yet sent — the books say so and this screen must not imply otherwise. */}
                  {detail.fee.paidAt && detail.agentName ? <div class="ctbl__sub">{t('tower.imports.feeOwed', { name: detail.agentName })}</div> : null}
                </li>
              </ul>
            ) : null}

            {detail.youAre === 'agent' && detail.feeState !== 'paid' ? (
              <>
                <div class="twr-knobs">
                  <label class="twr-knob">
                    <span>{t('tower.imports.f.amount')}</span>
                    <input type="number" min={1} value={feeForm.amount} onChange={(e) => setFeeForm({ ...feeForm, amount: (e.target as HTMLInputElement).value })} />
                  </label>
                  <label class="twr-knob">
                    <span>{t('tower.imports.f.feeNote')}</span>
                    <input value={feeForm.note} onChange={(e) => setFeeForm({ ...feeForm, note: (e.target as HTMLInputElement).value })} />
                  </label>
                </div>
                <div class="twr-panelend">
                  {feeQuoteBlocker(feeForm) ? <span class="ctbl__sub">{t(feeQuoteBlocker(feeForm)!)}</span> : null}
                  <button
                    type="button"
                    class="cbtn"
                    disabled={Boolean(feeQuoteBlocker(feeForm)) || busy === 'fee'}
                    onClick={() =>
                      run(
                        'fee',
                        () => client!.api.quoteClearanceFee(detail.importId, { amount: Number(feeForm.amount), ...(feeForm.note.trim() ? { note: feeForm.note.trim() } : {}), ...(who ? { by: who } : {}) }),
                        t('tower.imports.quoted'),
                        () => setFeeForm({ ...EMPTY_FEE_FORM }),
                      )
                    }
                  >
                    {t('tower.imports.quote')}
                  </button>
                </div>
              </>
            ) : null}

            {detail.youAre === 'importer' && detail.feeState === 'quoted' ? (
              <div class="twr-panelend">
                <button
                  type="button"
                  class="cbtn"
                  disabled={busy === 'feeAccept'}
                  onClick={() => run('feeAccept', () => client!.api.acceptClearanceFee(detail.importId, { ...(who ? { by: who } : {}) }), t('tower.imports.feeAccepted'))}
                >
                  {t('tower.imports.feeAccept')}
                </button>
              </div>
            ) : null}

            {/* Network staff only: money is created by an observed event with a reference, never by a claim. */}
            {!isCompany && detail.feeState === 'accepted' ? (
              <>
                <p class="cons__lede">{t('tower.imports.receiptHint')}</p>
                <div class="twr-knobs">
                  <label class="twr-knob">
                    <span>{t('tower.imports.f.reference')}</span>
                    <input value={receiptForm.reference} onChange={(e) => setReceiptForm({ ...receiptForm, reference: (e.target as HTMLInputElement).value })} />
                  </label>
                  <label class="twr-knob">
                    <span>{t('tower.imports.f.amount')}</span>
                    <input type="number" min={1} value={receiptForm.amount} onChange={(e) => setReceiptForm({ ...receiptForm, amount: (e.target as HTMLInputElement).value })} />
                  </label>
                </div>
                <div class="twr-panelend">
                  {receiptBlocker(receiptForm) ? <span class="ctbl__sub">{t(receiptBlocker(receiptForm)!)}</span> : null}
                  <button
                    type="button"
                    class="cbtn"
                    disabled={Boolean(receiptBlocker(receiptForm)) || busy === 'receipt'}
                    onClick={() =>
                      run(
                        'receipt',
                        () =>
                          client!.api.recordClearanceReceipt(detail.importId, {
                            reference: receiptForm.reference.trim(),
                            ...(receiptForm.amount.trim() ? { amount: Number(receiptForm.amount) } : {}),
                            ...(who ? { by: who } : {}),
                          }),
                        t('tower.imports.received'),
                        () => setReceiptForm({ ...EMPTY_RECEIPT_FORM }),
                      )
                    }
                  >
                    {t('tower.imports.recordReceipt')}
                  </button>
                </div>
              </>
            ) : null}
          </section>

          {/* ---- CL2b: the road leg, minted by a person from the port ---- */}
          {detail.youAre === 'importer' ? (
            <section class="cons__panel">
              <div class="cons__panelhead">
                <span class="cons__panelt">{t('tower.imports.roadTitle')}</span>
                {detail.roadFreightCode ? <span class="ctag ctag--ok">{t('tower.imports.roadAlready', { code: detail.roadFreightCode })}</span> : null}
              </div>
              <p class="cons__lede">{t('tower.imports.roadHint')}</p>
              {detail.roadFreightCode ? null : (
                <>
                  <div class="twr-knobs">
                    <label class="twr-knob">
                      <span>{t('tower.imports.f.portLat')}</span>
                      <input value={roadForm.lat} onChange={(e) => setRoadForm({ ...roadForm, lat: (e.target as HTMLInputElement).value })} />
                    </label>
                    <label class="twr-knob">
                      <span>{t('tower.imports.f.portLng')}</span>
                      <input value={roadForm.lng} onChange={(e) => setRoadForm({ ...roadForm, lng: (e.target as HTMLInputElement).value })} />
                    </label>
                    <label class="twr-knob">
                      <span>{t('tower.imports.f.roadDest')}</span>
                      <input value={roadForm.destLabel} onChange={(e) => setRoadForm({ ...roadForm, destLabel: (e.target as HTMLInputElement).value })} />
                    </label>
                    <label class="twr-knob">
                      <span>{t('tower.imports.f.weight')}</span>
                      <input type="number" min={1} value={roadForm.weightKg} onChange={(e) => setRoadForm({ ...roadForm, weightKg: (e.target as HTMLInputElement).value })} />
                    </label>
                  </div>
                  <div class="twr-panelend">
                    {roadBlocker(roadForm) ? <span class="ctbl__sub">{t(roadBlocker(roadForm)!)}</span> : null}
                    <button
                      type="button"
                      class="cbtn"
                      disabled={Boolean(roadBlocker(roadForm)) || busy === 'road'}
                      onClick={() =>
                        run(
                          'road',
                          () =>
                            client!.api.mintImportRoadLeg(detail.importId, {
                              pickupLocation: { lat: Number(roadForm.lat), lng: Number(roadForm.lng) },
                              destLabel: roadForm.destLabel.trim(),
                              weightKg: Number(roadForm.weightKg),
                              ...(who ? { by: who } : {}),
                            }),
                          t('tower.imports.roadMinted', { code: '' }),
                          () => setRoadForm({ ...EMPTY_ROAD_FORM }),
                        )
                      }
                    >
                      {t('tower.imports.mintRoad')}
                    </button>
                  </div>
                </>
              )}
            </section>
          ) : null}

          {/* ---- CL4 item 1: what the state did, and the two accounts of it ---- */}
          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.imports.holdsTitle')}</span>
              {detail.customsHolds.length ? <span class="ctag ctag--quiet">{detail.customsHolds.length}</span> : null}
            </div>
            {/* Said before the form, because this field's whole risk is being read as an excuse box. It is
                not counted against the agent anywhere, and it is not counted FOR them either. */}
            <p class="cons__lede">{t('tower.imports.holdsHint')}</p>

            {detail.customsHolds.length === 0 ? (
              <p class="cons__empty">{t('tower.imports.holdsNone')}</p>
            ) : (
              <ul class="twr-checklist">
                {detail.customsHolds.map((h) => (
                  <li key={h.holdId}>
                    <b>{t(`tower.imports.holdKind.${h.kind}` as never)}</b> · <span class="ctbl__sub">{new Date(h.at).toLocaleDateString()}</span>
                    {h.releasedAt ? <span class="ctag ctag--ok">{t('tower.imports.holdReleased', { on: new Date(h.releasedAt).toLocaleDateString() })}</span> : null}
                    {/* A disputed hold is still SHOWN, and marked. Nothing here is ever deleted: the two
                        accounts stand side by side and a reader weighs them, which is not our job. */}
                    {holdDisputed(h) ? <span class="ctag ctag--warn">{t('tower.imports.holdDisputed')}</span> : null}
                    {h.accounts.map((a, i) => (
                      <div key={`${h.holdId}-${i}`} class="ctbl__sub">
                        {a.stance === 'disputed' ? t('tower.imports.holdSaysNot') : t('tower.imports.holdSays')}
                        {a.note ? ` — “${a.note}”` : ''} · {a.by}
                      </div>
                    ))}
                    {isCompany ? (
                      <div class="twr-panelend">
                        {/* Either party may answer, and the server refuses a dispute with no words: a bare
                            contradiction is something nobody can weigh. */}
                        <input
                          class="cinput cinput--sm"
                          placeholder={t('tower.imports.f.holdAnswer')}
                          value={holdNote[h.holdId] ?? ''}
                          onChange={(e) => setHoldNote({ ...holdNote, [h.holdId]: (e.target as HTMLInputElement).value })}
                        />
                        <button
                          type="button"
                          class="cbtn cbtn--ghost cbtn--sm"
                          disabled={busy === `hold:${h.holdId}`}
                          onClick={() =>
                            run(
                              `hold:${h.holdId}`,
                              () =>
                                client!.api.answerCustomsHold(detail.importId, h.holdId, {
                                  stance: 'disputed',
                                  ...(holdNote[h.holdId]?.trim() ? { note: holdNote[h.holdId].trim() } : {}),
                                  ...(who ? { by: who } : {}),
                                }),
                              t('tower.imports.holdAnswered'),
                              () => setHoldNote({ ...holdNote, [h.holdId]: '' }),
                            )
                          }
                        >
                          {t('tower.imports.holdDispute')}
                        </button>
                        {h.releasedAt ? null : (
                          <button
                            type="button"
                            class="cbtn cbtn--ghost cbtn--sm"
                            disabled={busy === `release:${h.holdId}`}
                            onClick={() =>
                              run(`release:${h.holdId}`, () => client!.api.releaseCustomsHold(detail.importId, h.holdId, { ...(who ? { by: who } : {}) }), t('tower.imports.holdReleasedOk'))
                            }
                          >
                            {t('tower.imports.holdRelease')}
                          </button>
                        )}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {isCompany ? (
              <div class="twr-panelend">
                <select class="cinput cinput--sm" value={holdForm.kind} onChange={(e) => setHoldForm({ ...holdForm, kind: (e.target as HTMLSelectElement).value as CustomsHoldKind })}>
                  {CUSTOMS_HOLD_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`tower.imports.holdKind.${k}` as never)}
                    </option>
                  ))}
                </select>
                <input class="cinput cinput--sm" placeholder={t('tower.imports.f.holdNote')} value={holdForm.note} onChange={(e) => setHoldForm({ ...holdForm, note: (e.target as HTMLInputElement).value })} />
                <button
                  type="button"
                  class="cbtn cbtn--ghost cbtn--sm"
                  disabled={busy === 'hold'}
                  onClick={() =>
                    run(
                      'hold',
                      () =>
                        client!.api.recordCustomsHold(detail.importId, {
                          kind: holdForm.kind,
                          ...(holdForm.note.trim() ? { note: holdForm.note.trim() } : {}),
                          ...(who ? { by: who } : {}),
                        }),
                      t('tower.imports.holdRecorded'),
                      () => setHoldForm({ kind: 'inspection_selected', note: '' }),
                    )
                  }
                >
                  {t('tower.imports.holdRecord')}
                </button>
              </div>
            ) : null}
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
