import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { FREE_DAY_KINDS, type FreeDayKind } from './container-box';
import { FEE_STATES, type FeeState } from './import.types';
import { Quote } from './quote.types';
import { ExportSli, ExportSliView } from './export-sli.types';
import { ExportPacking, ExportPackingView } from './export-packing.types';
import { ExportInvoice, ExportInvoiceView } from './export-invoice.types';
import { HeldRailNote, RailNoteView } from './rail-note.types';
import { ExportByRail } from './rail-leg.types';

/**
 * EXPORTS TO THE PORT (the user, 2026-10-27: "when goods move to a port, we need to have the documentation and foundation
 * for ocean shipments ready … The missing for goods going to a port should be build"). Design: 05_engineering/
 * exports_to_the_port.md.
 *
 * ONE EXPORT CONSIGNMENT — `EXP-001` — is one container leaving through a port: the forwarder's booking and its gate
 * cut-off, the empty box out to where it is stuffed, the laden box to the terminal, its verified gross mass, the export
 * papers and one file the forwarder takes at the gate. The SEA IS NEVER OURS: no rate, no space, no bill of lading issued,
 * nothing submitted to a line — every such thing is a REFERENCE the exporter typed from what its forwarder or the line
 * gave it. Open to any forwarder or line; keyed to none.
 */

/** Who the exporter booked the ocean leg with. A label of the relationship — we book nothing. */
export const BOOKED_WITH = ['forwarder', 'shipping_line'] as const;
export type BookedWith = (typeof BOOKED_WITH)[number];

/**
 * THE PAPERS AN EXPORT HOLDS (the user, 2026-10-28: "in the exports field I miss quiet a bit of documents. Shouldn't we
 * add them? we don't book but we hold documents as a report"). We issue none of them and file none: each is the
 * exporter's own document (fingerprinted and versioned with its other papers) or a reference — held here so the record,
 * and the file the forwarder takes, is complete. Three groups:
 *
 *  - `needed` — on every export, counted missing until given: what the forwarder and customs ask of any export.
 *  - `kept` — on every export, kept when there is one and never counted missing: the booking confirmation, the shipping
 *    instructions to the forwarder, the weighbridge ticket behind the verified gross mass, the bill of lading's copy.
 *  - `asked` — put on the list by the exporter or its clearing agent when the goods, the buyer or the destination ask for
 *    it; once there, counted missing until given. A dangerous goods declaration is put there for hazardous goods. Any
 *    other paper can be asked for by name (`other-1`, `other-2`, …).
 *
 * General names, never one country's agency: the plant-health authority, the standards body and the licensing office
 * differ by country; the paper's kind does not.
 */
export const EXPORT_PAPER_KEYS = [
  'commercial_invoice',
  'packing_list',
  'export_entry',
  'booking_confirmation',
  'shipping_instructions',
  'weighbridge_ticket',
  'bill_of_lading',
  'certificate_of_origin',
  'phytosanitary_certificate',
  'fumigation_certificate',
  'export_permit',
  'inspection_certificate',
  'certificate_of_analysis',
  'health_certificate',
  'insurance_certificate',
  'dangerous_goods_declaration',
  'letter_of_credit',
] as const;
export type KnownExportPaperKey = (typeof EXPORT_PAPER_KEYS)[number];
/** A paper of the catalogue, or another paper asked for by name. */
export type ExportPaperKey = KnownExportPaperKey | `other-${number}`;

export const EXPORT_PAPER_GROUPS = ['needed', 'asked', 'kept'] as const;
export type ExportPaperGroup = (typeof EXPORT_PAPER_GROUPS)[number];

export const EXPORT_PAPER_GROUP: Record<KnownExportPaperKey, ExportPaperGroup> = {
  commercial_invoice: 'needed',
  packing_list: 'needed',
  export_entry: 'needed',
  booking_confirmation: 'kept',
  // The forwarder drafts the bill of lading from it: needed, and a form of its own (EX9), never just a reference.
  shipping_instructions: 'needed',
  weighbridge_ticket: 'kept',
  bill_of_lading: 'kept',
  certificate_of_origin: 'asked',
  phytosanitary_certificate: 'asked',
  fumigation_certificate: 'asked',
  export_permit: 'asked',
  inspection_certificate: 'asked',
  certificate_of_analysis: 'asked',
  health_certificate: 'asked',
  insurance_certificate: 'asked',
  dangerous_goods_declaration: 'asked',
  letter_of_credit: 'asked',
};

const OTHER_KEY = /^other-([1-9][0-9]?)$/;

/** Is this one of the papers an export can hold — the catalogue's, or another asked for by name? */
export function isExportPaperKey(key: string): key is ExportPaperKey {
  return (EXPORT_PAPER_KEYS as readonly string[]).includes(key) || OTHER_KEY.test(key);
}

/** Where the timing stands, derived on every read from the cut-off, the road and the laden leg. */
export const EXPORT_TIMING = ['on_time', 'at_risk', 'missed', 'gated_in'] as const;
export type ExportTimingState = (typeof EXPORT_TIMING)[number];

export class ExportPlace {
  @ApiProperty() label: string;
  @ApiProperty() location: { lat: number; lng: number };
}

/** The forwarder's (or line's) booking, as the exporter copied it off the booking confirmation. */
export class ExportBooking {
  /** The booking number the forwarder or the line gave. */
  @ApiProperty() reference: string;
  @ApiProperty({ enum: BOOKED_WITH }) bookedWith: BookedWith;
  /** The forwarder's or the line's name. */
  @ApiProperty() partyName: string;
  @ApiPropertyOptional() vessel?: string;
  @ApiPropertyOptional() voyage?: string;
  /** The terminal's gate-in cut-off: the laden box must be inside the gate before this. */
  @ApiProperty() gateCutoffAt: string;
  /** By when the verified gross mass must be declared to the line (by the forwarder). */
  @ApiPropertyOptional() vgmCutoffAt?: string;
  /** By when the shipping documents must reach the forwarder. */
  @ApiPropertyOptional() docsCutoffAt?: string;
  /** The empty release number: what the depot hands the empty box out against. */
  @ApiPropertyOptional() emptyReleaseRef?: string;
}

/** The verified gross mass (SOLAS): recorded and handed to the forwarder — never sent to a line by us. */
export class ExportVgm {
  /** 1: the packed box weighed whole. 2: everything packed weighed, plus the box's tare. */
  @ApiProperty({ enum: [1, 2] }) method: 1 | 2;
  @ApiProperty() kg: number;
  @ApiPropertyOptional() weighbridge?: string;
  @ApiPropertyOptional() ticketRef?: string;
  @ApiPropertyOptional() weighedAt?: string;
  /** The person who signs for it, for the exporter. */
  @ApiProperty() signatory: string;
  @ApiProperty() declaredAt: string;
  @ApiProperty() declaredBy: string;
}

/** One export paper: a document from the exporter's own papers, or (the export entry) a reference. */
export class ExportPaper {
  /** One of the catalogue's (EXPORT_PAPER_KEYS), or `other-N` for a paper asked for by name. */
  @ApiProperty({ type: String }) key: ExportPaperKey;
  /** Kept when there is one, never counted missing (the booking confirmation, the weighbridge ticket …). */
  @ApiPropertyOptional() optional?: boolean;
  /** The name of a paper asked for by name. */
  @ApiPropertyOptional() title?: string;
  /** Who put it on the list, for these goods — the exporter or its agent. Absent: on every export. */
  @ApiPropertyOptional() addedBy?: string;
  @ApiPropertyOptional() addedByEntityId?: string;
  @ApiPropertyOptional() addedAt?: string;
  @ApiPropertyOptional() documentId?: string;
  @ApiPropertyOptional() documentTitle?: string;
  @ApiPropertyOptional() reference?: string;
  @ApiPropertyOptional() suppliedAt?: string;
  @ApiPropertyOptional() suppliedBy?: string;
  /** The appointed clearing agent's word on what was supplied — accepted, or sent back with a reason. Cleared when the paper is supplied again. */
  @ApiPropertyOptional() acceptedAt?: string;
  @ApiPropertyOptional() acceptedBy?: string;
  @ApiPropertyOptional() refusedAt?: string;
  @ApiPropertyOptional() refusedBy?: string;
  @ApiPropertyOptional() refusedReason?: string;
}

/** How many free days the line gives — the exporter's claim, from its agreement with the line or forwarder. Every claim is kept; the latest is in force. */
export class ExportFreeDays {
  @ApiProperty({ enum: FREE_DAY_KINDS }) kind: FreeDayKind;
  @ApiProperty() days: number;
  @ApiProperty() byEntityId: string;
  @ApiProperty() by: string;
  @ApiProperty() at: string;
}

/** A moment the exporter recorded from what it was told — when no load of ours saw it happen. */
export class ExportMoment {
  @ApiProperty() at: string;
  @ApiProperty() by: string;
  @ApiProperty() recordedAt: string;
}

/** The clearing agent the exporter appointed: reads this export's papers, gives the export entry, accepts or sends back. */
export class ExportAgent {
  @ApiProperty() entityId: string;
  @ApiProperty() appointedAt: string;
  @ApiProperty() appointedBy: string;
}

/** An appointment that ended — kept, so who could read these papers, and until when, stays on the record. */
export class ExportFormerAgent extends ExportAgent {
  @ApiProperty() endedAt: string;
  @ApiProperty() endedBy: string;
  @ApiPropertyOptional() reason?: string;
  /** The fee it quoted while appointed, if it did: the quotation stays between the two of them. */
  @ApiPropertyOptional() feeQuoteId?: string;
}

/** The appointed agent's fee: which quotation it is, whose, and when it was first quoted. One per appointment. */
export class ExportFeeStamp {
  @ApiProperty() quoteId: string;
  @ApiProperty() quotedAt: string;
  @ApiProperty() agentEntityId: string;
}

/** The exporter says the box is its own (a shipper-owned container): no line's free days run on it. */
export class ExportOwnBox {
  @ApiProperty() by: string;
  @ApiProperty() at: string;
}

export class ExportBillOfLading {
  @ApiProperty() number: string;
  @ApiProperty() recordedAt: string;
  @ApiProperty() recordedBy: string;
}

export class ExportConsignment {
  @ApiProperty() exportId: string;
  /** EXP-001. */
  @ApiProperty() code: string;
  /** The business that owns the goods and books the ocean leg with its forwarder. */
  @ApiProperty() exporterEntityId: string;
  @ApiProperty() goodsDescription: string;
  @ApiProperty() originCountry: string;
  @ApiProperty() destCountry: string;
  /** The port it leaves through — a label, like the import side's ports. */
  @ApiProperty() loadingPort: string;
  /** The ISO 6346 size/type code — selected from the catalogue, so the road leg's facts are derived. */
  @ApiPropertyOptional() containerType?: string;
  @ApiPropertyOptional() natureCode?: string;
  @ApiProperty({ type: ExportBooking }) booking: ExportBooking;
  /** Where the box is stuffed: the exporter's saved place. */
  @ApiProperty({ type: ExportPlace }) loadingPlace: ExportPlace;
  /** The terminal it is delivered to. */
  @ApiProperty({ type: ExportPlace }) terminal: ExportPlace;
  /** Where the empty is collected, when the exporter fetches it. Absent: the line or forwarder brings it. */
  @ApiPropertyOptional({ type: ExportPlace }) emptyDepot?: ExportPlace;
  /** The box's number, once it is known (at the depot, or when stuffed): ISO 6346, check digit checked. */
  @ApiPropertyOptional() containerNo?: string;
  @ApiPropertyOptional() emptyFreightId?: string;
  @ApiPropertyOptional() emptyFreightCode?: string;
  @ApiPropertyOptional() ladenFreightId?: string;
  @ApiPropertyOptional() ladenFreightCode?: string;
  @ApiPropertyOptional({ type: ExportVgm }) vgm?: ExportVgm;
  @ApiProperty({ type: [ExportPaper] }) papers: ExportPaper[];
  @ApiPropertyOptional({ type: ExportBillOfLading }) billOfLading?: ExportBillOfLading;
  /** The box's free days, as the exporter was given them: detention outside the terminal, demurrage inside. */
  @ApiPropertyOptional({ type: [ExportFreeDays] }) freeDays?: ExportFreeDays[];
  /** When the empty left the depot — recorded only where no empty load of ours fetched it (the line or forwarder brought it). */
  @ApiPropertyOptional({ type: ExportMoment }) emptyOut?: ExportMoment;
  /** Loaded on board, from the forwarder's or the line's word: what stops the box's clock. */
  @ApiPropertyOptional({ type: ExportMoment }) loaded?: ExportMoment;
  @ApiPropertyOptional({ type: ExportAgent }) agent?: ExportAgent;
  @ApiPropertyOptional({ type: [ExportFormerAgent] }) formerAgents?: ExportFormerAgent[];
  @ApiPropertyOptional({ type: ExportFeeStamp }) fee?: ExportFeeStamp;
  @ApiPropertyOptional({ type: ExportOwnBox }) ownBox?: ExportOwnBox;
  /** The shipper's letter of instruction: the form, and the versions signed. */
  @ApiPropertyOptional({ type: ExportSli }) sli?: ExportSli;
  /** The packing list, imported from the shipper's own file: its lines and the versions signed. */
  @ApiPropertyOptional({ type: ExportPacking }) packing?: ExportPacking;
  /** The commercial invoice, drawn from the packing list's lines: the form, and the versions signed. */
  @ApiPropertyOptional({ type: ExportInvoice }) invoice?: ExportInvoice;
  /** Which warnings were sent, once each: the latest departure near, the cut-off passed, the VGM cut-off near — and the box's free days, once per due date. */
  @ApiPropertyOptional() warned?: { pickup?: string; gate?: string; vgm?: string; box?: string[] };
  /** The railway's note, where the box goes to the port by rail — held, never issued by us (rail-note.ts). */
  @ApiPropertyOptional({ type: HeldRailNote }) rail?: HeldRailNote;
  /** By rail to the port (2026-10-29): our truck takes the box to a rail terminal, timed to the train's cut-off there. */
  @ApiPropertyOptional({ type: ExportByRail }) byRail?: ExportByRail;
  /** The notes it replaced, each kept as it was. */
  @ApiPropertyOptional({ type: [HeldRailNote] }) formerRail?: HeldRailNote[];
  @ApiProperty() createdAt: string;
  @ApiProperty() createdBy: string;
}

/** Where the timing stands, said on every read. */
/** Where our truck hands the box over, and by when: the port gate, or — by rail — the rail terminal. */
export class ExportHandover {
  @ApiProperty() place: string;
  @ApiProperty() cutoffAt: string;
  @ApiProperty() byRail: boolean;
}

export class ExportTiming {
  @ApiProperty({ type: ExportHandover }) handover: ExportHandover;
  @ApiProperty({ enum: EXPORT_TIMING }) state: ExportTimingState;
  /** The latest the laden truck may leave the loading place and still gate in before the cut-off. */
  @ApiProperty() leaveByAt: string;
  /** The road between them, and the hours it is planned at (with the gate buffer). */
  @ApiProperty() roadKm: number;
  @ApiProperty() plannedHours: number;
  /** When the laden box was delivered at the terminal (its leg's delivery), once it was. */
  @ApiPropertyOptional() gatedInAt?: string;
  /** When the laden leg was collected at the loading place. */
  @ApiPropertyOptional() collectedAt?: string;
}

/** A leg of this export, as the screen reads it. */
export class ExportLegView {
  @ApiProperty() freightId: string;
  @ApiProperty() code: string;
  @ApiProperty() status: string;
  @ApiPropertyOptional() pickedUpAt?: string;
  @ApiPropertyOptional() deliveredAt?: string;
}

export class ExportSealView {
  @ApiPropertyOptional() number?: string;
  @ApiProperty() state: string;
  @ApiProperty() appliedBy: string;
}

export class ExportPaperView extends ExportPaper {
  @ApiProperty() label: string;
  @ApiProperty({ enum: EXPORT_PAPER_GROUPS }) group: ExportPaperGroup;
  /** This reader asked for it and nothing was given for it yet: it may take it off the list. */
  @ApiPropertyOptional() removable?: boolean;
}

/** The box's clock on this export, derived on every read: detention outside, demurrage inside, in dates and days — never money. */
export class ExportBoxClockView {
  @ApiProperty({ enum: ['detention', 'demurrage', 'stopped', 'unknown', 'owned'] }) kind: 'detention' | 'demurrage' | 'stopped' | 'unknown' | 'owned';
  @ApiPropertyOptional() since?: string;
  @ApiPropertyOptional() daysElapsed?: number;
  @ApiPropertyOptional() freeDays?: number;
  @ApiPropertyOptional() freeDaysBy?: string;
  @ApiPropertyOptional() freeDaysAt?: string;
  @ApiPropertyOptional() dueAt?: string;
  @ApiPropertyOptional() daysLeft?: number;
  @ApiProperty() overdue: boolean;
  /** Within three days of the date: still time to act. */
  @ApiProperty() dueSoon: boolean;
  @ApiPropertyOptional() detentionDays?: number;
  @ApiPropertyOptional() demurrageDays?: number;
  /** When the empty left the depot, and how we know: its load's pickup, or what the exporter recorded. */
  @ApiPropertyOptional() emptyOutAt?: string;
  @ApiPropertyOptional({ enum: ['load', 'recorded'] }) emptyOutFrom?: 'load' | 'recorded';
  @ApiProperty() basis: string;
}

export class ExportAgentView extends ExportAgent {
  @ApiProperty() name: string;
}

export class ExportDocumentChoice {
  @ApiProperty() documentId: string;
  @ApiProperty() title: string;
}

export class ExportDetail {
  @ApiProperty({ type: ExportConsignment }) consignment: ExportConsignment;
  @ApiProperty({ type: ExportTiming }) timing: ExportTiming;
  @ApiPropertyOptional({ type: ExportLegView }) emptyLeg?: ExportLegView;
  @ApiPropertyOptional({ type: ExportLegView }) ladenLeg?: ExportLegView;
  /** The seals written on the laden load — the seal is written there, with its photographs, never twice. */
  @ApiProperty({ type: [ExportSealView] }) seals: ExportSealView[];
  @ApiProperty({ type: [ExportPaperView] }) papers: ExportPaperView[];
  /** What is still missing before the forwarder can take it at the gate — in words. Empty: nothing. */
  @ApiProperty({ type: [String] }) missing: string[];
  /** The exporter's own current papers, to attach one to a line (never a loose upload). Empty for its agent: it reads what is attached, nothing more. */
  @ApiProperty({ type: [ExportDocumentChoice] }) documents: ExportDocumentChoice[];
  @ApiProperty({ type: ExportBoxClockView }) box: ExportBoxClockView;
  /** Who is reading: the exporter, its appointed clearing agent, or network staff. */
  @ApiProperty({ enum: ['exporter', 'agent', 'staff'] }) you: 'exporter' | 'agent' | 'staff';
  @ApiProperty() exporterName: string;
  @ApiPropertyOptional({ type: ExportAgentView }) agent?: ExportAgentView;
  /** The appointed agent's fee, as a quotation between it and the exporter: nothing of it passes through SeeBuyGet. */
  @ApiPropertyOptional({ type: Quote }) fee?: Quote;
  @ApiProperty({ enum: FEE_STATES }) feeState: FeeState;
  @ApiProperty({ type: ExportSliView }) sli: ExportSliView;
  @ApiPropertyOptional({ type: ExportPackingView }) packing?: ExportPackingView;
  @ApiProperty({ type: ExportInvoiceView }) invoice: ExportInvoiceView;
  /** The railway's note with its check, and what it says of the box against ours. */
  @ApiPropertyOptional({ type: RailNoteView }) rail?: RailNoteView;
}

export class ExportRow {
  @ApiProperty() exportId: string;
  @ApiProperty() code: string;
  @ApiProperty() goodsDescription: string;
  @ApiProperty() loadingPort: string;
  @ApiProperty() bookingReference: string;
  @ApiProperty() gateCutoffAt: string;
  @ApiPropertyOptional() containerNo?: string;
  @ApiProperty({ type: ExportTiming }) timing: ExportTiming;
  @ApiProperty() missing: number;
  @ApiProperty({ type: ExportBoxClockView }) box: ExportBoxClockView;
  @ApiProperty({ enum: ['exporter', 'agent', 'staff'] }) you: 'exporter' | 'agent' | 'staff';
  @ApiProperty() exporterName: string;
  @ApiPropertyOptional() agentName?: string;
}

/* ------------------------------------------------------------------ requests -- */

export class ExportBookingDto {
  @IsString() @MaxLength(60) reference!: string;
  @IsIn(BOOKED_WITH) bookedWith!: BookedWith;
  @IsString() @MaxLength(120) partyName!: string;
  @IsOptional() @IsString() @MaxLength(80) vessel?: string;
  @IsOptional() @IsString() @MaxLength(40) voyage?: string;
  @IsString() gateCutoffAt!: string;
  @IsOptional() @IsString() vgmCutoffAt?: string;
  @IsOptional() @IsString() docsCutoffAt?: string;
  @IsOptional() @IsString() @MaxLength(60) emptyReleaseRef?: string;
}

export class RegisterExportDto {
  /** Staff name the company; a business or an administrator acts as its own. */
  @IsOptional() @IsString() exporterEntityId?: string;
  @IsString() @MaxLength(300) goodsDescription!: string;
  @IsString() @MaxLength(2) originCountry!: string;
  @IsString() @MaxLength(2) destCountry!: string;
  @IsString() @MaxLength(80) loadingPort!: string;
  @IsOptional() @IsString() @MaxLength(8) containerType?: string;
  @IsOptional() @IsString() @MaxLength(8) natureCode?: string;
  @ValidateNested() @Type(() => ExportBookingDto) booking!: ExportBookingDto;
  /** The exporter's saved places: where it is stuffed (kind `loading`), the terminal and the empty depot (kind `port`). */
  @IsString() loadingSiteId!: string;
  @IsString() terminalSiteId!: string;
  @IsOptional() @IsString() emptyDepotSiteId?: string;
  /** The box is the exporter's own (a shipper-owned container): no line's free days run on it. */
  @IsOptional() @IsBoolean() ownBox?: boolean;
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

export class ExportContainerDto {
  @IsString() @MaxLength(16) containerNo!: string;
}

export class ExportLadenLegDto {
  /** The gross weight, where no verified gross mass is declared yet. */
  @IsOptional() @IsNumber() @Min(1) weightKg?: number;
}

export class ExportVgmDto {
  @IsInt() @IsIn([1, 2]) method!: 1 | 2;
  @IsNumber() @Min(1) @Max(60000) kg!: number;
  @IsOptional() @IsString() @MaxLength(120) weighbridge?: string;
  @IsOptional() @IsString() @MaxLength(60) ticketRef?: string;
  @IsOptional() @IsString() weighedAt?: string;
  @IsString() @MaxLength(120) signatory!: string;
}

export class ExportPaperDto {
  @IsString() @Matches(/^([a-z_]{3,40}|other-[1-9][0-9]?)$/) key!: ExportPaperKey;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
}

export class ExportBillOfLadingDto {
  @IsString() @MaxLength(60) number!: string;
}

export class ExportFreeDaysDto {
  @IsIn(FREE_DAY_KINDS) kind!: FreeDayKind;
  @IsInt() @Min(0) @Max(90) days!: number;
}

export class ExportMomentDto {
  /** When it happened, as ISO-8601. */
  @IsString() at!: string;
}

export class ExportAppointAgentDto {
  /** The clearing agent's company, chosen from the agents' directory. */
  @IsString() agentEntityId!: string;
}

export class ExportEndAgentDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/** Ask for a paper these goods need: one of the catalogue's `asked` papers, or `other` with its name. */
export class ExportAddPaperDto {
  @IsString() @MaxLength(40) key!: string;
  @IsOptional() @IsString() @MaxLength(80) title?: string;
}

export class ExportOwnBoxDto {
  @IsBoolean() own!: boolean;
}

/** The appointed agent's fee, quoted to the exporter: a quotation, never a payment through us. */
export class ExportFeeDto {
  @IsNumber() @Min(0.01) amount!: number;
  /** Three letters; left out, the currency of the country it is sent from. */
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  /** Its own number for it — the quotation or proforma number. */
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
}

export class ExportPaperRefusalDto {
  @IsString() @MaxLength(300) reason!: string;
}
