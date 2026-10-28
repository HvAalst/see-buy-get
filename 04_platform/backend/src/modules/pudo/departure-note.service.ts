import { EntityService } from '../../foundation/entity/entity.service';
import { Injectable, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { ConsignmentNoteService, agentConfirmation, reloadLine } from './consignment-note.service';
import { DepartureService } from './departure.service';
import { CargoService } from './cargo.service';
import { AgentService } from './agent.service';
import { VendorService } from './vendor.service';
import type { ConsignmentNote, NoteParty } from './consignment-note.types';
import type { Departure, DepartureBooking } from './departure.types';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { actingDid } from '../../foundation/auth/acting';

/** The same wording the board's note dates its boxes in. */
function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * A RUN'S BOOKING, ON THE SAME CONSIGNMENT NOTE THE BOARD ALREADY USES.
 *
 * The user's rule for FP2 was: implement the CMR, and let it be the standard where there is no standard.
 * That rule did not stop applying because the load arrived through a different door. A booking on a fleet's
 * own run is a contract of carriage — goods handed to a carrier, moved for a price, handed to somebody at
 * the other end — and until now it was the only kind of carriage on this network that produced no document
 * at all. Domestically, between people who know each other, a receipt does. Across a border a note is not
 * a nicety; it is what the goods travel on.
 *
 * THIS BUILDS THE SAME SHAPE AND REUSES THE SAME RENDERER. Not a second note, not a second layout, not a
 * second set of box numbers: `ConsignmentNoteService.htmlFor` prints this one exactly as it prints a
 * board haul's, because a shipper comparing the two should find one product.
 *
 * What differs is only what is TRUE of a run, and the note says so rather than filling the box:
 *
 *  - CARRIAGE IS NOT PRICED BY US. The board's note can say the network billed the sender. Here the fleet
 *    quoted and the shipper pays them directly, so box 14 says exactly that, with the settlement terms.
 *  - COVER IS THE CARRIER'S, OR NOBODY'S. It goes in box 13 beside the declared value, because those two
 *    numbers side by side are the whole of what a forwarder needs and neither is a promise of ours.
 *  - THE CONSIGNEE IS OFTEN UNKNOWN until the goods arrive. A run sells space, not a door; the note says
 *    "not stated" rather than inventing a party, and box 24 names whoever actually took them.
 */
@Injectable()
export class DepartureNoteService {
  constructor(
    private readonly departures: DepartureService,
    private readonly notes: ConsignmentNoteService,
    private readonly cargo: CargoService,
    private readonly agents: AgentService,
    private readonly vendors: VendorService,
    // B2 — a customer's business is named as the sender. Optional so the specs that build this by hand keep compiling.
    @Optional() private readonly entities?: EntityService,
  ) {}

  /**
   * The note, for a party to this carriage and nobody else.
   *
   * A consignment note names both sides and describes the goods, so it is not a public document — the same
   * stance the board's note takes. The shipper, the carrier, the driver who moved it, and an operator.
   */
  requireReader(departureId: string, bookingId: string, actor: IntrospectionResult | undefined): { departure: Departure; booking: DepartureBooking } {
    const departure = this.departures.require(departureId);
    const booking = departure.bookings.find((b) => b.bookingId === bookingId);
    if (!booking) throw new GlosError('NOT_FOUND', 'No such booking');
    if (actor?.role === 'operator') return { departure, booking };
    // actingDid throws its own generic refusal on a request with no actor at all. A note has a better
    // sentence for that case than "no actor identity", so the absence is answered here.
    const who = actor ? actingDid(actor) : undefined;
    const party = who && (who === booking.shipperDid || who === departure.managerDid || who === departure.driverDid);
    if (!party) throw new GlosError('FORBIDDEN', 'A consignment note names both sides of a carriage — only the parties to it may read it');
    return { departure, booking };
  }

  html(departureId: string, bookingId: string, actor: IntrospectionResult | undefined): string {
    const { departure, booking } = this.requireReader(departureId, bookingId, actor);
    return this.notes.htmlFor(this.build(departure, booking));
  }

  note(departureId: string, bookingId: string, actor: IntrospectionResult | undefined): ConsignmentNote {
    const { departure, booking } = this.requireReader(departureId, bookingId, actor);
    return this.build(departure, booking);
  }

  build(departure: Departure, booking: DepartureBooking): ConsignmentNote {
    const sender = this.senderOf(booking);
    // B4 — the business that booked it for a client, named as their agent.
    const agentEntity = booking.onBehalfOf ? this.entities?.byDid(booking.shipperDid) : undefined;
    const agent = agentEntity ? { name: agentEntity.name, ...(agentEntity.jurisdiction ? { country: agentEntity.jurisdiction } : {}), did: agentEntity.did } : undefined;
    const spec = this.cargo.classify({ kg: booking.weightKg });
    const capabilities = this.cargo.requiredCapabilities([booking.nature]);

    /*
     * BOX 5 — the papers that travel WITH the goods, which on a run are the photographs.
     *
     * Same list the board's note carries, from the same acts: what the driver confirmed and photographed
     * at the loading gate, and what they confirmed and photographed at the door.
     */
    const documents: string[] = [];
    if (booking.loadSafety?.securementPhotoRef) documents.push(`Photo of the secured load (${booking.loadSafety.securementPhotoRef})`);
    if (booking.loadSafety?.confirmed.length) documents.push(`Load-safety checklist, ${booking.loadSafety.confirmed.length} item(s) confirmed`);
    if (booking.pod?.confirmed.length) documents.push(`Unload checklist, ${booking.pod.confirmed.length} item(s) confirmed`);
    if (booking.pod?.photoRef) documents.push(`Photo of the goods as delivered (${booking.pod.photoRef})`);

    /*
     * BOX 13 — what the sender declared, and where cover actually stands.
     *
     * The declared value and the carrier's policy limit go here TOGETHER, because either alone is a
     * half-truth: a value with no cover reads as insured, and a limit with no value reads as sufficient.
     * Side by side they are the gap, stated, which is the most this network can honestly offer.
     */
    const instructions: string[] = [];
    if (capabilities.includes('coldChain')) instructions.push('Temperature-controlled goods — keep the chain');
    if (capabilities.includes('hazmat')) instructions.push('Dangerous goods — carried under the carrier’s own hazmat authority');
    if (booking.nature === 'FRG') instructions.push('Fragile — handle with care');
    instructions.push(
      booking.declaredValue != null
        ? `Value declared by the sender: ${booking.declaredValue} ${departure.rate.currency}. Not verified by SeeBuyGet.`
        : 'The sender declared no value for these goods.',
    );
    instructions.push(
      departure.cover
        ? departure.cover.limit > 0
          ? `Carrier’s goods-in-transit cover: up to ${departure.cover.limit} ${departure.rate.currency} per load${departure.cover.policy ? ` (${departure.cover.policy})` : ''}. SeeBuyGet carries no cover on these goods.`
          : 'The carrier states they hold no goods-in-transit cover. SeeBuyGet carries none either — these goods travel uninsured unless the sender has arranged their own.'
        : 'The carrier has not stated what cover they hold. SeeBuyGet carries none — ask the carrier before the goods travel.',
    );

    const reservations: string[] = [];
    for (const w of booking.waiting) {
      if (w.billableMin > 0) {
        reservations.push(`Held ${w.waitedMin} min at ${w.where === 'loading' ? 'taking over' : 'delivery'}, ${w.billableMin} min beyond the free window`);
      }
    }
    if (booking.pod?.remarks) reservations.push(`At delivery: ${booking.pod.remarks}`);
    // A run that went on in another truck after a breakdown: written here, and nowhere else.
    for (const r of departure.reloads ?? []) reservations.push(reloadLine(r));

    // Box 16 names the truck and driver the goods were taken over in; a later reload is box 18's.
    const first = departure.reloads?.[0];
    const takenOverIn = first ? { driverName: first.fromDriverName, plate: first.fromPlate, vehicleClass: first.fromVehicleClass } : { driverName: departure.driverName, plate: departure.plate, vehicleClass: departure.vehicleClass };
    const carrier: ConsignmentNote['carrier'] = {
      name: departure.company,
      did: departure.managerDid,
      ...(takenOverIn.driverName ? { driverName: takenOverIn.driverName } : {}),
      plate: takenOverIn.plate,
      vehicleClass: takenOverIn.vehicleClass,
    };

    return {
      number: `CMR-${booking.bookingId.replace(/^bkg_/, '').toUpperCase()}`,
      // A run is a domestic line unless somebody says otherwise; a corridor holds zones, not countries, so
      // the honest default is the national layout rather than a claim about a border we cannot see.
      kind: 'national',
      title: 'Consignment note (CMR layout)',
      freightId: booking.bookingId,
      code: booking.bookingId,
      status: booking.status,
      sender,
      ...(agent ? { agent } : {}),
      // A run sells SPACE, not a door. Inventing a consignee would be the one lie on an otherwise honest
      // page; box 24 names whoever actually took the goods.
      consignee: { name: 'Not stated — space booked on a scheduled run' },
      delivery: { place: departure.destZone, ...(booking.deliveredAt ? { at: booking.deliveredAt } : {}) },
      takingOver: { place: departure.originZone, at: departure.leavesAt },
      documents,
      goods: {
        description: booking.description,
        nature: booking.nature,
        cargoClass: spec,
        packages: null,
        grossKg: booking.weightKg,
        ...(booking.volumeM3 != null ? { volumeM3: booking.volumeM3 } : {}),
        dangerous: capabilities.includes('hazmat'),
        fragile: booking.nature === 'FRG',
      },
      instructions,
      /*
       * BOX 14 — and this is the box that had to be written differently.
       *
       * A board haul is priced by the network and billed to the sender, so its note can say so. Here the
       * fleet quoted their own price and the shipper pays them directly: we are not the merchant of
       * record and there is no invoice of ours behind this number. `between-parties` is the existing
       * vocabulary for exactly that, and the note says it in words as well.
       */
      carriage: {
        amount: booking.kind === 'own' ? undefined : booking.price,
        currency: departure.rate.currency,
        paidBy: booking.kind === 'own' ? 'not-priced' : 'between-parties',
        note:
          booking.kind === 'own'
            ? 'Carried for the carrier’s own customer. Not priced or billed through SeeBuyGet.'
            : `Agreed between sender and carrier at ${booking.price} ${departure.rate.currency}${this.settleWords(departure)}. SeeBuyGet does not bill or hold this payment.`,
      },
      carrier,
      reservations,
      established: { place: departure.originZone, at: booking.at },
      confirmations: {
        sender: { by: agentConfirmation(booking.bookedByName, agent, sender), at: booking.at, how: 'Booked electronically on SeeBuyGet' },
        ...(booking.loadSafety
          ? { carrier: { by: takenOverIn.driverName ?? departure.company, at: booking.loadSafety.at, how: 'Load-safety checklist confirmed electronically' } }
          : {}),
        ...(booking.pod
          ? {
              consignee: {
                by: booking.pod.receiverName,
                at: booking.pod.at,
                how: 'Recorded at the door by the carrier, with a photograph',
                ...(booking.pod.remarks ? { remarks: booking.pod.remarks } : {}),
              },
            }
          : {}),
      },
      attempts: [],
      /*
       * BOX 24 — the claim, and what the carrier said back.
       *
       * The board prints a DECISION here because an operator made one. There is none to print: we did
       * not take the money and we carry no cover, so nobody here is entitled to decide between them.
       * What goes in its place is the carrier’s own answer in their own words, which is the thing a
       * forwarder, an insurer or a magistrate actually needs off this page.
       */
      ...(booking.claim
        ? {
            claim: {
              line: `Claim by the sender ${when(booking.claim.raisedAt)} — goods ${booking.claim.kind === 'damaged' ? 'damaged' : booking.claim.kind === 'short' ? 'short' : 'not received'}: ${booking.claim.description}${booking.claim.amount != null ? ` (claimed at ${booking.claim.amount} ${departure.rate.currency})` : ''}`,
              ...(booking.claim.answeredAt
                ? {
                    decision: `The carrier ${booking.claim.answer === 'accepted' ? 'accepted' : 'refused'} it ${when(booking.claim.answeredAt)}${booking.claim.answerNote ? ` — ${booking.claim.answerNote}` : ''}. Settled between sender and carrier; SeeBuyGet neither decides nor pays.`,
                  }
                : {}),
            },
          }
        : {}),
      ...(departure.status === 'cancelled'
        ? { cancelled: { at: departure.leavesAt, reason: departure.cancelledReason ?? 'The carrier called the run off', by: 'network' as const } }
        : {}),
    };
  }

  /** The settlement terms as half a sentence, for box 14. Silent where the carrier has not said. */
  private settleWords(departure: Departure): string {
    if (!departure.settle) return '';
    const method =
      departure.settle.method === 'cash'
        ? 'in cash'
        : departure.settle.method === 'mobile_money'
          ? 'by mobile money'
          : departure.settle.method === 'bank'
            ? 'by bank transfer'
            : 'as the two parties arrange';
    const when =
      departure.settle.when === 'on_pickup' ? 'on taking over' : departure.settle.when === 'on_delivery' ? 'on delivery' : 'after delivery';
    return `, payable ${method} ${when}`;
  }

  /**
   * Box 1 — the sender, by name where we hold one.
   *
   * A shop and a store both ship; both are resolved the way the board's note resolves them. The fleet's
   * OWN customer has no account here at all, so the note names them as the fleet filed them and says who
   * put them on the truck — which is the honest version of a party we cannot verify.
   */
  private senderOf(booking: DepartureBooking): NoteParty {
    // B4 — booked by an expeditor for a client: the CLIENT is the sender.
    if (booking.onBehalfOf) return { name: booking.onBehalfOf.name, ...(booking.onBehalfOf.address ? { address: booking.onBehalfOf.address } : {}), ...(booking.onBehalfOf.country ? { country: booking.onBehalfOf.country } : {}) };
    if (booking.kind === 'own') {
      return { name: booking.customer as string, address: 'The carrier’s own customer — not a SeeBuyGet account' };
    }
    // B2 — a customer's business, by its registered name.
    const business = this.entities?.byDid(booking.shipperDid);
    if (business?.kind === 'business') return { name: business.name, ...(business.business?.address ? { address: business.business.address } : {}), ...(business.jurisdiction ? { country: business.jurisdiction } : {}), did: booking.shipperDid };
    // A store, then a shop, then the honest placeholder — the same order and the same fields the
    // board's note resolves a sender in, so one page cannot describe a party two ways.
    if (this.vendors.has(booking.shipperDid)) {
      const v = this.vendors.get(booking.shipperDid);
      return { name: v.name, ...(v.address ? { address: v.address } : {}), ...(v.country ? { country: v.country } : {}), did: v.did };
    }
    try {
      const a = this.agents.get(booking.shipperDid);
      return { name: a.shopName, ...(a.physicalAddress ?? a.landmark ? { address: (a.physicalAddress ?? a.landmark) as string } : {}), ...(a.country ? { country: a.country } : {}), did: a.did };
    } catch {
      return { name: 'Sender', did: booking.shipperDid };
    }
  }
}
