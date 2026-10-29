import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import type { CargoNature } from './cargo.types';
import { boxDueSoon, exportBoxClock, FREE_DAY_KINDS, type FreeDayKind } from './container-box';
import { ContainerBoxService } from './container-box.service';
import { containerType } from './container-type';
import { dangerousGoodsGap } from './cargo.types';
import { DispatchService } from './dispatch.service';
import { EXPORT_PAPER_GROUP, EXPORT_PAPER_KEYS, type ExportPaperGroup, type KnownExportPaperKey, type ExportBoxClockView, type ExportConsignment, type ExportDetail, type ExportLegView, type ExportPaper, type ExportPaperKey, type ExportPlace, type ExportRow, type ExportTiming, type BookedWith } from './export.types';
import { LoadSealService } from './load-seal.service';
import { NotificationService } from './notification.service';
import { EXPORT_GATE_BUFFER_H, VEHICLE_SPEED_KMH } from './pudo.config';
import { catalogueEntry, isKnownCurrency } from '../../foundation/countries/catalogue';
import type { FeeState } from './import.types';
import { QuoteService } from './quote.service';
import type { Quote } from './quote.types';
import { ROUTER, type Router } from './router';
import { cleanInvoice, INVOICE_TRUTH, invoiceBasis, invoiceGaps, invoiceHtml, invoiceNotes, invoiceTotals } from './export-invoice';
import type { ExportInvoiceView, InvoiceDraftDto, InvoiceTemplate } from './export-invoice.types';
import { cellsWithRows, packingBasis, packingHtml, readPacking, summarisePacking, totalsOf, type PackingFacts } from './export-packing';
import type { ExportPackingView, PackingCheck, PackingImportDto, PackingColumnUse } from './export-packing.types';
import { readWorkbook } from './workbook';
import { cleanDraft, sliBasis, sliGaps, sliHtml, sliStale, type SliFacts } from './export-sli';
import type { ExportSliView, SliDraft, SliDraftDto } from './export-sli.types';
import { SiteService } from './site.service';
import { holdRailNote, railNoteView } from './rail-note';
import { journeyModes, type ExportByRailDto } from './rail-leg.types';
import { fblView, holdFbl, verifyFbl } from './fbl-note';
import type { FblDto, FblVerifiedDto } from './fbl-note.types';
import type { RailNoteDto } from './rail-note.types';
import { airlineOfPrefix, awbDigits, awbProblem, checkAirWaybill, formatAwb } from '../../foundation/carriage-law/air';
import { AIR_INSPECTION_H, AIR_LAT_BUFFER_H } from './pudo.config';
import { AIR_ONLY_PAPERS, SEA_ONLY_PAPERS, type ExportAir, type ExportAirView } from './export.types';
import type { TruckSubtype } from './fleet.config';

/** The words for each paper, where a sentence names it (the screen translates its own). */
export const EXPORT_PAPER_LABEL: Record<KnownExportPaperKey, string> = {
  commercial_invoice: 'Commercial invoice',
  packing_list: 'Packing list',
  export_entry: 'Export entry (from your clearing agent)',
  booking_confirmation: 'Booking confirmation',
  shipping_instructions: 'Shipping instructions to the forwarder',
  weighbridge_ticket: 'Weighbridge ticket',
  bill_of_lading: 'Bill of lading',
  certificate_of_origin: 'Certificate of origin',
  phytosanitary_certificate: 'Phytosanitary certificate (plant health)',
  fumigation_certificate: 'Fumigation certificate',
  export_permit: 'Export permit or licence',
  inspection_certificate: 'Inspection or conformity certificate',
  certificate_of_analysis: 'Certificate of analysis or quality',
  health_certificate: 'Health or veterinary certificate',
  insurance_certificate: 'Insurance certificate',
  dangerous_goods_declaration: 'Dangerous goods declaration',
  letter_of_credit: 'Letter of credit',
  air_waybill: 'Air waybill (copy)',
  consignment_security_declaration: 'Consignment security declaration (from the regulated agent)',
};

/** The same papers mid-sentence: "sent back the packing list". */
const EXPORT_PAPER_NOUN: Record<KnownExportPaperKey, string> = {
  commercial_invoice: 'the commercial invoice',
  packing_list: 'the packing list',
  export_entry: 'the export entry',
  booking_confirmation: 'the booking confirmation',
  shipping_instructions: 'the shipping instructions',
  weighbridge_ticket: 'the weighbridge ticket',
  bill_of_lading: 'the bill of lading',
  certificate_of_origin: 'the certificate of origin',
  phytosanitary_certificate: 'the phytosanitary certificate',
  fumigation_certificate: 'the fumigation certificate',
  export_permit: 'the export permit or licence',
  inspection_certificate: 'the inspection certificate',
  certificate_of_analysis: 'the certificate of analysis',
  health_certificate: 'the health certificate',
  insurance_certificate: 'the insurance certificate',
  dangerous_goods_declaration: 'the dangerous goods declaration',
  letter_of_credit: 'the letter of credit',
  air_waybill: 'the air waybill',
  consignment_security_declaration: 'the consignment security declaration',
};

/** The bodies that cannot be locked or sealed: secured air cargo never rides in one (2026-10-29, "with safeguards"). */
const OPEN_BODIES: TruckSubtype[] = ['flatbed', 'dropside', 'curtain_side', 'tipper', 'cement_mixer', 'grain_hopper', 'car_carrier', 'livestock', 'skeletal', 'crane'];

/** A line's name: the catalogue's, or the name it was asked for by. */
export function paperLabel(p: Pick<ExportPaper, 'key' | 'title'>): string {
  return p.title ?? EXPORT_PAPER_LABEL[p.key as KnownExportPaperKey] ?? p.key;
}

function paperNoun(p: Pick<ExportPaper, 'key' | 'title'>): string {
  return p.title ? `“${p.title}”` : (EXPORT_PAPER_NOUN[p.key as KnownExportPaperKey] ?? p.key);
}

/** Which group a line is in: kept (never missing), asked for these goods, or needed on every export. */
function groupOf(p: ExportPaper): ExportPaperGroup {
  if (p.optional) return 'kept';
  if (p.title || EXPORT_PAPER_GROUP[p.key as KnownExportPaperKey] === 'asked') return 'asked';
  return 'needed';
}

const H = 3_600_000;
/** Warned this long before the latest departure, while no truck has collected the box. */
const PICKUP_WARN_H = 6;
/** Warned this long before the VGM cut-off, while no VGM is declared. */
const VGM_WARN_H = 12;

/**
 * EXPORTS TO THE PORT (the user, 2026-10-27; design 05_engineering/exports_to_the_port.md). One container leaving through a
 * port, from the exporter's side of the gate: its forwarder's booking and the gate cut-off, the empty out to where it is
 * stuffed, the laden box to the terminal, its verified gross mass, its papers, and one file for the forwarder at the gate.
 *
 * THE SEA IS NEVER OURS: no rate, no space, no bill of lading issued, nothing submitted to a line. Every such thing here is
 * a reference the exporter typed from what its forwarder or the line gave it — open to any of them, keyed to none.
 *
 * The exporter's alone to write: staff read it, and decide nothing in its name (the controller refuses them by name).
 */
@Injectable()
export class ExportService {
  private readonly exports = new PersistentMap<string, ExportConsignment>('export-consignments');
  /** Each signed letter of instruction, exactly as it was signed: `exportId:version` → its page and the fingerprint of its bytes. */
  private readonly sliCopies = new PersistentMap<string, { html: string; fingerprint: string }>('export-sli-copies');
  /** Each signed packing list, exactly as signed, with the fingerprint of its page and of its lines. */
  private readonly packingCopies = new PersistentMap<string, { html: string; fingerprint: string; basis: string }>('export-packing-copies');
  /** How each business's headings were read, remembered from its last import: its own file is read the same way next time. */
  private readonly packingTemplates = new PersistentMap<string, Record<string, PackingColumnUse>>('export-packing-templates');
  /** Each signed commercial invoice, exactly as signed. */
  private readonly invoiceCopies = new PersistentMap<string, { html: string; fingerprint: string }>('export-invoice-copies');
  /** What a business's last invoice to a country carried — `entityId:country` — offered on its next one there. */
  private readonly invoiceTemplates = new PersistentMap<string, InvoiceTemplate>('export-invoice-templates');

  constructor(
    private readonly entities: EntityService,
    private readonly documents: CompanyDocumentService,
    private readonly dispatch: DispatchService,
    private readonly sites: SiteService,
    private readonly seals: LoadSealService,
    @Inject(ROUTER) private readonly router: Router,
    private readonly quotes: QuoteService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  /* ----------------------------------------------------------- EX1 the booking -- */

  /**
   * RECORD AN EXPORT: the goods, the port, the box, the forwarder's booking with its gate cut-off, and the three places —
   * where it is stuffed, the terminal, and (when the exporter fetches the empty) the depot. Refused before anything is
   * written where a fact the road needs is missing.
   */
  register(
    input: {
      exporterEntityId: string;
      goodsDescription: string;
      originCountry: string;
      destCountry: string;
      loadingPort: string;
      containerType?: string;
      natureCode?: string;
      booking: { reference: string; bookedWith: BookedWith; partyName: string; vessel?: string; voyage?: string; gateCutoffAt: string; vgmCutoffAt?: string; docsCutoffAt?: string; emptyReleaseRef?: string };
      loadingSiteId: string;
      terminalSiteId: string;
      emptyDepotSiteId?: string;
      ownBox?: boolean;
    },
    by: string,
    now = Date.now(),
  ): ExportConsignment {
    const exporter = this.entities.get(input.exporterEntityId);
    const goodsDescription = input.goodsDescription?.trim();
    if (!goodsDescription) throw new GlosError('FIELD_REQUIRED', 'Say what is in it — the forwarder, the papers and the truck all start from what the goods are', { field: 'goodsDescription' });
    const loadingPort = input.loadingPort?.trim();
    if (!loadingPort) throw new GlosError('FIELD_REQUIRED', 'Say which port it leaves through', { field: 'loadingPort' });
    const originCountry = country(input.originCountry, 'where it is sent from');
    const destCountry = country(input.destCountry, 'where it is going');
    // The truck that carries a 40ft is not the one that carries a 20ft: the box is named now, from the catalogue.
    const spec = containerType(input.containerType);
    if (!spec) throw new GlosError('FIELD_REQUIRED', 'Say what kind of box it is — the booking confirmation names it (for example 22G1 for a 20ft, 45G1 for a 40ft high cube)', { field: 'containerType' });
    const b = input.booking ?? ({} as typeof input.booking);
    const reference = b.reference?.trim();
    if (!reference) throw new GlosError('FIELD_REQUIRED', 'Give the booking number your forwarder or the shipping line gave you — we book no ship', { field: 'booking.reference' });
    const partyName = b.partyName?.trim();
    if (!partyName) throw new GlosError('FIELD_REQUIRED', 'Say who it is booked with', { field: 'booking.partyName' });
    const gateCutoffAt = moment(b.gateCutoffAt, 'The gate cut-off');
    if (!gateCutoffAt) throw new GlosError('FIELD_REQUIRED', 'Give the terminal’s gate-in cut-off from the booking confirmation: the box must be inside the gate before it', { field: 'booking.gateCutoffAt' });
    const vgmCutoffAt = moment(b.vgmCutoffAt, 'The VGM cut-off');
    const docsCutoffAt = moment(b.docsCutoffAt, 'The documents cut-off');
    const placeOf = (siteId: string | undefined, kind: 'loading' | 'port', what: string): ExportPlace => {
      if (!siteId) throw new GlosError('FIELD_REQUIRED', `Choose ${what} from your places`, { field: what });
      const site = this.sites.require(exporter.entityId, siteId);
      if (site.kind !== kind) throw new GlosError('VALIDATION_FAILED', `That place is not one of your ${kind === 'loading' ? 'loading places' : 'port places'}`, { field: what });
      return { label: site.name, location: site.location };
    };
    const loadingPlace = placeOf(input.loadingSiteId, 'loading', 'where it is stuffed');
    const terminal = placeOf(input.terminalSiteId, 'port', 'the terminal');
    const emptyDepot = input.emptyDepotSiteId ? placeOf(input.emptyDepotSiteId, 'port', 'the empty depot') : undefined;
    const hazardous = /^HAZ/.test(input.natureCode?.trim().toUpperCase() ?? '');

    const consignment: ExportConsignment = {
      exportId: `exp_${randomBytes(8).toString('hex')}`,
      code: this.nextCode(),
      exporterEntityId: exporter.entityId,
      goodsDescription: goodsDescription.slice(0, 300),
      originCountry,
      destCountry,
      loadingPort: loadingPort.slice(0, 80),
      containerType: spec.code,
      ...(input.natureCode?.trim() ? { natureCode: input.natureCode.trim() } : {}),
      booking: {
        reference: reference.slice(0, 60),
        bookedWith: b.bookedWith === 'shipping_line' ? 'shipping_line' : 'forwarder',
        partyName: partyName.slice(0, 120),
        ...(b.vessel?.trim() ? { vessel: b.vessel.trim().slice(0, 80) } : {}),
        ...(b.voyage?.trim() ? { voyage: b.voyage.trim().slice(0, 40) } : {}),
        gateCutoffAt,
        ...(vgmCutoffAt ? { vgmCutoffAt } : {}),
        ...(docsCutoffAt ? { docsCutoffAt } : {}),
        ...(b.emptyReleaseRef?.trim() ? { emptyReleaseRef: b.emptyReleaseRef.trim().slice(0, 60) } : {}),
      },
      loadingPlace,
      terminal,
      ...(emptyDepot ? { emptyDepot } : {}),
      ...(input.ownBox ? { ownBox: { by, at: new Date(now).toISOString() } } : {}),
      // Every export's papers — needed, and kept when there is one — and, for hazardous goods, their declaration.
      papers: EXPORT_PAPER_KEYS.filter((key) => !AIR_ONLY_PAPERS.includes(key) && (EXPORT_PAPER_GROUP[key] !== 'asked' || (key === 'dangerous_goods_declaration' && hazardous))).map((key) => ({
        key,
        ...(EXPORT_PAPER_GROUP[key] === 'kept' ? { optional: true } : {}),
      })),
      createdAt: new Date(now).toISOString(),
      createdBy: by,
    };
    this.exports.set(consignment.exportId, consignment);
    return consignment;
  }

  /**
   * AN EXPORT BY AIR (the user, 2026-10-29: "flower exports … perishables"): the goods, the countries, where it is loaded,
   * the cargo terminal at the airport, and the booking with the airline as the exporter copied it off its confirmation —
   * the air waybill, the flights, and the latest acceptance time our truck must beat. Refused before anything is written
   * where the waybill number cannot be one, where a fact the road needs is missing, or where the goods are ones we do not
   * carry to an airport yet: medicines wait for the lawyer (legal.html L29), live animals for the next slice.
   */
  registerAir(
    input: {
      exporterEntityId: string;
      goodsDescription: string;
      originCountry: string;
      destCountry: string;
      natureCode?: string;
      bookedWith: 'forwarder' | 'airline';
      partyName: string;
      loadingSiteId: string;
      terminalSiteId: string;
      air: {
        awb: string;
        waybillKind: 'master' | 'house' | 'direct';
        houseNumber?: string;
        airline?: string;
        bookingStatus: 'confirmed' | 'queued';
        flights: Array<{ flight: string; date: string; from: string; to: string; departsLocal?: string }>;
        latAt: string;
        pieces: number;
        weightKg: number;
        volumeM3?: number;
        aircraft?: 'passenger' | 'freighter';
        handler?: string;
        security: { status: 'secured' | 'unsecured'; agentName?: string; agentNumber?: string; knownConsignor?: boolean };
        temp?: { minC: number; maxC: number; preCooled?: boolean };
        inspectionAtAirport?: boolean;
      };
    },
    by: string,
    now = Date.now(),
  ): ExportConsignment {
    const exporter = this.entities.get(input.exporterEntityId);
    const goodsDescription = input.goodsDescription?.trim();
    if (!goodsDescription) throw new GlosError('FIELD_REQUIRED', 'Say what is in it — the forwarder, the papers and the truck all start from what the goods are', { field: 'goodsDescription' });
    const originCountry = country(input.originCountry, 'where it is sent from');
    const destCountry = country(input.destCountry, 'where it is going');
    const nature = input.natureCode?.trim().toUpperCase() || undefined;
    if (nature === 'HUM') throw new GlosError('FORBIDDEN', 'Medicines and vaccines are not carried to or from an airport on SeeBuyGet yet: who must hold a licence to carry them is with our lawyer (legal.html L29).', { field: 'natureCode', reason: 'medicines' });
    if (nature === 'HAZ-BIO') throw new GlosError('FORBIDDEN', 'Live animals and biological goods by air come after this first step: they are not carried to an airport on SeeBuyGet yet.', { field: 'natureCode', reason: 'biological' });
    const partyName = input.partyName?.trim();
    if (!partyName) throw new GlosError('FIELD_REQUIRED', 'Say who it is booked with: your forwarder, or the airline', { field: 'partyName' });
    const a = input.air ?? ({} as typeof input.air);
    // The airline's waybill number: eleven digits, the last a check digit — a wrong one is never kept.
    const problem = awbProblem(a.awb);
    if (problem === 'format') throw new GlosError('VALIDATION_FAILED', 'An air waybill number is eleven digits: the airline’s three, and eight more — like 706-12345675', { field: 'air.awb' });
    if (problem === 'check_digit') throw new GlosError('VALIDATION_FAILED', 'That air waybill number’s last digit does not check: the first seven of its last eight, divided by 7, leave the last. Look at the number again.', { field: 'air.awb' });
    const digits = awbDigits(a.awb);
    const line = airlineOfPrefix(digits.slice(0, 3));
    const airline = line?.name ?? a.airline?.trim();
    if (!airline) throw new GlosError('FIELD_REQUIRED', `We do not hold the airline for prefix ${digits.slice(0, 3)}: say which airline it is`, { field: 'air.airline' });
    if (a.waybillKind === 'house' && !a.houseNumber?.trim()) throw new GlosError('FIELD_REQUIRED', 'A consolidation: give the forwarder’s house waybill number too', { field: 'air.houseNumber' });
    const flights = (a.flights ?? []).map((f) => ({ flight: f.flight.replace(/\s+/g, ' ').trim().toUpperCase(), date: f.date, from: f.from.trim().toUpperCase(), to: f.to.trim().toUpperCase(), ...(f.departsLocal ? { departsLocal: f.departsLocal } : {}) }));
    if (!flights.length) throw new GlosError('FIELD_REQUIRED', 'Give the flight it is booked on', { field: 'air.flights' });
    const latAt = moment(a.latAt, 'The latest acceptance time');
    if (!latAt) throw new GlosError('FIELD_REQUIRED', 'Give the latest acceptance time from the airline’s booking confirmation: the cargo must be accepted at the terminal before it', { field: 'air.latAt' });
    if (!(a.pieces > 0) || !(a.weightKg > 0)) throw new GlosError('FIELD_REQUIRED', 'Say how many pieces and what they weigh, as on the booking', { field: 'air.pieces' });
    const sec = a.security ?? ({ status: 'unsecured' } as typeof a.security);
    if (sec.status === 'secured' && !sec.agentName?.trim()) throw new GlosError('FIELD_REQUIRED', 'Secured cargo: say which regulated agent or known consignor secured it — only it can give a security status', { field: 'air.security.agentName' });
    // Perishable goods travel cold: their own range, which a reefer's set-point must sit inside.
    if (nature === 'FOP' && !a.temp) throw new GlosError('FIELD_REQUIRED', 'Perishable goods: give the temperature range they must be kept in, in °C', { field: 'air.temp' });
    if (a.temp && !(a.temp.minC < a.temp.maxC)) throw new GlosError('VALIDATION_FAILED', 'The lowest temperature must be below the highest', { field: 'air.temp' });
    const placeOf = (siteId: string | undefined, kind: 'loading' | 'port', what: string): ExportPlace => {
      if (!siteId) throw new GlosError('FIELD_REQUIRED', `Choose ${what} from your places`, { field: what });
      const site = this.sites.require(exporter.entityId, siteId);
      if (site.kind !== kind) throw new GlosError('VALIDATION_FAILED', `That place is not one of your ${kind === 'loading' ? 'loading places' : 'port and airport places'}`, { field: what });
      return { label: site.name, location: site.location };
    };
    const loadingPlace = placeOf(input.loadingSiteId, 'loading', 'where it is loaded');
    const terminal = placeOf(input.terminalSiteId, 'port', 'the cargo terminal');
    const hazardous = /^HAZ/.test(nature ?? '');
    const air: ExportAir = {
      awb: formatAwb(digits),
      waybillKind: a.waybillKind === 'house' ? 'house' : a.waybillKind === 'direct' ? 'direct' : 'master',
      ...(a.houseNumber?.trim() ? { houseNumber: a.houseNumber.trim().slice(0, 40) } : {}),
      airline: airline.slice(0, 80),
      bookingStatus: a.bookingStatus === 'queued' ? 'queued' : 'confirmed',
      flights,
      latAt,
      pieces: Math.round(a.pieces),
      weightKg: Math.round(a.weightKg * 10) / 10,
      ...(a.volumeM3 ? { volumeM3: Math.round(a.volumeM3 * 100) / 100 } : {}),
      ...(a.aircraft ? { aircraft: a.aircraft } : {}),
      ...(a.handler?.trim() ? { handler: a.handler.trim().slice(0, 80) } : {}),
      fromAirport: flights[0].from,
      toAirport: flights[flights.length - 1].to,
      security: { status: sec.status === 'secured' ? 'secured' : 'unsecured', ...(sec.agentName?.trim() ? { agentName: sec.agentName.trim().slice(0, 120) } : {}), ...(sec.agentNumber?.trim() ? { agentNumber: sec.agentNumber.trim().slice(0, 40) } : {}), ...(sec.knownConsignor ? { knownConsignor: true } : {}) },
      ...(a.temp ? { temp: { minC: a.temp.minC, maxC: a.temp.maxC, ...(a.temp.preCooled ? { preCooled: true } : {}) } } : {}),
      ...(a.inspectionAtAirport ? { inspectionAtAirport: true } : {}),
    };
    const consignment: ExportConsignment = {
      exportId: `exp_${randomBytes(8).toString('hex')}`,
      code: this.nextCode(),
      exporterEntityId: exporter.entityId,
      goodsDescription: goodsDescription.slice(0, 300),
      originCountry,
      destCountry,
      loadingPort: `${air.fromAirport} — ${terminal.label}`.slice(0, 80),
      ...(nature ? { natureCode: nature } : {}),
      mode: 'air',
      air,
      // One deadline for every clock: by air, the cut-off is the airline's latest acceptance time at the terminal.
      booking: { reference: air.awb, bookedWith: input.bookedWith === 'airline' ? 'airline' : 'forwarder', partyName: partyName.slice(0, 120), gateCutoffAt: latAt },
      loadingPlace,
      terminal,
      // An air export's papers: no weighbridge ticket and no bill of lading; the waybill's copy, the security declaration
      // where it is secured, the phytosanitary certificate where the plant inspection is at the airport.
      papers: EXPORT_PAPER_KEYS.filter(
        (key) =>
          !SEA_ONLY_PAPERS.includes(key) &&
          (key === 'consignment_security_declaration' ? air.security.status === 'secured' : EXPORT_PAPER_GROUP[key] !== 'asked' || (key === 'dangerous_goods_declaration' && hazardous) || (key === 'phytosanitary_certificate' && Boolean(air.inspectionAtAirport))),
      ).map((key) => ({ key, ...(EXPORT_PAPER_GROUP[key] === 'kept' ? { optional: true } : {}) })),
      createdAt: new Date(now).toISOString(),
      createdBy: by,
    };
    this.exports.set(consignment.exportId, consignment);
    return consignment;
  }

  /** The waybill's check, and what the exporter is warned of — for an export by air. */
  private airViewOf(c: ExportConsignment, now: number): ExportAirView {
    const a = c.air!;
    const totals = c.packing?.lines.length ? c.packing.lines.reduce((t, l) => ({ pieces: t.pieces + (l.packages ?? 0), kg: t.kg + (l.grossKg ?? 0) }), { pieces: 0, kg: 0 }) : undefined;
    const check = checkAirWaybill(
      { number: a.awb, kind: a.waybillKind, ...(a.houseNumber ? { houseNumber: a.houseNumber } : {}), from: c.originCountry, to: c.destCountry, madeOutOn: a.flights[0]?.date, pieces: a.pieces, weightKg: a.weightKg },
      totals ? { pieces: totals.pieces, weightKg: Math.round(totals.kg * 10) / 10 } : {},
      new Date(now).toISOString().slice(0, 10),
    );
    const warnings: string[] = [];
    if (a.bookingStatus === 'queued') warnings.push('The airline has not confirmed this booking yet: the truck may go, but the cargo may not fly on this flight. The risk of being left behind is yours.');
    if (a.security.status === 'secured') warnings.push(`Secured cargo: it goes in a closed vehicle that locks, sealed where it is loaded and its seal checked at the terminal, with a driver whose ID has been seen. Its security status is ${a.security.agentName}’s to give, never SeeBuyGet’s.`);
    else warnings.push('Not secured: the terminal screens it when it arrives, which takes time there.');
    if (a.temp) warnings.push(`Kept between ${a.temp.minC} and ${a.temp.maxC} °C: a reefer or insulated body, its set-point inside the range, and the temperature recorded on the way.`);
    if (a.inspectionAtAirport) warnings.push(`The plant-health inspection is at the airport: about ${AIR_INSPECTION_H} hours there, before the latest acceptance time.`);
    return {
      check: {
        number: check.number,
        ...(check.problem ? { problem: check.problem } : {}),
        ...(check.airline ? { airline: check.airline.name, airlineSource: check.airline.source } : {}),
        regime: check.regime,
        ...(check.rules ? { rules: check.rules } : {}),
        sources: check.sources,
        missing: check.missing,
        ask: check.ask,
        mismatches: check.mismatches,
        electronicPossible: check.electronicPossible,
        limits: check.limits,
        claims: check.claims,
        caveats: check.caveats,
      },
      warnings,
    };
  }

  /** Sea-only steps, refused by name for an export by air: it has no box, no weighed box, no bill of lading, no train. */
  private seaOnly(c: ExportConsignment, what: string): void {
    if (c.mode === 'air') throw new GlosError('INVALID_STATE', `${c.code} goes by air: it has no ${what}`);
  }

  /** The exports this company is a party to: its own as exporter, and the ones it was appointed to clear. */
  list(readerEntityId: string, opts: { all?: boolean } = {}, now = Date.now()): ExportRow[] {
    return [...this.exports.values()]
      .filter((c) => opts.all || c.exporterEntityId === readerEntityId || (Boolean(readerEntityId) && c.agent?.entityId === readerEntityId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => ({
        exportId: c.exportId,
        code: c.code,
        goodsDescription: c.goodsDescription,
        loadingPort: c.loadingPort,
        bookingReference: c.booking.reference,
        gateCutoffAt: c.booking.gateCutoffAt,
        modes: c.mode === 'air' ? journeyModes(['road', 'air']) : journeyModes(['road', c.byRail ? 'rail' : undefined, 'sea']),
        ...(c.mode === 'air' ? { mode: 'air' as const } : {}),
        ...(c.containerNo ? { containerNo: c.containerNo } : {}),
        timing: this.timingOf(c, now),
        missing: this.missingOf(c).length,
        box: this.boxOf(c, now),
        you: this.sideOf(c, readerEntityId, opts.all),
        exporterName: this.nameOf(c.exporterEntityId),
        ...(c.agent ? { agentName: this.nameOf(c.agent.entityId) } : {}),
      }));
  }

  detail(exportId: string, readerEntityId: string, opts: { all?: boolean } = {}, now = Date.now()): ExportDetail {
    const c = this.requireExport(exportId);
    // The exporter, the agent it appointed, or staff reading — anybody else is told there is no such export.
    const you = this.sideOf(c, readerEntityId, opts.all);
    const timing = this.timingOf(c, now);
    const fee = this.feeOf(c);
    return {
      consignment: c,
      timing,
      ...(c.emptyFreightId ? { emptyLeg: this.legOf(c.emptyFreightId) } : {}),
      ...(c.ladenFreightId ? { ladenLeg: this.legOf(c.ladenFreightId) } : {}),
      seals: c.ladenFreightId ? this.seals.views(c.ladenFreightId).map((s) => ({ ...(s.number ? { number: s.number } : {}), state: s.state, appliedBy: s.appliedBy })) : [],
      papers: c.papers.map((p) => ({
        ...p,
        label: paperLabel(p),
        group: groupOf(p),
        ...(p.addedByEntityId && p.addedByEntityId === readerEntityId && !p.documentId && !p.reference ? { removable: true } : {}),
      })),
      missing: this.missingOf(c),
      // The exporter's own list, to attach from. Its agent reads what is attached on a line, and not the rest of its papers.
      documents:
        you === 'exporter'
          ? this.documents
              .list(c.exporterEntityId)
              .filter((d) => d.status !== 'superseded' && d.status !== 'rejected')
              .map((d) => ({ documentId: d.documentId, title: d.title }))
          : [],
      box: this.boxOf(c, now, timing),
      you,
      exporterName: this.nameOf(c.exporterEntityId),
      ...(c.agent ? { agent: { ...c.agent, name: this.nameOf(c.agent.entityId) } } : {}),
      ...(fee ? { fee } : {}),
      feeState: feeStateOf(fee),
      sli: this.sliViewOf(c, you),
      ...(c.packing ? { packing: this.packingViewOf(c) } : {}),
      invoice: this.invoiceViewOf(c, you),
      ...(c.rail ? { rail: this.railViewOf(c) } : {}),
      ...(c.fbl ? { fbl: this.fblViewOf(c) } : {}),
      ...(c.air ? { air: this.airViewOf(c, now) } : {}),
    };
  }

  /* ------------------------------------------------- the forwarder's bill (FBL) -- */

  /**
   * THE FORWARDER'S BILL, HELD (the user, 2026-10-28: "if we optimize for FBL, we must know and report for our users"). The
   * FIATA bill the exporter's forwarder issued — or its waybill — kept with what is printed on it: a copy from the exporter's
   * papers (its agent gives an electronic one by number), and read back with what it means. A new one replaces it; the one
   * replaced is kept.
   */
  holdFbl(exportId: string, actorEntityId: string, dto: FblDto, by: string, now = Date.now()): ExportDetail {
    const c = this.requireExport(exportId);
    const side = this.sideOf(c, actorEntityId);
    this.seaOnly(c, 'FIATA bill — the forwarder’s own paper by air is its house air waybill');
    if (side === 'agent' && dto.documentId) throw new GlosError('VALIDATION_FAILED', 'Give the bill’s number: your own documents are not the exporter’s', { field: 'number' });
    const held = holdFbl(dto, { ...(dto.documentId ? { document: this.exporterPaper(c, dto.documentId) } : {}), by, byEntityId: actorEntityId, now });
    if (c.fbl) c.formerFbl = [...(c.formerFbl ?? []), c.fbl];
    c.fbl = held;
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /** What the exporter saw on FIATA's page for an electronic bill, with the page's result attached from its papers. */
  verifyFbl(exportId: string, actorEntityId: string, dto: FblVerifiedDto, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    if (!c.fbl) throw new GlosError('INVALID_STATE', `No bill is held on ${c.code} yet`);
    c.fbl = verifyFbl(c.fbl, dto, this.exporterPaper(c, dto.proofDocumentId), by, actorEntityId, now);
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  private exporterPaper(c: ExportConsignment, documentId: string): { documentId: string; title: string } {
    const d = this.documents.list(c.exporterEntityId).find((x) => x.documentId === documentId);
    if (!d) throw new GlosError('NOT_FOUND', 'No such paper among your company’s documents');
    if (d.status === 'superseded' || d.status === 'rejected') throw new GlosError('INVALID_STATE', `${d.title} is not a current paper on your record — attach the current one`);
    return { documentId: d.documentId, title: d.title };
  }

  private fblViewOf(c: ExportConsignment) {
    const seals = c.ladenFreightId ? this.seals.views(c.ladenFreightId).flatMap((s) => (s.number && s.state === 'on' ? [s.number] : [])) : [];
    const totals = c.packing?.lines?.length ? totalsOf(c.packing.lines) : undefined;
    return fblView(
      c.fbl!,
      { ...(c.containerNo ? { containerNo: c.containerNo } : {}), seals, ...(totals ? { packages: totals.packages, ...(totals.grossKg ? { grossWeightKg: totals.grossKg } : {}) } : {}), port: { label: 'loading', value: c.loadingPort }, countries: [c.originCountry, c.destCountry] },
      c.formerFbl?.length ?? 0,
    );
  }

  /* ----------------------------------------------------- the railway's note -- */

  /**
   * THE RAILWAY'S NOTE, HELD (the user, 2026-10-28: "for now we hold the note but we should be able to see whether it is
   * valid"). Where the box goes to the port by rail, the railway issues the note; the exporter — or its clearing agent, who
   * often books the train — keeps it here: a copy from the exporter's papers, or its number, and what is printed on it. A
   * new one replaces it, and the one replaced is kept as it was.
   */
  holdRail(exportId: string, actorEntityId: string, dto: RailNoteDto, by: string, now = Date.now()): ExportDetail {
    const c = this.requireExport(exportId);
    const side = this.sideOf(c, actorEntityId);
    this.seaOnly(c, 'rail note');
    if (side === 'agent' && dto.documentId) throw new GlosError('VALIDATION_FAILED', 'Give the rail note’s number: your own documents are not the exporter’s', { field: 'noteNumber' });
    let document: { documentId: string; title: string } | undefined;
    if (dto.documentId) {
      const d = this.documents.list(c.exporterEntityId).find((x) => x.documentId === dto.documentId);
      if (!d) throw new GlosError('NOT_FOUND', 'No such paper among your company’s documents');
      if (d.status === 'superseded' || d.status === 'rejected') throw new GlosError('INVALID_STATE', `${d.title} is not a current paper on your record — attach the current one`);
      document = { documentId: d.documentId, title: d.title };
    }
    const held = holdRailNote(dto, { ...(document ? { document } : {}), by, byEntityId: actorEntityId, now });
    if (c.rail) c.formerRail = [...(c.formerRail ?? []), c.rail];
    c.rail = held;
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  private railViewOf(c: ExportConsignment) {
    const seals = c.ladenFreightId ? this.seals.views(c.ladenFreightId).flatMap((s) => (s.number && s.state === 'on' ? [s.number] : [])) : [];
    const totals = c.packing?.lines?.length ? totalsOf(c.packing.lines) : undefined;
    return railNoteView(c.rail!, { ...(c.containerNo ? { containerNo: c.containerNo } : {}), seals, ...(totals?.grossKg ? { grossMassKg: totals.grossKg } : {}) }, c.formerRail?.length ?? 0);
  }

  /**
   * WHERE THE TIMING STANDS, derived on every read — never a stored flag that goes stale: the latest the laden truck may
   * leave the loading place and still be inside the gate before the cut-off (the road at a truck's speed, plus a gate
   * buffer), and whether it was collected, delivered, or is late.
   */
  timingOf(c: ExportConsignment, now = Date.now()): ExportTiming {
    const h = this.handoverOf(c);
    const roadKm = Math.round(this.router.roadKm(c.loadingPlace.location, h.place.location) * 10) / 10;
    // By air: a shorter buffer before the latest acceptance time, and the plant inspection's hours where it is at the airport.
    const byAir = c.mode === 'air';
    const driveHours = Math.round((roadKm / VEHICLE_SPEED_KMH.truck) * 10) / 10;
    const bufferHours = byAir ? AIR_LAT_BUFFER_H : EXPORT_GATE_BUFFER_H;
    const inspectionHours = byAir && c.air?.inspectionAtAirport ? AIR_INSPECTION_H : 0;
    const plannedHours = Math.round((roadKm / VEHICLE_SPEED_KMH.truck + bufferHours + inspectionHours) * 10) / 10;
    const cutoff = Date.parse(h.cutoffAt);
    const leaveByAt = new Date(cutoff - plannedHours * H).toISOString();
    const laden = c.ladenFreightId ? this.legOf(c.ladenFreightId) : undefined;
    const collectedAt = laden?.pickedUpAt;
    const gatedInAt = laden?.status === 'delivered' ? laden.deliveredAt : undefined;
    const state = gatedInAt ? 'gated_in' : now > cutoff ? 'missed' : !collectedAt && now > Date.parse(leaveByAt) ? 'at_risk' : 'on_time';
    return { handover: { place: h.place.label, cutoffAt: h.cutoffAt, byRail: h.byRail, ...(byAir ? { byAir: true } : {}) }, state, leaveByAt, roadKm, plannedHours, ...(gatedInAt ? { gatedInAt } : {}), ...(collectedAt ? { collectedAt } : {}), ...(byAir ? { air: { driveHours, bufferHours, inspectionHours } } : {}) };
  }

  /**
   * WHERE OUR TRUCK HANDS THE BOX OVER, and by when: inside the port gate before the vessel's cut-off — or, by rail, at
   * the rail terminal before the train's (2026-10-29). Everything that times the road reads it from here.
   */
  private handoverOf(c: ExportConsignment): { place: ExportPlace; cutoffAt: string; byRail: boolean } {
    return c.byRail ? { place: c.byRail.terminal, cutoffAt: c.byRail.cutoffAt, byRail: true } : { place: c.terminal, cutoffAt: c.booking.gateCutoffAt, byRail: false };
  }

  /**
   * BY RAIL TO THE PORT (the user, 2026-10-29: "build the clock with the blocker as you said"): the rail terminal our truck
   * takes the box to, and the train's cut-off there — which must fall before the port gate closes, or the train arrives too
   * late for the vessel. Set before the load to the terminal is posted: once a truck is sent, its destination stands.
   */
  setByRail(exportId: string, actorEntityId: string, input: ExportByRailDto, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    this.seaOnly(c, 'train to the port');
    this.refuseOnceSent(c);
    const site = this.sites.require(c.exporterEntityId, input.terminalSiteId);
    if (site.kind !== 'port' && site.kind !== 'clearance') throw new GlosError('VALIDATION_FAILED', 'Choose the rail terminal from your port places or places of clearance', { field: 'terminalSiteId' });
    const cutoffAt = moment(input.cutoffAt, 'The train’s cut-off');
    if (!cutoffAt) throw new GlosError('FIELD_REQUIRED', 'Give the train’s cut-off at the rail terminal', { field: 'cutoffAt' });
    if (Date.parse(cutoffAt) <= now) throw new GlosError('VALIDATION_FAILED', `That cut-off has passed (${utc(cutoffAt)}): ask the railway or ${c.booking.partyName} for the next train`, { field: 'cutoffAt' });
    if (Date.parse(cutoffAt) >= Date.parse(c.booking.gateCutoffAt)) {
      throw new GlosError('VALIDATION_FAILED', `The train’s cut-off (${utc(cutoffAt)}) is not before the port gate closes (${utc(c.booking.gateCutoffAt)}): the box would reach the port too late for the vessel — check both with ${c.booking.partyName}`, { field: 'cutoffAt' });
    }
    const reference = input.reference?.trim();
    c.byRail = { terminal: { label: site.name, location: site.location }, cutoffAt, ...(reference ? { reference: reference.slice(0, 60) } : {}), recordedAt: new Date(now).toISOString(), recordedBy: by };
    // A new cut-off is warned afresh.
    if (c.warned) c.warned = { ...c.warned, pickup: undefined, gate: undefined };
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /** Back to the road: the truck takes the box to the port gate after all. Only before the load is posted. */
  clearByRail(exportId: string, actorEntityId: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    this.refuseOnceSent(c);
    delete c.byRail;
    if (c.warned) c.warned = { ...c.warned, pickup: undefined, gate: undefined };
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /** When the train brought the box inside the port gate, as the exporter was told: the line's clock moves inside from then. */
  recordAtPort(exportId: string, actorEntityId: string, at: string, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    if (!c.byRail) throw new GlosError('INVALID_STATE', `${c.code} goes to the port by road: its truck’s delivery is the gate-in`);
    const when = moment(at, 'When it reached the port');
    if (!when || Date.parse(when) > now + 5 * 60_000) throw new GlosError('VALIDATION_FAILED', 'Say when the train brought it inside the port gate — a moment that has come', { field: 'at' });
    c.byRail = { ...c.byRail, atPort: { at: when, by, recordedAt: new Date(now).toISOString() } };
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  private refuseOnceSent(c: ExportConsignment): void {
    const laden = c.ladenFreightId ? this.legOf(c.ladenFreightId) : undefined;
    if (laden && laden.status !== 'cancelled') throw new GlosError('CONFLICT', `The load to ${this.handoverOf(c).place.label} is already posted (${c.ladenFreightCode}): its truck’s destination stands`);
  }

  /* -------------------------------------------------- EX2 empty, stuffed, laden -- */

  /** The box's number, once the depot released it or it was stuffed: ISO 6346, check digit checked — the arithmetic only. */
  setContainer(exportId: string, actorEntityId: string, containerNo: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    this.seaOnly(c, 'box');
    if (c.ladenFreightId) throw new GlosError('INVALID_STATE', `The box is on its way to the port as load ${c.ladenFreightCode}: its number is on that load and its papers`);
    c.containerNo = ContainerBoxService.validate(containerNo);
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /**
   * THE EMPTY OUT: a run from the depot to where the box is stuffed, carrying the release number the depot hands the box
   * out against. Only where the exporter fetches the empty — the line or the forwarder may bring it.
   */
  mintEmptyLeg(exportId: string, actorEntityId: string, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    this.seaOnly(c, 'empty box to fetch');
    if (!c.emptyDepot) throw new GlosError('INVALID_STATE', `${c.code} names no depot to fetch the empty from: the line or your forwarder brings it`);
    if (c.emptyFreightId) throw new GlosError('CONFLICT', `${c.code} already has its empty run (${c.emptyFreightCode})`);
    if (c.emptyOut) throw new GlosError('INVALID_STATE', `You recorded the empty leaving the depot on ${utc(c.emptyOut.at)}: it is already out`);
    if (c.ladenFreightId) throw new GlosError('INVALID_STATE', `${c.code} is already on its way to the port`);
    const exporter = this.entities.get(c.exporterEntityId);
    const spec = containerType(c.containerType)!;
    const release = c.booking.emptyReleaseRef ? ` Release ${c.booking.emptyReleaseRef}.` : '';
    const f = this.dispatch.registerFreight(
      {
        description: `${c.code} — empty ${spec.label} for ${c.goodsDescription}`.slice(0, 200),
        pickupLocation: c.emptyDepot.location,
        pickupLabel: c.emptyDepot.label,
        destLabel: c.loadingPlace.label,
        destLocation: c.loadingPlace.location,
        // An empty box is not a light one; until its own tare is read off its door, a standard tare for its length.
        weightKg: standardTareKg(spec.lengthM),
        emptyRun: true,
        bodyHint: spec.bodies[0],
        packaging: 'piece',
        originEquipment: spec.equipment,
        destEquipment: spec.equipment,
        ...(spec.heightM ? { heightM: spec.heightM } : {}),
        indivisible: true,
        ...(c.containerNo ? { containerNo: c.containerNo } : {}),
        pickupCountry: c.originCountry,
        destCountry: c.originCountry,
        instructions: `Export ${c.code}: collect the empty ${spec.label} against booking ${c.booking.reference} (${c.booking.partyName}).${release} Bring it to ${c.loadingPlace.label} to be stuffed.`.slice(0, 500),
        postedByDid: exporter.did,
        externalOrderId: `${c.code}-EMPTY`,
      },
      now,
    );
    Object.assign(c, { emptyFreightId: f.freightId, emptyFreightCode: f.code });
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /**
   * THE LADEN BOX TO THE TERMINAL, before the gate closes. The box's facts as the import leg passes them, the cut-off in its
   * delivery window, the booking in its instructions, the VGM as its weight once declared. Its seal is written on this load
   * with the seal panel and its photographs — one way to seal a load. Delivered at the terminal is gated in.
   */
  mintLadenLeg(exportId: string, actorEntityId: string, input: { weightKg?: number; dangerousGoods?: { unNumber: string; properShippingName: string; hazardClass: string; packingGroup?: string } }, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    if (c.ladenFreightId) throw new GlosError('CONFLICT', `${c.code} already has its load to the port (${c.ladenFreightCode}) — a second would send two trucks for one box`);
    if (c.mode === 'air') return this.mintAirLeg(c, actorEntityId, input, by, now);
    if (!c.containerNo) throw new GlosError('INVALID_STATE', `Say the box’s number first: the terminal gates it in by its number`, { field: 'containerNo' });
    const weightKg = c.vgm?.kg ?? Number(input.weightKg);
    if (!(weightKg > 0)) throw new GlosError('FIELD_REQUIRED', 'Say what the packed box weighs — or declare its verified gross mass first', { field: 'weightKg' });
    // Dangerous goods reach the road note with their UN number (the gaps check, 2026-10-29).
    const dangerousGoods = input.dangerousGoods ?? c.dangerousGoods;
    const dangerousGap = dangerousGoodsGap(c.natureCode, dangerousGoods);
    if (dangerousGap) throw new GlosError('FIELD_REQUIRED', dangerousGap, { field: 'dangerousGoods' });
    const h = this.handoverOf(c);
    if (now > Date.parse(h.cutoffAt)) {
      throw new GlosError('INVALID_STATE', h.byRail ? `The train’s cut-off at ${h.place.label} passed at ${utc(h.cutoffAt)}: ask the railway or ${c.booking.partyName} for the next train, and record its cut-off first` : `The gate closed for this booking at ${utc(c.booking.gateCutoffAt)}: ask your forwarder for the next vessel and a new cut-off first`);
    }
    const exporter = this.entities.get(c.exporterEntityId);
    const spec = containerType(c.containerType)!;
    const vessel = c.booking.vessel ? `, vessel ${c.booking.vessel}${c.booking.voyage ? ` voyage ${c.booking.voyage}` : ''}` : '';
    const f = this.dispatch.registerFreight(
      {
        description: `${c.code} — ${c.goodsDescription} (${spec.label}, for export)`.slice(0, 200),
        pickupLocation: c.loadingPlace.location,
        pickupLabel: c.loadingPlace.label,
        destLabel: h.place.label,
        destLocation: h.place.location,
        weightKg,
        ...(c.natureCode ? { natureCode: c.natureCode as CargoNature } : {}),
        bodyHint: spec.bodies[0],
        packaging: 'piece',
        originEquipment: spec.equipment,
        destEquipment: spec.equipment,
        ...(spec.heightM ? { heightM: spec.heightM } : {}),
        indivisible: true,
        containerNo: c.containerNo,
        ...(dangerousGoods ? { dangerousGoods } : {}),
        pickupCountry: c.originCountry,
        destCountry: c.originCountry,
        deliveryWindow: (h.byRail ? `At ${h.place.label} before ${utc(h.cutoffAt)} — the train’s cut-off` : `Inside the gate at ${c.terminal.label} before ${utc(c.booking.gateCutoffAt)} — the vessel cut-off`).slice(0, 120),
        instructions: (h.byRail
          ? `Export ${c.code}: container ${c.containerNo}, booking ${c.booking.reference} with ${c.booking.partyName}${vessel}, by rail from ${h.place.label}${c.byRail?.reference ? ` (train ${c.byRail.reference})` : ''} to ${c.terminal.label}. Hand it in at the rail terminal against this booking, before the train’s cut-off.`
          : `Export ${c.code}: container ${c.containerNo}, booking ${c.booking.reference} with ${c.booking.partyName}${vessel}. Hand it in at the terminal gate against this booking, before the cut-off.`
        ).slice(0, 500),
        postedByDid: exporter.did,
        externalOrderId: c.code,
      },
      now,
    );
    Object.assign(c, { ladenFreightId: f.freightId, ladenFreightCode: f.code, ...(dangerousGoods ? { dangerousGoods: { unNumber: f.dangerousGoods?.unNumber ?? dangerousGoods.unNumber, properShippingName: dangerousGoods.properShippingName.trim(), hazardClass: dangerousGoods.hazardClass.trim(), ...(dangerousGoods.packingGroup ? { packingGroup: dangerousGoods.packingGroup } : {}) } } : {}) });
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /**
   * THE ROAD TO THE CARGO TERMINAL, BY AIR (2026-10-29): posted for the first truck that fits, timed to the airline's latest
   * acceptance time. Chilled goods ride a reefer or an insulated body, kept in the shipper's own range; secured cargo a
   * lockable body, sealed at loading. An unconfirmed booking is said on the note: it may not fly on this flight.
   */
  private mintAirLeg(c: ExportConsignment, actorEntityId: string, input: { dangerousGoods?: { unNumber: string; properShippingName: string; hazardClass: string; packingGroup?: string } }, by: string, now: number): ExportDetail {
    const a = c.air!;
    const dangerousGoods = input.dangerousGoods ?? c.dangerousGoods;
    const dangerousGap = dangerousGoodsGap(c.natureCode, dangerousGoods);
    if (dangerousGap) throw new GlosError('FIELD_REQUIRED', dangerousGap, { field: 'dangerousGoods' });
    if (now > Date.parse(a.latAt)) throw new GlosError('INVALID_STATE', `The latest acceptance time at ${c.terminal.label} passed at ${utc(a.latAt)}: ask ${c.booking.partyName} for the next flight, and record its new time first`);
    const exporter = this.entities.get(c.exporterEntityId);
    const secured = a.security.status === 'secured';
    const words = this.airLegWords(c);
    const f = this.dispatch.registerFreight(
      {
        description: `${c.code} — ${c.goodsDescription} (${a.pieces} pieces, for export by air)`.slice(0, 200),
        pickupLocation: c.loadingPlace.location,
        pickupLabel: c.loadingPlace.label,
        destLabel: c.terminal.label,
        destLocation: c.terminal.location,
        weightKg: a.weightKg,
        packages: a.pieces,
        packaging: 'piece',
        // Chilled goods are cold-chain goods on the road, kept in the shipper's own range.
        ...(a.temp ? { natureCode: 'FOP' as CargoNature, tempRange: { minC: a.temp.minC, maxC: a.temp.maxC } } : c.natureCode ? { natureCode: c.natureCode as CargoNature } : {}),
        ...(secured ? { excludedBodies: OPEN_BODIES, securedBy: a.security.agentName } : {}),
        ...(dangerousGoods ? { dangerousGoods } : {}),
        pickupCountry: c.originCountry,
        destCountry: c.originCountry,
        deliveryWindow: words.deliveryWindow,
        instructions: words.text,
        postedByDid: exporter.did,
        externalOrderId: c.code,
      },
      now,
    );
    Object.assign(c, { ladenFreightId: f.freightId, ladenFreightCode: f.code, ...(dangerousGoods ? { dangerousGoods: { unNumber: f.dangerousGoods?.unNumber ?? dangerousGoods.unNumber, properShippingName: dangerousGoods.properShippingName.trim(), hazardClass: dangerousGoods.hazardClass.trim(), ...(dangerousGoods.packingGroup ? { packingGroup: dangerousGoods.packingGroup } : {}) } } : {}) });
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /** What the driver is told by air: the waybill, the flights, where it is handed in, and what the cargo asks of the road. */
  private airLegWords(c: ExportConsignment): { text: string; deliveryWindow: string } {
    const a = c.air!;
    const flights = a.flights.map((f) => `${f.flight} on ${f.date}`).join(', ');
    const notes = [
      `Export ${c.code} by air: air waybill ${a.awb} (${a.airline})${a.houseNumber ? `, house waybill ${a.houseNumber}` : ''}, ${flights}. Hand it in at ${a.handler ?? c.terminal.label} against this waybill, before the latest acceptance time.`,
      a.bookingStatus === 'queued' ? 'The airline has not confirmed the booking: it may not fly on this flight.' : '',
      a.security.status === 'secured' ? `Secured cargo (${a.security.agentName}): keep it locked and sealed, with no stops on the way; the seal is checked at the terminal.` : '',
      a.temp ? `Keep it between ${a.temp.minC} and ${a.temp.maxC} °C, the set-point inside that range, and record the temperature on the way.` : '',
    ].filter(Boolean);
    return { text: notes.join(' ').slice(0, 500), deliveryWindow: `At ${c.terminal.label} before ${utc(a.latAt)} — the airline’s latest acceptance time`.slice(0, 120) };
  }

  /**
   * THE BOOKING CHANGED (2026-10-29): the airline confirmed a booking on request, or moved the cargo to another flight with
   * a new latest acceptance time. The exporter's own record, from its own sign-in; the booking as it stood is kept. The
   * clock and its warnings follow the new time, and the load to the cargo terminal — while it is not yet delivered — tells
   * its driver what changed.
   */
  changeAirBooking(exportId: string, actorEntityId: string, input: { bookingStatus?: 'confirmed' | 'queued'; flights?: Array<{ flight: string; date: string; from: string; to: string; departsLocal?: string }>; latAt?: string }, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    if (c.mode !== 'air' || !c.air) throw new GlosError('INVALID_STATE', `${c.code} goes by sea: its booking is your forwarder’s or the line’s`);
    const a = c.air;
    const flights = input.flights?.length ? input.flights.map((f) => ({ flight: f.flight.replace(/\s+/g, ' ').trim().toUpperCase(), date: f.date, from: f.from.trim().toUpperCase(), to: f.to.trim().toUpperCase(), ...(f.departsLocal ? { departsLocal: f.departsLocal } : {}) })) : undefined;
    const latAt = input.latAt !== undefined ? moment(input.latAt, 'The latest acceptance time') : undefined;
    if (input.latAt !== undefined && !latAt) throw new GlosError('FIELD_REQUIRED', 'Give the new latest acceptance time from the airline’s confirmation', { field: 'latAt' });
    if (latAt && Date.parse(latAt) <= now) throw new GlosError('VALIDATION_FAILED', 'That latest acceptance time has passed already: give the one for the flight it is booked on now', { field: 'latAt' });
    const status = input.bookingStatus ?? a.bookingStatus;
    const sameFlights = !flights || JSON.stringify(flights) === JSON.stringify(a.flights);
    if (status === a.bookingStatus && sameFlights && (!latAt || latAt === a.latAt)) throw new GlosError('FIELD_REQUIRED', 'Say what changed: the airline confirmed it, another flight, or a new latest acceptance time', { field: 'bookingStatus' });
    const timeMoved = Boolean(latAt && latAt !== a.latAt);
    c.air = {
      ...a,
      bookingStatus: status,
      ...(flights ? { flights, fromAirport: flights[0].from, toAirport: flights[flights.length - 1].to } : {}),
      ...(latAt ? { latAt } : {}),
      formerBookings: [...(a.formerBookings ?? []), { bookingStatus: a.bookingStatus, flights: a.flights, latAt: a.latAt, until: new Date(now).toISOString(), by }].slice(-20),
    };
    c.booking = { ...c.booking, gateCutoffAt: c.air.latAt };
    c.loadingPort = `${c.air.fromAirport} — ${c.terminal.label}`.slice(0, 80);
    // A new time is a new clock: its warnings are said again, under that time.
    if (timeMoved && c.warned) {
      const { pickup: _p, gate: _g, ...rest } = c.warned;
      c.warned = rest;
    }
    this.exports.set(c.exportId, c);
    // The load to the cargo terminal, still on its way there, carries the new booking: posted, it is rewritten; on the road,
    // the driver is told what changed.
    const leg = c.ladenFreightId ? this.legOf(c.ladenFreightId) : undefined;
    if (leg && ['scheduled', 'available', 'ordered', 'claimed', 'in_transit'].includes(leg.status)) {
      const exporter = this.entities.get(c.exporterEntityId);
      const words = this.airLegWords(c);
      const change = [status !== a.bookingStatus ? (status === 'confirmed' ? 'The airline has confirmed the booking.' : 'The airline has not confirmed the booking: it may not fly on this flight.') : '', !sameFlights ? `Now on ${c.air.flights.map((f) => `${f.flight} on ${f.date}`).join(', ')}.` : '', timeMoved ? `Latest acceptance time now ${utc(c.air.latAt)}.` : ''].filter(Boolean).join(' ');
      this.dispatch.setInstructions(c.ladenFreightId!, exporter.did, leg.status === 'in_transit' ? { text: `The booking changed: ${change}` } : { text: words.text, deliveryWindow: words.deliveryWindow }, now);
    }
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /* -------------------------------------------------------- EX3 the VGM -- */

  /**
   * THE VERIFIED GROSS MASS (SOLAS): the packed box weighed whole (method 1), or everything packed plus the box's tare
   * (method 2), signed for by a person. Recorded and handed to the forwarder — we send nothing to a line. Declared again,
   * it replaces the first (a re-weighing), and the laden load's weight is not changed once it is on the road.
   */
  declareVgm(exportId: string, actorEntityId: string, input: { method: 1 | 2; kg: number; weighbridge?: string; ticketRef?: string; weighedAt?: string; signatory: string }, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    this.seaOnly(c, 'box to weigh');
    const method = Number(input.method);
    if (method !== 1 && method !== 2) throw new GlosError('VALIDATION_FAILED', 'Say how it was weighed: 1, the packed box whole; 2, its contents and the box’s tare', { field: 'method' });
    const kg = Math.round(Number(input.kg));
    // Nothing packed weighs less than an empty box, and nothing on a road trailer weighs more than this.
    if (!(kg >= 1500 && kg <= 45000)) throw new GlosError('VALIDATION_FAILED', 'A packed container weighs between 1,500 and 45,000 kg — check the figure', { field: 'kg' });
    const signatory = input.signatory?.trim();
    if (!signatory) throw new GlosError('FIELD_REQUIRED', 'Say who signs for this weight, for your company', { field: 'signatory' });
    const weighedAt = input.weighedAt?.trim() ? moment(input.weighedAt, 'When it was weighed') : undefined;
    c.vgm = {
      method,
      kg,
      ...(input.weighbridge?.trim() ? { weighbridge: input.weighbridge.trim().slice(0, 120) } : {}),
      ...(input.ticketRef?.trim() ? { ticketRef: input.ticketRef.trim().slice(0, 60) } : {}),
      ...(weighedAt ? { weighedAt } : {}),
      signatory: signatory.slice(0, 120),
      declaredAt: new Date(now).toISOString(),
      declaredBy: by,
    };
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /* ------------------------------------------------------- EX4 the papers -- */

  /**
   * A PAPER ON ITS LINE: one of the exporter's own documents — fingerprinted and versioned where every paper it owns lives,
   * never a loose upload — or a reference (the export entry its clearing agent gave). We file nothing with customs.
   */
  supplyPaper(exportId: string, actorEntityId: string, input: { key: ExportPaperKey; documentId?: string; reference?: string }, by: string, now = Date.now()): ExportDetail {
    const c = this.requireExport(exportId);
    const side = this.sideOf(c, actorEntityId);
    // Its agent gives the one paper that is its own work — the export entry, by its number — and supplies none of the exporter's.
    if (side === 'agent' && input.key !== 'export_entry') {
      throw new GlosError('FORBIDDEN', 'The exporter supplies its own papers: as its clearing agent you give the export entry, and accept or send back the rest');
    }
    if (side === 'agent' && input.documentId) throw new GlosError('VALIDATION_FAILED', 'Give the export entry’s number: your own documents are not the exporter’s', { field: 'reference' });
    // Never just a reference: the letter is filled in and signed on the export, and its signing gives the line.
    if (input.key === 'shipping_instructions') throw new GlosError('INVALID_STATE', 'Fill in and sign the letter of instruction on the export: the forwarder drafts the bill of lading from it');
    const line = c.papers.find((p) => p.key === input.key);
    if (!line) throw new GlosError('NOT_FOUND', 'No such paper on this export');
    const reference = input.reference?.trim();
    let document: { documentId: string; title: string } | undefined;
    if (input.documentId) {
      const d = this.documents.list(c.exporterEntityId).find((x) => x.documentId === input.documentId);
      if (!d) throw new GlosError('NOT_FOUND', 'No such paper among your company’s documents');
      if (d.status === 'superseded') throw new GlosError('INVALID_STATE', `That version of ${d.title} has been replaced — attach the current one`);
      if (d.status === 'rejected') throw new GlosError('INVALID_STATE', `${d.title} was rejected on your own record`);
      document = { documentId: d.documentId, title: d.title };
    }
    if (!document && !(reference && reference.length >= 3)) throw new GlosError('FIELD_REQUIRED', 'Attach one of your documents, or give its reference', { field: 'reference' });
    // What the line IS stays — its name and who asked for it; what was given, and the word on it, are new.
    const next: ExportPaper = {
      key: line.key,
      ...(line.optional ? { optional: true } : {}),
      ...(line.title ? { title: line.title } : {}),
      ...(line.addedByEntityId ? { addedBy: line.addedBy, addedByEntityId: line.addedByEntityId, addedAt: line.addedAt } : {}),
      ...(document ? { documentId: document.documentId, documentTitle: document.title } : {}),
      ...(reference ? { reference: reference.slice(0, 80) } : {}),
      suppliedAt: new Date(now).toISOString(),
      suppliedBy: by,
      // The entry is the agent's own word: given by it, it stands as accepted by it. Anything else waits for its word again.
      ...(side === 'agent' ? { acceptedAt: new Date(now).toISOString(), acceptedBy: by } : {}),
    };
    c.papers = c.papers.map((p) => (p.key === line.key ? next : p));
    this.exports.set(c.exportId, c);
    if (side === 'agent') {
      this.tell(c, `${c.code}: your clearing agent gave the export entry`, `${this.nameOf(actorEntityId)} gave the export entry ${next.reference} on ${c.code}. It is on the export, and in the file for your forwarder.`);
    } else if (c.agent && line.refusedAt) {
      this.tell(
        c,
        `${c.code}: ${paperNoun(line)} was supplied again`,
        `${this.nameOf(c.exporterEntityId)} supplied ${paperNoun(line)} again on ${c.code}, after you sent it back. Read it, and accept it or send it back.`,
        c.agent.entityId,
      );
    }
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /**
   * THE AGENT'S WORD ON A PAPER: accepted, or sent back with a reason — the import's bargain. A paper replaced, or past its
   * date, is not accepted: the exporter hears it here, from its own agent, and not at the customs counter.
   */
  acceptPaper(exportId: string, actorEntityId: string, key: ExportPaperKey, by: string, now = Date.now()): ExportDetail {
    const c = this.requireExport(exportId);
    this.requireAgent(c, actorEntityId);
    const line = this.suppliedLine(c, key);
    if (line.key === 'export_entry' && line.acceptedAt) throw new GlosError('INVALID_STATE', 'The export entry is your own: given by you, it stands');
    if (line.documentId) {
      const d = this.documents.list(c.exporterEntityId).find((x) => x.documentId === line.documentId);
      if (!d) throw new GlosError('INVALID_STATE', `${line.documentTitle ?? paperLabel(line)} is no longer among the exporter’s papers — ask it to attach it again`);
      if (d.status === 'superseded') throw new GlosError('INVALID_STATE', `${d.title} has been replaced since it was attached — ask the exporter to attach the current one`);
      if (d.expiresAt && d.expiresAt < new Date(now).toISOString().slice(0, 10)) throw new GlosError('INVALID_STATE', `${d.title} expired on ${d.expiresAt}: it cannot be relied on at customs`);
    }
    Object.assign(line, { acceptedAt: new Date(now).toISOString(), acceptedBy: by });
    delete line.refusedAt;
    delete line.refusedBy;
    delete line.refusedReason;
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /** Sent back, always with a reason: an exporter cannot put right a paper that came back with none. */
  refusePaper(exportId: string, actorEntityId: string, key: ExportPaperKey, reason: string, by: string, now = Date.now()): ExportDetail {
    const c = this.requireExport(exportId);
    this.requireAgent(c, actorEntityId);
    const why = reason?.trim();
    if (!why || why.length < 3) throw new GlosError('FIELD_REQUIRED', 'Say why — an exporter cannot put right a paper that came back with no reason', { field: 'reason' });
    const line = this.suppliedLine(c, key);
    Object.assign(line, { refusedAt: new Date(now).toISOString(), refusedBy: by, refusedReason: why.slice(0, 300) });
    delete line.acceptedAt;
    delete line.acceptedBy;
    this.exports.set(c.exportId, c);
    this.tell(c, `${c.code}: your clearing agent sent back ${paperNoun(line)}`, `${this.nameOf(actorEntityId)} sent back ${paperNoun(line)} on ${c.code}: “${line.refusedReason}”. Supply it again on the export.`);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /**
   * THE PAPER ITSELF, for whoever may read this export: the exporter, its appointed agent, staff. The grant IS the
   * appointment — derived, never a second list — so ending it ends the reading on the same call.
   */
  paperFile(exportId: string, readerEntityId: string, key: ExportPaperKey, opts: { all?: boolean } = {}) {
    const c = this.requireExport(exportId);
    this.sideOf(c, readerEntityId, opts.all);
    // The commercial invoice: the exporter's own document where one is attached, else its latest signed version.
    if (key === 'commercial_invoice' && !c.papers.find((p) => p.key === key)?.documentId) {
      const version = c.invoice?.versions.length ?? 0;
      const copy = version ? this.invoiceCopies.get(`${c.exportId}:${version}`) : undefined;
      if (!copy) throw new GlosError('NOT_FOUND', 'No paper is attached on that line');
      return { bytes: Buffer.from(copy.html, 'utf8'), contentType: 'text/html; charset=utf-8', fingerprint: copy.fingerprint, intact: createHash('sha256').update(copy.html, 'utf8').digest('hex') === copy.fingerprint };
    }
    // The packing list: the shipper's own document where one is attached, else its latest signed version, as signed.
    if (key === 'packing_list' && !c.papers.find((p) => p.key === key)?.documentId) {
      const version = c.packing?.versions.length ?? 0;
      const copy = version ? this.packingCopies.get(`${c.exportId}:${version}`) : undefined;
      if (!copy) throw new GlosError('NOT_FOUND', 'No paper is attached on that line');
      return { bytes: Buffer.from(copy.html, 'utf8'), contentType: 'text/html; charset=utf-8', fingerprint: copy.fingerprint, intact: createHash('sha256').update(copy.html, 'utf8').digest('hex') === copy.fingerprint };
    }
    // The letter of instruction is ours to draw: its latest signed version, exactly as signed.
    if (key === 'shipping_instructions') {
      const version = c.sli?.versions.length ?? 0;
      const copy = version ? this.sliCopies.get(`${c.exportId}:${version}`) : undefined;
      if (!copy) throw new GlosError('NOT_FOUND', 'No signed letter of instruction yet');
      return { bytes: Buffer.from(copy.html, 'utf8'), contentType: 'text/html; charset=utf-8', fingerprint: copy.fingerprint, intact: createHash('sha256').update(copy.html, 'utf8').digest('hex') === copy.fingerprint };
    }
    const line = c.papers.find((p) => p.key === key);
    if (!line?.documentId) throw new GlosError('NOT_FOUND', 'No paper is attached on that line');
    return this.documents.file(c.exporterEntityId, line.documentId);
  }

  /**
   * ASK FOR A PAPER THESE GOODS NEED — the exporter, or its clearing agent who knows what this border asks: one of the
   * catalogue's (a phytosanitary certificate for plants, a health certificate for food), or another paper by name. Once
   * on the list it counts as missing until given. Who asked is kept on the line, and the other side is told.
   */
  addPaper(exportId: string, actorEntityId: string, input: { key: string; title?: string }, by: string, now = Date.now()): ExportDetail {
    const c = this.requireExport(exportId);
    const side = this.sideOf(c, actorEntityId);
    const at = new Date(now).toISOString();
    const asked = { addedBy: by, addedByEntityId: actorEntityId, addedAt: at };
    let line: ExportPaper;
    if (input.key === 'other') {
      const title = input.title?.trim();
      if (!title || title.length < 3) throw new GlosError('FIELD_REQUIRED', 'Name the paper — as the buyer or the border calls it', { field: 'title' });
      if (c.papers.some((p) => paperLabel(p).toLowerCase() === title.toLowerCase())) throw new GlosError('CONFLICT', `${title} is already on the list`);
      const next = Math.max(0, ...c.papers.map((p) => Number(/^other-(\d+)$/.exec(p.key)?.[1] ?? 0))) + 1;
      if (next > 99) throw new GlosError('INVALID_STATE', 'This export already holds as many other papers as it can');
      line = { key: `other-${next}`, title: title.slice(0, 80), ...asked };
    } else {
      const key = input.key as KnownExportPaperKey;
      if (!(EXPORT_PAPER_KEYS as readonly string[]).includes(key)) throw new GlosError('NOT_FOUND', 'No such paper');
      if (EXPORT_PAPER_GROUP[key] !== 'asked') throw new GlosError('INVALID_STATE', `${EXPORT_PAPER_LABEL[key]} is on every export already`);
      const there = c.papers.find((p) => p.key === key);
      // An older record kept a certificate of origin as "if asked for": asked for now, it counts.
      if (there && !there.optional) throw new GlosError('CONFLICT', `${EXPORT_PAPER_LABEL[key]} is already on the list`);
      line = { ...(there ?? {}), key, ...asked };
      delete line.optional;
    }
    c.papers = c.papers.some((p) => p.key === line.key) ? c.papers.map((p) => (p.key === line.key ? line : p)) : [...c.papers, line];
    this.exports.set(c.exportId, c);
    if (side === 'agent') {
      this.tell(c, `${c.code}: your clearing agent asks for ${paperNoun(line)}`, `${this.nameOf(actorEntityId)} asks for ${paperNoun(line)} on ${c.code}: it is on the export's list now, counted as missing until you give it.`);
    } else if (c.agent) {
      this.tell(c, `${c.code}: ${paperNoun(line)} is on the list`, `${this.nameOf(c.exporterEntityId)} put ${paperNoun(line)} on the list for ${c.code}.`, c.agent.entityId);
    }
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /** Off the list again — only by whoever asked for it, and only while nothing was given for it: a given paper stays on the record. */
  removePaper(exportId: string, actorEntityId: string, key: ExportPaperKey, now = Date.now()): ExportDetail {
    const c = this.requireExport(exportId);
    this.sideOf(c, actorEntityId);
    const line = c.papers.find((p) => p.key === key);
    if (!line) throw new GlosError('NOT_FOUND', 'No such paper on this export');
    if (!line.addedByEntityId) throw new GlosError('INVALID_STATE', `${paperLabel(line)} is on this export's list for good`);
    if (line.addedByEntityId !== actorEntityId) throw new GlosError('FORBIDDEN', `${line.addedBy ?? 'The other side'} asked for ${paperNoun(line)}: only they take it off the list`);
    if (line.documentId || line.reference) throw new GlosError('INVALID_STATE', `${paperLabel(line)} has been given: it stays on the record`);
    c.papers = c.papers.filter((p) => p.key !== key);
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /* ------------------------------------- EX9 the shipper's letter of instruction -- */

  /** The form as the exporter leaves it — saved as often as it likes; nothing is handed over until it is signed. */
  saveSli(exportId: string, actorEntityId: string, input: SliDraftDto, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    c.sli = { draft: cleanDraft(input, by, now), versions: c.sli?.versions ?? [] };
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /**
   * SIGNED, IT STOPS CHANGING. Refused while the forwarder could not draft a bill of lading from it. The page is drawn
   * once, from the export's facts and the form, and kept exactly as signed with the fingerprint of its bytes; a change
   * afterwards is a new version. Its line on the papers is given by the signing, and the agent's word on it is asked again.
   */
  signSli(exportId: string, actorEntityId: string, signatory: string, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    const draft = this.effectiveSli(c);
    const gaps = sliGaps(draft, { hazardous: this.hazardousOf(c), containerNo: c.containerNo, air: c.mode === 'air' });
    if (gaps.length) throw new GlosError('FIELD_REQUIRED', `The letter of instruction is not complete: ${gaps.join('; ')}`);
    const who = signatory?.trim();
    if (!who || who.length < 2) throw new GlosError('FIELD_REQUIRED', 'Say who signs it, for the exporter', { field: 'signatory' });
    const versions = c.sli!.versions;
    const version = versions.length + 1;
    const signedAt = new Date(now).toISOString();
    const facts = this.sliFactsOf(c);
    const html = sliHtml(facts, draft!, { version, signedBy: who.slice(0, 120), signedAt });
    const fingerprint = createHash('sha256').update(html, 'utf8').digest('hex');
    this.sliCopies.set(`${c.exportId}:${version}`, { html, fingerprint });
    c.sli = { draft: c.sli!.draft!, versions: [...versions, { version, signedBy: who.slice(0, 120), signedAt, fingerprint, basis: sliBasis(facts), ...(facts.vgm ? { vgmKg: facts.vgm.kg } : {}), ...(facts.container.seals.length ? { seals: facts.container.seals } : {}) }] };
    // Its line on the papers: given by the signing, the agent's word on an earlier version no longer standing.
    c.papers = c.papers.map((p) =>
      p.key === 'shipping_instructions'
        ? { key: p.key, ...(p.optional ? { optional: true } : {}), reference: `Version ${version}, signed by ${who.slice(0, 60)}`, suppliedAt: signedAt, suppliedBy: by }
        : p,
    );
    this.exports.set(c.exportId, c);
    if (c.agent) this.tell(c, `${c.code}: shipping instructions signed, version ${version}`, `${this.nameOf(c.exporterEntityId)} signed its letter of instruction for ${c.code}, version ${version}. Read it on the export, and accept it or send it back.`, c.agent.entityId);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /**
   * THE LETTER'S PAGE: a signed version exactly as it was signed (the latest, or the one asked for), for the exporter, its
   * agent and staff — or the draft, marked a draft, for the exporter alone.
   */
  sliPage(exportId: string, readerEntityId: string, which: { version?: number; draft?: boolean } = {}, opts: { all?: boolean } = {}): string {
    const c = this.requireExport(exportId);
    const side = this.sideOf(c, readerEntityId, opts.all);
    if (which.draft) {
      if (side !== 'exporter' || !c.sli?.draft) throw new GlosError('NOT_FOUND', 'No draft of the letter of instruction');
      return sliHtml(this.sliFactsOf(c), this.effectiveSli(c)!, 'draft');
    }
    const versions = c.sli?.versions ?? [];
    const version = which.version ?? versions.length;
    const copy = version > 0 ? this.sliCopies.get(`${c.exportId}:${version}`) : undefined;
    if (!copy) throw new GlosError('NOT_FOUND', 'No such version of the letter of instruction');
    return copy.html;
  }

  /** Hazardous goods: by their nature, or because their declaration is on the list. */
  private hazardousOf(c: ExportConsignment): boolean {
    return /^HAZ/.test((c.natureCode ?? '').toUpperCase()) || c.papers.some((p) => p.key === 'dangerous_goods_declaration' && !p.optional);
  }

  /** What the letter reads off the export itself, rather than asking again. */
  private sliFactsOf(c: ExportConsignment): SliFacts {
    const exporter = this.entities.get(c.exporterEntityId);
    const record = this.entities.recordOf(c.exporterEntityId);
    const a = record.registeredAddress;
    const seals = c.ladenFreightId ? this.seals.views(c.ladenFreightId).filter((s) => s.state === 'on').map((s) => s.number ?? '—') : [];
    return {
      code: c.code,
      shipper: {
        name: exporter.name,
        ...(a ? { address: [a.line1, a.line2, a.city, a.region, a.postalCode].filter(Boolean).join(', ') } : {}),
        // The business's own numbers as it gave them, else what its company record says.
        ...((exporter.business?.registrationNo ?? record.registrationNumber) ? { registrationNo: exporter.business?.registrationNo ?? record.registrationNumber } : {}),
        ...((exporter.business?.taxNo ?? exporter.taxRegistration) ? { taxNo: exporter.business?.taxNo ?? exporter.taxRegistration } : {}),
        country: c.originCountry,
      },
      forwarder: c.booking.partyName,
      bookedWith: c.booking.bookedWith === 'shipping_line' ? 'shipping line' : 'forwarder',
      booking: c.booking.reference,
      ...(c.booking.vessel ? { vessel: c.booking.vessel } : {}),
      ...(c.booking.voyage ? { voyage: c.booking.voyage } : {}),
      loadingPort: c.loadingPort,
      terminal: c.terminal.label,
      originCountry: c.originCountry,
      destCountry: c.destCountry,
      ...(c.booking.docsCutoffAt ? { docsCutoffAt: c.booking.docsCutoffAt } : {}),
      container: { ...(c.containerType ? { type: c.containerType } : {}), ...(c.containerNo ? { number: c.containerNo } : {}), seals },
      ...(c.vgm ? { vgm: { kg: c.vgm.kg, method: c.vgm.method, signatory: c.vgm.signatory } } : {}),
      papers: c.papers.filter((p) => p.key !== 'shipping_instructions' && (p.documentId || p.reference)).map((p) => paperLabel(p)),
      ...(c.packing?.lines.length ? { goods: packingBasis(c.packing.lines) } : {}),
      ...(c.air ? { air: { awb: c.air.awb, airline: c.air.airline, flights: c.air.flights.map((f) => `${f.flight} ${f.date} ${f.from}→${f.to}`).join(', '), fromAirport: c.air.fromAirport, toAirport: c.air.toAirport, pieces: c.air.pieces, weightKg: c.air.weightKg, security: c.air.security.status === 'secured' ? `Secured by ${c.air.security.agentName}` : 'Not secured — screened at the terminal', ...(c.air.temp ? { temp: `${c.air.temp.minC} to ${c.air.temp.maxC} °C` } : {}) } } : {}),
    };
  }

  /** The letter as this reader sees it: the draft (the exporter's alone), the versions, what signing needs, whether it is out of date. */
  private sliViewOf(c: ExportConsignment, you: 'exporter' | 'agent' | 'staff'): ExportSliView {
    const versions = c.sli?.versions ?? [];
    const last = versions[versions.length - 1];
    const hazardous = this.hazardousOf(c);
    const fromPacking = Boolean(c.packing?.lines.length);
    return {
      ...(you === 'exporter' && c.sli?.draft ? { draft: c.sli.draft } : {}),
      versions,
      gaps: sliGaps(this.effectiveSli(c), { hazardous, containerNo: c.containerNo, air: c.mode === 'air' }),
      fromPacking,
      ...(fromPacking ? { goods: summarisePacking(c.packing!.lines) } : {}),
      stale: Boolean(last && sliStale(last, this.sliFactsOf(c))),
      hazardous,
    };
  }

  /* ------------------------------------- EX11 the commercial invoice, from the same lines -- */

  /** The invoice as the exporter leaves it — saved as often as it likes; nothing is handed over until it is signed. */
  saveInvoice(exportId: string, actorEntityId: string, input: InvoiceDraftDto, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    c.invoice = { draft: cleanInvoice(input, by, now), versions: c.invoice?.versions ?? [] };
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /**
   * SIGN THE INVOICE — refused while it lacks what no invoice anywhere goes without; frozen exactly as signed with the
   * fingerprint of its page, a change a new version. What this invoice carried for its destination (its particulars'
   * names, its declarations, its terms) is remembered for this business's next invoice to the same country.
   */
  signInvoice(exportId: string, actorEntityId: string, signatory: string, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    const lines = c.packing?.lines ?? [];
    const draft = c.invoice?.draft;
    const gaps = invoiceGaps(draft, lines);
    if (gaps.length) throw new GlosError('FIELD_REQUIRED', `The invoice is not complete: ${gaps.join('; ')}`);
    const who = signatory?.trim();
    if (!who || who.length < 2) throw new GlosError('FIELD_REQUIRED', 'Say who signs it, for the exporter', { field: 'signatory' });
    const versions = c.invoice!.versions;
    const version = versions.length + 1;
    const signedAt = new Date(now).toISOString();
    const html = invoiceHtml(this.sliFactsOf(c), this.consigneeWordsOf(c), draft!, lines, { version, signedBy: who.slice(0, 120), signedAt });
    const fingerprint = createHash('sha256').update(html, 'utf8').digest('hex');
    this.invoiceCopies.set(`${c.exportId}:${version}`, { html, fingerprint });
    const t = invoiceTotals(lines, draft);
    c.invoice = { draft: draft!, versions: [...versions, { version, signedBy: who.slice(0, 120), signedAt, fingerprint, basis: invoiceBasis(lines), total: t.total, currency: draft!.currency }] };
    c.papers = c.papers.map((p) =>
      p.key === 'commercial_invoice'
        ? { key: p.key, ...(p.optional ? { optional: true } : {}), reference: `Invoice ${draft!.number}, version ${version}, signed by ${who.slice(0, 60)} — ${draft!.currency} ${t.total.toLocaleString('en', { minimumFractionDigits: 2 })}`, suppliedAt: signedAt, suppliedBy: by }
        : p,
    );
    this.invoiceTemplates.set(`${c.exporterEntityId}:${c.destCountry}`, {
      destCountry: c.destCountry,
      fieldLabels: draft!.fields.map((f) => f.label),
      declarations: draft!.declarations,
      ...(draft!.paymentTerms ? { paymentTerms: draft!.paymentTerms } : {}),
      fromExport: c.code,
    });
    this.exports.set(c.exportId, c);
    if (c.agent) this.tell(c, `${c.code}: commercial invoice signed, version ${version}`, `${this.nameOf(c.exporterEntityId)} signed its commercial invoice ${draft!.number} for ${c.code}, version ${version}. Read it on the export, and accept it or send it back.`, c.agent.entityId);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /** The invoice's page: a signed version exactly as signed (the latest unless one is named), or the exporter's draft. */
  invoicePage(exportId: string, readerEntityId: string, which: { version?: number; draft?: boolean } = {}, opts: { all?: boolean } = {}): string {
    const c = this.requireExport(exportId);
    const side = this.sideOf(c, readerEntityId, opts.all);
    if (which.draft) {
      if (side !== 'exporter' || !c.invoice?.draft) throw new GlosError('NOT_FOUND', 'No draft of the invoice');
      return invoiceHtml(this.sliFactsOf(c), this.consigneeWordsOf(c), c.invoice.draft, c.packing?.lines ?? [], 'draft');
    }
    const version = which.version ?? c.invoice?.versions.length ?? 0;
    const copy = version > 0 ? this.invoiceCopies.get(`${c.exportId}:${version}`) : undefined;
    if (!copy) throw new GlosError('NOT_FOUND', 'No such version of the invoice');
    return copy.html;
  }

  /** The consignee as the letter of instruction names it, in words. */
  private consigneeWordsOf(c: ExportConsignment): string | undefined {
    const d = c.sli?.draft;
    if (!d) return undefined;
    if (d.consigneeKind === 'named') return d.consignee ? `${d.consignee.name}${d.consignee.address ? `, ${d.consignee.address.replace(/\r?\n/g, ', ')}` : ''}` : undefined;
    return d.consigneeKind === 'to_order_of_bank' ? `To the order of ${d.orderOfBank ?? '—'}` : 'To order';
  }

  /** The invoice as this reader sees it: the draft (the exporter's alone), the versions, the totals, what it still needs. */
  private invoiceViewOf(c: ExportConsignment, you: 'exporter' | 'agent' | 'staff'): ExportInvoiceView {
    const lines = c.packing?.lines ?? [];
    const draft = c.invoice?.draft;
    const versions = c.invoice?.versions ?? [];
    const last = versions[versions.length - 1];
    const template = you === 'exporter' ? this.invoiceTemplates.get(`${c.exporterEntityId}:${c.destCountry}`) : undefined;
    const totals = invoiceTotals(lines, draft);
    return {
      ...(you === 'exporter' && draft ? { draft } : {}),
      versions,
      totals,
      gaps: invoiceGaps(draft, lines),
      notes: invoiceNotes(draft, totals, template, c.destCountry),
      stale: Boolean(last && last.basis !== invoiceBasis(lines)),
      ...(template ? { template } : {}),
      ...(c.packing?.currency ? { currencyFromList: c.packing.currency } : {}),
      listColumns: c.packing?.extraColumns ?? [],
      truth: INVOICE_TRUTH,
    };
  }

  /* --------------------------------------------- EX10 the packing list, imported -- */

  /** The shipper's file as cells: CSV or pasted text, an .xlsx workbook, or the rows its system sends. Exactly one. */
  private packingCells(input: PackingImportDto): { cells: string[][]; rowNumbers?: number[]; sheet?: string; source: 'workbook' | 'text' | 'rows' } | { refusal: string } {
    const given = [input.text?.trim() ? 'text' : '', input.workbook ? 'workbook' : '', input.rows?.length ? 'rows' : ''].filter(Boolean);
    if (given.length !== 1) return { refusal: given.length ? 'Send the list one way: a file’s text, a workbook, or rows — not more than one' : 'Send the list: a CSV file, an Excel workbook, cells pasted from a spreadsheet, or rows' };
    if (input.rows?.length) return { cells: input.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : [])), source: 'rows' };
    if (input.workbook) {
      const wb = readWorkbook(Buffer.from(input.workbook, 'base64'));
      if ('refusal' in wb) return { refusal: wb.refusal };
      return { cells: wb.rows, rowNumbers: wb.lines, sheet: wb.sheet, source: 'workbook' };
    }
    return { ...cellsWithRows(input.text ?? ''), source: 'text' };
  }

  /** Read the file against this export — its columns, its lines, its problems, and its weight against the box. Keeps nothing. */
  private readPackingFor(c: ExportConsignment, input: PackingImportDto) {
    const got = this.packingCells(input);
    if ('refusal' in got) return { reading: undefined, got, check: { ...EMPTY_PACKING_CHECK, refusal: got.refusal, imported: false } as PackingCheck };
    const reading = readPacking(got.cells, { chosen: input.mapping, remembered: this.packingTemplates.get(c.exporterEntityId), ...(got.rowNumbers ? { rowNumbers: got.rowNumbers } : {}) });
    const notes = [...reading.check.notes, ...this.packingNotes(c, reading.check.totals)];
    return { reading, got, check: { ...reading.check, notes, ...(got.sheet ? { sheet: got.sheet } : {}), imported: false } as PackingCheck };
  }

  /** What the list's totals say against the export: its gross weight is part of the box's verified gross mass, never more. */
  private packingNotes(c: ExportConsignment, t: { grossKg: number }): string[] {
    if (c.vgm && t.grossKg > c.vgm.kg) return [`The list’s gross weight, ${t.grossKg.toLocaleString('en')} kg, is more than the box’s verified gross mass, ${c.vgm.kg.toLocaleString('en')} kg — which includes the box itself. One of them is wrong.`];
    return [];
  }

  /** CHECK the shipper's file: every line read, the totals, what is wrong — nothing kept. */
  checkPacking(exportId: string, actorEntityId: string, input: PackingImportDto): PackingCheck {
    const c = this.requireOwn(exportId, actorEntityId);
    return this.readPackingFor(c, input).check;
  }

  /**
   * IMPORT it: refused while a line cannot be kept as it is — a packing list with a line left out is a wrong one. The
   * lines become the list's draft (replacing the last), and how each heading was read is remembered for the business, so
   * its next file is read the same way without asking.
   */
  importPacking(exportId: string, actorEntityId: string, input: PackingImportDto, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    const { reading, got, check } = this.readPackingFor(c, input);
    if (!reading || check.refusal) throw new GlosError('VALIDATION_FAILED', check.refusal ?? 'The list could not be read');
    if (check.problems.length) {
      const shown = check.problems.slice(0, 5).map((p) => `row ${p.row}: ${p.says}`).join('; ');
      throw new GlosError('VALIDATION_FAILED', `The list has ${check.problems.length} line${check.problems.length === 1 ? '' : 's'} that cannot be kept as ${check.problems.length === 1 ? 'it is' : 'they are'} — ${shown}${check.problems.length > 5 ? '; …' : ''}. Put the file right, or match the columns, and import it again`);
    }
    this.packingTemplates.set(c.exporterEntityId, { ...(this.packingTemplates.get(c.exporterEntityId) ?? {}), ...reading.mapping });
    c.packing = {
      lines: reading.lines,
      extraColumns: reading.extraColumns,
      source: 'source' in got ? got.source : 'text',
      ...(input.sourceName?.trim() ? { sourceName: input.sourceName.trim().slice(0, 160) } : {}),
      ...(check.currency ? { currency: check.currency } : {}),
      importedAt: new Date(now).toISOString(),
      importedBy: by,
      versions: c.packing?.versions ?? [],
    };
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /**
   * SIGN THE LIST — frozen exactly as it is, with the fingerprint of its page; a change is a new version. Its line among
   * the papers is given by it (the shipper's own document stays a way to give it), and the agent's word is asked again.
   */
  signPacking(exportId: string, actorEntityId: string, signatory: string, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    const p = c.packing;
    if (!p?.lines.length) throw new GlosError('INVALID_STATE', 'Import the packing list first');
    const who = signatory?.trim();
    if (!who || who.length < 2) throw new GlosError('FIELD_REQUIRED', 'Say who signs it, for the exporter', { field: 'signatory' });
    const version = p.versions.length + 1;
    const signedAt = new Date(now).toISOString();
    const html = packingHtml(this.packingFactsOf(c), p.lines, p.extraColumns, { version, signedBy: who.slice(0, 120), signedAt });
    const fingerprint = createHash('sha256').update(html, 'utf8').digest('hex');
    this.packingCopies.set(`${c.exportId}:${version}`, { html, fingerprint, basis: packingBasis(p.lines) });
    const t = totalsOf(p.lines);
    p.versions = [...p.versions, { version, signedBy: who.slice(0, 120), signedAt, fingerprint, lines: t.lines, packages: t.packages }];
    c.papers = c.papers.map((line) =>
      line.key === 'packing_list'
        ? { key: line.key, ...(line.optional ? { optional: true } : {}), reference: `Version ${version}, signed by ${who.slice(0, 60)} — ${t.lines.toLocaleString('en')} line${t.lines === 1 ? '' : 's'}, ${t.packages.toLocaleString('en')} packages`, suppliedAt: signedAt, suppliedBy: by }
        : line,
    );
    this.exports.set(c.exportId, c);
    if (c.agent) this.tell(c, `${c.code}: packing list signed, version ${version}`, `${this.nameOf(c.exporterEntityId)} signed its packing list for ${c.code}, version ${version} (${t.lines.toLocaleString('en')} lines). Read it on the export, and accept it or send it back.`, c.agent.entityId);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /** The list's page: a signed version exactly as signed (the latest unless one is named), or the exporter's draft. */
  packingPage(exportId: string, readerEntityId: string, which: { version?: number; draft?: boolean } = {}, opts: { all?: boolean } = {}): string {
    const c = this.requireExport(exportId);
    const side = this.sideOf(c, readerEntityId, opts.all);
    if (which.draft) {
      if (side !== 'exporter' || !c.packing?.lines.length) throw new GlosError('NOT_FOUND', 'No draft of the packing list');
      return packingHtml(this.packingFactsOf(c), c.packing.lines, c.packing.extraColumns, 'draft');
    }
    const version = which.version ?? c.packing?.versions.length ?? 0;
    const copy = version > 0 ? this.packingCopies.get(`${c.exportId}:${version}`) : undefined;
    if (!copy) throw new GlosError('NOT_FOUND', 'No such version of the packing list');
    return copy.html;
  }

  /** The exports a business's own system may send a packing list to — its own, as its Exports screen lists them. */
  exportsOf(entityId: string, now = Date.now()): ExportRow[] {
    return this.list(entityId, {}, now).filter((r) => r.you === 'exporter');
  }

  private packingFactsOf(c: ExportConsignment): PackingFacts {
    const exporter = this.entities.get(c.exporterEntityId);
    const a = this.entities.recordOf(c.exporterEntityId).registeredAddress;
    const seals = c.ladenFreightId ? this.seals.views(c.ladenFreightId).filter((s) => s.state === 'on').map((s) => s.number ?? '—') : [];
    const consignee = c.sli?.draft?.consigneeKind === 'named' ? c.sli.draft.consignee?.name : c.sli?.draft?.consigneeKind === 'to_order_of_bank' ? `To the order of ${c.sli.draft.orderOfBank ?? '—'}` : c.sli?.draft ? 'To order' : undefined;
    return {
      code: c.code,
      shipper: { name: exporter.name, ...(a ? { address: [a.line1, a.line2, a.city, a.region, a.postalCode].filter(Boolean).join(', ') } : {}), country: c.originCountry },
      ...(consignee ? { consignee } : {}),
      booking: c.booking.reference,
      forwarder: c.booking.partyName,
      ...(c.booking.vessel ? { vessel: `${c.booking.vessel}${c.booking.voyage ? ` / ${c.booking.voyage}` : ''}` } : {}),
      loadingPort: c.loadingPort,
      destCountry: c.destCountry,
      container: { ...(c.containerType ? { type: c.containerType } : {}), ...(c.containerNo ? { number: c.containerNo } : {}), seals },
    };
  }

  /** The list as a reader sees it on the export. */
  private packingViewOf(c: ExportConsignment): ExportPackingView | undefined {
    const p = c.packing;
    if (!p) return undefined;
    const last = p.versions[p.versions.length - 1];
    const signedBasis = last ? this.packingCopies.get(`${c.exportId}:${last.version}`)?.basis : undefined;
    const t = totalsOf(p.lines);
    return {
      lineCount: p.lines.length,
      totals: t,
      preview: p.lines.slice(0, 20),
      extraColumns: p.extraColumns,
      versions: p.versions,
      importedAt: p.importedAt,
      importedBy: p.importedBy,
      ...(p.sourceName ? { sourceName: p.sourceName } : {}),
      unsigned: !last || signedBasis !== packingBasis(p.lines) || last.lines !== t.lines,
      notes: this.packingNotes(c, t),
    };
  }

  /** The letter as it is drawn: its goods worked out from the packing list where there is one, else as typed. */
  private effectiveSli(c: ExportConsignment): SliDraft | undefined {
    const draft = c.sli?.draft;
    if (!draft || !c.packing?.lines.length) return draft;
    return { ...draft, lines: summarisePacking(c.packing.lines) };
  }

  /* ------------------------------------------------- EX7 the clearing agent -- */

  /**
   * APPOINT A CLEARING AGENT on this export — the exporter's decision alone, as its papers are its own. The agent reads
   * what is attached here, gives the export entry, and accepts each paper or sends it back, under its own sign-in.
   * Replacing one is two acts: the moment the first stops reading the exporter's papers is one the exporter sees.
   */
  appointAgent(exportId: string, actorEntityId: string, agentEntityId: string, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    const agent = this.entities.find(agentEntityId);
    if (!agent) throw new GlosError('NOT_FOUND', 'No such company');
    if (agent.entityId === c.exporterEntityId) throw new GlosError('VALIDATION_FAILED', 'You hold your own papers — appointing yourself grants nothing');
    if (c.agent) {
      throw new GlosError('INVALID_STATE', `${this.nameOf(c.agent.entityId)} is already appointed on ${c.code}. End that appointment first — an agent losing access to your papers is a moment you should see happen`);
    }
    c.agent = { entityId: agent.entityId, appointedAt: new Date(now).toISOString(), appointedBy: by };
    this.exports.set(c.exportId, c);
    this.tell(
      c,
      `${c.code}: you are appointed to clear an export`,
      `${this.nameOf(c.exporterEntityId)} appointed you as its clearing agent on ${c.code} — ${c.goodsDescription}, leaving through ${c.loadingPort}, booking ${c.booking.reference}. Its papers are on the export in your Exports: give the export entry, and accept each paper or send it back with a reason.`,
      agent.entityId,
    );
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /** End it: at once, and both sides see it. Kept on the record — who could read these papers, and until when. */
  endAgent(exportId: string, actorEntityId: string, by: string, reason?: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    if (!c.agent) throw new GlosError('INVALID_STATE', `No clearing agent is appointed on ${c.code}`);
    const why = reason?.trim();
    const feeQuoteId = c.fee && c.fee.agentEntityId === c.agent.entityId ? c.fee.quoteId : undefined;
    const former = { ...c.agent, endedAt: new Date(now).toISOString(), endedBy: by, ...(why ? { reason: why.slice(0, 200) } : {}), ...(feeQuoteId ? { feeQuoteId } : {}) };
    c.formerAgents = [...(c.formerAgents ?? []), former];
    delete c.agent;
    // Its quotation stays between the two of them, kept on the former appointment; the next agent quotes its own.
    delete c.fee;
    this.exports.set(c.exportId, c);
    this.tell(c, `${c.code}: your appointment ended`, `${this.nameOf(c.exporterEntityId)} ended your appointment as clearing agent on ${c.code}${why ? `: “${former.reason}”` : ''}. Its papers are no longer shared with you.`, former.entityId);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /* --------------------------------------------- EX8 the agent's fee -- */

  /**
   * THE AGENT NAMES ITS FEE — a QUOTATION to the exporter, the import's bargain (the user, 2026-10-04: "we don't manage
   * the clearing agent's fee, but we do handle quotations for anyone"). One per appointment: a re-quote changes it and
   * drops the exporter's agreement; a new agent quotes its own. Nothing of it passes through SeeBuyGet.
   */
  quoteFee(exportId: string, actorEntityId: string, input: { amount: number; currency?: string; note?: string; reference?: string }, by: string, now = Date.now()): ExportDetail {
    const c = this.requireExport(exportId);
    this.requireAgent(c, actorEntityId);
    const agent = c.agent!;
    if (input.currency?.trim() && !isKnownCurrency(input.currency)) throw new GlosError('VALIDATION_FAILED', `“${input.currency.trim()}” is no currency we know — choose it from the list`, { field: 'currency' });
    const quote = this.quotes.quote(
      {
        subject: { kind: 'export', id: `${c.exportId}@${agent.entityId}@${agent.appointedAt}`, code: c.code },
        issuer: { name: this.nameOf(agent.entityId), entityId: agent.entityId },
        payer: { name: this.nameOf(c.exporterEntityId), entityId: c.exporterEntityId },
        amount: input.amount,
        currency: input.currency?.trim() || catalogueEntry(c.originCountry)?.currency || 'USD',
        note: input.note,
        reference: input.reference,
      },
      by,
      now,
    );
    const first = c.fee?.quoteId === quote.quoteId ? c.fee.quotedAt : new Date(now).toISOString();
    c.fee = { quoteId: quote.quoteId, quotedAt: first, agentEntityId: agent.entityId };
    this.exports.set(c.exportId, c);
    const ref = quote.reference ? ` (its reference ${quote.reference})` : '';
    this.tell(
      c,
      `${c.code}: your clearing agent quoted its fee`,
      `${this.nameOf(agent.entityId)} quotes ${quote.amount.toLocaleString('en')} ${quote.currency} for clearing ${c.code}${ref}. Agree to it on the export if it is what you agreed — agreeing is not paying, and SeeBuyGet moves no money between you.`,
    );
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /** The exporter agrees to the figure. Nothing moves — agreeing is not paying. */
  acceptFee(exportId: string, actorEntityId: string, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    const fee = this.feeOf(c);
    if (!fee) throw new GlosError('INVALID_STATE', `No fee has been quoted on ${c.code} yet`);
    this.quotes.agree(fee.quoteId, { name: by, entityId: actorEntityId }, now);
    this.tell(c, `${c.code}: the exporter agreed to your fee`, `${this.nameOf(c.exporterEntityId)} agreed to your fee of ${fee.amount.toLocaleString('en')} ${fee.currency} for clearing ${c.code}. Whether it is paid is for the two of you to say on the quotation.`, c.agent!.entityId);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /** The quotation behind the appointed agent's fee — only the agent appointed now; an earlier one's stays on its record. */
  feeOf(c: ExportConsignment): Quote | undefined {
    // Only the agent appointed now has one: ending an appointment clears the stamp and keeps its quotation on its record.
    if (!c.fee) return undefined;
    try {
      return this.quotes.get(c.fee.quoteId);
    } catch {
      return undefined;
    }
  }

  /**
   * THE BOX IS OURS — a shipper-owned container, said by the exporter (or taken back: it is the line's after all). No line
   * lent it, so no line's free days run on it and nobody is warned about them.
   */
  setOwnBox(exportId: string, actorEntityId: string, own: boolean, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    this.seaOnly(c, 'box');
    if (own) c.ownBox = { by, at: new Date(now).toISOString() };
    else delete c.ownBox;
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /* ----------------------------------------------------- EX6 the box's clock -- */

  /**
   * HOW MANY FREE DAYS THE LINE GIVES — the exporter's claim, from its agreement with the line or its forwarder: outside
   * the terminal (detention) or inside it (demurrage). Kept, every one: a corrected figure is a second claim, not an edit.
   */
  claimFreeDays(exportId: string, actorEntityId: string, kind: FreeDayKind, days: number, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    this.seaOnly(c, 'box with free days');
    if (!(FREE_DAY_KINDS as readonly string[]).includes(kind)) throw new GlosError('VALIDATION_FAILED', 'Say which free days: outside the terminal (detention) or inside it (demurrage)', { field: 'kind' });
    if (!Number.isInteger(days) || days < 0 || days > 90) throw new GlosError('VALIDATION_FAILED', 'Free days are a whole number of days, 0 to 90', { field: 'days' });
    if (c.loaded) throw new GlosError('INVALID_STATE', `${c.code} was loaded on board on ${utc(c.loaded.at)}: the box’s clock has stopped`);
    if (c.ownBox) throw new GlosError('INVALID_STATE', 'The box is your own: no line lent it, so no line’s free days run on it');
    c.freeDays = [...(c.freeDays ?? []), { kind, days, byEntityId: c.exporterEntityId, by, at: new Date(now).toISOString() }];
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /**
   * WHEN THE EMPTY LEFT THE DEPOT, where no load of ours fetched it — the line or the forwarder brought it, or the
   * exporter's own truck did. Where our empty load fetched it, its pickup says it, and a typed second date is refused.
   */
  recordEmptyOut(exportId: string, actorEntityId: string, at: string, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    this.seaOnly(c, 'empty box');
    if (c.emptyFreightId && this.legOf(c.emptyFreightId).status !== 'cancelled') {
      throw new GlosError('INVALID_STATE', `The empty is fetched on load ${c.emptyFreightCode}: its pickup says when it left the depot`);
    }
    const when = pastMoment(at, 'When the empty left the depot', now);
    const gatedInAt = this.timingOf(c, now).gatedInAt;
    if (gatedInAt && when > gatedInAt) throw new GlosError('VALIDATION_FAILED', `The empty cannot have left the depot after the box was inside the gate (${utc(gatedInAt)})`, { field: 'at' });
    c.emptyOut = { at: when, by, recordedAt: new Date(now).toISOString() };
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /** LOADED ON BOARD, from the forwarder's or the line's word: what stops the box's clock. Only once it is inside the gate. */
  recordLoaded(exportId: string, actorEntityId: string, at: string, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    this.seaOnly(c, 'vessel to load');
    const gatedInAt = this.timingOf(c, now).gatedInAt;
    if (!gatedInAt) throw new GlosError('INVALID_STATE', `${c.code} is not inside the terminal yet: a box is loaded on board only after it gated in`);
    const when = pastMoment(at, 'When it was loaded on board', now);
    if (when < gatedInAt) throw new GlosError('VALIDATION_FAILED', `It cannot have been loaded on board before it was inside the gate (${utc(gatedInAt)})`, { field: 'at' });
    c.loaded = { at: when, by, recordedAt: new Date(now).toISOString() };
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /** The box's clock, derived on every read from the empty out, the gate-in and the loading — never a stored figure. */
  boxOf(c: ExportConsignment, now = Date.now(), timing: ExportTiming = this.timingOf(c, now)): ExportBoxClockView {
    const empty = c.emptyFreightId ? this.legOf(c.emptyFreightId) : undefined;
    const fromLoad = empty && empty.status !== 'cancelled' ? empty.pickedUpAt : undefined;
    const emptyOutAt = fromLoad ?? c.emptyOut?.at;
    const clock = exportBoxClock(
      {
        ...(emptyOutAt ? { emptyOutAt } : {}),
        // By rail, our truck's delivery is the hand-over to the railway: the box is inside the port gate only once the
        // train brought it there, as the exporter records — until then the line's clock counts it outside.
        ...((c.byRail ? c.byRail.atPort?.at : timing.gatedInAt) ? { gatedInAt: (c.byRail ? c.byRail.atPort?.at : timing.gatedInAt)! } : {}),
        ...(c.loaded ? { loaded: { at: c.loaded.at, by: c.loaded.by } } : {}),
        ...(c.ownBox ? { owned: { by: c.ownBox.by } } : {}),
        freeDays: c.freeDays ?? [],
      },
      now,
    );
    return { ...clock, dueSoon: boxDueSoon(clock), ...(emptyOutAt ? { emptyOutAt, emptyOutFrom: fromLoad ? ('load' as const) : ('recorded' as const) } : {}) };
  }

  /* --------------------------------------------- EX5 the handover and the BL -- */

  /** The bill of lading's number, once the forwarder issued it — recorded back so the receiving end can match it. */
  recordBillOfLading(exportId: string, actorEntityId: string, number: string, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    this.seaOnly(c, 'bill of lading — its waybill is the airline’s');
    const n = number?.trim();
    if (!n || n.length < 3) throw new GlosError('FIELD_REQUIRED', 'Give the bill of lading number your forwarder or the line issued', { field: 'number' });
    c.billOfLading = { number: n.slice(0, 60), recordedAt: new Date(now).toISOString(), recordedBy: by };
    // Its line holds the copy; until one is attached, the number stands on it.
    c.papers = c.papers.map((p) => (p.key === 'bill_of_lading' && !p.documentId ? { ...p, reference: c.billOfLading!.number, suppliedAt: c.billOfLading!.recordedAt, suppliedBy: by } : p));
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /** What is still missing before the forwarder can take it at the gate, in words. */
  missingOf(c: ExportConsignment): string[] {
    const out: string[] = [];
    if (c.mode === 'air') {
      if (!c.ladenFreightId) out.push('A load to the cargo terminal');
      else if (c.air?.security.status === 'secured' && !this.seals.views(c.ladenFreightId).some((s) => s.state === 'on')) out.push('A seal written on the load to the cargo terminal — secured cargo travels sealed');
      for (const m of this.airViewOf(c, Date.now()).check.mismatches) out.push(`The air waybill and the packing list disagree — ${m.replace(/\.$/, '')}`);
    } else {
      if (!c.containerNo) out.push('The box’s number');
      if (!c.ladenFreightId) out.push('A load to the terminal');
      else if (!this.seals.views(c.ladenFreightId).some((s) => s.state === 'on')) out.push('A seal written on the load to the terminal');
      if (!c.vgm) out.push('The verified gross mass');
    }
    const lastInvoice = c.invoice?.versions[c.invoice.versions.length - 1];
    if (lastInvoice && lastInvoice.basis !== invoiceBasis(c.packing?.lines ?? [])) out.push(`The commercial invoice: the packing list changed since version ${lastInvoice.version} was signed — sign it again`);
    const pv = this.packingViewOf(c);
    if (pv && pv.versions.length && pv.unsigned) out.push(`The packing list: imported again since version ${pv.versions.length} was signed — sign it`);
    const lastSli = c.sli?.versions[c.sli.versions.length - 1];
    if (lastSli && sliStale(lastSli, this.sliFactsOf(c))) out.push(`The letter of instruction: the export changed since version ${lastSli.version} was signed — sign it again`);
    for (const p of c.papers) {
      // A paper its agent sent back is a gap, whatever was attached: what was given is not what customs will take.
      if (p.refusedAt) out.push(`${paperLabel(p)} — sent back by your clearing agent: ${p.refusedReason}`);
      else if (!p.optional && !p.documentId && !p.reference) out.push(paperLabel(p));
    }
    return out;
  }

  /**
   * ONE FILE FOR THE FORWARDER AT THE GATE: the booking, the cut-offs, the box, its seal, its verified gross mass, the
   * papers with their references, the road consignment note's number and when it gated in — and the bill of lading once
   * recorded. What is missing is said, never left blank.
   */
  handoverHtml(exportId: string, readerEntityId: string, opts: { all?: boolean } = {}, now = Date.now()): string {
    const d = this.detail(exportId, readerEntityId, opts, now);
    const c = d.consignment;
    const exporter = this.entities.get(c.exporterEntityId);
    if (c.mode === 'air') return this.airHandoverHtml(d, exporter.name, now);
    const spec = containerType(c.containerType);
    const missing = (s?: string) => (s ? esc(s) : '<span class="missing">Missing</span>');
    const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
    const seal = d.seals.filter((s) => s.state === 'on').map((s) => s.number ?? '—').join(', ');
    const vgm = c.vgm
      ? `${c.vgm.kg.toLocaleString('en')} kg, method ${c.vgm.method}${c.vgm.weighbridge ? `, ${esc(c.vgm.weighbridge)}` : ''}${c.vgm.ticketRef ? `, ticket ${esc(c.vgm.ticketRef)}` : ''} — signed for by ${esc(c.vgm.signatory)}`
      : '';
    const paperRows = (only: (g: ExportPaperGroup) => boolean) => d.papers
      .filter((p) => only(p.group))
      .map((p) => {
        const given = p.documentTitle || p.reference ? esc([p.documentTitle, p.reference].filter(Boolean).join(' — ')) : p.optional ? 'None kept here' : missing();
        const word = p.refusedAt ? ` <span class="missing">Sent back by the clearing agent: ${esc(p.refusedReason ?? '')}</span>` : p.acceptedAt ? ` — accepted by ${esc(p.acceptedBy ?? '')}` : '';
        return row(p.group === 'asked' && p.addedBy ? `${p.label} (asked for by ${p.addedBy})` : p.label, given + word);
      })
      .join('');
    const papers = paperRows((g) => g !== 'kept');
    const kept = paperRows((g) => g === 'kept');
    const agentRow = row('Clearing agent', d.agent ? esc(d.agent.name) : 'None appointed on SeeBuyGet');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.code)} — handover at ${esc(c.loadingPort)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;color:#111;margin:24px auto;max-width:760px;padding:0 16px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}table{border-collapse:collapse;width:100%}th{text-align:left;font-weight:600;width:38%;padding:4px 8px 4px 0;vertical-align:top}td{padding:4px 0}.missing{color:#b00020;font-weight:600}.note{color:#555;font-size:12px;margin-top:18px}@media print{body{margin:0}}</style></head><body>
<h1>Handover at ${esc(c.loadingPort)} — ${esc(c.code)}</h1>
<div>${esc(exporter.name)} · ${esc(c.goodsDescription)} · ${esc(c.originCountry)} → ${esc(c.destCountry)}</div>
${d.missing.length ? `<p class="missing">Still missing: ${esc(d.missing.join('; '))}.</p>` : ''}
<h2>Booking</h2><table>${row('Booking number', esc(c.booking.reference))}${row(c.booking.bookedWith === 'shipping_line' ? 'Shipping line' : 'Forwarder', esc(c.booking.partyName))}${c.booking.vessel ? row('Vessel / voyage', esc(`${c.booking.vessel}${c.booking.voyage ? ` / ${c.booking.voyage}` : ''}`)) : ''}${row('Gate-in cut-off', esc(utc(c.booking.gateCutoffAt)))}${c.booking.vgmCutoffAt ? row('Verified gross mass cut-off', esc(utc(c.booking.vgmCutoffAt))) : ''}${c.booking.docsCutoffAt ? row('Documents cut-off', esc(utc(c.booking.docsCutoffAt))) : ''}${c.booking.emptyReleaseRef ? row('Empty release', esc(c.booking.emptyReleaseRef)) : ''}</table>
<h2>The box</h2><table>${row('Container number', missing(c.containerNo))}${row('Type', esc(spec ? `${spec.code} — ${spec.label}` : c.containerType ?? ''))}${row('Owner of the box', c.ownBox ? 'The exporter (a shipper-owned container)' : 'The line, on loan for this booking')}${row('Seal', missing(seal || undefined))}${row('Verified gross mass', missing(vgm || undefined))}</table>
<h2>Papers</h2><table>${agentRow}${papers}</table>
<h2>Kept with the export</h2><table>${kept}</table>
<h2>The road to the terminal</h2><table>${row('Terminal', esc(c.terminal.label))}${c.byRail ? row('By rail from', esc(`${c.byRail.terminal.label} — the train’s cut-off ${utc(c.byRail.cutoffAt)}${c.byRail.reference ? `, train ${c.byRail.reference}` : ''}`)) : ''}${row('Road consignment note', d.ladenLeg ? esc(`CMR-${d.ladenLeg.code}`) : missing())}${row('Collected', d.timing.collectedAt ? esc(utc(d.timing.collectedAt)) : 'Not yet')}${row('Gated in', d.timing.gatedInAt ? esc(utc(d.timing.gatedInAt)) : 'Not yet')}${row('Bill of lading', c.billOfLading ? esc(c.billOfLading.number) : 'Not issued yet — recorded once your forwarder issues it')}${d.fbl ? row('Forwarder’s bill held', esc(`${d.fbl.form === 'fwb' ? 'FIATA waybill (FWB)' : 'FIATA bill of lading (FBL)'} ${d.fbl.number}, issued by ${d.fbl.issuer.name} on ${d.fbl.issuedOn} — ${d.fbl.check.complete ? 'complete as printed' : `not complete: ${d.fbl.check.findings.filter((f) => f.kind === 'missing').length} missing`}${d.fbl.electronic ? `; ${d.fbl.verified === 'registered' ? 'shown as registered on FIATA’s page, as the exporter recorded' : d.fbl.verified === 'not_registered' ? 'NOT shown as registered on FIATA’s page, as the exporter recorded' : 'not checked on FIATA’s page'}` : ''}. A copy — never an original.`)) : ''}${d.rail ? row('Railway’s note held', esc(`${d.rail.railwayName}${d.rail.noteNumber ? ` ${d.rail.noteNumber}` : ''}, ${d.rail.from.name} to ${d.rail.to.name} — ${d.rail.check.notChecked ? 'its rules not read' : d.rail.check.complete ? 'complete as printed' : 'not complete'}`)) : ''}</table>
<h2>The box’s clock</h2><table>${row('Empty out of the depot', d.box.emptyOutAt ? esc(utc(d.box.emptyOutAt)) : 'Not recorded')}${row('Free days outside the terminal (detention)', esc(freeDaysWords(c, 'detention')))}${row('Free days inside the terminal (demurrage)', esc(freeDaysWords(c, 'demurrage')))}${c.loaded ? row('Loaded on board', esc(utc(c.loaded.at))) : ''}</table><p>${esc(d.box.basis)}</p>
<p class="note">Made on SeeBuyGet on ${esc(utc(new Date(now).toISOString()))}. SeeBuyGet carried the road leg; the ocean leg, its booking and the bill of lading are your forwarder’s or the line’s. The verified gross mass is the exporter’s declaration, handed to the forwarder — SeeBuyGet sends nothing to a line.</p>
</body></html>`;
  }

  /** The forwarder's file for an export by air: the waybill and its check, the papers, the road to the cargo terminal. */
  private airHandoverHtml(d: ExportDetail, exporterName: string, now: number): string {
    const c = d.consignment;
    const a = c.air!;
    const check = d.air!.check;
    const missing = (s?: string) => (s ? esc(s) : '<span class="missing">Missing</span>');
    const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
    const seal = d.seals.filter((s) => s.state === 'on').map((s) => s.number ?? '—').join(', ');
    const paperRows = (only: (g: ExportPaperGroup) => boolean) => d.papers
      .filter((p) => only(p.group))
      .map((p) => row(p.label, p.documentTitle || p.reference ? esc([p.documentTitle, p.reference].filter(Boolean).join(' — ')) : p.optional ? 'None kept here' : missing()))
      .join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.code)} — handover at ${esc(c.terminal.label)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;color:#111;margin:24px auto;max-width:760px;padding:0 16px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}table{border-collapse:collapse;width:100%}th{text-align:left;font-weight:600;width:38%;padding:4px 8px 4px 0;vertical-align:top}td{padding:4px 0}.missing{color:#b00020;font-weight:600}.note{color:#555;font-size:12px;margin-top:18px}@media print{body{margin:0}}</style></head><body>
<h1>Handover at ${esc(c.terminal.label)} — ${esc(c.code)}</h1>
<div>${esc(exporterName)} · ${esc(c.goodsDescription)} · ${esc(c.originCountry)} → ${esc(c.destCountry)}</div>
${d.missing.length ? `<p class="missing">Still missing: ${esc(d.missing.join('; '))}.</p>` : ''}
<h2>The air booking</h2><table>${row('Air waybill', esc(`${a.awb} — ${a.airline}${check.airline ? '' : ' (airline as given: its prefix is not one we hold)'}`))}${a.houseNumber ? row('House waybill', esc(a.houseNumber)) : ''}${row(c.booking.bookedWith === 'airline' ? 'Airline' : 'Forwarder', esc(c.booking.partyName))}${row('Flights', esc(a.flights.map((f) => `${f.flight} ${f.date} ${f.from}→${f.to}${f.departsLocal ? ` ${f.departsLocal}` : ''}`).join('; ')))}${row('Booking', a.bookingStatus === 'confirmed' ? 'Confirmed by the airline' : '<span class="missing">Not confirmed by the airline: it may not fly on this flight</span>')}${row('Latest acceptance time', esc(utc(a.latAt)))}${row('Pieces and weight', esc(`${a.pieces} pieces, ${a.weightKg} kg${a.volumeM3 ? `, ${a.volumeM3} m³` : ''}`))}${a.handler ? row('Received by', esc(a.handler)) : ''}${row('Security', esc(a.security.status === 'secured' ? `Secured by ${a.security.agentName}${a.security.agentNumber ? ` (${a.security.agentNumber})` : ''} — its status, not SeeBuyGet’s` : 'Not secured: screened at the terminal'))}${a.temp ? row('Temperature', esc(`${a.temp.minC} to ${a.temp.maxC} °C${a.temp.preCooled ? ', pre-cooled' : ''}`)) : ''}</table>
<h2>The waybill, read against the law of its route</h2><table>${row('Convention', esc(check.rules ?? (check.regime === 'none' ? 'None joins these two countries' : check.regime === 'domestic' ? 'Domestic carriage' : 'Not read for this route')))}${row('Limit', esc(check.limits.join(' ')))}${row('Complaints', esc(check.claims.join(' ')))}${check.mismatches.length ? row('Against our papers', `<span class="missing">${esc(check.mismatches.join(' '))}</span>`) : ''}</table>
<h2>Papers</h2><table>${paperRows((g) => g !== 'kept')}</table>
<h2>Kept with the export</h2><table>${paperRows((g) => g === 'kept')}</table>
<h2>The road to the cargo terminal</h2><table>${row('Cargo terminal', esc(c.terminal.label))}${row('Road consignment note', d.ladenLeg ? esc(`CMR-${d.ladenLeg.code}`) : missing())}${a.security.status === 'secured' ? row('Seal', missing(seal || undefined)) : ''}${row('Leave by', esc(utc(d.timing.leaveByAt)))}${row('Collected', d.timing.collectedAt ? esc(utc(d.timing.collectedAt)) : 'Not yet')}${row('Delivered at the terminal', d.timing.gatedInAt ? esc(utc(d.timing.gatedInAt)) : 'Not yet')}</table>
<p class="note">Made on SeeBuyGet on ${esc(utc(new Date(now).toISOString()))}. SeeBuyGet carried the road to the cargo terminal; the air carriage, its booking and its waybill are the airline’s and your forwarder’s. Delivered at the terminal is not accepted by the airline: acceptance is the airline’s word. SeeBuyGet gives no security status.</p>
</body></html>`;
  }

  /* ----------------------------------------------------------- the cut-off watch -- */

  /**
   * Every ten minutes (ExportCutoffSweeper): the exporter is told, once each, when the latest departure is six hours off
   * and no truck has collected the box; when the gate closed without it; and when the VGM cut-off is twelve hours off with
   * no VGM. In its bell, as a load's trouble is.
   */
  sweep(now = Date.now()): string[] {
    const told: string[] = [];
    for (const c of [...this.exports.values()]) {
      const t = this.timingOf(c, now);
      const warned = { ...(c.warned ?? {}) };
      // The box's free days — outside the terminal until the gate, inside it until it is loaded: once three days before
      // the date, and once when it passed. Keyed by the date, so a corrected claim is a new date and is warned afresh.
      const box = this.boxOf(c, now, t);
      if (box.dueAt && (box.kind === 'detention' || box.kind === 'demurrage') && (box.overdue || box.dueSoon)) {
        const key = `${box.kind}@${box.dueAt}:${box.overdue ? 'over' : 'soon'}`;
        if (!(warned.box ?? []).includes(key)) {
          warned.box = [...(warned.box ?? []), key];
          const [title, body] = boxWarning(c, box);
          this.tell(c, title, body);
          told.push(`${c.code}:box:${box.kind}:${box.overdue ? 'over' : 'soon'}`);
        }
      }
      const h = this.handoverOf(c);
      const cutoff = Date.parse(h.cutoffAt);
      if (!t.gatedInAt && !warned.pickup && !t.collectedAt && now < cutoff && now >= Date.parse(t.leaveByAt) - PICKUP_WARN_H * H) {
        warned.pickup = new Date(now).toISOString();
        const to = c.mode === 'air' ? `To be at ${c.terminal.label} before the airline’s latest acceptance time at ${utc(h.cutoffAt)}` : h.byRail ? `To be at ${h.place.label} before the train’s cut-off at ${utc(h.cutoffAt)}` : `To be inside the gate at ${c.terminal.label} before ${utc(c.booking.gateCutoffAt)}`;
        this.tell(c, `${c.code}: the ${c.mode === 'air' ? 'cargo' : 'box'} must leave by ${utc(t.leaveByAt)}`, `${to}, a truck must leave ${c.loadingPlace.label} by ${utc(t.leaveByAt)}. ${c.ladenFreightId ? `No driver has collected load ${c.ladenFreightCode} yet.` : `Post the load to the ${c.mode === 'air' ? 'cargo terminal' : 'terminal'} now.`}`);
        told.push(`${c.code}:pickup`);
      }
      if (!t.gatedInAt && !warned.gate && now >= cutoff) {
        warned.gate = new Date(now).toISOString();
        if (c.mode === 'air') this.tell(c, `${c.code}: the latest acceptance time passed without the cargo`, `The latest acceptance time at ${c.terminal.label} was ${utc(h.cutoffAt)} and the cargo has not been delivered there. Tell ${c.booking.partyName} at once: it may go on a later flight, under a new time.`);
        else if (h.byRail) this.tell(c, `${c.code}: the train’s cut-off passed without the box`, `The train’s cut-off at ${h.place.label} was ${utc(h.cutoffAt)} and the box is not there. Ask the railway or ${c.booking.partyName} for the next train — it must still reach the port before the gate closes at ${utc(c.booking.gateCutoffAt)}.`);
        else this.tell(c, `${c.code}: the gate closed without the box`, `The gate-in cut-off at ${c.terminal.label} was ${utc(c.booking.gateCutoffAt)} and the box is not inside. Tell ${c.booking.partyName} at once: it may go on the next vessel, under a new cut-off.`);
        told.push(`${c.code}:gate`);
      }
      if (!t.gatedInAt && c.booking.vgmCutoffAt && !c.vgm && !warned.vgm && now >= Date.parse(c.booking.vgmCutoffAt) - VGM_WARN_H * H) {
        warned.vgm = new Date(now).toISOString();
        this.tell(c, `${c.code}: declare the verified gross mass`, `${c.booking.partyName} needs the box’s verified gross mass before ${utc(c.booking.vgmCutoffAt)}: without it the box is not loaded. Weigh it and declare it on the export.`);
        told.push(`${c.code}:vgm`);
      }
      if (JSON.stringify(warned) !== JSON.stringify(c.warned ?? {})) {
        c.warned = warned;
        this.exports.set(c.exportId, c);
      }
    }
    return told;
  }

  /* ----------------------------------------------------------------- inside -- */

  /** Into the bell — the exporter's, or (named) its agent's — as a load's trouble is. */
  private tell(c: ExportConsignment, title: string, body: string, toEntityId: string = c.exporterEntityId): void {
    let did: string | undefined;
    try {
      did = this.entities.get(toEntityId).did;
    } catch {
      return;
    }
    if (!did) return;
    void this.notifications?.notify(did, { kind: 'freight_problem', title, body, link: '/', tag: `export:${c.exportId}:${title}`, data: { exportId: c.exportId } }).catch(() => undefined);
  }

  private legOf(freightId: string): ExportLegView {
    const f = this.dispatch.requireFreightPublic(freightId);
    return { freightId: f.freightId, code: f.code, status: f.status, ...(f.pickedUpAt ? { pickedUpAt: f.pickedUpAt } : {}), ...(f.deliveredAt ? { deliveredAt: f.deliveredAt } : {}) };
  }

  private requireExport(exportId: string): ExportConsignment {
    const c = this.exports.get(exportId);
    if (!c) throw new GlosError('NOT_FOUND', 'No such export');
    return c;
  }

  /** Who is reading: the exporter, the agent it appointed, or staff — anybody else is told there is no such export. */
  private sideOf(c: ExportConsignment, readerEntityId: string, all?: boolean): 'exporter' | 'agent' | 'staff' {
    if (readerEntityId && readerEntityId === c.exporterEntityId) return 'exporter';
    if (readerEntityId && readerEntityId === c.agent?.entityId) return 'agent';
    if (all) return 'staff';
    throw new GlosError('NOT_FOUND', 'No such export');
  }

  private requireAgent(c: ExportConsignment, actorEntityId: string): void {
    this.sideOf(c, actorEntityId);
    if (c.agent?.entityId !== actorEntityId) throw new GlosError('FORBIDDEN', `Only the clearing agent appointed on ${c.code} gives its word on the papers`);
  }

  /** A paper line that holds something to give a word on. */
  private suppliedLine(c: ExportConsignment, key: ExportPaperKey): ExportPaper {
    const line = c.papers.find((p) => p.key === key);
    if (!line) throw new GlosError('NOT_FOUND', 'No such paper on this export');
    if (!line.documentId && !line.reference) throw new GlosError('INVALID_STATE', `Nothing is supplied for ${paperLabel(line)} yet`);
    return line;
  }

  private nameOf(entityId: string): string {
    return this.entities.find(entityId)?.name ?? entityId;
  }

  /** The exporter's own — anybody else is told there is no such export. */
  private requireOwn(exportId: string, actorEntityId: string): ExportConsignment {
    const c = this.requireExport(exportId);
    if (c.exporterEntityId !== actorEntityId) throw new GlosError('NOT_FOUND', 'No such export');
    return c;
  }

  private nextCode(): string {
    return `EXP-${String(this.exports.size + 1).padStart(3, '0')}`;
  }
}

function country(value: string, which: string): string {
  const code = (value ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw new GlosError('VALIDATION_FAILED', `Say ${which} as a two-letter country code`);
  return code;
}

/** A moment in time, as ISO: refused when it is not one. Absent stays absent. */
function moment(value: string | undefined, what: string): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  const at = Date.parse(v);
  if (Number.isNaN(at)) throw new GlosError('VALIDATION_FAILED', `${what} must be a date and time`);
  return new Date(at).toISOString();
}

const EMPTY_PACKING_CHECK = { columns: [], headingRow: 0, totals: { lines: 0, packages: 0, grossKg: 0, netKg: 0, volumeM3: 0 }, preview: [], problems: [], notes: [] };

/** How far the agent's fee has got, read off its quotation every time — the import's words. */
function feeStateOf(fee?: Quote): FeeState {
  if (!fee) return 'none';
  if (fee.status === 'paid') return 'paid';
  return fee.agreedAt ? 'accepted' : 'quoted';
}

/** A moment that already happened: refused when it is not a time, or when it is ahead of now. */
function pastMoment(value: string, what: string, now: number): string {
  const at = moment(value, what);
  if (!at) throw new GlosError('FIELD_REQUIRED', `Say ${what.charAt(0).toLowerCase()}${what.slice(1)}`, { field: 'at' });
  if (Date.parse(at) > now + 10 * 60_000) throw new GlosError('VALIDATION_FAILED', `${what} cannot be ahead of now`, { field: 'at' });
  return at;
}

/** The claim in force, in words: "14 days, said by Amina on 28 Oct 2026 09:00 UTC" — or that nobody said. */
function freeDaysWords(c: ExportConsignment, kind: FreeDayKind): string {
  const claim = (c.freeDays ?? [])
    .filter((f) => f.kind === kind)
    .sort((a, b) => a.at.localeCompare(b.at))
    .pop();
  return claim ? `${claim.days} day${claim.days === 1 ? '' : 's'}, said by ${claim.by} on ${utc(claim.at)}` : 'Not said';
}

/** The bell's words for a box near or past its free days: what is counted, by when, and who to talk to. Never a sum. */
function boxWarning(c: ExportConsignment, box: ExportBoxClockView): [string, string] {
  const due = utc(box.dueAt!);
  if (box.kind === 'detention') {
    return box.overdue
      ? [
          `${c.code}: the box’s free days outside the terminal ran out`,
          `The ${box.freeDays} free days outside the terminal (detention) ended on ${due} and the box is not inside the gate at ${c.terminal.label}. Each day over is the line’s to charge, under your agreement with it — talk to ${c.booking.partyName}.`,
        ]
      : [
          `${c.code}: the box’s free days outside the terminal end ${due}`,
          `The line gives ${box.freeDays} free days for the box outside the terminal (detention, ${box.freeDaysBy}’s figure); they end on ${due}. Get it inside the gate at ${c.terminal.label} before then: after that the line may charge for each day, under your agreement with it.`,
        ];
  }
  return box.overdue
    ? [
        `${c.code}: the box’s free days inside the terminal ran out`,
        `The ${box.freeDays} free days inside ${c.terminal.label} (demurrage) ended on ${due}, and nobody has recorded the box loaded on board. Ask ${c.booking.partyName} — and record it loaded once it is.`,
      ]
    : [
        `${c.code}: the box’s free days inside the terminal end ${due}`,
        `The box waits inside ${c.terminal.label}; its ${box.freeDays} free days there (demurrage, ${box.freeDaysBy}’s figure) end on ${due}. Ask ${c.booking.partyName} which vessel takes it: after that the terminal or the line may charge for each day.`,
      ];
}

/** "28 Oct 2026 18:00 UTC" — a cut-off said in one clock, the same for everybody who reads it. */
function utc(iso: string): string {
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** A standard tare for a box of this length, until its own is read off its door. */
function standardTareKg(lengthM: number): number {
  if (lengthM <= 6.1) return 2300;
  if (lengthM <= 12.2) return 3800;
  return 4800;
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
