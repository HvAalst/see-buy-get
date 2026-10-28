import type { Result, SbgClient } from '../../lib/sbg';
import type { MessageKey, Translate } from '../../shared/i18n';
import type { QuoteView } from '../../shared/quote';

/**
 * EXPORTS TO THE PORT (the user, 2026-10-27: "The missing for goods going to a port should be build"). One container leaving
 * through a port, from the exporter's side of the gate: its forwarder's booking and the gate cut-off, the empty out, the box
 * stuffed and sealed, the laden leg to the terminal, its verified gross mass, its papers, and one file for the forwarder.
 * SeeBuyGet books no ship: every booking, vessel and bill of lading here is a reference the exporter copied in.
 */

export type ExportTimingState = 'on_time' | 'at_risk' | 'missed' | 'gated_in';
export type ExportPaperKey = 'commercial_invoice' | 'packing_list' | 'certificate_of_origin' | 'export_entry';

export interface ExportPlace {
  label: string;
  location: { lat: number; lng: number };
}

export interface ExportTiming {
  state: ExportTimingState;
  leaveByAt: string;
  roadKm: number;
  plannedHours: number;
  gatedInAt?: string;
  collectedAt?: string;
}

export interface ExportBooking {
  reference: string;
  bookedWith: 'forwarder' | 'shipping_line';
  partyName: string;
  vessel?: string;
  voyage?: string;
  gateCutoffAt: string;
  vgmCutoffAt?: string;
  docsCutoffAt?: string;
  emptyReleaseRef?: string;
}

export interface ExportVgm {
  method: 1 | 2;
  kg: number;
  weighbridge?: string;
  ticketRef?: string;
  weighedAt?: string;
  signatory: string;
  declaredAt: string;
}

export interface ExportPaperView {
  key: ExportPaperKey;
  label: string;
  optional?: boolean;
  documentId?: string;
  documentTitle?: string;
  reference?: string;
  suppliedAt?: string;
  /** The appointed clearing agent's word: accepted, or sent back with its reason. */
  acceptedAt?: string;
  acceptedBy?: string;
  refusedAt?: string;
  refusedBy?: string;
  refusedReason?: string;
}

/** The box's clock, derived by the server on every read: detention outside the terminal, demurrage inside — days, never money. */
export interface ExportBoxClock {
  kind: 'detention' | 'demurrage' | 'stopped' | 'unknown' | 'owned';
  since?: string;
  daysElapsed?: number;
  freeDays?: number;
  freeDaysBy?: string;
  freeDaysAt?: string;
  dueAt?: string;
  daysLeft?: number;
  overdue: boolean;
  dueSoon: boolean;
  detentionDays?: number;
  demurrageDays?: number;
  emptyOutAt?: string;
  emptyOutFrom?: 'load' | 'recorded';
  basis: string;
}

export interface ExportFreeDays {
  kind: 'detention' | 'demurrage';
  days: number;
  by: string;
  at: string;
}

export interface ExportLeg {
  freightId: string;
  code: string;
  status: string;
  pickedUpAt?: string;
  deliveredAt?: string;
}

export interface ExportConsignment {
  exportId: string;
  code: string;
  goodsDescription: string;
  originCountry: string;
  destCountry: string;
  loadingPort: string;
  containerType?: string;
  booking: ExportBooking;
  loadingPlace: ExportPlace;
  terminal: ExportPlace;
  emptyDepot?: ExportPlace;
  containerNo?: string;
  emptyFreightId?: string;
  ladenFreightId?: string;
  vgm?: ExportVgm;
  billOfLading?: { number: string; recordedAt: string };
  freeDays?: ExportFreeDays[];
  emptyOut?: { at: string; by: string };
  loaded?: { at: string; by: string };
  formerAgents?: Array<{ entityId: string; appointedAt: string; endedAt: string; endedBy: string; reason?: string; feeQuoteId?: string }>;
  /** The box is the exporter's own (a shipper-owned container): no line's clock runs on it. */
  ownBox?: { by: string; at: string };
  createdAt: string;
}

export type ExportReader = 'exporter' | 'agent' | 'staff';

export interface ExportDetail {
  consignment: ExportConsignment;
  timing: ExportTiming;
  emptyLeg?: ExportLeg;
  ladenLeg?: ExportLeg;
  seals: Array<{ number?: string; state: string; appliedBy: string }>;
  papers: ExportPaperView[];
  missing: string[];
  documents: Array<{ documentId: string; title: string }>;
  box: ExportBoxClock;
  you: ExportReader;
  exporterName: string;
  agent?: { entityId: string; name: string; appointedAt: string; appointedBy: string };
  /** The appointed agent's fee, as a quotation between it and the exporter. */
  fee?: QuoteView;
  feeState: 'none' | 'quoted' | 'accepted' | 'paid';
}

export interface ExportRow {
  exportId: string;
  code: string;
  goodsDescription: string;
  loadingPort: string;
  bookingReference: string;
  gateCutoffAt: string;
  containerNo?: string;
  timing: ExportTiming;
  missing: number;
  box: ExportBoxClock;
  you: ExportReader;
  exporterName: string;
  agentName?: string;
}

/** One clearing agent from the public directory: what it claims, and what we have seen. Alphabetical, never ranked. */
export interface ExportAgentCard {
  entityId: string;
  name: string;
  handle?: string;
  country?: string;
  offer?: { specialisms?: string[] };
  appointed: number;
  cleared: number;
  thin: boolean;
  contact?: { phone?: string };
}

export interface RegisterExportInput {
  goodsDescription: string;
  originCountry: string;
  destCountry: string;
  loadingPort: string;
  containerType: string;
  natureCode?: string;
  booking: ExportBooking;
  loadingSiteId: string;
  terminalSiteId: string;
  emptyDepotSiteId?: string;
  ownBox?: boolean;
}

export interface ExportsApi {
  list(): Promise<Result<{ items: ExportRow[] }>>;
  detail(exportId: string): Promise<Result<ExportDetail>>;
  register(input: RegisterExportInput): Promise<Result<{ exportId: string; code: string }>>;
  container(exportId: string, containerNo: string): Promise<Result<ExportDetail>>;
  emptyLeg(exportId: string): Promise<Result<ExportDetail>>;
  ladenLeg(exportId: string, weightKg?: number): Promise<Result<ExportDetail>>;
  vgm(exportId: string, body: { method: 1 | 2; kg: number; weighbridge?: string; ticketRef?: string; weighedAt?: string; signatory: string }): Promise<Result<ExportDetail>>;
  paper(exportId: string, body: { key: ExportPaperKey; documentId?: string; reference?: string }): Promise<Result<ExportDetail>>;
  billOfLading(exportId: string, number: string): Promise<Result<ExportDetail>>;
  /** The file the forwarder takes at the gate, as printable HTML. */
  handover(exportId: string): Promise<Result<string>>;
  freeDays(exportId: string, kind: 'detention' | 'demurrage', days: number): Promise<Result<ExportDetail>>;
  emptyOut(exportId: string, at: string): Promise<Result<ExportDetail>>;
  loaded(exportId: string, at: string): Promise<Result<ExportDetail>>;
  appointAgent(exportId: string, agentEntityId: string): Promise<Result<ExportDetail>>;
  endAgent(exportId: string, reason?: string): Promise<Result<ExportDetail>>;
  acceptPaper(exportId: string, key: ExportPaperKey): Promise<Result<ExportDetail>>;
  refusePaper(exportId: string, key: ExportPaperKey, reason: string): Promise<Result<ExportDetail>>;
  /** The paper attached on a line, as its bytes — for the exporter, its appointed agent, staff. */
  paperFile(exportId: string, key: ExportPaperKey): Promise<Result<Blob>>;
  /** The clearing agents' directory, alphabetical. */
  findAgents(): Promise<Result<{ items: ExportAgentCard[] }>>;
  ownBox(exportId: string, own: boolean): Promise<Result<ExportDetail>>;
  quoteFee(exportId: string, body: { amount: number; currency?: string; note?: string; reference?: string }): Promise<Result<ExportDetail>>;
  acceptFee(exportId: string): Promise<Result<ExportDetail>>;
}

export function exportsApi(sbg: SbgClient): ExportsApi {
  const call = <T>(fn: Parameters<SbgClient['request']>[0]) => sbg.request(fn) as unknown as Promise<Result<T>>;
  const id = (exportId: string) => encodeURIComponent(exportId);
  const post = <T>(path: string, body: unknown = {}) => call<T>((c) => c.POST(path as never, { body } as never) as never);
  return {
    list: () => call((c) => c.GET('/v1/sbg/exports' as never, {} as never) as never),
    detail: (exportId) => call((c) => c.GET(`/v1/sbg/exports/${id(exportId)}` as never, {} as never) as never),
    register: (input) => post('/v1/sbg/exports', input),
    container: (exportId, containerNo) => post(`/v1/sbg/exports/${id(exportId)}/container`, { containerNo }),
    emptyLeg: (exportId) => post(`/v1/sbg/exports/${id(exportId)}/empty-leg`),
    ladenLeg: (exportId, weightKg) => post(`/v1/sbg/exports/${id(exportId)}/laden-leg`, weightKg ? { weightKg } : {}),
    vgm: (exportId, body) => post(`/v1/sbg/exports/${id(exportId)}/vgm`, body),
    paper: (exportId, body) => post(`/v1/sbg/exports/${id(exportId)}/papers`, body),
    billOfLading: (exportId, number) => post(`/v1/sbg/exports/${id(exportId)}/bill-of-lading`, { number }),
    handover: (exportId) => call((c) => c.GET(`/v1/sbg/exports/${id(exportId)}/handover.html` as never, { parseAs: 'text' } as never) as never),
    freeDays: (exportId, kind, days) => post(`/v1/sbg/exports/${id(exportId)}/free-days`, { kind, days }),
    emptyOut: (exportId, at) => post(`/v1/sbg/exports/${id(exportId)}/empty-out`, { at }),
    loaded: (exportId, at) => post(`/v1/sbg/exports/${id(exportId)}/loaded`, { at }),
    appointAgent: (exportId, agentEntityId) => post(`/v1/sbg/exports/${id(exportId)}/agent`, { agentEntityId }),
    endAgent: (exportId, reason) => post(`/v1/sbg/exports/${id(exportId)}/agent/end`, reason ? { reason } : {}),
    acceptPaper: (exportId, key) => post(`/v1/sbg/exports/${id(exportId)}/papers/${key}/accept`),
    refusePaper: (exportId, key, reason) => post(`/v1/sbg/exports/${id(exportId)}/papers/${key}/refuse`, { reason }),
    paperFile: (exportId, key) => call((c) => c.GET(`/v1/sbg/exports/${id(exportId)}/papers/${key}/file` as never, { parseAs: 'blob' } as never) as never),
    findAgents: () => call((c) => c.GET('/v1/sbg/agents/find' as never, {} as never) as never),
    ownBox: (exportId, own) => post(`/v1/sbg/exports/${id(exportId)}/own-box`, { own }),
    quoteFee: (exportId, body) => post(`/v1/sbg/exports/${id(exportId)}/fee`, body),
    acceptFee: (exportId) => post(`/v1/sbg/exports/${id(exportId)}/fee/accept`),
  };
}

/** "28 Oct 2026 18:00 UTC" — a cut-off in one clock, the same for the exporter, its forwarder and the driver. */
export function utcWords(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** A `datetime-local` value, read as UTC — the cut-off on a booking confirmation is the terminal's, written as UTC here. */
export function fromUtcInput(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  const at = Date.parse(`${v}${v.length === 16 ? ':00' : ''}Z`);
  return Number.isNaN(at) ? undefined : new Date(at).toISOString();
}

const TIMING_TONE: Record<ExportTimingState, 'ok' | 'warn' | 'info'> = { on_time: 'info', at_risk: 'warn', missed: 'warn', gated_in: 'ok' };
const TIMING_WORD: Record<ExportTimingState, MessageKey> = {
  on_time: 'business.exports.state.on_time',
  at_risk: 'business.exports.state.at_risk',
  missed: 'business.exports.state.missed',
  gated_in: 'business.exports.state.gated_in',
};

/** The tag beside an export: on time, at risk, missed, inside the gate. */
export function timingTag(timing: ExportTiming, t: Translate): { tone: 'ok' | 'warn' | 'info'; word: string } {
  return { tone: TIMING_TONE[timing.state], word: t(TIMING_WORD[timing.state]) };
}

/** "28 Oct 2026" — a free-days date is a day, not a minute. */
export function dayWords(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const CLOCK_WORDS: Record<'detention' | 'demurrage', { noClaim: MessageKey; running: MessageKey; over: MessageKey }> = {
  detention: { noClaim: 'business.exports.clock.outside.noClaim', running: 'business.exports.clock.outside.running', over: 'business.exports.clock.outside.over' },
  demurrage: { noClaim: 'business.exports.clock.inside.noClaim', running: 'business.exports.clock.inside.running', over: 'business.exports.clock.inside.over' },
};

/**
 * THE BOX'S CLOCK IN ONE LINE: what is running, since when, to which date — and whose figure that date comes from. No
 * figure, no date: the line asks for the free days instead of counting to a zero. Days, never money.
 */
export function boxLine(box: ExportBoxClock, t: Translate): { tone: 'ok' | 'warn' | 'info'; text: string } {
  if (box.kind === 'unknown') return { tone: 'info', text: t('business.exports.clock.unknown') };
  if (box.kind === 'owned') return { tone: 'info', text: t('business.exports.clock.owned') };
  if (box.kind === 'stopped') return { tone: 'ok', text: t('business.exports.clock.stopped', { outside: box.detentionDays ?? 0, inside: box.demurrageDays ?? 0 }) };
  const words = CLOCK_WORDS[box.kind];
  const since = dayWords(box.since ?? '');
  if (box.freeDays == null || !box.dueAt) return { tone: 'info', text: t(words.noClaim, { since, days: box.daysElapsed ?? 0 }) };
  const due = dayWords(box.dueAt);
  if (box.overdue) return { tone: 'warn', text: t(words.over, { due, over: -(box.daysLeft ?? 0), free: box.freeDays }) };
  return { tone: box.dueSoon ? 'warn' : 'info', text: t(words.running, { since, day: box.daysElapsed ?? 0, free: box.freeDays, by: box.freeDaysBy ?? '', due }) };
}

/** The tag beside an export in the list, only when the box's free days ask for something: soon, or past. */
export function boxTag(box: ExportBoxClock, t: Translate): { tone: 'warn'; word: string } | null {
  if (box.kind !== 'detention' && box.kind !== 'demurrage') return null;
  if (box.overdue) return { tone: 'warn', word: t('business.exports.clock.tagOver') };
  if (box.dueSoon) return { tone: 'warn', word: t('business.exports.clock.tagSoon', { n: box.daysLeft ?? 0 }) };
  return null;
}

/** The claim in force for one kind — the latest, as the server counts it. */
export function freeDaysOf(c: Pick<ExportConsignment, 'freeDays'>, kind: 'detention' | 'demurrage'): ExportFreeDays | undefined {
  return (c.freeDays ?? [])
    .filter((f) => f.kind === kind)
    .sort((a, b) => a.at.localeCompare(b.at))
    .pop();
}

/** The one line that says what the clock asks: when it must leave, or that it is inside the gate, or that it missed it. */
export function timingLine(d: Pick<ExportDetail, 'timing' | 'consignment'>, t: Translate): string {
  const { timing, consignment: c } = d;
  if (timing.state === 'gated_in') return t('business.exports.line.gatedIn', { terminal: c.terminal.label, when: utcWords(timing.gatedInAt ?? '') });
  if (timing.state === 'missed') return t('business.exports.line.missed', { terminal: c.terminal.label, cutoff: utcWords(c.booking.gateCutoffAt), party: c.booking.partyName });
  if (timing.collectedAt) return t('business.exports.line.onTheRoad', { terminal: c.terminal.label, cutoff: utcWords(c.booking.gateCutoffAt) });
  return t('business.exports.line.leaveBy', { place: c.loadingPlace.label, leaveBy: utcWords(timing.leaveByAt), terminal: c.terminal.label, cutoff: utcWords(c.booking.gateCutoffAt), km: Math.round(timing.roadKm), hours: timing.plannedHours });
}
