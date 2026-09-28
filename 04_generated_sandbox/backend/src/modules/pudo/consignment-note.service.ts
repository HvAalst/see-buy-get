import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { qrSvgGroup } from '../../foundation/label/qr';
import { MailService } from '../../foundation/mail/mail.service';
import { appUrl } from '../../foundation/mail/mail.templates';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { AccountService } from './account.service';
import { AgentService } from './agent.service';
import { DispatchService } from './dispatch.service';
import { Freight, FreightTrackView } from './dispatch.types';
import { DriverService } from './driver.service';
import { ImportService } from './import.service';
import { FleetManagerService } from './fleet-manager.service';
import { tempBand } from './heavy-cargo';
import { incotermEntry } from '../../foundation/incoterms/catalogue';
import { NETWORK_CURRENCY } from './pudo.config';
import { VendorService } from './vendor.service';
import { ConsignmentNote, NoteParty } from './consignment-note.types';
import { noteFingerprint } from './note-archive.types';
import { retentionFor, retentionWords } from './retention';

/**
 * Builds the consignment note for a load from what the network knows (see consignment-note.types.ts), renders it as
 * a printable page, decides who may read it, and — when the load is delivered — sends the shipper the receipt that
 * points at it.
 */
@Injectable()
export class ConsignmentNoteService implements OnModuleInit {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
    private readonly agents: AgentService,
    private readonly vendors: VendorService,
    private readonly events: EventBus,
    private readonly imports: ImportService,
    @Optional() private readonly accounts?: AccountService,
    @Optional() private readonly mail?: MailService,
  ) {}

  onModuleInit(): void {
    this.events.subscribe<{ freightId: string }>(GlosEvent.Pudo.FreightDelivered, (e) => void this.sendReceipt(e.payload.freightId));
  }

  /* ------------------------------------------------------------------ who may read it -- */

  /** The sender, the carrier (driver or their fleet), or network staff. Anyone else is told the load does not exist. */
  requireReader(freightId: string, actor: IntrospectionResult | undefined): Freight {
    const f = this.dispatch.requireFreightPublic(freightId) as Freight;
    if (actor?.role === 'operator') return f;
    const did = actor?.did;
    if (did && this.isParty(f, did)) return f;
    throw new GlosError('NOT_FOUND', 'Freight not found');
  }

  isParty(f: Freight, did: string): boolean {
    if (f.postedByDid === did || f.claimedBy === did) return true;
    if (f.shipperDid && this.shipperDidOf(f) === did) return true;
    if (f.claimedBy && this.managerOf(f.claimedBy) === did) return true;
    return false;
  }

  /**
   * The same set `isParty` tests against, as a list — for the archive, which has to freeze WHO may read a
   * document alongside the document. A frozen note outlives the relationships that produced it: a driver
   * leaves the fleet, a shop closes its account, and they are all still parties to a carriage that happened.
   */
  partiesOf(f: Freight): string[] {
    const dids = [f.postedByDid, f.claimedBy, this.shipperDidOf(f), f.claimedBy ? this.managerOf(f.claimedBy) : undefined];
    return [...new Set(dids.filter((d): d is string => Boolean(d)))];
  }

  /* ------------------------------------------------------------------ the note -- */

  noteFor(freightId: string): ConsignmentNote {
    return this.build(this.dispatch.requireFreightPublic(freightId) as Freight);
  }

  build(f: Freight): ConsignmentNote {
    const sender = this.senderOf(f);
    const carrier = this.carrierOf(f);
    const international = Boolean(f.pickupCountry && f.destCountry && f.pickupCountry !== f.destCountry);
    const volume = f.dimensionsCm ? Math.round(((f.dimensionsCm[0] * f.dimensionsCm[1] * f.dimensionsCm[2]) / 1_000_000) * 1000) / 1000 : undefined;
    const band = tempBand(f.natureCode);
    const documents: string[] = [];
    /*
     * THE CLEARANCE PACK FIRST, because that is what box 5 is for: the papers that travel WITH the
     * goods. A leg minted from a container carries the consignment's code as its external order id, and
     * the accepted papers hang off that — which is what makes this note the one place the information
     * gathers rather than a fifth place somebody has to type it.
     */
    if (f.externalOrderId) documents.push(...this.imports.papersOnNote(f.externalOrderId));
    if (f.loadSafety?.securementPhotoRef) documents.push(`Photo of the secured load (${f.loadSafety.securementPhotoRef})`);
    if (f.tempReadings?.length) documents.push(`Temperature log, ${f.tempReadings.length} reading(s)`);
    if (f.unloadReport) documents.push(`Unload report, ${f.unloadReport.confirmed.length} item(s) confirmed`);
    if (f.proofOfDelivery?.photoRef) documents.push(`Photo of the goods as delivered (${f.proofOfDelivery.photoRef})`);
    const instructions: string[] = [];
    if (band) instructions.push(`Keep between ${band.minC} °C and ${band.maxC} °C`);
    if (f.fragile) instructions.push('Fragile — handle with care');
    if (f.indivisible) instructions.push('Indivisible load — do not split');
    if (f.requiredEquipment?.length) instructions.push(`Equipment required: ${f.requiredEquipment.join(', ')}`);
    if (f.scheduledPickupAt) instructions.push(`Taking over booked for ${when(f.scheduledPickupAt)}`);
    // FP7 — what the sender actually wrote, after what the load's facts imply; then every subsequent instruction, dated.
    if (f.instructions?.deliveryWindow) instructions.push(`Deliver: ${f.instructions.deliveryWindow}`);
    if (f.instructions?.contactName || f.instructions?.contactPhone) instructions.push(`Contact at delivery: ${[f.instructions.contactName, f.instructions.contactPhone].filter(Boolean).join(', ')}`);
    if (f.instructions?.text) instructions.push(f.instructions.text);
    for (const a of f.instructionAmendments ?? []) instructions.push(`Subsequent instruction, ${when(a.at)}: ${a.text}`);
    const reservations: string[] = [];
    if (f.reservations) reservations.push(`At taking over: ${f.reservations.note}`);
    if (f.tempBreached) reservations.push('Cold chain breached in transit — see the temperature log');
    const carriage = this.carriageOf(f);
    const attempts = (f.deliveryAttempts ?? []).map((a) => `Delivery attempted ${when(a.at)}: ${a.outcome === 'absent' ? 'nobody to receive the goods' : a.outcome === 'refused' ? 'the receiver refused the goods' : 'the place could not be reached'}${a.note ? ` — ${a.note}` : ''}`);
    const claim = f.claim
      ? {
          line: `Claim by the sender ${when(f.claim.raisedAt)} — goods ${f.claim.kind === 'damaged' ? 'damaged' : f.claim.kind === 'short' ? 'short' : 'not received'}: ${f.claim.description}`,
          ...(f.claim.state === 'resolved' && f.claim.decision
            ? { decision: `Decided ${when(f.claim.decidedAt ?? f.claim.raisedAt)}: ${f.claim.decision === 'upheld' ? 'upheld' : f.claim.decision === 'partly_upheld' ? 'upheld in part' : 'rejected'}${f.claim.award ? `, ${f.claim.award} ${NETWORK_CURRENCY} awarded` : f.claim.paidTo?.kind === 'between_parties' ? ', to be settled between sender and carrier' : ''}${f.claim.note ? ` — ${f.claim.note}` : ''}` }
            : {}),
        }
      : undefined;
    return {
      number: `CMR-${f.code}`,
      kind: international ? 'cmr' : 'national',
      title: international ? 'CMR — International consignment note' : 'Consignment note (CMR layout)',
      freightId: f.freightId,
      code: f.code,
      trackingKey: f.trackingKey,
      status: f.status,
      sender,
      consignee: this.consigneeOf(f),
      delivery: { place: f.destLabel, ...(f.destCountry ? { country: countryName(f.destCountry) } : {}), ...(f.deliveredAt ? { at: f.deliveredAt } : {}) },
      takingOver: { place: f.pickupLabel, ...(f.pickupCountry ? { country: countryName(f.pickupCountry) } : {}), ...(f.pickedUpAt ? { at: f.pickedUpAt } : {}) },
      documents,
      goods: {
        description: f.description,
        nature: f.natureCode ?? 'GEN',
        cargoClass: f.cargoClass,
        ...(f.packaging ? { packaging: f.packaging } : {}),
        packages: f.indivisible ? 1 : null,
        grossKg: f.weightKg,
        ...(volume ? { volumeM3: volume } : {}),
        dangerous: (f.requiredCapabilities ?? []).includes('hazmat'),
        ...(band ? { temperatureBand: `${band.minC} °C to ${band.maxC} °C` } : {}),
        fragile: Boolean(f.fragile),
      },
      instructions,
      carriage,
      ...(carrier ? { carrier } : {}),
      // A door the carrier stood at and could not hand over at is the carrier's observation: box 18, for good.
      reservations: [...reservations, ...attempts],
      attempts,
      ...(claim ? { claim } : {}),
      established: { place: f.pickupLabel, at: f.createdAt },
      confirmations: {
        sender: { by: sender.name, at: f.createdAt, how: 'Confirmed electronically at posting' },
        ...(f.pickedUpAt && carrier ? { carrier: { by: carrier.driverName ?? carrier.name, at: f.pickedUpAt, how: 'Confirmed electronically at taking over, after the load-safety check' } } : {}),
        ...(f.proofOfDelivery
          ? { consignee: { by: f.proofOfDelivery.receiverName, at: f.proofOfDelivery.at, how: f.proofOfDelivery.photoRef ? 'Received in person; name recorded by the driver at delivery, with a photo of the goods as delivered' : 'Received in person; name recorded by the driver at delivery', ...(f.proofOfDelivery.remarks ? { remarks: `Receiver’s remarks: ${f.proofOfDelivery.remarks}` } : {}) } }
          : f.deliveredAt
            ? { consignee: { by: 'Receiver — confirmation not recorded', at: f.deliveredAt, how: 'Delivery recorded by the carrier with the unload report; the receiver’s own confirmation is not yet part of this note' } }
            : {}),
      },
      ...(f.cancellation ? { cancelled: { at: f.cancellation.at, reason: f.cancellation.reason, by: f.cancellation.role === 'operator' ? 'network' : 'sender' } } : {}),
      ...(f.trackingKey ? { trackingUrl: `${appUrl('send')}?track=${encodeURIComponent(f.trackingKey)}` } : {}),
    };
  }

  /**
   * FP6 — the load as the holder of its tracking link sees it. Built beside the note because the note already
   * knows the parties; what leaves here is the subset a stranger with the link may see: the journey, the carrier
   * as they would meet them at the door, who signed. No phone, no money, no reasons, no proposals.
   */
  trackView(f: Freight): FreightTrackView {
    const carrier = this.carrierOf(f);
    const steps: FreightTrackView['steps'] = [{ status: f.scheduledPickupAt ? 'scheduled' : 'available', at: f.createdAt }];
    if (f.claimedAt) steps.push({ status: 'claimed', at: f.claimedAt });
    if (f.pickedUpAt) steps.push({ status: 'in_transit', at: f.pickedUpAt });
    if (f.deliveredAt) steps.push({ status: 'delivered', at: f.deliveredAt });
    if (f.cancellation) steps.push({ status: 'cancelled', at: f.cancellation.at });
    return {
      kind: 'freight',
      ref: f.code,
      status: f.status,
      description: f.description,
      weightKg: f.weightKg,
      pickupLabel: f.pickupLabel,
      destLabel: f.destLabel,
      ...(f.destLocation ? { destLocation: f.destLocation } : {}),
      ...(f.scheduledPickupAt ? { scheduledPickupAt: f.scheduledPickupAt } : {}),
      ...(carrier ? { carrier: { name: carrier.name, ...(carrier.driverName ? { driverName: carrier.driverName } : {}), ...(carrier.plate ? { plate: carrier.plate } : {}), ...(carrier.vehicleClass ? { vehicleClass: carrier.vehicleClass } : {}) } } : {}),
      steps,
      ...(f.deliveryAttempts?.length ? { attempts: f.deliveryAttempts.map((a) => ({ outcome: a.outcome, at: a.at })) } : {}),
      ...(f.proofOfDelivery?.receiverName ? { receiverName: f.proofOfDelivery.receiverName } : {}),
      ...(f.cancellation ? { cancelled: { at: f.cancellation.at, by: f.cancellation.role === 'operator' ? 'network' : 'sender' } } : {}),
    };
  }

  /* ------------------------------------------------------------------ the parties -- */

  private shipperDidOf(f: Freight): string | undefined {
    if (!f.shipperDid) return undefined;
    return this.vendors.has(f.shipperDid) ? this.vendors.get(f.shipperDid).did : f.shipperDid;
  }

  private managerOf(driverDid: string): string | undefined {
    try {
      return this.drivers.get(driverDid).managerDid ?? undefined;
    } catch {
      return undefined;
    }
  }

  private senderOf(f: Freight): NoteParty {
    // A CONTAINER's road leg: the importer is the sender. Asked first, because such a leg carries no
    // shipper DID at all and would otherwise fall through to the placeholder at the bottom.
    const parties = f.externalOrderId ? this.imports.noteParties(f.externalOrderId) : null;
    if (parties) return { name: parties.sender.name, ...(parties.sender.country ? { country: countryName(parties.sender.country) } : {}) };
    // A store's order: the store is the sender, whoever pressed the button.
    if (f.shipperDid && this.vendors.has(f.shipperDid)) {
      const v = this.vendors.get(f.shipperDid);
      return { name: v.name, ...(v.address ? { address: v.address } : {}), country: countryName(v.country), did: v.did };
    }
    const did = f.postedByDid ?? f.shipperDid;
    if (did) {
      const shop = this.agentOrNone(did);
      if (shop) return shop;
      return { name: 'Sender', did };
    }
    return { name: 'Sender not recorded' };
  }

  private consigneeOf(f: Freight): NoteParty {
    // Before the buyer reading below, which would otherwise invent "the buyer of order IMP-097" for a
    // container nobody has sold. `externalOrderId` carries a shop order OR a consignment code, and only
    // the import register can tell them apart.
    const parties = f.externalOrderId ? this.imports.noteParties(f.externalOrderId) : null;
    if (parties) {
      return {
        name: parties.consignee.name,
        address: f.destLabel,
        ...(parties.consignee.country ? { country: countryName(parties.consignee.country) } : {}),
      };
    }
    if (f.externalOrderId || f.buyerPhoneHash) {
      // A buyer: known to the network by a verified phone, never printed here. Delivery is to the shop they chose.
      return { name: f.externalOrderId ? `The buyer of order ${f.externalOrderId}` : 'The buyer', address: `Collects at ${f.destLabel}`, ...(f.destCountry ? { country: countryName(f.destCountry) } : {}) };
    }
    return { name: f.destLabel, address: 'As named by the sender', ...(f.destCountry ? { country: countryName(f.destCountry) } : {}) };
  }

  private carrierOf(f: Freight): ConsignmentNote['carrier'] | undefined {
    if (!f.claimedBy) return undefined;
    let driverName: string | undefined;
    let managerDid: string | undefined;
    let jurisdiction: string | undefined;
    try {
      const d = this.drivers.get(f.claimedBy);
      driverName = d.displayName;
      managerDid = d.managerDid ?? undefined;
      jurisdiction = d.jurisdiction ?? undefined;
    } catch {
      /* a carrier the network no longer knows is still named by its identity below */
    }
    const vehicle = f.carriage ? { plate: f.carriage.plate, vehicleClass: f.carriage.vehicleClass } : {};
    if (managerDid) {
      try {
        const m = this.managers.get(managerDid);
        return { name: m.companyName, ...(m.depotAddress ? { address: m.depotAddress } : {}), ...(m.jurisdiction ? { country: countryName(m.jurisdiction) } : {}), did: m.did, ...(driverName ? { driverName } : {}), ...vehicle };
      } catch {
        /* fall through to the driver as an independent carrier */
      }
    }
    return { name: driverName ?? 'Carrier', ...(jurisdiction ? { country: countryName(jurisdiction) } : {}), did: f.claimedBy, ...(driverName ? { driverName } : {}), ...vehicle };
  }

  private agentOrNone(did: string): NoteParty | undefined {
    try {
      const a = this.agents.get(did);
      return { name: a.shopName, address: a.physicalAddress ?? a.landmark, ...(a.country ? { country: countryName(a.country) } : {}), did: a.did };
    } catch {
      return undefined;
    }
  }

  private carriageOf(f: Freight): ConsignmentNote['carriage'] {
    // CL1 — the agreed term decides who BEARS the carriage, which is the carriage-level shadow of it and the
    // only part of a sale term that belongs on a carriage document. The term itself is not a box of the CMR.
    const term = incotermEntry(f.incoterm);
    const borne = term ? (term.riskPassesAt === 'origin' && term.code !== 'CPT' && term.code !== 'CIP' && term.code !== 'CFR' && term.code !== 'CIF' ? 'collect' : 'prepaid') : undefined;
    const termNote = term ? ' Agreed ' + term.code + (f.namedPlace ? ' ' + f.namedPlace : '') + ', so carriage is ' + (borne === 'collect' ? 'COLLECT (payable by the consignee).' : 'PREPAID (borne by the sender).') : '';
    if (f.lockedPrice == null) return { paidBy: 'not-priced', note: 'Carriage charges not yet agreed' + termNote };
    if (!f.shipperDid) return { amount: f.lockedPrice, currency: NETWORK_CURRENCY, paidBy: 'between-parties', note: 'Carriage charges settled between sender and carrier; the network holds no money for this load.' + termNote };
    return { amount: f.lockedPrice, currency: NETWORK_CURRENCY, paidBy: 'sender', note: 'Carriage charges paid by the sender through SeeBuyGet.' + termNote };
  }

  /* ------------------------------------------------------------------ the receipt -- */

  /** The load is delivered: the shipper is told, with the charge and where the note is. A shop has an email; a store's system hears through its callbacks. */
  private async sendReceipt(freightId: string): Promise<void> {
    if (!this.mail || !this.accounts) return;
    try {
      const f = this.dispatch.requireFreightPublic(freightId) as Freight;
      const shipperDid = this.shipperDidOf(f) ?? f.postedByDid;
      if (!shipperDid) return;
      const email = this.accounts.emailForDid(shipperDid);
      if (!email) return;
      const note = this.build(f);
      await this.mail.send('freight-delivered', { address: email, name: note.sender.name }, {
        code: f.code,
        description: f.description,
        destination: f.destLabel,
        deliveredAt: f.deliveredAt ?? new Date().toISOString(),
        ...(f.proofOfDelivery ? { receiverName: f.proofOfDelivery.receiverName } : {}),
        carrier: note.carrier?.name ?? 'the carrier',
        ...(note.carrier?.driverName ? { driver: note.carrier.driverName } : {}),
        ...(note.carriage.amount != null ? { amount: note.carriage.amount, currency: note.carriage.currency ?? NETWORK_CURRENCY } : {}),
        noteNumber: note.number,
      });
    } catch {
      /* a receipt that cannot be sent never fails a delivery */
    }
  }

  /* ------------------------------------------------------------------ the page -- */

  htmlFor(n: ConsignmentNote): string {
    const e = escapeHtml;
    const party = (p: NoteParty | undefined, extra?: string) =>
      p ? `<b>${e(p.name)}</b>${p.address ? `<br>${e(p.address)}` : ''}${p.country ? `<br>${e(p.country)}` : ''}${extra ? `<br>${extra}` : ''}${p.did ? `<br><span class="did">${e(p.did)}</span>` : ''}` : '<span class="empty">—</span>';
    const list = (xs: string[]) => (xs.length ? xs.map((x) => `<div>${e(x)}</div>`).join('') : '<span class="empty">None</span>');
    const box = (no: number | string, label: string, body: string, cls = '') => `<div class="box ${cls}"><div class="box__h"><span class="no">${no}</span>${e(label)}</div><div class="box__b">${body}</div></div>`;
    const conf = (c: ConsignmentNote['confirmations']['sender'] | undefined, missing: string) =>
      c ? `<b>${e(c.by)}</b><br>${e(when(c.at))}<br><span class="how">${e(c.how)}</span>${c.remarks ? `<br>${e(c.remarks)}` : ''}` : `<span class="empty">${e(missing)}</span>`;
    const cancelledLine = n.cancelled ? `Cancelled by the ${n.cancelled.by} ${when(n.cancelled.at)} — ${n.cancelled.reason}` : '';
    // Box 24 before delivery: every failed attempt, then the honest gap. After: the confirmation, then the claim.
    const box24missing = n.cancelled ? cancelledLine : n.attempts.length ? `Not yet delivered — ${n.attempts.length} attempt(s), see box 18` : 'Not yet delivered';
    const claimLines = n.claim ? `<div class="claim"><b>${e(n.claim.line)}</b>${n.claim.decision ? `<br>${e(n.claim.decision)}` : '<br><span class="empty">Not yet decided</span>'}</div>` : '';
    const qr = n.trackingUrl ? `<svg viewBox="0 0 120 120" width="120" height="120" aria-label="Tracking code">${qrSvgGroup(n.trackingUrl, 0, 0, 120)}</svg>` : '';
    const g = n.goods;
    const carrierExtra = [n.carrier?.driverName ? `Driver: ${e(n.carrier.driverName)}` : '', n.carrier?.plate ? `Vehicle: ${e(n.carrier.plate)}${n.carrier.vehicleClass ? ` (${e(n.carrier.vehicleClass)})` : ''}` : ''].filter(Boolean).join('<br>');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(n.number)} — ${e(n.title)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font: 12px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; background: #fff; }
  .sheet { max-width: 800px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 10px; }
  h1 { font-size: 18px; margin: 0; letter-spacing: .02em; }
  .sub { color: #444; margin: 4px 0 0; font-size: 11px; max-width: 60ch; }
  .num { font: 700 16px/1.2 ui-monospace, Menlo, Consolas, monospace; text-align: right; }
  .num small { display: block; font: 11px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif; color: #444; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid #111; }
  .box { border: 1px solid #111; margin: -1px 0 0 -1px; padding: 6px 8px; min-height: 58px; break-inside: avoid; }
  .box.wide { grid-column: 1 / -1; }
  .box__h { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #444; margin-bottom: 4px; }
  .no { display: inline-block; min-width: 18px; font-weight: 700; color: #111; margin-right: 6px; }
  .box__b { font-size: 12px; }
  .empty { color: #777; }
  .did, .how { color: #555; font-size: 10px; word-break: break-all; }
  .claim { margin-top: 6px; padding-top: 6px; border-top: 1px dashed #999; }
  table.goods { width: 100%; border-collapse: collapse; }
  table.goods th, table.goods td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #ccc; vertical-align: top; font-size: 12px; }
  table.goods th { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #444; }
  footer { margin-top: 10px; font-size: 10px; color: #555; display: flex; justify-content: space-between; gap: 12px; }
  /* The fingerprint of this exact copy. Four parties holding four printed sheets can compare one line
     and know whether they are holding the same document — which is the thing paper did by being paper. */
  .fp { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8px; color: #777; word-break: break-all; }
  .status { display: inline-block; padding: 1px 8px; border: 1px solid #111; border-radius: 10px; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
  @media print { body { padding: 0; } }
</style></head><body><div class="sheet">
<header>
  <div>
    <h1>${e(n.title)}</h1>
    <p class="sub">${n.kind === 'cmr' ? 'This carriage is subject to the Convention on the Contract for the International Carriage of Goods by Road (CMR), notwithstanding any clause to the contrary.' : 'Same layout and numbering as the CMR note, used for every consignment on the network — including where no national form exists.'}</p>
    <p class="sub"><span class="status">${e(n.status.replace('_', ' '))}</span></p>
  </div>
  <div class="num">${e(n.number)}<small>Load ${e(n.code)}${n.trackingKey ? ` · Tracking ${e(n.trackingKey)}` : ''}</small>${qr}</div>
</header>
<div class="grid">
  ${box(1, 'Sender (name, address, country)', party(n.sender))}
  ${box(16, 'Carrier (name, address, country)', party(n.carrier, carrierExtra) || '')}
  ${box(2, 'Consignee (name, address, country)', party(n.consignee))}
  ${box(17, 'Successive carriers', '<span class="empty">None</span>')}
  ${box(3, 'Place of delivery of the goods (place, country)', `<b>${e(n.delivery.place)}</b>${n.delivery.country ? `<br>${e(n.delivery.country)}` : ''}${n.delivery.at ? `<br>Delivered ${e(when(n.delivery.at))}` : ''}`)}
  ${box(18, 'Carrier’s reservations and observations', list(n.reservations))}
  ${box(4, 'Place and date of taking over the goods (place, country, date)', `<b>${e(n.takingOver.place)}</b>${n.takingOver.country ? `<br>${e(n.takingOver.country)}` : ''}<br>${n.takingOver.at ? e(when(n.takingOver.at)) : '<span class="empty">Not yet taken over</span>'}`)}
  ${box(19, 'Special agreements', n.kind === 'cmr' ? '<span class="empty">None</span>' : 'Carried under the network’s terms; this note stands as the consignment note where no national form applies.')}
  ${box(5, 'Documents attached', list(n.documents))}
  ${box(20, 'To be paid by', `${n.carriage.amount != null ? `<b>${e(String(n.carriage.amount))} ${e(n.carriage.currency ?? '')}</b><br>` : ''}${e(n.carriage.note)}`)}
  ${box('6–12', 'Goods', `<table class="goods"><tr><th>Marks / description</th><th>Packages</th><th>Method of packing</th><th>Nature of the goods</th><th>Gross weight</th><th>Volume</th></tr><tr><td>${e(g.description)}${g.fragile ? '<br><i>Fragile</i>' : ''}${g.dangerous ? '<br><b>Dangerous goods</b>' : ''}</td><td>${g.packages == null ? '<span class="empty">Not stated</span>' : g.packages}</td><td>${g.packaging ? e(g.packaging) : '<span class="empty">—</span>'}</td><td>${e(g.nature)} · ${e(g.cargoClass)}${g.temperatureBand ? `<br>${e(g.temperatureBand)}` : ''}</td><td>${e(String(g.grossKg))} kg</td><td>${g.volumeM3 != null ? `${e(String(g.volumeM3))} m³` : '<span class="empty">—</span>'}</td></tr></table>`, 'wide')}
  ${box(13, 'Sender’s instructions', list(n.instructions))}
  ${box(14, 'Instructions as to payment for carriage', e(n.carriage.paidBy === 'sender' ? 'Carriage paid' : n.carriage.paidBy === 'between-parties' ? 'Carriage settled between the parties' : 'Not yet agreed'))}
  ${box(21, 'Established in / on', `<b>${e(n.established.place)}</b><br>${e(when(n.established.at))}`)}
  ${box(15, 'Cash on delivery', '<span class="empty">None — the network never collects cash on delivery</span>')}
  ${box(22, 'Signature and stamp of the sender', conf(n.confirmations.sender, ''))}
  ${box(23, 'Signature and stamp of the carrier', conf(n.confirmations.carrier, n.cancelled ? 'Never taken over — the load was cancelled' : 'Not yet taken over'))}
  ${box(24, 'Goods received — signature and stamp of the consignee', (n.confirmations.consignee ? conf(n.confirmations.consignee, '') : `<span class="empty">${box24missing}</span>`) + claimLines, 'wide')}
</div>
<footer><span>Issued by the SeeBuyGet network from its records of this load. Every box is filled from a recorded act; a box that says it is not recorded is not recorded.<br>${e(retentionWords(retentionFor({ finishedAt: n.delivery.at, hasClaim: Boolean(n.claim) })))}</span><span>${e(n.number)}<br><span class="fp">${e(noteFingerprint(n))}</span><br><span class="fp">Check this copy: ${e(`${appUrl('home')}?note=${noteFingerprint(n)}`)}</span></span></footer>
</div></body></html>`;
  }
}

function countryName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return catalogueEntry(code)?.name ?? code;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

export function escapeHtml(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
