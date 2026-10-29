import { useCallback, useEffect, useState } from 'preact/hooks';
import { DocumentButton } from '../../../shared/ui';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { tabAtTheTap } from '../../../shared/openPage';
import { useT, type MessageKey } from '../../../shared/i18n';
import { ConsolePick } from '../../tower/ConsolePick';
import { ParticipantPicker } from '../../tower/screens/ParticipantPicker';
import { ExportSli } from './ExportSli';
import { ExportPacking } from './ExportPacking';
import { ExportInvoice } from './ExportInvoice';
import { CurrencySelect } from '../../tower/screens/CurrencySelect';
import { QuotePanel } from '../../tower/screens/QuotePanel';
import { SitePicker } from '../../tower/screens/SitePicker';
import type { BusinessClient, BusinessView } from '../api';
import { ASKED_PAPERS, boxLine, boxTag, dayWords, freeDaysOf, fromUtcInput, paperKindFor, timingLine, timingTag, utcWords, type ExportDetail, type ExportPaperGroup, type ExportPaperKey, type ExportRow } from '../exports';
import { isDangerousNature, mayAct } from '../logic';
import { RailNotePanel } from '../../tower/screens/RailNotePanel';
import { ExportByRail } from './ExportByRail';
import { AirWaybillPanel, RegisterAirExport } from './ExportByAir';
import { exportJourney, JourneyStrip, ModeFilter, modesPresent, type LegMode } from '../../tower/screens/JourneyStrip';
import { FblPanel, FiataDirectoryHint, fileAsDataUrl } from '../../tower/screens/FblPanel';

type Problem = { detail?: string; title: string } | null | undefined;

/** A leg's state in words, never the machine's own. */
const LEG_WORD: Record<string, MessageKey> = {
  scheduled: 'business.exports.leg.scheduled',
  available: 'business.exports.leg.available',
  claimed: 'business.exports.leg.claimed',
  in_transit: 'business.exports.leg.in_transit',
  delivered: 'business.exports.leg.delivered',
  cancelled: 'business.exports.leg.cancelled',
};
const sayProblem = (e: Problem) => (e ? e.detail || e.title : null);

/** The catalogue's papers in this reader's words; one asked for by name is said by its name. */
const PAPER_WORD: Record<string, MessageKey> = {
  commercial_invoice: 'business.exports.paper.commercial_invoice',
  packing_list: 'business.exports.paper.packing_list',
  export_entry: 'business.exports.paper.export_entry',
  booking_confirmation: 'business.exports.paper.booking_confirmation',
  shipping_instructions: 'business.exports.paper.shipping_instructions',
  weighbridge_ticket: 'business.exports.paper.weighbridge_ticket',
  bill_of_lading: 'business.exports.paper.bill_of_lading',
  certificate_of_origin: 'business.exports.paper.certificate_of_origin',
  phytosanitary_certificate: 'business.exports.paper.phytosanitary_certificate',
  fumigation_certificate: 'business.exports.paper.fumigation_certificate',
  export_permit: 'business.exports.paper.export_permit',
  inspection_certificate: 'business.exports.paper.inspection_certificate',
  certificate_of_analysis: 'business.exports.paper.certificate_of_analysis',
  health_certificate: 'business.exports.paper.health_certificate',
  insurance_certificate: 'business.exports.paper.insurance_certificate',
  dangerous_goods_declaration: 'business.exports.paper.dangerous_goods_declaration',
  letter_of_credit: 'business.exports.paper.letter_of_credit',
};

const PAPER_GROUPS: ExportPaperGroup[] = ['needed', 'asked', 'kept'];
const GROUP_WORD: Record<ExportPaperGroup, MessageKey> = {
  needed: 'business.exports.papers.groupNeeded',
  asked: 'business.exports.papers.groupAsked',
  kept: 'business.exports.papers.groupKept',
};

/**
 * EXPORTS TO THE PORT (the user, 2026-10-27: "The missing for goods going to a port should be build"). The business's own
 * exports: its forwarder's booking and the gate cut-off, the empty out, the box stuffed and sealed, the load to the
 * terminal, the verified gross mass, the papers, and the file its forwarder takes at the gate. SeeBuyGet books no ship.
 */
export function ExportsScreen({ business, client }: { business: BusinessView; client: BusinessClient | null }) {
  const t = useT();
  const works = mayAct(business.you.role);
  // A business that sends goods records its exports; a clearing agent only reads the ones it was appointed to clear.
  const sends = business.activities.some((a) => a === 'shipper' || a === 'expeditor');
  const [rows, setRows] = useState<ExportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Recording one: by sea through a port, or by air through an airport (2026-10-29).
  const [forming, setForming] = useState<'sea' | 'air' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // The list by its modes (2026-10-29): all, or those with a leg of one mode.
  const [mode, setMode] = useState<LegMode | ''>('');

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.exports.list();
    if (r.error) setError(sayProblem(r.error));
    else setRows(r.data?.items ?? []);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div class="cons__page">
      <header class="cons__head">
        <h1 class="cons__title">{t('business.exports.title')}</h1>
        <p class="cons__lede">{t('business.exports.lede')}</p>
        {business.activities.includes('clearing_agent') ? <p class="chint">{t('business.exports.agentLede')}</p> : null}
      </header>
      {error ? <p class="cerr">{error}</p> : null}

      {works && sends && client && !forming ? (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--primary" onClick={() => setForming('sea')}>
            {t('business.exports.recordSea')}
          </button>
          <button type="button" class="cbtn cbtn--primary" onClick={() => setForming('air')}>
            {t('business.exports.recordAir')}
          </button>
        </div>
      ) : null}
      {forming === 'air' && client ? (
        <RegisterAirExport
          business={business}
          client={client}
          onDone={async (exportId) => {
            setForming(null);
            await load();
            if (exportId) setOpenId(exportId);
          }}
        />
      ) : null}
      {forming === 'sea' && client ? (
        <RegisterExport
          business={business}
          client={client}
          onDone={async (exportId) => {
            setForming(null);
            await load();
            if (exportId) setOpenId(exportId);
          }}
        />
      ) : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t(sends ? 'business.exports.listTitle' : 'business.exports.listTitleAgent')}</span>
        </div>
        <ModeFilter present={modesPresent(rows ?? [])} value={mode} onChange={setMode} />
        {rows === null ? (
          <p class="cons__empty">{t('business.loading')}</p>
        ) : rows.length === 0 ? (
          <p class="cons__empty">{t(sends ? 'business.exports.none' : 'business.exports.noneAgent')}</p>
        ) : (
          <div class="crows">
            {rows.filter((r) => !mode || (r.modes ?? []).includes(mode)).map((r) => {
              const tag = timingTag(r.timing, t);
              const clock = boxTag(r.box, t);
              return (
                <button type="button" class="crow" key={r.exportId} onClick={() => setOpenId(openId === r.exportId ? null : r.exportId)} aria-expanded={openId === r.exportId}>
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name">
                        {r.code} — {r.goodsDescription}
                      </span>
                      <span class={`ctag ctag--${tag.tone}`}>{tag.word}</span>
                      {clock ? <span class={`ctag ctag--${clock.tone}`}>{clock.word}</span> : null}
                    </span>
                    {r.you === 'agent' ? <span class="crow__sub">{t('business.exports.rowFor', { exporter: r.exporterName })}</span> : null}
                    <span class="crow__sub">{r.mode === 'air' ? t('business.exports.rowLineAir', { airport: r.loadingPort, awb: r.bookingReference, cutoff: utcWords(r.gateCutoffAt) }) : t('business.exports.rowLine', { port: r.loadingPort, booking: r.bookingReference, cutoff: utcWords(r.gateCutoffAt) })}</span>
                    {r.missing ? <span class="crow__sub">{t(r.mode === 'air' ? 'business.exports.rowMissingAir' : 'business.exports.rowMissing', { n: r.missing })}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {openId && client ? <ExportPanel key={openId} exportId={openId} business={business} client={client} works={works} onChanged={load} /> : null}
    </div>
  );
}

/** The goods, the box, the forwarder's booking with its cut-offs, and the three places. */
function RegisterExport({ business, client, onDone }: { business: BusinessView; client: BusinessClient; onDone: (exportId?: string) => void | Promise<void> }) {
  const t = useT();
  const [form, setForm] = useState({ goods: '', from: business.country ?? '', to: '', port: '', box: '', reference: '', bookedWith: 'forwarder' as 'forwarder' | 'shipping_line', party: '', vessel: '', voyage: '', gateCutoff: '', vgmCutoff: '', docsCutoff: '', release: '' });
  const [sites, setSites] = useState({ loading: '', terminal: '', depot: '' });
  const [ownBox, setOwnBox] = useState(false);
  const [boxes, setBoxes] = useState<Array<{ code: string; label: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: Event) => setForm({ ...form, [k]: (e.target as HTMLInputElement).value });

  useEffect(() => {
    void client.api.containerTypes().then((r) => {
      const items = (r.data as { items?: Array<{ code: string; label: string }> } | undefined)?.items ?? [];
      setBoxes(items);
    });
  }, [client]);

  const send = async () => {
    setBusy(true);
    setError(null);
    const r = await client.exports.register({
      goodsDescription: form.goods.trim(),
      originCountry: form.from.trim(),
      destCountry: form.to.trim(),
      loadingPort: form.port.trim(),
      containerType: form.box.trim(),
      booking: {
        reference: form.reference.trim(),
        bookedWith: form.bookedWith,
        partyName: form.party.trim(),
        ...(form.vessel.trim() ? { vessel: form.vessel.trim() } : {}),
        ...(form.voyage.trim() ? { voyage: form.voyage.trim() } : {}),
        gateCutoffAt: fromUtcInput(form.gateCutoff) ?? '',
        ...(fromUtcInput(form.vgmCutoff) ? { vgmCutoffAt: fromUtcInput(form.vgmCutoff) } : {}),
        ...(fromUtcInput(form.docsCutoff) ? { docsCutoffAt: fromUtcInput(form.docsCutoff) } : {}),
        ...(form.release.trim() ? { emptyReleaseRef: form.release.trim() } : {}),
      },
      loadingSiteId: sites.loading,
      terminalSiteId: sites.terminal,
      ...(sites.depot ? { emptyDepotSiteId: sites.depot } : {}),
      ...(ownBox ? { ownBox: true } : {}),
    });
    setBusy(false);
    if (r.error) return setError(sayProblem(r.error));
    await onDone(r.data?.exportId);
  };

  const field = (k: keyof typeof form, label: MessageKey, extra: Record<string, string> = {}) => (
    <label class="cfield">
      <span class="cfield__label">{t(label)}</span>
      <input class="cinput" value={form[k]} onInput={set(k)} {...extra} />
    </label>
  );
  const api = client.api as never;
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.exports.f.title')}</span>
      </div>
      <p class="chint">{t('business.exports.f.hint')}</p>
      {field('goods', 'business.exports.f.goods', { maxLength: '300' })}
      <div class="biz-two">
        {field('from', 'business.exports.f.from', { maxLength: '2', placeholder: 'KE' })}
        {field('to', 'business.exports.f.to', { maxLength: '2', placeholder: 'NL' })}
      </div>
      <div class="biz-two">
        {field('port', 'business.exports.f.port', { maxLength: '80', placeholder: 'Mombasa' })}
        <div class="twr-knob">
          <ConsolePick label={t('business.exports.f.box')} value={form.box} onChange={(box) => setForm({ ...form, box })} options={boxes.map((b) => ({ value: b.code, label: b.code, sub: b.label }))} placeholder="45G1" allowFree={(typed) => (/^[A-Za-z0-9]{4}$/.test(typed) ? typed.toUpperCase() : null)} />
        </div>
      </div>
      <label class="cfield--check">
        <input type="checkbox" checked={ownBox} onChange={() => setOwnBox((v) => !v)} />
        <span>{t('business.exports.f.ownBox')}</span>
      </label>
      <h3 class="cons__sub">{t('business.exports.f.bookingTitle')}</h3>
      <p class="chint">{t('business.exports.f.bookingHint')}</p>
      <div class="biz-two">
        {field('reference', 'business.exports.f.reference', { maxLength: '60' })}
        <ConsolePick
          label={t('business.exports.f.bookedWith')}
          value={form.bookedWith}
          options={[
            { value: 'forwarder', label: t('business.exports.f.forwarder') },
            { value: 'shipping_line', label: t('business.exports.f.line') },
          ]}
          onChange={(v) => setForm({ ...form, bookedWith: v as 'forwarder' | 'shipping_line' })}
        />
      </div>
      {field('party', 'business.exports.f.party', { maxLength: '120' })}
      <div class="biz-two">
        {field('vessel', 'business.exports.f.vessel', { maxLength: '80' })}
        {field('voyage', 'business.exports.f.voyage', { maxLength: '40' })}
      </div>
      <div class="biz-two">
        {field('gateCutoff', 'business.exports.f.gateCutoff', { type: 'datetime-local' })}
        {field('vgmCutoff', 'business.exports.f.vgmCutoff', { type: 'datetime-local' })}
      </div>
      <div class="biz-two">
        {field('docsCutoff', 'business.exports.f.docsCutoff', { type: 'datetime-local' })}
        {field('release', 'business.exports.f.release', { maxLength: '60' })}
      </div>
      <p class="chint">{t('business.exports.f.utc')}</p>
      <h3 class="cons__sub">{t('business.exports.f.placesTitle')}</h3>
      <SitePicker kind="loading" entityId={business.entityId} api={api} value={sites.loading} onChange={(loading) => setSites({ ...sites, loading })} label={t('business.exports.f.loading')} addLabel={t('business.exports.f.addPlace')} />
      <SitePicker kind="port" entityId={business.entityId} api={api} value={sites.terminal} onChange={(terminal) => setSites({ ...sites, terminal })} label={t('business.exports.f.terminal')} addLabel={t('business.exports.f.addPlace')} />
      <SitePicker kind="port" entityId={business.entityId} api={api} value={sites.depot} onChange={(depot) => setSites({ ...sites, depot })} label={t('business.exports.f.depot')} addLabel={t('business.exports.f.addPlace')} />
      <p class="chint">{t('business.exports.f.depotHint')}</p>
      {error ? <p class="cerr">{error}</p> : null}
      <div class="twr-panelend">
        <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => void send()}>
          {t('business.exports.f.save')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={() => void onDone()}>
          {t('business.exports.notNow')}
        </button>
      </div>
    </section>
  );
}

/** One export, step by step: the booking and its clock, the box, the empty out, the weight, the papers, the load, the file. */
/** One export, read by whoever may: the exporter writes, its appointed agent gives its word, staff read. `initial` lets a test draw it. */
export function ExportPanel({ exportId, business, client, works, onChanged, initial }: { exportId: string; business: BusinessView; client: BusinessClient; works: boolean; onChanged: () => void | Promise<void>; initial?: ExportDetail }) {
  const t = useT();
  const [d, setD] = useState<ExportDetail | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [boxNo, setBoxNo] = useState('');
  const [weight, setWeight] = useState('');
  // Dangerous goods for the road note's box 9, asked when the load to the terminal is posted (2026-10-29).
  const [dg, setDg] = useState({ un: '', name: '', cls: '', group: '' });
  const [vgm, setVgm] = useState({ method: '1', kg: '', weighbridge: '', ticketRef: '', signatory: business.you.name ?? '' });
  const [paper, setPaper] = useState<Record<string, { documentId: string; reference: string }>>({});
  const [bl, setBl] = useState('');
  const [reweigh, setReweigh] = useState(false);
  const [changing, setChanging] = useState<Record<string, boolean>>({});
  const legWord = (status: string) => (LEG_WORD[status] ? t(LEG_WORD[status]) : status);
  const [freeOut, setFreeOut] = useState('');
  const [freeIn, setFreeIn] = useState('');
  const [emptyAt, setEmptyAt] = useState('');
  const [loadedAt, setLoadedAt] = useState('');
  const [picking, setPicking] = useState(false);
  const [endReason, setEndReason] = useState('');
  const [refusing, setRefusing] = useState<Record<string, string | undefined>>({});
  const [entry, setEntry] = useState('');
  const [fee, setFee] = useState({ amount: '', currency: '', reference: '', note: '' });
  const [requoting, setRequoting] = useState(false);
  const [asking, setAsking] = useState({ key: '', title: '' });

  /** A paper's bytes, opened in a tab at the tap — a PDF or a photograph, which the browser already knows how to show. */
  const openPaper = async (key: ExportPaperKey, title: string) => {
    const tab = tabAtTheTap();
    try {
      const r = await client.exports.paperFile(exportId, key);
      if (r.error || !r.data) return setError(t('business.exports.papers.unreadable', { title }));
      tab.show(r.data as Blob);
    } finally {
      tab.cancel();
    }
  };

  const read = useCallback(async () => {
    const r = await client.exports.detail(exportId);
    if (r.error) setError(sayProblem(r.error));
    else setD(r.data ?? null);
  }, [client, exportId]);

  useEffect(() => {
    if (!initial) void read();
  }, [read, initial]);

  const act = async (fn: () => Promise<{ data?: ExportDetail | null; error?: Problem }>, note: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    const r = await fn();
    setBusy(false);
    if (r.error) return setError(sayProblem(r.error));
    if (r.data) setD(r.data);
    setDone(note);
    await onChanged();
  };

  if (!d) return error ? <p class="cerr">{error}</p> : <p class="cons__empty">{t('business.loading')}</p>;
  const c = d.consignment;
  const tag = timingTag(d.timing, t);
  // The exporter writes; its appointed agent gives its word on the papers; staff read.
  const mine = works && d.you === 'exporter';
  const needsDg = isDangerousNature(d.consignment.natureCode) && !d.consignment.dangerousGoods;
  const dgDigits = /^\s*(UN)?\s*(\d{4})\s*$/i.exec(dg.un)?.[2];
  const dgValue = needsDg && dgDigits && dg.name.trim() && dg.cls.trim() ? { unNumber: `UN${dgDigits}`, properShippingName: dg.name.trim(), hazardClass: dg.cls.trim(), ...(['I', 'II', 'III'].includes(dg.group) ? { packingGroup: dg.group } : {}) } : undefined;
  const asAgent = works && d.you === 'agent';
  const clock = boxLine(d.box, t);
  const clockTag = boxTag(d.box, t);
  const outClaim = freeDaysOf(c, 'detention');
  const inClaim = freeDaysOf(c, 'demurrage');
  const emptyByLoad = Boolean(d.emptyLeg && d.emptyLeg.status !== 'cancelled');
  const onRoad = Boolean(c.ladenFreightId);
  // By air (2026-10-29): no box, no box clock, no weighing, no train, no bill of lading — the waybill is the airline's.
  const byAir = c.mode === 'air';
  const secured = c.air?.security.status === 'secured';
  const fact = (k: MessageKey, v: string) => (
    <div class="cons__fact">
      <dt class="cons__factk">{t(k)}</dt>
      <dd class="cons__factv">{v}</dd>
    </div>
  );

  /** A paper's name: the catalogue's, in this reader's words — or the name it was asked for by. */
  const paperName = (p: ExportDetail['papers'][number]) => (PAPER_WORD[p.key] ? t(PAPER_WORD[p.key]) : (p.title ?? p.label));

  /**
   * A FILE OF ITS OWN, uploaded right on the line: filed among the exporter's documents under this export's code and the
   * line (so two papers of one kind never replace each other), then attached. Never a loose upload.
   */
  const upload = (p: ExportDetail['papers'][number], file: File) => {
    const reader = new FileReader();
    reader.onload = () =>
      void act(async () => {
        const up = await client.api.uploadCompanyDocument(business.entityId, { kind: paperKindFor(p.key), title: paperName(p), dataUrl: String(reader.result), relatesTo: `${c.code}:${p.key}` });
        const documentId = (up.data as { documentId?: string } | undefined)?.documentId;
        if (up.error || !documentId) return { error: (up.error as Problem) ?? { title: t('business.exports.papers.uploadFailed') } };
        const draft = paper[p.key];
        return client.exports.paper(c.exportId, { key: p.key, documentId, ...(draft?.reference.trim() ? { reference: draft.reference.trim() } : {}) });
      }, t('business.exports.papers.uploaded')).then(() => setChanging({ ...changing, [p.key]: false }));
    reader.readAsDataURL(file);
  };

  const paperRow = (p: ExportDetail['papers'][number]) => {
    const draft = paper[p.key] ?? { documentId: '', reference: '' };
    const given = p.documentTitle || p.reference;
    // Its agent's word wins the tag: sent back is a gap whatever was given; accepted is the strongest yes. A kept paper not given is no gap.
    const paperTone = p.refusedAt ? 'warn' : given ? 'ok' : p.optional ? 'quiet' : 'warn';
    const paperWord: MessageKey = p.refusedAt ? 'business.exports.papers.sentBack' : p.acceptedAt ? 'business.exports.papers.acceptedTag' : given ? 'business.exports.papers.given' : p.optional ? 'business.exports.papers.noneKept' : 'business.exports.papers.missing';
    const changeable = mine && given && !changing[p.key] && p.key !== 'shipping_instructions';
    // Not given yet: two buttons, not a form — a file of its own, or the form to attach one or write its number.
    // The letter of instruction is given by signing its form below — never a file or a number on the line.
    const isSli = p.key === 'shipping_instructions';
    const giving = mine && !given && !changing[p.key] && !isSli;
    // The agent gives its word on what the exporter supplied; the entry it gave itself stands as its word.
    const worded = asAgent && given && refusing[p.key] === undefined && !(p.key === 'export_entry' && p.acceptedAt);
    return (
      <div class="crow" key={p.key}>
        <span class="crow__body">
          <span class="crow__top">
            <span class="crow__name">{paperName(p)}</span>
            <span class={`ctag ctag--${paperTone}`}>{t(paperWord)}</span>
          </span>
          {p.addedBy ? <span class="crow__sub">{t('business.exports.papers.askedBy', { who: p.addedBy, when: dayWords(p.addedAt ?? '') })}</span> : null}
          {given ? <span class="crow__sub">{[p.documentTitle, p.reference].filter(Boolean).join(' — ')}</span> : null}
          {isSli && !given ? <span class="crow__sub">{t('business.exports.sli.onTheLine')}</span> : null}
          {p.key === 'packing_list' && !given ? <span class="crow__sub">{t('business.exports.packing.onTheLine')}</span> : null}
          {p.key === 'commercial_invoice' && !given ? <span class="crow__sub">{t('business.exports.invoice.onTheLine')}</span> : null}
          {p.refusedAt ? (
            <span class="crow__sub cerr">{t('business.exports.papers.refused', { who: p.refusedBy ?? '', reason: p.refusedReason ?? '' })}</span>
          ) : p.acceptedAt ? (
            <span class="crow__sub">{t('business.exports.papers.accepted', { who: p.acceptedBy ?? '' })}</span>
          ) : null}
          {/* One row of what this reader can do: open it; the exporter changes it; its agent accepts it or sends it back; whoever asked for it takes it off. */}
          {p.documentId || (isSli && given) || (p.key === 'packing_list' && given) || (p.key === 'commercial_invoice' && given && !p.documentId && p.reference?.startsWith('Invoice ')) || changeable || giving || worded || p.removable ? (
            <span class="twr-panelend">
              {p.documentId || (isSli && given) || (p.key === 'packing_list' && given) || (p.key === 'commercial_invoice' && given && p.reference?.startsWith('Invoice ')) ? (
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void openPaper(p.key, p.documentTitle ?? paperName(p))}>
                  {t('business.exports.papers.open')}
                </button>
              ) : null}
              {changeable ? (
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setChanging({ ...changing, [p.key]: true })}>
                  {t('business.exports.papers.change')}
                </button>
              ) : null}
              {giving && p.key !== 'export_entry' ? (
                <label class="cbtn cbtn--ghost cbtn--sm twr-quote__file">
                  {t('business.exports.papers.upload')}
                  <input
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    disabled={busy}
                    onChange={(e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) upload(p, file);
                      (e.target as HTMLInputElement).value = '';
                    }}
                  />
                </label>
              ) : null}
              {giving ? (
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setChanging({ ...changing, [p.key]: true })}>
                  {t(p.key === 'export_entry' ? 'business.exports.papers.writeNumber' : 'business.exports.papers.attachOrNumber')}
                </button>
              ) : null}
              {worded && !p.acceptedAt ? (
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => void act(() => client.exports.acceptPaper(c.exportId, p.key), t('business.exports.papers.acceptedNote'))}>
                  {t('business.exports.papers.accept')}
                </button>
              ) : null}
              {worded && !p.refusedAt ? (
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => setRefusing({ ...refusing, [p.key]: '' })}>
                  {t('business.exports.papers.sendBackStart')}
                </button>
              ) : null}
              {p.removable ? (
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => void act(() => client.exports.removePaper(c.exportId, p.key), t('business.exports.papers.removed'))}>
                  {t('business.exports.papers.remove')}
                </button>
              ) : null}
            </span>
          ) : null}
          {asAgent && refusing[p.key] !== undefined ? (
            <span class="biz-paperline">
              <input class="cinput" maxLength={300} placeholder={t('business.exports.papers.refusePh')} value={refusing[p.key]} onInput={(e) => setRefusing({ ...refusing, [p.key]: (e.target as HTMLInputElement).value })} />
              <button
                type="button"
                class="cbtn cbtn--ghost cbtn--sm"
                disabled={busy || (refusing[p.key] ?? '').trim().length < 3}
                onClick={() => void act(() => client.exports.refusePaper(c.exportId, p.key, (refusing[p.key] ?? '').trim()), t('business.exports.papers.refusedNote')).then(() => setRefusing({ ...refusing, [p.key]: undefined }))}
              >
                {t('business.exports.papers.sendBack')}
              </button>
            </span>
          ) : null}
          {/* The agent's own work is the export entry, by its number. */}
          {asAgent && p.key === 'export_entry' && !p.acceptedAt ? (
            <span class="biz-paperline">
              <input class="cinput" maxLength={80} placeholder={t('business.exports.papers.entryAgentPh')} value={entry} onInput={(e) => setEntry((e.target as HTMLInputElement).value)} />
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy || entry.trim().length < 3} onClick={() => void act(() => client.exports.paper(c.exportId, { key: 'export_entry', reference: entry.trim() }), t('business.exports.papers.entryGiven')).then(() => setEntry(''))}>
                {t('business.exports.papers.giveEntry')}
              </button>
            </span>
          ) : null}
          {mine && changing[p.key] ? (
            <span class="biz-paperline">
              {p.key !== 'export_entry' && d.documents.length ? (
                <ConsolePick
                  bare
                  small
                  label={t('business.exports.papers.pickTitle')}
                  value={draft.documentId}
                  placeholder={t('business.exports.papers.pick')}
                  // A document chosen by mistake can be put back: the paper is then given by its reference alone.
                  options={[...(draft.documentId ? [{ value: '', label: t('business.exports.papers.noDocument') }] : []), ...d.documents.map((doc) => ({ value: doc.documentId, label: doc.title }))]}
                  onChange={(documentId) => setPaper({ ...paper, [p.key]: { ...draft, documentId } })}
                />
              ) : null}
              <input class="cinput" maxLength={80} placeholder={t(p.key === 'export_entry' ? 'business.exports.papers.entryPh' : 'business.exports.papers.refPh')} value={draft.reference} onInput={(e) => setPaper({ ...paper, [p.key]: { ...draft, reference: (e.target as HTMLInputElement).value } })} />
              <button
                type="button"
                class="cbtn cbtn--ghost cbtn--sm"
                disabled={busy || (!draft.documentId && draft.reference.trim().length < 3)}
                onClick={() => void act(() => client.exports.paper(c.exportId, { key: p.key, ...(draft.documentId ? { documentId: draft.documentId } : {}), ...(draft.reference.trim() ? { reference: draft.reference.trim() } : {}) }), t('business.exports.papers.saved')).then(() => setChanging({ ...changing, [p.key]: false }))}
              >
                {t('business.exports.papers.save')}
              </button>
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setChanging({ ...changing, [p.key]: false })}>
                {t('business.exports.notNow')}
              </button>
              {p.key !== 'export_entry' ? (
                <label class="cbtn cbtn--ghost cbtn--sm twr-quote__file">
                  {t('business.exports.papers.upload')}
                  <input
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    disabled={busy}
                    onChange={(e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) upload(p, file);
                      (e.target as HTMLInputElement).value = '';
                    }}
                  />
                </label>
              ) : null}
            </span>
          ) : null}
        </span>
      </div>
    );
  };

  return (
    <>
      {/* EX1 — the booking, and what its clock asks. */}
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">
            {c.code} — {c.goodsDescription}
          </span>
          <span class={`ctag ctag--${tag.tone}`}>{tag.word}</span>
        </div>
        <p class="cons__lede">{timingLine(d, t)}</p>
        {/* The journey, by its legs (2026-10-29): the truck, the train where it goes by rail, the ship. */}
        <JourneyStrip legs={exportJourney(d, t)} />
        {done ? <p class="cnote">{done}</p> : null}
        {error ? <p class="cerr">{error}</p> : null}
        <dl class="cons__facts">
          {d.you !== 'exporter' ? fact('business.exports.d.exporter', d.exporterName) : null}
          {fact(byAir ? 'business.exports.d.bookedWith' : 'business.exports.d.booking', byAir ? c.booking.partyName : `${c.booking.reference} — ${c.booking.partyName}`)}
          {c.booking.vessel ? fact('business.exports.d.vessel', `${c.booking.vessel}${c.booking.voyage ? ` / ${c.booking.voyage}` : ''}`) : null}
          {byAir ? null : fact('business.exports.d.gateCutoff', utcWords(c.booking.gateCutoffAt))}
          {c.booking.vgmCutoffAt ? fact('business.exports.d.vgmCutoff', utcWords(c.booking.vgmCutoffAt)) : null}
          {c.booking.docsCutoffAt ? fact('business.exports.d.docsCutoff', utcWords(c.booking.docsCutoffAt)) : null}
          {/* Our truck's road: to the port's gate, or by rail to the rail terminal (the journey strip above shows every leg). */}
          {fact('business.exports.d.route', `${c.loadingPlace.label} → ${c.byRail ? c.byRail.terminal.label : `${c.terminal.label} (${c.air ? c.air.fromAirport : c.loadingPort})`}`)}
          {byAir ? null : fact('business.exports.d.box', `${c.containerType ?? ''}${c.containerNo ? ` · ${c.containerNo}` : ''}`)}
        </dl>
        {d.missing.length ? <p class="chint">{t(byAir ? 'business.exports.d.missingAir' : 'business.exports.d.missing', { what: d.missing.join('; ') })}</p> : <p class="chint">{t(byAir ? 'business.exports.d.nothingMissingAir' : 'business.exports.d.nothingMissing')}</p>}
      </section>

      {/* By air: the waybill, read against the law of its route and our papers. */}
      {byAir ? (
        <AirWaybillPanel
          d={d}
          client={client}
          mine={mine}
          onDetail={async (next) => {
            setD(next);
            await onChanged();
          }}
        />
      ) : null}

      {/* EX2 — the box's number, and the empty out. */}
      {byAir ? null : (
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.exports.box.title')}</span>
        </div>
        {c.containerNo ? <p class="cons__lede">{t('business.exports.box.number', { number: c.containerNo })}</p> : mine ? <p class="chint">{t('business.exports.box.numberHint')}</p> : null}
        {mine && !onRoad ? (
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.box.numberLabel')}</span>
              <input class="cinput" maxLength={16} value={boxNo} placeholder="MSCU1234566" onInput={(e) => setBoxNo((e.target as HTMLInputElement).value)} />
            </label>
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy || !boxNo.trim()} onClick={() => void act(() => client.exports.container(c.exportId, boxNo.trim()), t('business.exports.box.saved'))}>
                {t('business.exports.box.save')}
              </button>
            </div>
          </div>
        ) : null}
        {c.emptyDepot ? (
          d.emptyLeg ? (
            <p class="cons__lede">{t('business.exports.empty.leg', { code: d.emptyLeg.code, status: legWord(d.emptyLeg.status), depot: c.emptyDepot.label })}</p>
          ) : mine && !onRoad ? (
            <div class="twr-panelend">
              <span class="chint">{t('business.exports.empty.hint', { depot: c.emptyDepot.label, release: c.booking.emptyReleaseRef ?? '—' })}</span>
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => void act(() => client.exports.emptyLeg(c.exportId), t('business.exports.empty.posted'))}>
                {t('business.exports.empty.post')}
              </button>
            </div>
          ) : null
        ) : (
          <p class="chint">{t('business.exports.empty.brought')}</p>
        )}
      </section>
      )}

      {/* EX6 — the box's clock: outside the terminal until the gate, inside it until loaded on board. Days, never money. */}
      {byAir ? null : (
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.exports.clock.title')}</span>
          {clockTag ? <span class={`ctag ctag--${clockTag.tone}`}>{clockTag.word}</span> : null}
        </div>
        <p class="cons__lede">{clock.text}</p>
        <dl class="cons__facts">
          {fact(
            'business.exports.clock.emptyOut',
            d.box.emptyOutAt ? t(d.box.emptyOutFrom === 'load' ? 'business.exports.clock.emptyOutLoad' : 'business.exports.clock.emptyOutRecorded', { when: utcWords(d.box.emptyOutAt) }) : t('business.exports.clock.notRecorded'),
          )}
          {fact('business.exports.clock.owner', t(c.ownBox ? 'business.exports.clock.ownerYours' : 'business.exports.clock.ownerLine'))}
          {c.ownBox ? null : fact('business.exports.clock.freeOutside', outClaim ? t('business.exports.clock.claim', { days: outClaim.days, by: outClaim.by, when: dayWords(outClaim.at) }) : t('business.exports.clock.notSaid'))}
          {c.ownBox ? null : fact('business.exports.clock.freeInside', inClaim ? t('business.exports.clock.claim', { days: inClaim.days, by: inClaim.by, when: dayWords(inClaim.at) }) : t('business.exports.clock.notSaid'))}
          {c.loaded ? fact('business.exports.clock.loadedAt', utcWords(c.loaded.at)) : null}
        </dl>
        {mine && !c.ownBox ? <p class="chint"><Abbreviated text={t('business.exports.clock.hint')} /></p> : null}
        {mine && !c.loaded ? (
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => void act(() => client.exports.ownBox(c.exportId, !c.ownBox), t(c.ownBox ? 'business.exports.clock.lineSaved' : 'business.exports.clock.ownSaved'))}>
              {t(c.ownBox ? 'business.exports.clock.lineBox' : 'business.exports.clock.ownBox')}
            </button>
          </div>
        ) : null}
        {mine && !c.loaded && !c.ownBox ? (
          <>
            <div class="biz-two">
              <label class="cfield">
                <span class="cfield__label">{t('business.exports.clock.freeOutsideLabel')}</span>
                <input class="cinput" type="number" min={0} max={90} value={freeOut} onInput={(e) => setFreeOut((e.target as HTMLInputElement).value)} />
              </label>
              <div class="twr-panelend">
                <button
                  type="button"
                  class="cbtn cbtn--ghost cbtn--sm"
                  disabled={busy || freeOut.trim() === '' || !Number.isInteger(Number(freeOut))}
                  onClick={() => void act(() => client.exports.freeDays(c.exportId, 'detention', Number(freeOut)), t('business.exports.clock.saved')).then(() => setFreeOut(''))}
                >
                  {t('business.exports.clock.saveFree')}
                </button>
              </div>
            </div>
            <div class="biz-two">
              <label class="cfield">
                <span class="cfield__label">{t('business.exports.clock.freeInsideLabel')}</span>
                <input class="cinput" type="number" min={0} max={90} value={freeIn} onInput={(e) => setFreeIn((e.target as HTMLInputElement).value)} />
              </label>
              <div class="twr-panelend">
                <button
                  type="button"
                  class="cbtn cbtn--ghost cbtn--sm"
                  disabled={busy || freeIn.trim() === '' || !Number.isInteger(Number(freeIn))}
                  onClick={() => void act(() => client.exports.freeDays(c.exportId, 'demurrage', Number(freeIn)), t('business.exports.clock.saved')).then(() => setFreeIn(''))}
                >
                  {t('business.exports.clock.saveFree')}
                </button>
              </div>
            </div>
          </>
        ) : null}
        {mine && !c.ownBox && !d.box.emptyOutAt && !d.timing.gatedInAt && !emptyByLoad ? (
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.clock.emptyOutLabel')}</span>
              <input class="cinput" type="datetime-local" value={emptyAt} onInput={(e) => setEmptyAt((e.target as HTMLInputElement).value)} />
            </label>
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy || !fromUtcInput(emptyAt)} onClick={() => void act(() => client.exports.emptyOut(c.exportId, fromUtcInput(emptyAt)!), t('business.exports.clock.emptyOutSaved')).then(() => setEmptyAt(''))}>
                {t('business.exports.clock.save')}
              </button>
            </div>
          </div>
        ) : null}
        {mine && d.timing.gatedInAt && !c.loaded ? (
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.clock.loadedLabel')}</span>
              <input class="cinput" type="datetime-local" value={loadedAt} onInput={(e) => setLoadedAt((e.target as HTMLInputElement).value)} />
            </label>
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy || !fromUtcInput(loadedAt)} onClick={() => void act(() => client.exports.loaded(c.exportId, fromUtcInput(loadedAt)!), t('business.exports.clock.loadedSaved')).then(() => setLoadedAt(''))}>
                {t('business.exports.clock.save')}
              </button>
            </div>
          </div>
        ) : null}
      </section>
      )}

      {/* EX3 — the verified gross mass. */}
      {byAir ? null : (
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.exports.vgm.title')}</span>
        </div>
        {c.vgm ? (
          <p class="cons__lede">{t('business.exports.vgm.declared', { kg: c.vgm.kg.toLocaleString('en'), method: c.vgm.method, who: c.vgm.signatory })}</p>
        ) : (
          <p class="chint">{t(mine ? 'business.exports.vgm.hint' : 'business.exports.vgm.notYet')}</p>
        )}
        {mine && c.vgm && !reweigh ? (
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setReweigh(true)}>
              {t('business.exports.vgm.again')}
            </button>
          </div>
        ) : null}
        {mine && (!c.vgm || reweigh) ? (
          <>
            <div class="biz-two">
              <ConsolePick
                label={t('business.exports.vgm.method')}
                value={vgm.method}
                options={[
                  { value: '1', label: t('business.exports.vgm.method1') },
                  { value: '2', label: t('business.exports.vgm.method2') },
                ]}
                onChange={(method) => setVgm({ ...vgm, method })}
              />
              <label class="cfield">
                <span class="cfield__label">{t('business.exports.vgm.kg')}</span>
                <input class="cinput" type="number" min={1500} max={45000} value={vgm.kg} onInput={(e) => setVgm({ ...vgm, kg: (e.target as HTMLInputElement).value })} />
              </label>
            </div>
            <div class="biz-two">
              <label class="cfield">
                <span class="cfield__label">{t('business.exports.vgm.weighbridge')}</span>
                <input class="cinput" maxLength={120} value={vgm.weighbridge} onInput={(e) => setVgm({ ...vgm, weighbridge: (e.target as HTMLInputElement).value })} />
              </label>
              <label class="cfield">
                <span class="cfield__label">{t('business.exports.vgm.ticket')}</span>
                <input class="cinput" maxLength={60} value={vgm.ticketRef} onInput={(e) => setVgm({ ...vgm, ticketRef: (e.target as HTMLInputElement).value })} />
              </label>
            </div>
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.vgm.signatory')}</span>
              <input class="cinput" maxLength={120} value={vgm.signatory} onInput={(e) => setVgm({ ...vgm, signatory: (e.target as HTMLInputElement).value })} />
            </label>
            <div class="twr-panelend">
              <button
                type="button"
                class="cbtn cbtn--ghost cbtn--sm"
                disabled={busy || !vgm.kg || !vgm.signatory.trim()}
                onClick={() =>
                  void act(
                    () => client.exports.vgm(c.exportId, { method: vgm.method === '2' ? 2 : 1, kg: Number(vgm.kg), ...(vgm.weighbridge.trim() ? { weighbridge: vgm.weighbridge.trim() } : {}), ...(vgm.ticketRef.trim() ? { ticketRef: vgm.ticketRef.trim() } : {}), signatory: vgm.signatory.trim() }),
                    t('business.exports.vgm.saved'),
                  ).then(() => setReweigh(false))
                }
              >
                {t('business.exports.vgm.save')}
              </button>
            </div>
          </>
        ) : null}
      </section>
      )}

      {/* EX7 — the clearing agent: appointed by the exporter, reads the papers attached here, gives its word on each. */}
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.exports.agent.title')}</span>
        </div>
        {d.you === 'agent' ? (
          <p class="cons__lede">{t('business.exports.agent.youAre', { exporter: d.exporterName, when: dayWords(d.agent?.appointedAt ?? '') })}</p>
        ) : d.agent ? (
          <p class="cons__lede">{t('business.exports.agent.appointed', { name: d.agent.name, when: dayWords(d.agent.appointedAt), by: d.agent.appointedBy })}</p>
        ) : (
          <p class="chint">{t('business.exports.agent.none')}</p>
        )}
        {mine && d.agent ? (
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.agent.reason')}</span>
              <input class="cinput" maxLength={200} value={endReason} onInput={(e) => setEndReason((e.target as HTMLInputElement).value)} />
            </label>
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => void act(() => client.exports.endAgent(c.exportId, endReason.trim() || undefined), t('business.exports.agent.ended', { name: d.agent?.name ?? '' })).then(() => setEndReason(''))}>
                {t('business.exports.agent.end')}
              </button>
            </div>
          </div>
        ) : null}
        {mine && !d.agent ? (
          <>
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => setPicking(true)}>
                {t('business.exports.agent.choose')}
              </button>
            </div>
            <FiataDirectoryHint />
            {/* Chosen from the agents' directory, never typed: alphabetical, what each says beside what we have seen. */}
            <ParticipantPicker
              open={picking}
              title={t('business.exports.agent.choose')}
              actionLabel={t('business.exports.agent.appoint')}
              onClose={() => setPicking(false)}
              kinds={[
                {
                  key: 'agents',
                  labelKey: 'business.exports.agent.kind',
                  load: async () => {
                    const r = await client.exports.findAgents();
                    const items = r.data?.items ?? [];
                    return {
                      basis: t('business.exports.agent.basis', { n: items.length }),
                      rows: items
                        .filter((a) => a.entityId !== business.entityId)
                        .map((a) => ({
                          id: a.entityId,
                          name: a.name,
                          ...(a.handle ? { handle: a.handle } : {}),
                          ...(a.country ? { country: a.country } : {}),
                          ...(a.offer?.specialisms?.length ? { says: a.offer.specialisms.map((sp) => t(`home.agents.spec.${sp}` as never)).join(', ') } : {}),
                          seen: a.thin ? t('business.exports.agent.new') : t('business.exports.agent.seen', { appointed: a.appointed, cleared: a.cleared }),
                          ...(a.contact?.phone ? { phone: a.contact.phone } : {}),
                        })),
                    };
                  },
                },
              ]}
              onPick={(row) => {
                setPicking(false);
                void act(() => client.exports.appointAgent(c.exportId, row.id), t('business.exports.agent.appointedNote', { name: row.name }));
              }}
            />
          </>
        ) : null}
        {d.you === 'exporter' && c.formerAgents?.length ? <p class="chint">{t('business.exports.agent.former', { n: c.formerAgents.length })}</p> : null}
        {/* EX8 — its fee: a quotation between the agent and the exporter, never a payment through us. */}
        {d.agent ? (
          <>
            <h3 class="cons__sub">{t('business.exports.fee.title')}</h3>
            {d.fee ? (
              <>
                {d.fee.agreedAt ? (
                  <p class="chint">{t('business.exports.fee.agreed', { who: d.fee.agreedBy ?? '', when: dayWords(d.fee.agreedAt) })}</p>
                ) : mine && d.fee.status === 'open' ? (
                  <div class="twr-panelend">
                    <span class="chint">{t('business.exports.fee.agreeHint')}</span>
                    <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => void act(() => client.exports.acceptFee(c.exportId), t('business.exports.fee.agreedNote'))}>
                      {t('business.exports.fee.agree')}
                    </button>
                  </div>
                ) : (
                  <p class="chint">{t('business.exports.fee.notAgreed')}</p>
                )}
                <QuotePanel quote={d.fee} api={client.api as never} canChange={mine || asAgent} onChanged={() => read()} />
              </>
            ) : d.you === 'agent' ? (
              <p class="chint">{t('business.exports.fee.noneAgent')}</p>
            ) : (
              <p class="chint">{t('business.exports.fee.none', { name: d.agent.name })}</p>
            )}
            {asAgent && d.fee && d.fee.status === 'open' && !requoting ? (
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setRequoting(true)}>
                  {t('business.exports.fee.change')}
                </button>
              </div>
            ) : null}
            {asAgent && (!d.fee || (d.fee.status === 'open' && requoting)) ? (
              <>
                <div class="biz-two">
                  <label class="cfield">
                    <span class="cfield__label">{t('business.exports.fee.amount')}</span>
                    <input class="cinput" type="number" min={0} step="0.01" value={fee.amount} onInput={(e) => setFee({ ...fee, amount: (e.target as HTMLInputElement).value })} />
                  </label>
                  <CurrencySelect api={client.api as never} value={fee.currency} onChange={(currency) => setFee({ ...fee, currency })} label={t('business.exports.fee.currency')} near={[c.originCountry, c.destCountry]} />
                </div>
                <div class="biz-two">
                  <label class="cfield">
                    <span class="cfield__label">{t('business.exports.fee.reference')}</span>
                    <input class="cinput" maxLength={60} value={fee.reference} onInput={(e) => setFee({ ...fee, reference: (e.target as HTMLInputElement).value })} />
                  </label>
                  <label class="cfield">
                    <span class="cfield__label">{t('business.exports.fee.note')}</span>
                    <input class="cinput" maxLength={300} value={fee.note} onInput={(e) => setFee({ ...fee, note: (e.target as HTMLInputElement).value })} />
                  </label>
                </div>
                <p class="chint">{t('business.exports.fee.hint')}</p>
                <div class="twr-panelend">
                  <button
                    type="button"
                    class="cbtn cbtn--primary cbtn--sm"
                    disabled={busy || !(Number(fee.amount) > 0)}
                    onClick={() =>
                      void act(
                        () =>
                          client.exports.quoteFee(c.exportId, {
                            amount: Number(fee.amount),
                            ...(fee.currency.trim() ? { currency: fee.currency.trim() } : {}),
                            ...(fee.reference.trim() ? { reference: fee.reference.trim() } : {}),
                            ...(fee.note.trim() ? { note: fee.note.trim() } : {}),
                          }),
                        t('business.exports.fee.sent'),
                      ).then(() => setRequoting(false))
                    }
                  >
                    {t(d.fee ? 'business.exports.fee.resend' : 'business.exports.fee.send')}
                  </button>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </section>

      {/* EX4 — the papers an export holds: needed on every export, asked for these goods, kept when there is one. */}
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.exports.papers.title')}</span>
        </div>
        <p class="chint">{t(d.you === 'agent' ? 'business.exports.papers.hintAgent' : 'business.exports.papers.hint')}</p>
        {PAPER_GROUPS.map((group) => {
          const lines = d.papers.filter((p) => p.group === group);
          if (!lines.length && group !== 'asked') return null;
          return (
            <div key={group}>
              <h3 class="cons__sub">{t(GROUP_WORD[group])}</h3>
              {group === 'asked' && !lines.length ? <p class="chint">{t('business.exports.papers.noneAsked')}</p> : null}
              <div class="crows">{lines.map((p) => paperRow(p))}</div>
            </div>
          );
        })}
        {/* What these goods need beyond every export's papers: asked for by the exporter, or by its agent who knows the border. */}
        {mine || asAgent ? (
          <div class="biz-paperline">
            <ConsolePick
              bare
              small
              label={t('business.exports.papers.askTitle')}
              value={asking.key}
              placeholder={t('business.exports.papers.askPick')}
              options={[
                ...ASKED_PAPERS.filter((key) => !d.papers.some((p) => p.key === key && p.group === 'asked')).map((key) => ({ value: key, label: t(PAPER_WORD[key]) })),
                { value: 'other', label: t('business.exports.papers.askOther') },
              ]}
              onChange={(key) => setAsking({ ...asking, key })}
            />
            {asking.key === 'other' ? (
              <input class="cinput" maxLength={80} placeholder={t('business.exports.papers.askOtherPh')} value={asking.title} onInput={(e) => setAsking({ ...asking, title: (e.target as HTMLInputElement).value })} />
            ) : null}
            <button
              type="button"
              class="cbtn cbtn--ghost cbtn--sm"
              disabled={busy || !asking.key || (asking.key === 'other' && asking.title.trim().length < 3)}
              onClick={() =>
                void act(() => client.exports.addPaper(c.exportId, { key: asking.key, ...(asking.key === 'other' ? { title: asking.title.trim() } : {}) }), t('business.exports.papers.asked')).then(() => setAsking({ key: '', title: '' }))
              }
            >
              {t('business.exports.papers.ask')}
            </button>
          </div>
        ) : null}
      </section>

      {/* EX10 — the packing list, from the shipper's own file; the letter's goods are worked out from it. */}
      <ExportPacking d={d} client={client} mine={mine} signatory={business.you.name ?? ''} onDetail={async (next) => {
        setD(next);
        await onChanged();
      }} />

      {/* EX11 — the commercial invoice, from the packing list's lines; flexible for where the goods are going. */}
      <ExportInvoice d={d} client={client} mine={mine} signatory={business.you.name ?? ''} onDetail={async (next) => {
        setD(next);
        await onChanged();
      }} />

      {/* EX9 — the shipper's letter of instruction: a form, frozen on signing. */}
      <ExportSli d={d} client={client} mine={mine} signatory={business.you.name ?? ''} onDetail={async (next) => {
        setD(next);
        await onChanged();
      }} />

      {/* By rail to the port (2026-10-29): set before the load is posted — the truck is then timed to the train. */}
      {byAir ? null : (
        <ExportByRail
          d={d}
          business={business}
          client={client}
          mine={mine}
          onChanged={async () => {
            await read();
            await onChanged();
          }}
        />
      )}

      {/* EX2 — the load to the terminal; its seal is written on that load, with the seal panel and its photographs. */}
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t(byAir ? 'business.exports.laden.titleAir' : 'business.exports.laden.title')}</span>
        </div>
        {d.ladenLeg ? (
          <>
            <p class="cons__lede">{t('business.exports.laden.leg', { code: d.ladenLeg.code, status: legWord(d.ladenLeg.status) })}</p>
            {d.seals.length ? (
              <p class="chint">{t('business.exports.laden.sealed', { seals: d.seals.map((s) => s.number ?? '—').join(', ') })}</p>
            ) : byAir && !secured ? null : (
              <p class="chint">{t(byAir ? 'business.exports.laden.sealItSecured' : 'business.exports.laden.sealIt', { code: d.ladenLeg.code })}</p>
            )}
          </>
        ) : mine ? (
          <>
            <p class="chint">{byAir ? t(secured ? 'business.exports.laden.hintAirSecured' : 'business.exports.laden.hintAir', { terminal: c.terminal.label }) : c.byRail ? t(c.vgm ? 'business.exports.laden.hintRailVgm' : 'business.exports.laden.hintRail', { terminal: c.byRail.terminal.label }) : t(c.vgm ? 'business.exports.laden.hintVgm' : 'business.exports.laden.hint')}</p>
            {!c.vgm && !byAir ? (
              <label class="cfield">
                <span class="cfield__label">{t('business.exports.laden.weight')}</span>
                <input class="cinput" type="number" min={1} value={weight} onInput={(e) => setWeight((e.target as HTMLInputElement).value)} />
              </label>
            ) : null}
            {needsDg ? (
              <>
                <p class="chint">{t('business.exports.laden.dangerousHint')}</p>
                <div class="biz-two">
                  <label class="cfield"><span class="cfield__label">{t('business.exports.sli.unNumber')}</span><input class="cinput" maxLength={8} value={dg.un} onInput={(e) => setDg({ ...dg, un: (e.target as HTMLInputElement).value })} /></label>
                  <label class="cfield"><span class="cfield__label">{t('business.exports.sli.hazardClass')}</span><input class="cinput" maxLength={8} value={dg.cls} onInput={(e) => setDg({ ...dg, cls: (e.target as HTMLInputElement).value })} /></label>
                </div>
                <div class="biz-two">
                  <label class="cfield"><span class="cfield__label">{t('business.exports.sli.shippingName')}</span><input class="cinput" maxLength={200} value={dg.name} onInput={(e) => setDg({ ...dg, name: (e.target as HTMLInputElement).value })} /></label>
                  <label class="cfield"><span class="cfield__label">{t('business.exports.sli.packingGroup')}</span><input class="cinput" maxLength={3} value={dg.group} onInput={(e) => setDg({ ...dg, group: (e.target as HTMLInputElement).value.toUpperCase() })} /></label>
                </div>
              </>
            ) : null}
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy || (!byAir && (!c.containerNo || (!c.vgm && !weight))) || (needsDg && !dgValue)} onClick={() => void act(() => client.exports.ladenLeg(c.exportId, c.vgm || byAir ? undefined : Number(weight), dgValue), t(byAir ? 'business.exports.laden.postedAir' : 'business.exports.laden.posted'))}>
                {t(byAir ? 'business.exports.laden.postAir' : 'business.exports.laden.post')}
              </button>
            </div>
          </>
        ) : (
          <p class="chint">{t(byAir ? 'business.exports.laden.noneAir' : 'business.exports.laden.none')}</p>
        )}
      </section>

      {/* EX5 — the file the forwarder takes at the gate, and the bill of lading's number once issued. */}
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.exports.handover.title')}</span>
        </div>
        <p class="chint">{t(byAir ? 'business.exports.handover.hintAir' : 'business.exports.handover.hint')}</p>
        <div class="twr-panelend">
          <DocumentButton label={t('business.exports.handover.open')} title={t('business.exports.handover.open')} fetch={() => client.exports.handover(c.exportId)} />
        </div>
        {byAir ? null : c.billOfLading ? (
          <p class="cons__lede">{t('business.exports.bl.recorded', { number: c.billOfLading.number })}</p>
        ) : mine ? (
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.bl.label')}</span>
              <input class="cinput" maxLength={60} value={bl} onInput={(e) => setBl((e.target as HTMLInputElement).value)} />
            </label>
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy || bl.trim().length < 3} onClick={() => void act(() => client.exports.billOfLading(c.exportId, bl.trim()), t('business.exports.bl.saved'))}>
                {t('business.exports.bl.save')}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* The forwarder's FIATA bill: held, checked against its form, matched to our papers, explained — never issued (2026-10-29). */}
      {byAir ? null : (
      <FblPanel
        code={c.code}
        {...(d.fbl ? { fbl: d.fbl } : {})}
        canKeep={mine || asAgent}
        canVerify={mine}
        documents={mine ? d.documents : []}
        defaults={{ ...(c.containerNo ? { containerNo: c.containerNo } : {}), issuerCountry: c.originCountry }}
        calls={{ keep: (input) => client.exports.fbl(c.exportId, input), verified: (input) => client.exports.fblVerified(c.exportId, input) }}
        {...(mine
          ? {
              upload: async (file: File, kind: 'bill_of_lading' | 'other', title: string) => {
                const r = await client.api.uploadCompanyDocument(business.entityId, { kind, title, dataUrl: await fileAsDataUrl(file), relatesTo: `${c.code}:fbl` });
                const documentId = (r.data as { documentId?: string } | undefined)?.documentId;
                return documentId ? { documentId } : { error: (r.error as { detail?: string } | undefined)?.detail ?? '' };
              },
            }
          : {})}
        onKept={async () => {
          await read();
          await onChanged();
        }}
      />
      )}

      {/* Where the box goes to the port by rail: the railway's note, held, checked against its lane's law, matched to the box. */}
      {byAir ? null : (
      <RailNotePanel
        code={c.code}
        {...(d.rail ? { rail: d.rail } : {})}
        canKeep={mine || asAgent}
        documents={mine ? d.documents : []}
        defaults={{ fromCountry: c.originCountry, toCountry: c.originCountry, ...(c.containerNo ? { containerNo: c.containerNo } : {}) }}
        calls={{ railways: () => client.exports.railways(), check: (draft) => client.exports.railCheck(draft), keep: (input) => client.exports.rail(c.exportId, input) }}
        onKept={async () => {
          await read();
          await onChanged();
        }}
      />
      )}
    </>
  );
}
