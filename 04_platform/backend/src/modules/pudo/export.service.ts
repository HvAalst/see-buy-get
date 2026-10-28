import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import type { CargoNature } from './cargo.types';
import { ContainerBoxService } from './container-box.service';
import { containerType } from './container-type';
import { DispatchService } from './dispatch.service';
import { EXPORT_PAPER_KEYS, type ExportConsignment, type ExportDetail, type ExportLegView, type ExportPaper, type ExportPaperKey, type ExportPlace, type ExportRow, type ExportTiming, type BookedWith } from './export.types';
import { LoadSealService } from './load-seal.service';
import { NotificationService } from './notification.service';
import { EXPORT_GATE_BUFFER_H, VEHICLE_SPEED_KMH } from './pudo.config';
import { ROUTER, type Router } from './router';
import { SiteService } from './site.service';

/** The words for each paper, where a sentence names it (the screen translates its own). */
export const EXPORT_PAPER_LABEL: Record<ExportPaperKey, string> = {
  commercial_invoice: 'Commercial invoice',
  packing_list: 'Packing list',
  certificate_of_origin: 'Certificate of origin',
  export_entry: 'Export entry (from your clearing agent)',
};

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

  constructor(
    private readonly entities: EntityService,
    private readonly documents: CompanyDocumentService,
    private readonly dispatch: DispatchService,
    private readonly sites: SiteService,
    private readonly seals: LoadSealService,
    @Inject(ROUTER) private readonly router: Router,
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
      papers: EXPORT_PAPER_KEYS.map((key) => ({ key, ...(key === 'certificate_of_origin' ? { optional: true } : {}) })),
      createdAt: new Date(now).toISOString(),
      createdBy: by,
    };
    this.exports.set(consignment.exportId, consignment);
    return consignment;
  }

  list(readerEntityId: string, opts: { all?: boolean } = {}, now = Date.now()): ExportRow[] {
    return [...this.exports.values()]
      .filter((c) => opts.all || c.exporterEntityId === readerEntityId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => ({
        exportId: c.exportId,
        code: c.code,
        goodsDescription: c.goodsDescription,
        loadingPort: c.loadingPort,
        bookingReference: c.booking.reference,
        gateCutoffAt: c.booking.gateCutoffAt,
        ...(c.containerNo ? { containerNo: c.containerNo } : {}),
        timing: this.timingOf(c, now),
        missing: this.missingOf(c).length,
      }));
  }

  detail(exportId: string, readerEntityId: string, opts: { all?: boolean } = {}, now = Date.now()): ExportDetail {
    const c = this.requireExport(exportId);
    if (!opts.all && c.exporterEntityId !== readerEntityId) throw new GlosError('NOT_FOUND', 'No such export');
    return {
      consignment: c,
      timing: this.timingOf(c, now),
      ...(c.emptyFreightId ? { emptyLeg: this.legOf(c.emptyFreightId) } : {}),
      ...(c.ladenFreightId ? { ladenLeg: this.legOf(c.ladenFreightId) } : {}),
      seals: c.ladenFreightId ? this.seals.views(c.ladenFreightId).map((s) => ({ ...(s.number ? { number: s.number } : {}), state: s.state, appliedBy: s.appliedBy })) : [],
      papers: c.papers.map((p) => ({ ...p, label: EXPORT_PAPER_LABEL[p.key] })),
      missing: this.missingOf(c),
      documents: this.documents
        .list(c.exporterEntityId)
        .filter((d) => d.status !== 'superseded' && d.status !== 'rejected')
        .map((d) => ({ documentId: d.documentId, title: d.title })),
    };
  }

  /**
   * WHERE THE TIMING STANDS, derived on every read — never a stored flag that goes stale: the latest the laden truck may
   * leave the loading place and still be inside the gate before the cut-off (the road at a truck's speed, plus a gate
   * buffer), and whether it was collected, delivered, or is late.
   */
  timingOf(c: ExportConsignment, now = Date.now()): ExportTiming {
    const roadKm = Math.round(this.router.roadKm(c.loadingPlace.location, c.terminal.location) * 10) / 10;
    const plannedHours = Math.round((roadKm / VEHICLE_SPEED_KMH.truck + EXPORT_GATE_BUFFER_H) * 10) / 10;
    const cutoff = Date.parse(c.booking.gateCutoffAt);
    const leaveByAt = new Date(cutoff - plannedHours * H).toISOString();
    const laden = c.ladenFreightId ? this.legOf(c.ladenFreightId) : undefined;
    const collectedAt = laden?.pickedUpAt;
    const gatedInAt = laden?.status === 'delivered' ? laden.deliveredAt : undefined;
    const state = gatedInAt ? 'gated_in' : now > cutoff ? 'missed' : !collectedAt && now > Date.parse(leaveByAt) ? 'at_risk' : 'on_time';
    return { state, leaveByAt, roadKm, plannedHours, ...(gatedInAt ? { gatedInAt } : {}), ...(collectedAt ? { collectedAt } : {}) };
  }

  /* -------------------------------------------------- EX2 empty, stuffed, laden -- */

  /** The box's number, once the depot released it or it was stuffed: ISO 6346, check digit checked — the arithmetic only. */
  setContainer(exportId: string, actorEntityId: string, containerNo: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
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
    if (!c.emptyDepot) throw new GlosError('INVALID_STATE', `${c.code} names no depot to fetch the empty from: the line or your forwarder brings it`);
    if (c.emptyFreightId) throw new GlosError('CONFLICT', `${c.code} already has its empty run (${c.emptyFreightCode})`);
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
  mintLadenLeg(exportId: string, actorEntityId: string, input: { weightKg?: number }, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    if (c.ladenFreightId) throw new GlosError('CONFLICT', `${c.code} already has its load to the port (${c.ladenFreightCode}) — a second would send two trucks for one box`);
    if (!c.containerNo) throw new GlosError('INVALID_STATE', `Say the box’s number first: the terminal gates it in by its number`, { field: 'containerNo' });
    const weightKg = c.vgm?.kg ?? Number(input.weightKg);
    if (!(weightKg > 0)) throw new GlosError('FIELD_REQUIRED', 'Say what the packed box weighs — or declare its verified gross mass first', { field: 'weightKg' });
    if (now > Date.parse(c.booking.gateCutoffAt)) throw new GlosError('INVALID_STATE', `The gate closed for this booking at ${utc(c.booking.gateCutoffAt)}: ask your forwarder for the next vessel and a new cut-off first`);
    const exporter = this.entities.get(c.exporterEntityId);
    const spec = containerType(c.containerType)!;
    const vessel = c.booking.vessel ? `, vessel ${c.booking.vessel}${c.booking.voyage ? ` voyage ${c.booking.voyage}` : ''}` : '';
    const f = this.dispatch.registerFreight(
      {
        description: `${c.code} — ${c.goodsDescription} (${spec.label}, for export)`.slice(0, 200),
        pickupLocation: c.loadingPlace.location,
        pickupLabel: c.loadingPlace.label,
        destLabel: c.terminal.label,
        destLocation: c.terminal.location,
        weightKg,
        ...(c.natureCode ? { natureCode: c.natureCode as CargoNature } : {}),
        bodyHint: spec.bodies[0],
        packaging: 'piece',
        originEquipment: spec.equipment,
        destEquipment: spec.equipment,
        ...(spec.heightM ? { heightM: spec.heightM } : {}),
        indivisible: true,
        containerNo: c.containerNo,
        pickupCountry: c.originCountry,
        destCountry: c.originCountry,
        deliveryWindow: `Inside the gate at ${c.terminal.label} before ${utc(c.booking.gateCutoffAt)} — the vessel cut-off`.slice(0, 120),
        instructions: `Export ${c.code}: container ${c.containerNo}, booking ${c.booking.reference} with ${c.booking.partyName}${vessel}. Hand it in at the terminal gate against this booking, before the cut-off.`.slice(0, 500),
        postedByDid: exporter.did,
        externalOrderId: c.code,
      },
      now,
    );
    Object.assign(c, { ladenFreightId: f.freightId, ladenFreightCode: f.code });
    this.exports.set(c.exportId, c);
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
    const c = this.requireOwn(exportId, actorEntityId);
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
    const next: ExportPaper = {
      key: line.key,
      ...(line.optional ? { optional: true } : {}),
      ...(document ? { documentId: document.documentId, documentTitle: document.title } : {}),
      ...(reference ? { reference: reference.slice(0, 80) } : {}),
      suppliedAt: new Date(now).toISOString(),
      suppliedBy: by,
    };
    c.papers = c.papers.map((p) => (p.key === line.key ? next : p));
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /* --------------------------------------------- EX5 the handover and the BL -- */

  /** The bill of lading's number, once the forwarder issued it — recorded back so the receiving end can match it. */
  recordBillOfLading(exportId: string, actorEntityId: string, number: string, by: string, now = Date.now()): ExportDetail {
    const c = this.requireOwn(exportId, actorEntityId);
    const n = number?.trim();
    if (!n || n.length < 3) throw new GlosError('FIELD_REQUIRED', 'Give the bill of lading number your forwarder or the line issued', { field: 'number' });
    c.billOfLading = { number: n.slice(0, 60), recordedAt: new Date(now).toISOString(), recordedBy: by };
    this.exports.set(c.exportId, c);
    return this.detail(c.exportId, actorEntityId, {}, now);
  }

  /** What is still missing before the forwarder can take it at the gate, in words. */
  missingOf(c: ExportConsignment): string[] {
    const out: string[] = [];
    if (!c.containerNo) out.push('The box’s number');
    if (!c.ladenFreightId) out.push('A load to the terminal');
    else if (!this.seals.views(c.ladenFreightId).some((s) => s.state === 'on')) out.push('A seal written on the load to the terminal');
    if (!c.vgm) out.push('The verified gross mass');
    for (const p of c.papers) if (!p.optional && !p.documentId && !p.reference) out.push(EXPORT_PAPER_LABEL[p.key]);
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
    const spec = containerType(c.containerType);
    const missing = (s?: string) => (s ? esc(s) : '<span class="missing">Missing</span>');
    const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
    const seal = d.seals.filter((s) => s.state === 'on').map((s) => s.number ?? '—').join(', ');
    const vgm = c.vgm
      ? `${c.vgm.kg.toLocaleString('en')} kg, method ${c.vgm.method}${c.vgm.weighbridge ? `, ${esc(c.vgm.weighbridge)}` : ''}${c.vgm.ticketRef ? `, ticket ${esc(c.vgm.ticketRef)}` : ''} — signed for by ${esc(c.vgm.signatory)}`
      : '';
    const papers = d.papers
      .map((p) => row(p.label, p.documentTitle || p.reference ? esc([p.documentTitle, p.reference].filter(Boolean).join(' — ')) : p.optional ? 'Not given (not every destination asks for it)' : missing()))
      .join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.code)} — handover at ${esc(c.loadingPort)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;color:#111;margin:24px auto;max-width:760px;padding:0 16px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}table{border-collapse:collapse;width:100%}th{text-align:left;font-weight:600;width:38%;padding:4px 8px 4px 0;vertical-align:top}td{padding:4px 0}.missing{color:#b00020;font-weight:600}.note{color:#555;font-size:12px;margin-top:18px}@media print{body{margin:0}}</style></head><body>
<h1>Handover at ${esc(c.loadingPort)} — ${esc(c.code)}</h1>
<div>${esc(exporter.name)} · ${esc(c.goodsDescription)} · ${esc(c.originCountry)} → ${esc(c.destCountry)}</div>
${d.missing.length ? `<p class="missing">Still missing: ${esc(d.missing.join('; '))}.</p>` : ''}
<h2>Booking</h2><table>${row('Booking number', esc(c.booking.reference))}${row(c.booking.bookedWith === 'shipping_line' ? 'Shipping line' : 'Forwarder', esc(c.booking.partyName))}${c.booking.vessel ? row('Vessel / voyage', esc(`${c.booking.vessel}${c.booking.voyage ? ` / ${c.booking.voyage}` : ''}`)) : ''}${row('Gate-in cut-off', esc(utc(c.booking.gateCutoffAt)))}${c.booking.vgmCutoffAt ? row('Verified gross mass cut-off', esc(utc(c.booking.vgmCutoffAt))) : ''}${c.booking.docsCutoffAt ? row('Documents cut-off', esc(utc(c.booking.docsCutoffAt))) : ''}${c.booking.emptyReleaseRef ? row('Empty release', esc(c.booking.emptyReleaseRef)) : ''}</table>
<h2>The box</h2><table>${row('Container number', missing(c.containerNo))}${row('Type', esc(spec ? `${spec.code} — ${spec.label}` : c.containerType ?? ''))}${row('Seal', missing(seal || undefined))}${row('Verified gross mass', missing(vgm || undefined))}</table>
<h2>Papers</h2><table>${papers}</table>
<h2>The road to the terminal</h2><table>${row('Terminal', esc(c.terminal.label))}${row('Road consignment note', d.ladenLeg ? esc(`CMR-${d.ladenLeg.code}`) : missing())}${row('Collected', d.timing.collectedAt ? esc(utc(d.timing.collectedAt)) : 'Not yet')}${row('Gated in', d.timing.gatedInAt ? esc(utc(d.timing.gatedInAt)) : 'Not yet')}${row('Bill of lading', c.billOfLading ? esc(c.billOfLading.number) : 'Not issued yet — recorded once your forwarder issues it')}</table>
<p class="note">Made on SeeBuyGet on ${esc(utc(new Date(now).toISOString()))}. SeeBuyGet carried the road leg; the ocean leg, its booking and the bill of lading are your forwarder’s or the line’s. The verified gross mass is the exporter’s declaration, handed to the forwarder — SeeBuyGet sends nothing to a line.</p>
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
      if (t.gatedInAt) continue;
      const cutoff = Date.parse(c.booking.gateCutoffAt);
      const warned = { ...(c.warned ?? {}) };
      if (!warned.pickup && !t.collectedAt && now < cutoff && now >= Date.parse(t.leaveByAt) - PICKUP_WARN_H * H) {
        warned.pickup = new Date(now).toISOString();
        this.tell(c, `${c.code}: the box must leave by ${utc(t.leaveByAt)}`, `To be inside the gate at ${c.terminal.label} before ${utc(c.booking.gateCutoffAt)}, a truck must leave ${c.loadingPlace.label} by ${utc(t.leaveByAt)}. ${c.ladenFreightId ? `No driver has collected load ${c.ladenFreightCode} yet.` : 'Post the load to the terminal now.'}`);
        told.push(`${c.code}:pickup`);
      }
      if (!warned.gate && now >= cutoff) {
        warned.gate = new Date(now).toISOString();
        this.tell(c, `${c.code}: the gate closed without the box`, `The gate-in cut-off at ${c.terminal.label} was ${utc(c.booking.gateCutoffAt)} and the box is not inside. Tell ${c.booking.partyName} at once: it may go on the next vessel, under a new cut-off.`);
        told.push(`${c.code}:gate`);
      }
      if (c.booking.vgmCutoffAt && !c.vgm && !warned.vgm && now >= Date.parse(c.booking.vgmCutoffAt) - VGM_WARN_H * H) {
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

  private tell(c: ExportConsignment, title: string, body: string): void {
    let did: string | undefined;
    try {
      did = this.entities.get(c.exporterEntityId).did;
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
