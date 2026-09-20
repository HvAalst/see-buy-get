import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { AuthImage, Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { useWideScreen } from '../../../shared/useWideScreen';
import { ConsoleAction } from '../ConsoleAction';
import { ConsoleDetail } from '../ConsoleDetail';
import { ConsoleFold } from '../ConsoleFold';
import { PaperFile, PaperFiles } from './PaperFile';
import { PaperHelp } from './PaperHelp';
import { ConsignmentNoteCard } from './ConsignmentNoteCard';
import { publicPageUrl } from '../../../lib/sbg/config';
import { ParticipantPicker } from './ParticipantPicker';
import { SitePicker } from './SitePicker';
import { CountryPicker } from './CountryPicker';
import { useCountryAtlas } from './CountrySelect';
import { ConsoleSelect } from '../ConsoleSelect';
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
  kindForLabel,
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
  type AgentCardView,
  CARGO_NATURES,
  liveGrants,
  outstanding,
  outstandingCount,
  partiesDiffer,
  readersOf,
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
  const [picking, setPicking] = useState(false);
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<Array<{ label: string; copies: string; note: string }>>([{ label: '', copies: '', note: '' }]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [upload, setUpload] = useState({ kind: 'commercial_invoice', title: '', dataUrl: '', expiresAt: '', belongs: 'consignment' });
  const uploadRef = useRef<HTMLElement | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  /**
   * THE DOOR OUT OF A REQUIRED LINE WITH NOTHING TO ATTACH.
   *
   * The form that fixes it was always on this sheet and had no thread back to the line that needed it,
   * so an importer with an empty register was told to choose from a list with nothing in it. This fills
   * the form in from the line — the agent's own wording as the title, and the kind those words describe
   * where they plainly describe one — brings it into view and puts the cursor on the only thing left to
   * supply, the file. Filled in, never submitted: what gets uploaded is still their decision.
   */
  const putOnRecord = useCallback((label: string) => {
    setUpload((was) => ({ ...was, title: label, kind: kindForLabel(label) }));
    // The form is behind a fold now, so the door has to open it as well as point at it.
    setUploadOpen(true);
    // After the paint that closes the sheet the form is filled in and the section is where it will be.
    requestAnimationFrame(() => {
      const section = uploadRef.current;
      if (!section) return;
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      section.querySelector<HTMLInputElement>('input[type="file"]')?.focus();
    });
  }, []);
  const [feeForm, setFeeForm] = useState<FeeQuoteForm>({ ...EMPTY_FEE_FORM });
  const [receiptForm, setReceiptForm] = useState<ReceiptForm>({ ...EMPTY_RECEIPT_FORM });
  const [roadForm, setRoadForm] = useState<RoadLegForm>({ ...EMPTY_ROAD_FORM });
  const [holdForm, setHoldForm] = useState<{ kind: CustomsHoldKind; note: string }>({ kind: 'inspection_selected', note: '' });
  const [holdNote, setHoldNote] = useState<Record<string, string>>({});
  /** This company's own clearance record — null until read, absent for one that clears nothing. */
  const [mine, setMine] = useState<{ record: ClearanceRecordView; measured: string; handle?: string; offer?: { specialisms: string[]; places: string[]; words?: string } } | null>(null);
  /** Their own advertisement, loaded from their page so the form starts where their claim already is. */
  const [offerForm, setOfferForm] = useState<{ specialisms: string[]; places: string; words: string }>({ specialisms: [], places: '', words: '' });
  /** What kind of box, and what is in it. One form for three acts, because they are one conversation. */
  const [cargoForm, setCargoForm] = useState({ containerNo: '', cscPlateDate: '', containerType: '', natureCode: '', cargoHeightM: '', lastCargoes: '', cleanedAt: '', certificateDocumentId: '', unNumber: '', imdgClass: '', shippingName: '' });
  /** The SUGGESTION list — not the boundary of what the server accepts. See the field's own comment. */
  /**
   * Y1 — the box's own dates, kept apart from the cargo declaration because they are a different subject:
   * one describes the goods and the other describes somebody else's asset.
   */
  const [boxForm, setBoxForm] = useState({ arrivedAt: '', freeDayKind: 'detention', freeDays: '', where: '' });
  /** Y2 — the leg home. Its own form, because it is a LOAD being posted rather than a date being recorded. */
  const [homeForm, setHomeForm] = useState({ depotLabel: '', weightKg: '', cargo: '', depotEntityId: '' });
  /**
   * Y4 — the registered yards, so the leg home can NAME one.
   *
   * Picking a yard is what puts the box on that yard's own register when it arrives. A typed label does
   * not: two yards can call themselves the same thing, and matching on words would put somebody else's
   * box on somebody else's list.
   */
  const [depotOptions, setDepotOptions] = useState<Array<{ entityId: string; placeLabel: string; country: string }>>([]);
  /** Y3 — which gate a party is speaking about, and what they are saying. Empty side = the form is shut. */
  const [gateForm, setGateForm] = useState({ side: '', stance: 'damaged', note: '', dataUrl: '' });
  /** One photo open at a time: a thumbnail strip, and a deliberate tap for the full frame. */
  const [bigShot, setBigShot] = useState<string | null>(null);
  /** Refs whose bytes could not be fetched — said in words rather than shown as a grey tile. */
  const [deadShots, setDeadShots] = useState<string[]>([]);
  const [boxes, setBoxes] = useState<Array<{ code: string; label: string; openTop: boolean; kind: string }>>([]);
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

  // The catalogue, once. It is a catalogue and not data: it changes when somebody adds a box we book.
  useEffect(() => {
    if (!client) return;
    void client.api.containerTypes().then((r) => {
      if (!r.error) setBoxes((r.data as unknown as { items: Array<{ code: string; label: string; openTop: boolean; kind: string }> }).items ?? []);
    });
  }, [client]);

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
    // Y4 — the registered yards, so the leg home can name one rather than type a label at it.
    const yards = await client.api.findDepots();
    setDepotOptions(yards.error ? [] : (((yards.data as unknown as { items?: Array<{ entityId: string; placeLabel: string; country: string }> })?.items ?? []) as Array<{ entityId: string; placeLabel: string; country: string }>));
    // What others have been asked for at THIS port — read beside the container, because that is the only
    // place the answer is useful. A port with nothing recorded says so rather than showing an empty table.
    const k = await client.api.knownImportPapers(view.destCountry, view.destPort);
    setKnown(k.error ? [] : (((k.data as unknown as { items?: KnownPaper[] })?.items ?? []) as KnownPaper[]));
    // Start the cargo form where the record already is, so a screen cannot show something the server
    // does not hold.
    setCargoForm((c) => ({
      ...c,
      containerType: view.containerFacts?.code ?? c.containerType,
      containerNo: view.box?.containerNo ?? c.containerNo,
      cscPlateDate: view.box?.cscPlateDate?.slice(0, 10) ?? c.cscPlateDate,
    }));
    if (view.youAre === 'agent') {
      setLines(view.required.length ? view.required.map((r2) => ({ label: r2.label, copies: r2.copies ? String(r2.copies) : '', note: r2.note ?? '' })) : [{ label: '', copies: '', note: '' }]);
    }
  };

  /**
   * A LIST NOBODY CAN GET TO THE BOTTOM OF IS NOT A LIST — the user, at eighty-nine containers.
   *
   * Searched and paged here rather than on the server, because the route already answers with all of them
   * and a screenful is twenty. WHEN IT SHOULD MOVE: the day a company has enough containers that sending
   * them all is the cost — the registers work already has the server-side shape to copy, `{ items, total }`
   * with the search and the page as query parameters, and this is the note that says so out loud.
   */
  const PAGE = 20;
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const slice = onlyWaiting ? (rows ?? []).filter((r) => r.waitingOnYou > 0) : (rows ?? []);
  const found = slice.filter((r) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [r.code, r.containerNo, r.goodsDescription, r.destPort, r.agentName].filter(Boolean).some((f) => String(f).toLowerCase().includes(q));
  });
  const pages = Math.max(1, Math.ceil(found.length / PAGE));
  const shown = found.slice(page * PAGE, page * PAGE + PAGE);
  /*
   * WHETHER "WHICH SIDE ARE YOU ON" IS WORTH SAYING AT ALL.
   *
   * Derived from what is on the screen rather than from who is reading it, because a company can be the
   * importer on one container and the agent clearing another. When every visible row gives the same
   * answer the column is not telling anybody apart, and twenty identical pills are twenty things the eye
   * has to step over on its way to the one that differs.
   */
  const mixedParties = partiesDiffer(shown);
  // A table at a desk, a list in a hand. The same line the navigation and the detail already read.
  const wide = useWideScreen();
  const atlas = useCountryAtlas(client?.api as never);

  const registerFault = registerBlocker(form);
  const publishFault = publishBlocker(lines);
  const waiting = outstandingCount(rows);
  // Derived on every read, never stored — an empty list is not a cleared container, so `done` needs `asked`.
  const ready = detail ? readinessOf(detail) : null;

  /**
   * Y3 — a party's own photograph of the box at a gate.
   *
   * Read straight to a data URL and uploaded as their own media; the server adopts it onto the box, and a
   * ref it cannot adopt is dropped rather than cited.
   */
  const readShot = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setError(t('tower.imports.notAFile'));
    reader.onload = () => setGateForm((g) => ({ ...g, dataUrl: String(reader.result ?? '') }));
    reader.readAsDataURL(file);
  };

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
              <li class="chint">{t('tower.imports.recordThin', { n: mine.record.ratesNeed })}</li>
            ) : (
              <>
                {mine.record.listHours != null ? <li>{t('tower.imports.recordListHours', { h: mine.record.listHours })}</li> : null}
                {mine.record.checkHours != null ? <li>{t('tower.imports.recordCheckHours', { h: mine.record.checkHours })}</li> : null}
              </>
            )}
            {/* Counted, labelled, and not subtracted from anything above it. */}
            {mine.record.holds.recorded > 0 ? (
              <li class="chint">{t('tower.imports.recordHolds', { holds: mine.record.holds.recorded, disputed: mine.record.holds.disputed })}</li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {/*
        * THE TWO THINGS SOMEBODY MIGHT COME HERE TO DO, as two lines rather than two pages of fields.
        *
        * Recording a container is first and the directory entry second, which is the order of how often
        * they are done — the entry is written once and edited rarely, and it was at the top of the
        * screen. The list is what this page is, so it comes after both.
        */}
      {isCompany ? (
        <section class="cons__panel">
          <div class="cdos">
            <ConsoleAction title={t('tower.imports.newTitle')} hint={t('tower.imports.newHint')}>
              {(close) => (
                <>
                  <div class="twr-knobs__row">
                    <label class="twr-knob cfield">
                      <span class="cfield__label">{t('tower.imports.f.goods')}</span>
                      <input class="cinput" value={form.goodsDescription} onChange={(e) => setForm({ ...form, goodsDescription: (e.target as HTMLInputElement).value })} />
                    </label>
                    <div class="twr-knob">
                      <CountryPicker value={form.originCountry} onChange={(originCountry) => setForm({ ...form, originCountry })} label={t('tower.imports.f.origin')} options={atlas} />
                    </div>
                    <div class="twr-knob">
                      <CountryPicker value={form.destCountry} onChange={(destCountry) => setForm({ ...form, destCountry })} label={t('tower.imports.f.dest')} options={atlas} />
                    </div>
                    {/*
                      * TWO PLACES, AND THE ORDER IS THE JOURNEY. Where the vessel puts it down, then
                      * where the customs entry is made. For a coastal import they are the same place
                      * and the first is left empty; for a landlocked one they are Djibouti and Modjo,
                      * and until now the record could only hold one of them.
                      */}
                    <div class="twr-knob">
                      <SitePicker
                        kind="port"
                        entityId={state.who?.entityId ?? ''}
                        api={client?.api as never}
                        value={form.dischargeSiteId}
                        onChange={(dischargeSiteId) => setForm({ ...form, dischargeSiteId })}
                        label={t('tower.imports.f.discharge')}
                        addLabel={t('tower.sites.addPort')}
                      />
                    </div>
                    <div class="twr-knob">
                      <SitePicker
                        kind="clearance"
                        entityId={state.who?.entityId ?? ''}
                        api={client?.api as never}
                        value={form.clearanceSiteId}
                        onChange={(clearanceSiteId) => setForm({ ...form, clearanceSiteId })}
                        label={t('tower.imports.f.clearedAt')}
                        addLabel={t('tower.sites.addClearance')}
                      />
                    </div>
                    <label class="twr-knob cfield">
                      <span class="cfield__label">{t('tower.imports.f.container')}</span>
                      <input class="cinput" value={form.containerNo} onChange={(e) => setForm({ ...form, containerNo: (e.target as HTMLInputElement).value })} />
                    </label>
                    <label class="twr-knob cfield">
                      <span class="cfield__label">{t('tower.imports.f.carrier')}</span>
                      <input class="cinput" value={form.carrierRef} onChange={(e) => setForm({ ...form, carrierRef: (e.target as HTMLInputElement).value })} />
                    </label>
                    <label class="twr-knob cfield">
                      <span class="cfield__label">{t('tower.imports.f.eta')}</span>
                      <input class="cinput" type="date" value={form.etaAt} onChange={(e) => setForm({ ...form, etaAt: (e.target as HTMLInputElement).value })} />
                    </label>
                  </div>
                  <div class="twr-panelend">
                    {registerFault ? <span class="chint">{t(registerFault)}</span> : null}
                    <button
                      type="button"
                      class="cbtn cbtn--primary"
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
                              ...(form.clearanceSiteId ? { clearanceSiteId: form.clearanceSiteId } : {}),
                              ...(form.dischargeSiteId ? { dischargeSiteId: form.dischargeSiteId } : {}),
                              ...(form.containerNo.trim() ? { containerNo: form.containerNo.trim() } : {}),
                              ...(form.carrierRef.trim() ? { carrierRef: form.carrierRef.trim() } : {}),
                              ...(form.etaAt.trim() ? { etaAt: form.etaAt.trim() } : {}),
                              ...(who ? { by: who } : {}),
                            });
                            if (!r.error) setDone(t('tower.imports.registered', { code: (r.data as unknown as { code?: string })?.code ?? '' }));
                            return r;
                          },
                          t('tower.imports.registered', { code: '' }),
                          () => {
                            setForm({ ...EMPTY_IMPORT_FORM });
                            close();
                          },
                        )
                      }
                    >
                      {t('tower.imports.register')}
                    </button>
                  </div>
                </>
              )}
            </ConsoleAction>
            <ConsoleAction title={t('tower.imports.offerTitle')} hint={mine?.handle ? '@' + mine.handle : t('tower.imports.offerLine')}>
              {(close) => (
                <>
                  {/* The one asserted thing in this design, and the hint says so: everything else about them is
                      derived from the record, and a claim shown as a finding would undo the page's whole worth. */}
                  <p class="cons__lede">{t('tower.imports.offerHint')}</p>

                  {/* Not a <label>: the control is a button, and a label wrapping a button either does nothing
                      or fires it twice depending on the browser. */}
                  <div class="cfield">
                    <span class="cfield__label">{t('tower.imports.f.offerSpecialisms')}</span>
                    <ConsoleSelect
                      label={t('tower.imports.f.offerSpecialisms')}
                      options={CLEARANCE_SPECIALISMS.map((sp) => ({ value: sp, label: t(`home.agents.spec.${sp}` as never) }))}
                      chosen={offerForm.specialisms}
                      onChange={(specialisms) => setOfferForm({ ...offerForm, specialisms })}
                      placeholder={t('tower.imports.offerPick')}
                      summary={t('tower.imports.offerChosen', { n: offerForm.specialisms.length, all: CLEARANCE_SPECIALISMS.length })}
                      removeLabel={(what) => t('tower.imports.offerRemove', { what })}
                    />
                  </div>

                  <div class="twr-knobs__row">
                    <label class="twr-knob cfield">
                      <span class="cfield__label">{t('tower.imports.f.offerPlaces')}</span>
                      <input class="cinput" value={offerForm.places} onChange={(e) => setOfferForm({ ...offerForm, places: (e.target as HTMLInputElement).value })} />
                    </label>
                    <label class="twr-knob cfield">
                      <span class="cfield__label">{t('tower.imports.f.offerWords')}</span>
                      <input class="cinput" value={offerForm.words} onChange={(e) => setOfferForm({ ...offerForm, words: (e.target as HTMLInputElement).value })} />
                    </label>
                  </div>

                  <div class="twr-panelend">
                    {offerForm.specialisms.length === 0 ? <span class="chint">{t('tower.imports.offerNeedOne')}</span> : null}
                    <button
                      type="button"
                      class="cbtn cbtn--primary"
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
                          close,
                        )
                      }
                    >
                      {t('tower.imports.offerSave')}
                    </button>
                  </div>
                </>
              )}
            </ConsoleAction>
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

      {/* ---- the containers ---- */}
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{rows === null ? t('tower.imports.loading') : t('tower.imports.count', { n: rows.length })}</span>
          {/*
            * THE WAITING COUNT IS THE FILTER. It was a tag beside a labelled row of buttons reading
            * "Show: All / Waiting on you", which is three controls saying what this one says — and the
            * header already had to carry the number anyway. Pressed, the list is the ones waiting on
            * you; pressed again, it is all of them. Nothing else was ever worth a row of its own.
            *
            * Said here rather than on the navigation badge: a number beside a group reads as a demand,
            * and this one is only meaningful once the list has actually been read.
            */}
          {waiting !== null && waiting > 0 ? (
            <button
              type="button"
              class={`ctag ctag--warn${onlyWaiting ? ' ctag--pressed' : ''}`}
              aria-pressed={onlyWaiting}
              onClick={() => {
                setOnlyWaiting(!onlyWaiting);
                setPage(0);
              }}
            >
              {t('tower.imports.waitingOnYou', { n: waiting })}
            </button>
          ) : null}
          {/* Only where there is a table to search. In a hand the header is two facts and no more — the
              list is scrolled, not queried, and a field here cost more room than it was worth. */}
          {wide && rows !== null && rows.length > PAGE ? (
            <input
              class="cinput cinput--sm twr-find"
              value={query}
              onInput={(e) => {
                setQuery((e.target as HTMLInputElement).value);
                setPage(0);
              }}
              placeholder={t('tower.imports.searchPh')}
              aria-label={t('tower.imports.search')}
            />
          ) : null}
        </div>
        {rows === null ? (
          <p class="cons__empty">{t('tower.imports.loading')}</p>
        ) : rows.length === 0 ? (
          <p class="cons__empty">{isCompany ? t('tower.imports.noneCompany') : t('tower.imports.none')}</p>
        ) : !wide ? (
          /*
            * THE SAME ROWS, AS A LIST YOU RUN YOUR THUMB DOWN. CSS can move a table and cannot turn one
            * into a conversation list — so below the sidebar line this is a different component, the
            * same decision the navigation and the detail already made. The code and the route, because
            * that is how somebody recognises a container at a glance; everything else is one tap away.
            */
          <div class="crows">
            {shown.map((row) => (
              <button
                key={row.importId}
                type="button"
                class={`crow${detail?.importId === row.importId ? ' crow--on' : ''}`}
                onClick={() => (detail?.importId === row.importId ? setDetail(null) : void openOne(row.importId))}
              >
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">{row.code}</span>
                    {row.waitingOnYou ? <span class="ctag ctag--warn">{row.waitingOnYou}</span> : null}
                  </span>
                  <span class="crow__sub">
                    {row.originCountry} → {row.destCountry} · {row.destPort}
                  </span>
                </span>
                <span class="crow__tail">
                  <Icon name="chevronRight" size={16} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <table class="ctbl ctbl--zebra">
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
              {shown.map((row) => (
                <tr key={row.importId} class={detail?.importId === row.importId ? 'is-open' : undefined}>
                  <td>
                    <div class="ctbl__lines">
                      {/* ONE ANCHOR PER ROW, a size larger than everything around it. Twenty rows of
                          13px text differing only in weight is a texture, not a hierarchy. */}
                      <span class="ctbl__lead">{row.code}</span>
                      <span>{row.goodsDescription}</span>
                      {row.containerNo ? <span class="ctbl__mono">{row.containerNo}</span> : null}
                    </div>
                  </td>
                  <td class="ctbl__sub">
                    <span class="ctbl__lbl">{t('tower.imports.col.route')}</span>
                    <div class="ctbl__lines">
                      <span>
                        {row.originCountry} → {row.destCountry} · {row.destPort}
                      </span>
                      {row.etaAt ? <span>{t('tower.imports.eta', { date: row.etaAt })}</span> : null}
                    </div>
                  </td>
                  <td class="ctbl__sub">
                    <span class="ctbl__lbl">{t('tower.imports.col.agent')}</span>
                    <div class="ctbl__lines">
                      {row.agentName ? <span>{row.agentName}</span> : <span class="ctag ctag--quiet">{t('tower.imports.status.open')}</span>}
                      {/* Said only where it DISTINGUISHES one row from another. A company administrator
                          is the importer on every line they can see, so a tag reading "yours" on all
                          eighty-nine of them is eighty-nine pills carrying no information. */}
                      {mixedParties ? <span class="ctag ctag--quiet">{t(`tower.imports.youAre.${row.youAre}` as never)}</span> : null}
                    </div>
                  </td>
                  <td class="ctbl__sub">
                    <span class="ctbl__lbl">{t('tower.imports.col.papers')}</span>
                    {/* A STATE, not a sentence. Four greys in a column are read one at a time; four
                        pills of three colours are read at a glance, which is the whole job here. */}
                    {row.waitingOnYou ? (
                      <span class="ctag ctag--warn">{t('tower.imports.waitingOnYou', { n: row.waitingOnYou })}</span>
                    ) : row.asked ? (
                      <span class={`ctag ${row.accepted >= row.asked ? 'ctag--ok' : 'ctag--quiet'}`}>{t('tower.imports.progress', { accepted: row.accepted, asked: row.asked })}</span>
                    ) : (
                      <span>{t('tower.imports.noneAsked')}</span>
                    )}
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
        {/* THE PAGER, and it says where you are rather than only offering a direction. A list that can
            only go forwards is one you cannot get back out of. */}
        {rows !== null && pages > 1 ? (
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              {t('tower.imports.prev')}
            </button>
            <span class="chint">{t('tower.imports.page', { page: page + 1, pages, shown: shown.length, total: found.length })}</span>
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              {t('tower.imports.next')}
            </button>
          </div>
        ) : null}
      </section>

      {detail ? (
        <ConsoleDetail openKey={detail.importId} title={detail.code} onClose={() => setDetail(null)}>
          {/* CL2b — said the moment the container is opened, never saved up for the moment somebody pays. */}
          {detail.money.why ? (
            <p class="cons__caveat">
              <Icon name="info" size={16} />
              <span>{detail.money.why}</span>
            </p>
          ) : null}


          {/* ---- the agent's side: publish what you need, prompted by what others were asked for ---- */}
          {detail.youAre === 'agent' ? (
            <>
              <ConsoleFold
                title={t('tower.imports.publishTitle')}
                hint={detail.required.length === 0 ? t('tower.imports.fold.notPublished') : t('tower.imports.fold.published', { n: detail.required.length })}
              >
                <p class="cons__lede">{t('tower.imports.publishHint')}</p>
                {lines.map((line, i) => (
                  <div class="twr-knobs__row" key={`line-${i}`}>
                    <label class="twr-knob cfield">
                      <span class="cfield__label">{t('tower.imports.f.label')}</span>
                      <input class="cinput" value={line.label} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, label: (e.target as HTMLInputElement).value } : l)))} />
                    </label>
                    <label class="twr-knob cfield">
                      <span class="cfield__label">{t('tower.imports.f.copies')}</span>
                      <input class="cinput" type="number" min={1} max={50} value={line.copies} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, copies: (e.target as HTMLInputElement).value } : l)))} />
                    </label>
                    <label class="twr-knob cfield">
                      <span class="cfield__label">{t('tower.imports.f.note')}</span>
                      <input class="cinput" value={line.note} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, note: (e.target as HTMLInputElement).value } : l)))} />
                    </label>
                  </div>
                ))}
                <div class="twr-panelend">
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setLines([...lines, { label: '', copies: '', note: '' }])}>
                    {t('tower.imports.addLine')}
                  </button>
                  {publishFault ? <span class="chint">{t(publishFault)}</span> : null}
                  <button
                    type="button"
                    class="cbtn cbtn--primary"
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
              </ConsoleFold>

              <ConsoleFold
                title={t('tower.imports.knownTitle')}
                hint={knownNotAsked(known, lines.filter((l) => l.label.trim())).length === 0 ? t('tower.imports.fold.knownNone') : t('tower.imports.fold.knownNew', { n: knownNotAsked(known, lines.filter((l) => l.label.trim())).length })}
              >
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
                        <div class="chint">{t('tower.imports.knownRow', { agents: k.agents, times: k.times, when: k.lastAskedAt.slice(0, 10) })}</div>
                        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setLines([...lines.filter((l) => l.label.trim()), { label: k.label, copies: '', note: '' }])}>
                          {t('tower.imports.knownAdd')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </ConsoleFold>
            </>
          ) : null}

          {/* ---- the list itself, read by both sides ---- */}
          <ConsoleFold
            title={<>{detail.code} · {t('tower.imports.requiredTitle')}</>}
            hint={ready?.asked ? t('tower.imports.progress', { accepted: ready.accepted, asked: ready.asked }) : t('tower.imports.noneAsked')}
            defaultOpen={detail.waitingOnYou > 0}
          >
            {detail.youAre === 'importer' && detail.required.length > 0 ? <p class="cons__lede">{t('tower.imports.supplyHint')}</p> : null}
            {detail.required.length === 0 ? (
              <p class="cons__empty">{detail.agentEntityId ? t('tower.imports.requiredNone') : t('tower.imports.requiredNoAgent')}</p>
            ) : (
              <table class="ctbl ctbl--stack">
                <tbody>
                  {[...outstanding(detail), ...detail.required.filter((r) => !outstanding(detail).includes(r))].map((paper) => (
                    <PaperRow
                      key={paper.key}
                      paper={paper}
                      detail={detail}
                      t={t}
                      busy={busy}
                      api={client?.api as never}
                      onError={setError}
                      pick={pick[paper.key] ?? ''}
                      onPick={(v) => setPick({ ...pick, [paper.key]: v })}
                      onSupply={() =>
                        run('supply:' + paper.key, () => client!.api.supplyRequiredPaper(detail.importId, { key: paper.key, documentId: pick[paper.key], ...(who ? { by: who } : {}) }), t('tower.imports.supplied'))
                      }
                      onAccept={() => run('accept:' + paper.key, () => client!.api.acceptRequiredPaper(detail.importId, paper.key, { ...(who ? { by: who } : {}) }), t('tower.imports.acceptDone'))}
                      onPutOnRecord={detail.youAre === 'importer' ? putOnRecord : undefined}
                      onReject={(why) => run('reject:' + paper.key, () => client!.api.rejectRequiredPaper(detail.importId, paper.key, { reason: why, ...(who ? { by: who } : {}) }), t('tower.imports.rejectDone'))}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </ConsoleFold>

          {/* ---- what the asking is answered with: the papers this company holds ---- */}
          {detail.youAre === 'importer' ? (
            <>
              {/*
                * THE REGISTER, and until now it was not on the screen at all — these documents existed
                * only as <option> elements inside the attach control on each required line. Somebody
                * who had uploaded ten papers could not see that they had, could not open one to check
                * it was the right scan, and could not tell which of them an agent could already read.
                */}
              <ConsoleFold
                title={t('tower.imports.registerTitle')}
                hint={detail.documents.length === 0 ? t('tower.imports.fold.nothingOnRecord') : t('tower.imports.fold.onRecord', { n: detail.documents.length })}
              >
                <p class="cfield__label">{t('tower.imports.registerFor', { code: detail.code })}</p>
                <PaperFiles empty={t('tower.imports.registerNone')}>
                  {consignmentPapers(detail.documents, detail.code).map((d) => (
                    <PaperFile
                      key={d.documentId}
                      doc={d}
                      importId={detail.importId}
                      api={client?.api as never}
                      readers={readersOf(d, detail.code, detail.grants)}
                      onError={setError}
                    />
                  ))}
                </PaperFiles>
                <p class="cfield__label">{t('tower.imports.registerCompany')}</p>
                <PaperFiles empty={t('tower.imports.registerNone')}>
                  {companyPapers(detail.documents).map((d) => (
                    <PaperFile
                      key={d.documentId}
                      doc={d}
                      importId={detail.importId}
                      api={client?.api as never}
                      readers={readersOf(d, detail.code, detail.grants)}
                      onError={setError}
                    />
                  ))}
                </PaperFiles>
              </ConsoleFold>

              <ConsoleFold
                title={t('tower.imports.uploadTitle')}
                hint={t('tower.imports.fold.addPaper')}
                open={uploadOpen} onOpenChange={setUploadOpen} panelRef={uploadRef}
              >
                <p class="cons__lede">{t('tower.imports.uploadHint')}</p>
                <div class="twr-knobs__row">
                  <label class="twr-knob cfield">
                    <span class="cfield__label">{t('tower.imports.f.kind')}</span>
                    <select class="cinput" value={upload.kind} onChange={(e) => setUpload({ ...upload, kind: (e.target as HTMLSelectElement).value })}>
                      {DOCUMENT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(DOCUMENT_LABEL[k])}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="twr-knob cfield">
                    <span class="cfield__label">{t('tower.imports.f.belongs')}</span>
                    <select class="cinput" value={upload.belongs} onChange={(e) => setUpload({ ...upload, belongs: (e.target as HTMLSelectElement).value })}>
                      <option value="company">{t('tower.imports.belongs.company')}</option>
                      <option value="consignment">{t('tower.imports.belongs.consignment')}</option>
                    </select>
                  </label>
                  <label class="twr-knob cfield">
                    <span class="cfield__label">{t('tower.imports.f.title')}</span>
                    <input class="cinput" value={upload.title} onChange={(e) => setUpload({ ...upload, title: (e.target as HTMLInputElement).value })} />
                  </label>
                  <label class="twr-knob cfield">
                    <span class="cfield__label">{t('tower.imports.f.expires')}</span>
                    <input class="cinput" type="date" value={upload.expiresAt} onChange={(e) => setUpload({ ...upload, expiresAt: (e.target as HTMLInputElement).value })} />
                  </label>
                  <label class="twr-knob cfield">
                    <span class="cfield__label">{t('tower.imports.f.file')}</span>
                    <input class="cinput" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => readFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
                  </label>
                </div>
                <div class="twr-panelend">
                  <button
                    type="button"
                    class="cbtn cbtn--primary"
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
              </ConsoleFold>
            </>
          ) : null}

          {/* ---- CL2b: what the agent charges ---- */}
          <ConsoleFold
            title={t('tower.imports.feeTitle')}
            hint={detail.fee ? `${detail.fee.currency} ${detail.fee.amount}` : t('tower.imports.fold.noFee')}
            aside={<><span class={`ctag ${feeTone(detail.feeState) === 'ok' ? 'ctag--ok' : feeTone(detail.feeState) === 'warn' ? 'ctag--warn' : 'ctag--quiet'}`}>
                {t(`tower.imports.fee.${detail.feeState}` as never)}
              </span></>}
          >
            <p class="cons__lede">{t('tower.imports.feeHint')}</p>

            {detail.fee ? (
              <ul class="twr-checklist">
                <li>
                  <b>
                    {detail.fee.amount.toLocaleString()} {detail.fee.currency}
                  </b>
                  {detail.fee.note ? <div class="chint">{detail.fee.note}</div> : null}
                  <div class="chint">{t('tower.imports.feeBy', { who: detail.fee.quotedBy })}</div>
                  {detail.fee.paidAt ? <div class="chint">{t('tower.imports.feePaid', { when: detail.fee.paidAt.slice(0, 10), reference: detail.fee.reference ?? '' })}</div> : null}
                  {/* Owed, and not yet sent — the books say so and this screen must not imply otherwise. */}
                  {detail.fee.paidAt && detail.agentName ? <div class="chint">{t('tower.imports.feeOwed', { name: detail.agentName })}</div> : null}
                </li>
              </ul>
            ) : null}

            {detail.youAre === 'agent' && detail.feeState !== 'paid' ? (
              <>
                <div class="twr-knobs__row">
                  <label class="twr-knob cfield">
                    <span class="cfield__label">{t('tower.imports.f.amount')}</span>
                    <input class="cinput" type="number" min={1} value={feeForm.amount} onChange={(e) => setFeeForm({ ...feeForm, amount: (e.target as HTMLInputElement).value })} />
                  </label>
                  <label class="twr-knob cfield">
                    <span class="cfield__label">{t('tower.imports.f.feeNote')}</span>
                    <input class="cinput" value={feeForm.note} onChange={(e) => setFeeForm({ ...feeForm, note: (e.target as HTMLInputElement).value })} />
                  </label>
                </div>
                <div class="twr-panelend">
                  {feeQuoteBlocker(feeForm) ? <span class="chint">{t(feeQuoteBlocker(feeForm)!)}</span> : null}
                  <button
                    type="button"
                    class="cbtn cbtn--primary"
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
                  class="cbtn cbtn--primary"
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
                <div class="twr-knobs__row">
                  <label class="twr-knob cfield">
                    <span class="cfield__label">{t('tower.imports.f.reference')}</span>
                    <input class="cinput" value={receiptForm.reference} onChange={(e) => setReceiptForm({ ...receiptForm, reference: (e.target as HTMLInputElement).value })} />
                  </label>
                  <label class="twr-knob cfield">
                    <span class="cfield__label">{t('tower.imports.f.amount')}</span>
                    <input class="cinput" type="number" min={1} value={receiptForm.amount} onChange={(e) => setReceiptForm({ ...receiptForm, amount: (e.target as HTMLInputElement).value })} />
                  </label>
                </div>
                <div class="twr-panelend">
                  {receiptBlocker(receiptForm) ? <span class="chint">{t(receiptBlocker(receiptForm)!)}</span> : null}
                  <button
                    type="button"
                    class="cbtn cbtn--primary"
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
          </ConsoleFold>

          {/* ---- CL2b: the road leg, minted by a person from the port ---- */}
          {detail.youAre === 'importer' ? (
            <ConsoleFold
              title={t('tower.imports.roadTitle')}
              hint={detail.roadFreightCode ? t('tower.imports.fold.road', { code: detail.roadFreightCode }) : t('tower.imports.fold.noRoad')}
            >
              <p class="cons__lede">{t('tower.imports.roadHint')}</p>
              {/*
                * THE JOURNEY, SAID BEFORE THE LEG IS MINTED.
                *
                * A landlocked container is discharged at a coastal port and cleared inland: Djibouti and
                * Modjo, not one place twice. That is TWO road legs — the bonded run to the customs
                * station, then the delivery after release — and this screen can mint one. Saying so is
                * the honest half-measure: the alternative is a screen that quietly mints one leg for a
                * journey with two in it and lets somebody discover the other at a gate.
                */}
              <p class="chint">
                {detail.dischargePort
                  ? t('tower.imports.chainSplit', { quay: detail.dischargePort, counter: detail.destPort })
                  : t('tower.imports.chainSame', { place: detail.destPort })}
              </p>
              {detail.dischargePort && !detail.roadFreightCode ? <p class="cons__caveat">{t('tower.imports.chainOneLeg')}</p> : null}
              {detail.roadFreightCode ? null : (
                <>
                  {/*
                    * BOTH ENDS ARE PLACES, and they are chosen the same way. This asked for a latitude,
                    * a longitude and a sentence — two fields nobody knows by heart and one a driver has
                    * to interpret — for the same port, every time, on every container.
                    */}
                  <div class="twr-knobs__row">
                    <div class="twr-knob">
                      <SitePicker
                        kind="port"
                        entityId={detail.importerEntityId}
                        api={client?.api as never}
                        value={roadForm.pickupSiteId}
                        onChange={(pickupSiteId) => setRoadForm({ ...roadForm, pickupSiteId })}
                        label={t('tower.imports.f.collectedFrom')}
                        addLabel={t('tower.sites.addPort')}
                      />
                    </div>
                    <div class="twr-knob">
                      <SitePicker
                        kind="delivery"
                        entityId={detail.importerEntityId}
                        api={client?.api as never}
                        value={roadForm.destSiteId}
                        onChange={(destSiteId) => setRoadForm({ ...roadForm, destSiteId })}
                        label={t('tower.imports.f.deliverTo')}
                        addLabel={t('tower.sites.addDelivery')}
                      />
                    </div>
                    <label class="twr-knob cfield">
                      <span class="cfield__label">{t('tower.imports.f.weight')}</span>
                      <input class="cinput" type="number" min={1} value={roadForm.weightKg} onChange={(e) => setRoadForm({ ...roadForm, weightKg: (e.target as HTMLInputElement).value })} />
                    </label>
                  </div>
                  <div class="twr-panelend">
                    {roadBlocker(roadForm) ? <span class="chint">{t(roadBlocker(roadForm)!)}</span> : null}
                    <button
                      type="button"
                      class="cbtn cbtn--primary"
                      disabled={Boolean(roadBlocker(roadForm)) || busy === 'road'}
                      onClick={() =>
                        run(
                          'road',
                          () =>
                            client!.api.mintImportRoadLeg(detail.importId, {
                              pickupSiteId: roadForm.pickupSiteId,
                              destSiteId: roadForm.destSiteId,
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
            </ConsoleFold>
          ) : null}

          {/*
            * THE NOTE, WHERE THE LEG IS MADE. The waybill is a legal document and the user's point is
            * the right one: there has to be ONE place the information gathers, or the same facts get
            * typed into a form, a note and an email and disagree with each other by the third copy.
            *
            * This note is derived from what the network already holds — the importer is box 1, the
            * saved places are boxes 3 and 4, the accepted clearance papers are box 5, the container's
            * own declaration is boxes 6 to 12. Nothing on it is typed here.
            *
            * The carrier boxes are EMPTY UNTIL A DRIVER CLAIMS IT, and the screen says which those are
            * rather than showing a page of blanks: a document that looks finished and is not is worse
            * than one that says what it is still waiting for.
            */}
          {detail.roadFreightId ? <ConsignmentNoteCard freightId={detail.roadFreightId} api={client?.api as never} /> : null}

          {/* ---- CL7: what kind of box, and what is in it ---- */}
          <ConsoleFold
            title={t('tower.imports.boxTitle')}
            hint={detail.cargoGaps.length > 0 ? t('tower.imports.fold.gaps', { n: detail.cargoGaps.length }) : t('tower.imports.fold.boxReady')}
            aside={<>{detail.containerFacts ? <span class="ctag ctag--quiet">{detail.containerFacts.label}</span> : null}
              {detail.containerFacts?.outOfGauge ? <span class="ctag ctag--warn">{t('tower.imports.outOfGauge')}</span> : null}</>}
            defaultOpen={detail.cargoGaps.length > 0}
          >

            {/* WHAT IS MISSING, FIRST AND LOUDLY. Each of these is a fact no code, description or weight
                can supply, and each makes the road leg refuse — so it is said from the moment the
                container is recorded rather than discovered by whoever finally tries to mint one. */}
            {detail.cargoGaps.length > 0 ? (
              <div class="cons__caveat">
                <Icon name="warning" size={16} />
                <span>
                  {detail.cargoGaps.map((g, i) => (
                    <div key={i}>{g}</div>
                  ))}
                </span>
              </div>
            ) : null}

            {/* THE BOX'S FACTS, sent by the server from the catalogue rather than worked out here: two
                copies of one table drift, and the copy on the screen drifts silently. */}
            {detail.containerFacts ? (
              <p class="cons__lede">
                {t('tower.imports.boxFacts', {
                  label: detail.containerFacts.label,
                  // A height the CODE does not state says so in words. Four of the size codes mean only
                  // "taller than 2.896 m", and a blank where a height belongs is how somebody assumes one.
                  h: detail.containerFacts.heightUnstated ? t('tower.imports.boxHeightUnstated') : `${detail.containerFacts.heightM!.toFixed(3)} m`,
                  bodies: detail.containerFacts.bodies.join(', '),
                  gear: detail.containerFacts.equipment.join(', '),
                })}
              </p>
            ) : (
              <p class="cons__lede">{t('tower.imports.boxNone')}</p>
            )}

            {detail.youAre === 'importer' ? (
              <>
                <div class="twr-knobs__row">
                  {/* A SUGGESTION LIST AND FREE ENTRY, because the two are different things. The server
                      accepts any code ISO 6346 can build — thousands of combinations, and an unusable
                      dropdown — so the list offers what is common and the field takes whatever is printed
                      on the box. Confusing "what we suggest" with "what we accept" is exactly what made
                      the first version of this a shortlist with an escape hatch bolted onto it. */}
                  {/* THE NUMBER ON THE BOX, and it usually arrives later than the booking: a container is
                      recorded the day it is booked and the bill of lading names it weeks afterwards. The
                      server runs the ISO 6346 check digit over it and refuses one that cannot be right —
                      a wrong number is a box nobody can trace and a clock nobody can stop. */}
                  <label class="twr-knob cfield">
                    <span class="cfield__label">{t('tower.imports.f.containerNo')}</span>
                    <input
                      maxLength={13}
                      placeholder="MSCU1234566"
                      value={cargoForm.containerNo}
                      onChange={(e) => setCargoForm({ ...cargoForm, containerNo: (e.target as HTMLInputElement).value.toUpperCase() })}
                    />
                    <span class="chint">{t('tower.imports.containerNoSub')}</span>
                  </label>
                  {/* The CSC safety-approval plate date. Carried because a haulier at a gate needs it, and
                      NOTHING is said about it: whether the box is fit is a surveyor's verdict, not ours. */}
                  <label class="twr-knob cfield">
                    <span class="cfield__label">{t('tower.imports.f.cscPlateDate')}</span>
                    <input class="cinput" type="date" value={cargoForm.cscPlateDate} onChange={(e) => setCargoForm({ ...cargoForm, cscPlateDate: (e.target as HTMLInputElement).value })} />
                  </label>
                  <label class="twr-knob cfield">
                    <span class="cfield__label">{t('tower.imports.f.box')}</span>
                    <input
                      list="box-codes"
                      maxLength={4}
                      placeholder="45G1"
                      value={cargoForm.containerType}
                      onChange={(e) => setCargoForm({ ...cargoForm, containerType: (e.target as HTMLInputElement).value.toUpperCase() })}
                    />
                    <datalist id="box-codes">
                      {boxes.map((b) => (
                        <option key={b.code} value={b.code}>
                          {b.label}
                        </option>
                      ))}
                    </datalist>
                    <span class="chint">{t('tower.imports.boxAny')}</span>
                  </label>
                  {/* WHAT THE GOODS ARE — the importer's, because we must not read it out of a description.
                      This is the whole distance between a food tank and a fuel tank. */}
                  <label class="twr-knob cfield">
                    <span class="cfield__label">{t('tower.imports.f.nature')}</span>
                    <select class="cinput" value={cargoForm.natureCode} onChange={(e) => setCargoForm({ ...cargoForm, natureCode: (e.target as HTMLSelectElement).value })}>
                      <option value="">{t('tower.imports.naturePick')}</option>
                      {CARGO_NATURES.map((n) => (
                        <option key={n} value={n}>
                          {t(`tower.imports.nature.${n}` as never)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {/* Only for a box with no roof: its own height is the floor the cargo sits on. */}
                  {detail.containerFacts?.openTop || detail.containerFacts?.heightUnstated || boxes.find((b) => b.code === cargoForm.containerType)?.openTop ? (
                    <label class="twr-knob cfield">
                      <span class="cfield__label">{t('tower.imports.f.cargoHeight')}</span>
                      <input class="cinput" type="number" min={0.1} max={10} step={0.05} value={cargoForm.cargoHeightM} onChange={(e) => setCargoForm({ ...cargoForm, cargoHeightM: (e.target as HTMLInputElement).value })} />
                    </label>
                  ) : null}
                </div>

                <div class="twr-panelend">
                  <button
                    type="button"
                    class="cbtn cbtn--primary"
                    disabled={busy === 'cargo'}
                    onClick={() =>
                      run(
                        'cargo',
                        () =>
                          client!.api.declareImportCargo(detail.importId, {
                            ...(cargoForm.containerNo.trim() ? { containerNo: cargoForm.containerNo.trim() } : {}),
                            ...(cargoForm.cscPlateDate ? { cscPlateDate: cargoForm.cscPlateDate } : {}),
                            ...(cargoForm.containerType ? { containerType: cargoForm.containerType } : {}),
                            ...(cargoForm.natureCode ? { natureCode: cargoForm.natureCode } : {}),
                            ...(cargoForm.cargoHeightM.trim() ? { cargoHeightM: Number(cargoForm.cargoHeightM) } : {}),
                            ...(who ? { by: who } : {}),
                          }),
                        t('tower.imports.boxSaved'),
                      )
                    }
                  >
                    {t('tower.imports.boxSave')}
                  </button>
                </div>

                {/* A TANK'S HISTORY, which is the only thing that makes one food-grade. Shown only for a
                    tank: asking everybody for a cleaning certificate is how a form gets ignored. */}
                {detail.containerFacts?.kind === 'tank' ? (
                  <>
                    <p class="cons__lede">{t('tower.imports.tankHint')}</p>
                    <div class="twr-knobs__row">
                      <label class="twr-knob cfield">
                        <span class="cfield__label">{t('tower.imports.f.lastCargoes')}</span>
                        <input class="cinput" value={cargoForm.lastCargoes} onChange={(e) => setCargoForm({ ...cargoForm, lastCargoes: (e.target as HTMLInputElement).value })} />
                      </label>
                      <label class="twr-knob cfield">
                        <span class="cfield__label">{t('tower.imports.f.cleanedAt')}</span>
                        <input class="cinput" type="date" value={cargoForm.cleanedAt} onChange={(e) => setCargoForm({ ...cargoForm, cleanedAt: (e.target as HTMLInputElement).value })} />
                      </label>
                      <label class="twr-knob cfield">
                        <span class="cfield__label">{t('tower.imports.f.cleanCert')}</span>
                        <select class="cinput" value={cargoForm.certificateDocumentId} onChange={(e) => setCargoForm({ ...cargoForm, certificateDocumentId: (e.target as HTMLSelectElement).value })}>
                          <option value="">{t('tower.imports.certNone')}</option>
                          {detail.documents.filter((d) => d.status !== 'superseded').map((d) => (
                            <option key={d.documentId} value={d.documentId}>
                              {d.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div class="twr-panelend">
                      <button
                        type="button"
                        class="cbtn cbtn--ghost cbtn--sm"
                        disabled={!cargoForm.lastCargoes.trim() || busy === 'tank'}
                        onClick={() =>
                          run(
                            'tank',
                            () =>
                              client!.api.declareImportCargo(detail.importId, {
                                tank: {
                                  lastCargoes: cargoForm.lastCargoes.split(',').map((x) => x.trim()).filter(Boolean),
                                  ...(cargoForm.cleanedAt ? { cleanedAt: cargoForm.cleanedAt } : {}),
                                  ...(cargoForm.certificateDocumentId ? { certificateDocumentId: cargoForm.certificateDocumentId } : {}),
                                },
                                ...(who ? { by: who } : {}),
                              }),
                            t('tower.imports.tankSaved'),
                          )
                        }
                      >
                        {t('tower.imports.tankSave')}
                      </button>
                    </div>
                  </>
                ) : null}

                {/* THE DANGEROUS-GOODS DECLARATION. Ours to carry, never to infer: the number decides the
                    placards, the driver's certificate and which roads are closed to the load. */}
                {cargoForm.natureCode.startsWith('HAZ') || (detail.cargoGaps.join(' ').includes('UN number')) ? (
                  <>
                    <p class="cons__lede">{t('tower.imports.dgHint')}</p>
                    <div class="twr-knobs__row">
                      <label class="twr-knob cfield">
                        <span class="cfield__label">{t('tower.imports.f.unNumber')}</span>
                        <input class="cinput" placeholder="UN1202" value={cargoForm.unNumber} onChange={(e) => setCargoForm({ ...cargoForm, unNumber: (e.target as HTMLInputElement).value })} />
                      </label>
                      <label class="twr-knob cfield">
                        <span class="cfield__label">{t('tower.imports.f.imdgClass')}</span>
                        <input class="cinput" placeholder="3" value={cargoForm.imdgClass} onChange={(e) => setCargoForm({ ...cargoForm, imdgClass: (e.target as HTMLInputElement).value })} />
                      </label>
                      <label class="twr-knob cfield">
                        <span class="cfield__label">{t('tower.imports.f.shippingName')}</span>
                        <input class="cinput" value={cargoForm.shippingName} onChange={(e) => setCargoForm({ ...cargoForm, shippingName: (e.target as HTMLInputElement).value })} />
                      </label>
                    </div>
                    <div class="twr-panelend">
                      <button
                        type="button"
                        class="cbtn cbtn--ghost cbtn--sm"
                        disabled={!cargoForm.unNumber.trim() || !cargoForm.imdgClass.trim() || busy === 'dg'}
                        onClick={() =>
                          run(
                            'dg',
                            () =>
                              client!.api.declareImportCargo(detail.importId, {
                                dangerous: {
                                  unNumber: cargoForm.unNumber.trim(),
                                  imdgClass: cargoForm.imdgClass.trim(),
                                  ...(cargoForm.shippingName.trim() ? { properShippingName: cargoForm.shippingName.trim() } : {}),
                                },
                                ...(who ? { by: who } : {}),
                              }),
                            t('tower.imports.dgSaved'),
                          )
                        }
                      >
                        {t('tower.imports.dgSave')}
                      </button>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
          </ConsoleFold>

          {/* ---- Y0 + Y1: the box is somebody else's property, and a clock is running on it ----
              The panel exists whether or not a number has been recorded, because the ABSENCE is the thing
              worth saying: no number means no box, no clock, and nothing anybody can be warned about. */}
          <ConsoleFold
            title={t('tower.imports.clockTitle')}
            hint={detail.box ? detail.box.containerNo : t('tower.imports.fold.notArrived')}
            aside={<>{/* The one figure a reader is looking for, and the only place a state is coloured. */}
              {detail.box?.clock.overdue ? (
                <span class="ctag ctag--warn">{t('tower.imports.clockOverdue', { n: Math.abs(detail.box.clock.daysLeft ?? 0) })}</span>
              ) : detail.box?.clock.daysLeft != null ? (
                <span class="ctag ctag--quiet">{t('tower.imports.clockLeft', { n: detail.box.clock.daysLeft })}</span>
              ) : null}
              {detail.box?.ending ? <span class="ctag ctag--quiet">{t(`tower.imports.clockEnded.${detail.box.ending}` as never)}</span> : null}</>}
          >

            {!detail.box ? (
              <p class="cons__lede">{t('tower.imports.clockNoBox')}</p>
            ) : (
              <>
                {/* THE SENTENCE THE SERVER WROTE, shown verbatim. It names what is being counted and whose
                    numbers produced it — a countdown with nobody's name on it gets read as ours. */}
                <p class="cons__lede">{detail.box.clock.basis}</p>

                <div class="cons__facts">
                  <div class="cons__fact">
                    <span class="cons__factk">{t('tower.imports.clockOwner')}</span>
                    <span class="cons__factv">
                      {detail.box.ownerCode ?? '—'}
                      {detail.box.category ? <span class="chint">{detail.box.category}</span> : null}
                    </span>
                  </div>
                  <div class="cons__fact">
                    <span class="cons__factk">{t('tower.imports.clockOwed')}</span>
                    {/* DERIVED from the appointment. Before anybody is appointed it is nobody, and saying
                        so is better than leaving the row blank for a reader to fill in themselves. */}
                    <span class="cons__factv">{detail.box.owedByName ?? t('tower.imports.clockOwedNobody')}</span>
                  </div>
                  <div class="cons__fact">
                    <span class="cons__factk">{t('tower.imports.clockDates')}</span>
                    <span class="cons__factv">
                      {detail.box.arrivedAt ? t('tower.imports.clockArrived', { d: detail.box.arrivedAt.slice(0, 10) }) : t('tower.imports.clockNoArrival')}
                      {/* The out-gate is the road leg's PICKUP, not the minting of it: a container whose
                          truck has not turned up has not left the terminal, whatever the paperwork says. */}
                      <span class="chint">
                        {detail.box.outGatedAt
                          ? t('tower.imports.clockGated', { d: detail.box.outGatedAt.slice(0, 10) })
                          : detail.roadFreightCode
                            ? t('tower.imports.clockNotGated', { code: detail.roadFreightCode })
                            : t('tower.imports.clockNoLeg')}
                      </span>
                    </span>
                  </div>
                  {detail.box.cscPlateDate ? (
                    <div class="cons__fact">
                      <span class="cons__factk">{t('tower.imports.clockCsc')}</span>
                      {/* Carried, with nothing stated about it: whether a box is FIT is a surveyor's verdict. */}
                      <span class="cons__factv">
                        {detail.box.cscPlateDate.slice(0, 10)}
                        <span class="chint">{t('tower.imports.clockCscSub')}</span>
                      </span>
                    </div>
                  ) : null}
                  {detail.box.timesUsed > 1 ? (
                    <div class="cons__fact">
                      <span class="cons__factk">{t('tower.imports.clockTimes')}</span>
                      {/* The box is not owned by this consignment, and this row is why that matters. */}
                      <span class="cons__factv">{t('tower.imports.clockTimesV', { n: detail.box.timesUsed })}</span>
                    </div>
                  ) : null}
                </div>

                {/* EVERY CLAIM, and not only the one in force — which the drive is what taught. Claim 14
                    detention days on a box still standing in the terminal and the running clock is the
                    demurrage one, so the panel said "nobody has said how many free days" to somebody who
                    had just said it. A correction is also a second claim rather than an edit, so both the
                    old figure and who moved it stay readable. */}
                {detail.box.freeDays.length > 0 ? (
                  <p class="cons__lede">
                    {detail.box.freeDays
                      .map((c) => t('tower.imports.clockClaim', { kind: c.kind, n: c.days, by: c.by, d: c.at.slice(0, 10) }))
                      .join(' · ')}
                  </p>
                ) : null}

                {/* A figure recorded against the clock that is NOT running. It is not doing nothing, and it
                    is not being ignored: it starts counting when that clock starts. */}
                {detail.box.freeDays.length > 0 && detail.box.clock.freeDays == null && detail.box.clock.kind !== 'stopped' ? (
                  <p class="chint">{t('tower.imports.clockClaimIdle')}</p>
                ) : null}

                {/* ---- Y3: what the box looked like at each gate ----
                    "You damaged my box" against "it was like that when we took it" is an argument with no
                    evidence, and the importer loses it by default. Both gates are always listed, because a
                    gate nobody recorded is the one where that argument will happen. */}
                <div class="cons__gates">
                  {detail.box.interchange.map((g) => (
                    <div key={g.side} class="cons__gate">
                      <div class="cons__gatehead">
                        <span class="cons__gatet">{t(`tower.imports.gate.${g.side}` as never)}</span>
                        {g.at ? <span class="chint">{g.at.slice(0, 10)}</span> : null}
                        {/* Nothing adjudicates two accounts that disagree. The screen says they disagree. */}
                        {g.disputed ? <span class="ctag ctag--warn">{t('tower.imports.gateDisputed')}</span> : null}
                      </div>

                      {!g.stated ? (
                        <p class="chint">{t('tower.imports.gateNothing')}</p>
                      ) : (
                        g.accounts.map((a, i) => (
                          <div key={`${a.by}-${a.at}-${i}`} class="cons__account">
                            <p class="cons__lede">
                              <b>{t(`tower.imports.stance.${a.stance}` as never)}</b>
                              {' — '}
                              {a.by}
                              {/* The derived account is the driver's photograph being READ as condition
                                  evidence. Fair, and not the same as somebody saying it, so it says so. */}
                              {a.derived ? ` · ${t('tower.imports.gateDerived')}` : ''}
                              {a.note ? ` · “${a.note}”` : ''}
                            </p>
                            {a.photoRefs.length ? (
                              <div class="cons__shots">
                                {a.photoRefs.map((ref) => (
                                  <button
                                    key={`${ref}-${bigShot === ref ? 'full' : 'thumb'}`}
                                    type="button"
                                    class={`cons__shot${bigShot === ref ? ' cons__shot--big' : ''}`}
                                    onClick={() => setBigShot(bigShot === ref ? null : ref)}
                                    title={t('tower.imports.gateOpen')}
                                  >
                                    {/* Thumbnails until somebody asks for the full frame — the same rule the
                                        driver's hazard photos follow, and for the same reason. */}
                                    <AuthImage
                                      key={`${ref}-${bigShot === ref ? 'full' : 'thumb'}`}
                                      mediaId={ref}
                                      alt={t('tower.imports.gatePhotoAlt')}
                                      load={(id) => client!.api.boxPhoto(detail.importId, id, bigShot === ref ? 'full' : 'thumb') as never}
                                      onFailed={() => setDeadShots((d) => (d.includes(ref) ? d : [...d, ref]))}
                                    />
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))
                      )}
                      {/* A photograph the record cites and nobody can open is the "2 photos, none shown"
                          defect. Said in words rather than left as a grey tile. */}
                      {g.photoRefs.some((r) => deadShots.includes(r)) ? <p class="chint">{t('tower.imports.gateDead')}</p> : null}

                      {!detail.box!.ending || g.side === 'in' ? (
                        <div class="twr-panelend">
                          <button type="button" class="cbtn cbtn--ghost" disabled={busy === `gate-${g.side}`} onClick={() => setGateForm({ side: g.side, stance: 'damaged', note: '', dataUrl: '' })}>
                            {t('tower.imports.gateSay')}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>

                {gateForm.side ? (
                  <>
                    <p class="chint">{t('tower.imports.gateFormHint')}</p>
                    <div class="twr-knobs__row">
                      <label class="twr-knob cfield">
                        <span class="cfield__label">{t('tower.imports.f.stance')}</span>
                        <select class="cinput" value={gateForm.stance} onChange={(e) => setGateForm({ ...gateForm, stance: (e.target as HTMLSelectElement).value })}>
                          <option value="damaged">{t('tower.imports.stance.damaged')}</option>
                          <option value="sound">{t('tower.imports.stance.sound')}</option>
                        </select>
                      </label>
                      <label class="twr-knob cfield">
                        <span class="cfield__label">{t('tower.imports.f.gateNote')}</span>
                        <input class="cinput" value={gateForm.note} onChange={(e) => setGateForm({ ...gateForm, note: (e.target as HTMLInputElement).value })} placeholder={t('tower.imports.f.gateNotePh')} />
                      </label>
                      <label class="twr-knob cfield">
                        <span class="cfield__label">{t('tower.imports.f.gatePhoto')}</span>
                        <input class="cinput" type="file" accept="image/*" onChange={(e) => readShot((e.target as HTMLInputElement).files?.[0] ?? null)} />
                      </label>
                    </div>
                    <div class="twr-panelend">
                      <button
                        type="button"
                        class="cbtn cbtn--primary"
                        disabled={busy === `gate-${gateForm.side}`}
                        onClick={() =>
                          run(
                            `gate-${gateForm.side}`,
                            async () => {
                              // The photograph is uploaded as the caller's OWN media first; the server then
                              // adopts it. A ref it cannot adopt is dropped rather than cited.
                              let photoIds: string[] = [];
                              if (gateForm.dataUrl) {
                                const up = await client!.api.uploadMedia('interchange', gateForm.dataUrl);
                                const id = (up.data as { mediaId?: string } | null)?.mediaId;
                                if (id) photoIds = [id];
                              }
                              return client!.api.recordInterchange(detail.importId, {
                                side: gateForm.side as 'out' | 'in',
                                stance: gateForm.stance as 'sound' | 'damaged',
                                ...(gateForm.note.trim() ? { note: gateForm.note.trim() } : {}),
                                ...(photoIds.length ? { photoIds } : {}),
                                ...(who ? { by: who } : {}),
                              });
                            },
                            t('tower.imports.gateSaid'),
                            () => setGateForm({ side: '', stance: 'damaged', note: '', dataUrl: '' }),
                          )
                        }
                      >
                        {t('tower.imports.gateSaysave')}
                      </button>
                    </div>
                  </>
                ) : null}
                {/* ---- Y2: the leg home, laden or empty ----
                    The leg a laden run inland always implies, and which nothing modelled: no driver was
                    ever offered it, so the agent arranged it by telephone and the board could not see it. */}
                {detail.box.returnLegCode ? (
                  <p class="cons__lede">
                    {t(`tower.imports.homeLeg.${detail.box.returnLegState ?? 'posted'}` as never, {
                      code: detail.box.returnLegCode,
                      depot: detail.box.returnDepot ?? '—',
                    })}
                    {detail.box.returnEmpty ? ` ${t('tower.imports.homeEmpty')}` : ` ${t('tower.imports.homeLaden')}`}
                  </p>
                ) : !detail.box.ending ? (
                  <>
                    <p class="chint">{t('tower.imports.homeHint')}</p>
                    <div class="twr-knobs__row">
                      {/* Y4 — PICK a registered yard where there is one: that is what puts the box on
                          that yard's own list when it arrives. A typed label does not, and matching two
                          yards that call themselves the same thing would be worse than not trying. */}
                      {depotOptions.length ? (
                        <label class="twr-knob cfield">
                          <span class="cfield__label">{t('tower.imports.f.depotPick')}</span>
                          <select
                            value={homeForm.depotEntityId}
                            onChange={(e) => {
                              const id = (e.target as HTMLSelectElement).value;
                              const yard = depotOptions.find((d) => d.entityId === id);
                              setHomeForm({ ...homeForm, depotEntityId: id, depotLabel: yard ? yard.placeLabel : homeForm.depotLabel });
                            }}
                          >
                            <option value="">{t('tower.imports.depotPickNone')}</option>
                            {depotOptions.map((d) => (
                              <option key={d.entityId} value={d.entityId}>
                                {d.placeLabel} · {d.country}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label class="twr-knob cfield">
                        <span class="cfield__label">{t('tower.imports.f.depot')}</span>
                        <input class="cinput" value={homeForm.depotLabel} onChange={(e) => setHomeForm({ ...homeForm, depotLabel: (e.target as HTMLInputElement).value })} placeholder={t('tower.imports.f.depotPh')} />
                      </label>
                      {/* THE TARE, and it is asked for rather than invented: an empty container is not a
                          light one, and the figure is painted on the door of the thing they are next to. */}
                      <label class="twr-knob cfield">
                        <span class="cfield__label">{t('tower.imports.f.homeWeight')}</span>
                        <input class="cinput" type="number" min={1} step={50} value={homeForm.weightKg} onChange={(e) => setHomeForm({ ...homeForm, weightKg: (e.target as HTMLInputElement).value })} placeholder="2200" />
                      </label>
                      {/* Empty is the DEFAULT here only because it is the simpler form to leave blank —
                          the laden case is the commoner one, and saying what is in it is one field. */}
                      <label class="twr-knob cfield">
                        <span class="cfield__label">{t('tower.imports.f.homeCargo')}</span>
                        <input class="cinput" value={homeForm.cargo} onChange={(e) => setHomeForm({ ...homeForm, cargo: (e.target as HTMLInputElement).value })} placeholder={t('tower.imports.f.homeCargoPh')} />
                      </label>
                    </div>
                    <div class="twr-panelend">
                      <button
                        type="button"
                        class="cbtn cbtn--primary"
                        disabled={busy === 'homeLeg' || !homeForm.depotLabel.trim() || !homeForm.weightKg.trim()}
                        onClick={() =>
                          run(
                            'homeLeg',
                            () =>
                              client!.api.mintReturnLeg(detail.importId, {
                                depotLabel: homeForm.depotLabel.trim(),
                                ...(homeForm.depotEntityId ? { depotEntityId: homeForm.depotEntityId } : {}),
                                weightKg: Number(homeForm.weightKg),
                                ...(homeForm.cargo.trim() ? { cargo: homeForm.cargo.trim() } : {}),
                                ...(who ? { by: who } : {}),
                              }),
                            homeForm.cargo.trim() ? t('tower.imports.homeSavedLaden') : t('tower.imports.homeSavedEmpty'),
                          )
                        }
                      >
                        {t('tower.imports.homeSave')}
                      </button>
                    </div>
                  </>
                ) : null}

                {!detail.box.ending ? (
                  <>
                    <div class="twr-knobs__row">
                      <label class="twr-knob cfield">
                        <span class="cfield__label">{t('tower.imports.f.arrivedAt')}</span>
                        <input class="cinput" type="date" value={boxForm.arrivedAt} onChange={(e) => setBoxForm({ ...boxForm, arrivedAt: (e.target as HTMLInputElement).value })} />
                      </label>
                      {/* THE IMPORTER'S ALONE, and not as an access rule: the free days are in their own
                          contract with the line, so nobody else is in a position to state the figure. */}
                      {detail.youAre === 'importer' ? (
                        <>
                          <label class="twr-knob cfield">
                            <span class="cfield__label">{t('tower.imports.f.freeDayKind')}</span>
                            <select class="cinput" value={boxForm.freeDayKind} onChange={(e) => setBoxForm({ ...boxForm, freeDayKind: (e.target as HTMLSelectElement).value })}>
                              <option value="detention">{t('tower.imports.freeDays.detention')}</option>
                              <option value="demurrage">{t('tower.imports.freeDays.demurrage')}</option>
                            </select>
                          </label>
                          <label class="twr-knob cfield">
                            <span class="cfield__label">{t('tower.imports.f.freeDays')}</span>
                            <input class="cinput" type="number" min={0} max={365} step={1} value={boxForm.freeDays} onChange={(e) => setBoxForm({ ...boxForm, freeDays: (e.target as HTMLInputElement).value })} />
                          </label>
                        </>
                      ) : null}
                      <label class="twr-knob cfield">
                        <span class="cfield__label">{t('tower.imports.f.endedWhere')}</span>
                        <input class="cinput" value={boxForm.where} onChange={(e) => setBoxForm({ ...boxForm, where: (e.target as HTMLInputElement).value })} placeholder={t('tower.imports.f.endedWherePh')} />
                      </label>
                    </div>

                    <div class="twr-panelend">
                      <button
                        type="button"
                        class="cbtn cbtn--primary"
                        disabled={busy === 'boxArrived' || !boxForm.arrivedAt}
                        onClick={() =>
                          run('boxArrived', () => client!.api.recordBoxArrival(detail.importId, { at: boxForm.arrivedAt, ...(who ? { by: who } : {}) }), t('tower.imports.clockArrivedSaved'))
                        }
                      >
                        {t('tower.imports.clockArrivedSave')}
                      </button>
                      {detail.youAre === 'importer' ? (
                        <button
                          type="button"
                          class="cbtn cbtn--primary"
                          disabled={busy === 'boxFreeDays' || !boxForm.freeDays.trim()}
                          onClick={() =>
                            run(
                              'boxFreeDays',
                              () =>
                                client!.api.claimBoxFreeDays(detail.importId, {
                                  kind: boxForm.freeDayKind as 'demurrage' | 'detention',
                                  days: Number(boxForm.freeDays),
                                  ...(who ? { by: who } : {}),
                                }),
                              t('tower.imports.clockFreeDaysSaved'),
                            )
                          }
                        >
                          {t('tower.imports.clockFreeDaysSave')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        class="cbtn cbtn--primary"
                        disabled={busy === 'boxReturned'}
                        onClick={() =>
                          run(
                            'boxReturned',
                            () => client!.api.endBox(detail.importId, { kind: 'returned', ...(boxForm.where.trim() ? { where: boxForm.where.trim() } : {}), ...(who ? { by: who } : {}) }),
                            t('tower.imports.clockReturnedSaved'),
                          )
                        }
                      >
                        {t('tower.imports.clockReturnedSave')}
                      </button>
                      {/* THE ENDING A FIRST DRAFT FORGETS. Containers are traded goods: sold in the market
                          and never returned. Without this button the only way to stop the clock on a box
                          somebody bought would be to lie and call it returned. */}
                      <button
                        type="button"
                        class="cbtn cbtn--ghost"
                        disabled={busy === 'boxBought'}
                        onClick={() =>
                          run(
                            'boxBought',
                            () => client!.api.endBox(detail.importId, { kind: 'bought', ...(boxForm.where.trim() ? { note: boxForm.where.trim() } : {}), ...(who ? { by: who } : {}) }),
                            t('tower.imports.clockBoughtSaved'),
                          )
                        }
                      >
                        {t('tower.imports.clockBoughtSave')}
                      </button>
                    </div>
                    <p class="chint">{t('tower.imports.clockHint')}</p>
                  </>
                ) : (
                  <p class="chint">{t('tower.imports.clockEndedHint')}</p>
                )}
              </>
            )}
          </ConsoleFold>

          {/* ---- CL4 item 1: what the state did, and the two accounts of it ---- */}
          <ConsoleFold
            title={t('tower.imports.holdsTitle')}
            hint={detail.customsHolds.length === 0 ? t('tower.imports.fold.holdsNone') : detail.customsHolds.some((h) => !h.releasedAt) ? t('tower.imports.fold.holdsOpen', { n: detail.customsHolds.filter((h) => !h.releasedAt).length }) : t('tower.imports.fold.holdsClear')}
            defaultOpen={detail.customsHolds.some((h) => !h.releasedAt)}
          >
            {/* Said before the form, because this field's whole risk is being read as an excuse box. It is
                not counted against the agent anywhere, and it is not counted FOR them either. */}
            <p class="cons__lede">{t('tower.imports.holdsHint')}</p>

            {detail.customsHolds.length === 0 ? (
              <p class="cons__empty">{t('tower.imports.holdsNone')}</p>
            ) : (
              <ul class="twr-checklist">
                {detail.customsHolds.map((h) => (
                  <li key={h.holdId}>
                    <b>{t(`tower.imports.holdKind.${h.kind}` as never)}</b> · <span class="chint">{new Date(h.at).toLocaleDateString()}</span>
                    {h.releasedAt ? <span class="ctag ctag--ok">{t('tower.imports.holdReleased', { on: new Date(h.releasedAt).toLocaleDateString() })}</span> : null}
                    {/* A disputed hold is still SHOWN, and marked. Nothing here is ever deleted: the two
                        accounts stand side by side and a reader weighs them, which is not our job. */}
                    {holdDisputed(h) ? <span class="ctag ctag--warn">{t('tower.imports.holdDisputed')}</span> : null}
                    {h.accounts.map((a, i) => (
                      <div key={`${h.holdId}-${i}`} class="chint">
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
          </ConsoleFold>

          {/* ---- set once: who may read these papers, and who clears them ---- */}
          {detail.youAre === 'importer' ? (
            <>
              <ConsoleFold
                title={t('tower.imports.grantsTitle')}
                hint={liveGrants(detail.grants).length === 0 ? t('tower.imports.fold.noReaders') : t('tower.imports.fold.readers', { n: liveGrants(detail.grants).length })}
              >
                {liveGrants(detail.grants).length === 0 ? (
                  <p class="cons__empty">{t('tower.imports.grantsNone')}</p>
                ) : (
                  /*
                    * WHO FIRST, THEN WHAT THEY CAN READ. This was a three-column grid printing
                    * `partner-et-djibouti-clearing-lj2ga` — a primary key, wrapped over three lines in a
                    * column too narrow to hold it. Somebody deciding whether to revoke access to their
                    * own commercial papers was being asked to recognise a slug.
                    *
                    * The row reads as a list entry: the company's NAME, then the scope and how many
                    * papers it actually opens, then who gave it and when. Where the reader has a public
                    * page the row IS the link to it, opening in a new tab — the way to go and read who
                    * somebody is before deciding what they may see, with no journey to come back from.
                    */
                  <div class="crows">
                    {liveGrants(detail.grants).map((g) => {
                      const reaches = g.reaches ?? (g.scope === 'company' ? companyPapers(detail.documents).length : consignmentPapers(detail.documents, detail.code).length);
                      const page = g.readerHandle ? publicPageUrl(g.readerHandle) : null;
                      const inside = (
                        <>
                          <span class="crow__body">
                            <span class="crow__top">
                              <span class="crow__name">{g.readerName ?? g.readerEntityId}</span>
                              {g.readerHandle ? <span class="ctag ctag--quiet">@{g.readerHandle}</span> : null}
                            </span>
                            <span class="crow__sub">
                              {t(`tower.imports.grant.${g.scope}` as never)} · {reaches === 0 ? t('tower.imports.grantNoPapers') : t('tower.imports.grantPapers', { n: reaches })}
                            </span>
                            <span class="chint">{t('tower.imports.grant.since', { when: g.grantedAt.slice(0, 10), who: g.grantedBy })}</span>
                          </span>
                          <span class="crow__tail">{page ? <Icon name="chevronRight" size={16} /> : null}</span>
                        </>
                      );
                      return page ? (
                        <a key={g.grantId} class="crow" href={page} target="_blank" rel="noopener noreferrer">
                          {inside}
                        </a>
                      ) : (
                        <div key={g.grantId} class="crow">
                          {inside}
                        </div>
                      );
                    })}
                  </div>
                )}
              </ConsoleFold>

              <ConsoleFold
                title={detail.agentEntityId ? t('tower.imports.revokeTitle') : t('tower.imports.appointTitle')}
                hint={detail.agentName ?? t('tower.imports.fold.noAgent')}
              >
                <p class="cons__lede">{t('tower.imports.appointHint')}</p>
                {detail.agentEntityId ? (
                  <div class="twr-knobs__row">
                    <label class="twr-knob cfield">
                      <span class="cfield__label">{t('tower.imports.f.reason')}</span>
                      <input class="cinput" value={reason} onChange={(e) => setReason((e.target as HTMLInputElement).value)} />
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
                  <>
                    {/*
                      * CHOSEN FROM THE DIRECTORY, not typed. This asked for the agent's COMPANY ID —
                      * a primary key nobody knows, obtainable only if the agent sent it to you out of
                      * band, which is the exact gap the public finder was built to close.
                      */}
                    <div class="twr-panelend">
                      <button type="button" class="cbtn cbtn--primary" onClick={() => setPicking(true)}>
                        {t('tower.imports.chooseAgent')}
                      </button>
                    </div>
                    <ParticipantPicker
                      open={picking}
                      title={t('tower.imports.chooseAgent')}
                      actionLabel={t('tower.imports.appoint')}
                      onClose={() => setPicking(false)}
                      kinds={[
                        {
                          key: 'agents',
                          labelKey: 'tower.pick.agents',
                          /*
                           * ONE KIND, so the picker draws no tab bar. Appointing a clearing agent
                           * accepts a company that clears and nothing else; offering drivers and shops
                           * beside it would present four wrong answers and one right one.
                           *
                           * AND NO COUNTRY FILTER, which the drive argued me out of. Filtering to the
                           * container's destination is logically right — an agent clears at the border
                           * the goods arrive at — and it answered with NOTHING for every container in
                           * the sandbox, because the agents are registered next door. An empty list
                           * from a filter nobody chose is the wall again. Every row carries its own
                           * country instead, so an importer can see who is where and decide; a
                           * registered address is not the same thing as where somebody works.
                           */
                          load: async () => {
                            const r = await (client!.api as never as { findAgents: (q: { country?: string }) => Promise<{ data?: unknown }> }).findAgents({});
                            const got = (r.data ?? { items: [], basis: '' }) as { items: AgentCardView[]; basis: string };
                            return {
                              /*
                               * THE SENTENCE, NOT THE TOKEN. This route answers `basis:
                               * "alphabetical-never-ranked"`, which is a machine word — the public
                               * finder screen quietly ignores it and renders its own sentence. Printing
                               * it verbatim would put a slug in front of a reader, so this does the
                               * same as that screen. Worth saying that it is the odd one out: every
                               * other basis in this product (the contact card, the yard register, the
                               * saved places, the clearance record) is a sentence the server sends so
                               * no screen can show the figures without it.
                               */
                              basis: t('tower.pick.agentsBasis', { n: got.items.length, country: detail.destCountry }),
                              rows: got.items.map((a) => ({
                                id: a.entityId,
                                name: a.name,
                                ...(a.handle ? { handle: a.handle } : {}),
                                ...(a.country ? { country: a.country } : {}),
                                ...(a.offer?.specialisms?.length ? { says: a.offer.specialisms.map((s: string) => t(`home.agents.spec.${s}` as never)).join(', ') } : {}),
                                seen: a.thin ? t('tower.imports.agentNew') : t('tower.imports.agentSeen', { appointed: a.appointed, cleared: a.cleared }),
                                ...(a.contact?.phone ? { phone: a.contact.phone } : {}),
                              })),
                            };
                          },
                        },
                      ]}
                      onPick={(row) => {
                        setPicking(false);
                        void run('appoint', () => client!.api.appointClearingAgent(detail.importId, { agentEntityId: row.id, ...(who ? { by: who } : {}) }), t('tower.imports.appointed', { name: row.name }));
                      }}
                    />
                  </>
                )}
              </ConsoleFold>
            </>
          ) : null}
        </ConsoleDetail>
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
  api,
  onError,
  pick,
  onPick,
  onSupply,
  onAccept,
  onReject,
  onPutOnRecord,
}: {
  paper: RequiredPaperView;
  detail: ImportDetailView;
  t: ReturnType<typeof useT>;
  busy: string | null;
  api: Parameters<typeof PaperFile>[0]['api'];
  onError: (message: string) => void;
  pick: string;
  onPick: (v: string) => void;
  onSupply: () => void;
  onAccept: () => void;
  onReject: (reason: string) => void;
  onPutOnRecord?: (label: string) => void;
}) {
  const [why, setWhy] = useState('');
  const tone = paperTone(paper);
  // The importer attaches from their OWN register — which is why there is no file input on this row.
  const choices: CompanyDocument[] = detail.documents.filter((d) => d.status !== 'superseded');

  return (
    <tr>
      <td>
        <div class="ctbl__strong">{paper.label}</div>
        {paper.copies ? <div class="chint">{t('tower.imports.copies', { n: paper.copies })}</div> : null}
        {paper.note ? <div class="chint">{paper.note}</div> : null}
        <div class="chint">{t('tower.imports.by', { who: paper.addedBy })}</div>
      </td>
      <td>
        <span class={`ctag ${tone === 'ok' ? 'ctag--ok' : tone === 'bad' ? 'ctag--danger' : tone === 'warn' ? 'ctag--warn' : 'ctag--quiet'}`}>{t(`tower.imports.state.${paper.state}` as never)}</span>
        {/* THE PAPER ITSELF, where the judgement is made. An agent was being asked to accept or reject
            a document on the strength of its title and eight characters of fingerprint. */}
        {paper.document ? (
          <>
            <div class="chint">{shortFingerprint(paper.document.fingerprint)}</div>
            <PaperFile doc={paper.document} importId={detail.importId} api={api} onError={onError} />
          </>
        ) : null}
        {/* Said before it is relied on — never discovered at the counter. */}
        {paper.expired ? <div class="chint">{t('tower.imports.expired', { date: paper.document?.expiresAt ?? '' })}</div> : null}
        {paper.stale ? <div class="chint">{t('tower.imports.stale')}</div> : null}
        {paper.rejectionReason ? <div class="chint">{paper.rejectionReason}</div> : null}
      </td>
      {/* NOT `ctbl__num`. That class is for a column of figures and sets `white-space: nowrap`, so a
          cell holding a full-width select and a button beside it could not put them on two lines — the
          select took the width and the button went off the right of the phone. A cell of controls is a
          row that wraps, and the wrapping belongs to a div INSIDE the cell: a class that changes
          `display` on a `<td>` collapses the row into one anonymous cell, which this table has been
          bitten by before and the stylesheet guard now refuses. */}
      <td>
        {detail.youAre === 'importer' ? (
          <div class="twr-panelend">
            {/* An empty dropdown is not a choice, it is a dead end wearing a control's clothes. Where
                there is nothing to choose, say so and let the "i" beside it explain the way out. */}
            {choices.length === 0 ? (
              <span class="chint">{t('tower.imports.pickNone')}</span>
            ) : (
              <select class="cinput" value={pick} onChange={(e) => onPick((e.target as HTMLSelectElement).value)}>
                <option value="">{t('tower.imports.pick')}</option>
                {choices.map((d) => (
                  <option key={d.documentId} value={d.documentId}>
                    {d.title}
                  </option>
                ))}
              </select>
            )}
            {choices.length > 0 ? (
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={!pick || busy === 'supply:' + paper.key} onClick={onSupply}>
                {t('tower.imports.supply')}
              </button>
            ) : null}
            <PaperHelp paper={paper} hasPapers={choices.length > 0} onPutOnRecord={onPutOnRecord} />
          </div>
        ) : detail.youAre === 'agent' && paper.documentId ? (
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy === 'accept:' + paper.key} onClick={onAccept}>
              {t('tower.imports.accept')}
            </button>
            <input class="cinput" placeholder={t('tower.imports.rejectDone')} value={why} onChange={(e) => setWhy((e.target as HTMLInputElement).value)} />
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={!why.trim() || busy === 'reject:' + paper.key} onClick={() => onReject(why.trim())}>
              {t('tower.imports.reject')}
            </button>
          </div>
        ) : null}
      </td>
    </tr>
  );
}
