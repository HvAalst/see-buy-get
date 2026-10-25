import { Injectable, Optional } from '@nestjs/common';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { GlosError } from '../../foundation/http/glos-error';
import { incotermEntry } from '../../foundation/incoterms/catalogue';
import { PresenceService } from '../../foundation/presence/presence.service';
import { BusinessClientService } from './business-client.service';
import { clientRefOf, type ClientRef } from './business-client.types';
import { BusinessService } from './business.service';
import { CarriageContractService, isDay } from './carriage-contract.service';
import type { ContractRef } from './carriage-contract.types';
import { DispatchService } from './dispatch.service';
import type { Freight, InboundReceiver } from './dispatch.types';
import { SiteService } from './site.service';
import { EntityService } from '../../foundation/entity/entity.service';
import type { RegisterFreightDto } from './pudo.dto';
import { ShipperCodesService, clientCoder } from './shipper-codes.service';

/**
 * POSTING A LOAD — one way, whoever posts it: a person in an app, or a business's own system with its key (round 12:
 * "Post, send in, take at its price"). Moved out of the controller so the two doors carry the same checks in the same
 * words (rule-match-the-board): a term switched on for both countries, an order under a contract linked to this
 * business, a client of its own, the GS1 prefix it holds.
 *
 * `checkOnly` is a test key's post: every check runs and the load is worked out, and nothing is kept, numbered, coded,
 * announced or noted.
 */
@Injectable()
export class LoadPostingService {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly presence: PresenceService,
    private readonly clients: BusinessClientService,
    @Optional() private readonly contracts?: CarriageContractService,
    @Optional() private readonly businesses?: BusinessService,
    @Optional() private readonly shipperCodes?: ShipperCodesService,
    // Inbound, reading A: a load addressed to a business by the code of one of its receiving points.
    @Optional() private readonly sites?: SiteService,
    @Optional() private readonly entities?: EntityService,
  ) {}

  post(dto: RegisterFreightDto, actor: IntrospectionResult, checkOnly = false): Freight {
    // FB0b — the DTO carries dimensions as {l,w,h} (the shape every other measured route uses); the service
    // takes the orientation-free tuple. Convert here, as createInbound/accept already do.
    const dimensionsCm: [number, number, number] | undefined = dto.dimensionsCm ? [dto.dimensionsCm.l, dto.dimensionsCm.w, dto.dimensionsCm.h] : undefined;
    // FB0c — whoever posted it is who negotiates for it. Read straight off the actor rather than through
    // actingDid: a bulletin freight posted with no identity legitimately has no owner, and must not 403 here.
    // CL1 — refuse a term this country has not switched on, before the load exists rather than after.
    this.requireActiveTerm(dto.incoterm, dto.pickupCountry, dto.destCountry);
    // B2 — a business's DID is shared by everybody in it, so the person who posted is kept by name as well.
    const { forClientId, contractId, deliverOn, orderRef, receivingPoint, receiverRef, ...load } = dto;
    // Inbound, reading A: "deliver to" a business's receiving point — its place is where the load goes, by its own name.
    const receiving = receivingPoint ? this.receivingPointOf(receivingPoint) : undefined;
    if (receiving) {
      load.destLabel = `${receiving.name} — ${receiving.siteName}`;
      load.destLocation = { lat: receiving.location.lat, lng: receiving.location.lng };
    }
    // GS1 — a business posting its OWN goods gives its packages SSCCs under its prefix, when it holds one. Asked before
    // the load exists, so a load is never posted with some packages coded and others not. A client's goods carry the
    // CLIENT's code (round 20: the prefix on the client's record), never the forwarder's.
    const coder = actor?.role === 'business' && actor.tenant ? (forClientId ? clientCoder(actor.tenant, forClientId) : actor.tenant) : undefined;
    this.shipperCodes?.assertCanIssue(coder, dto.packages);
    const posted = this.dispatch.registerFreight(
      { ...load, dimensionsCm, ...this.contractOrder(actor, contractId, deliverOn, orderRef), ...(receiving ? { receiver: receiving.receiver, ...(receiverRef ? { receiverRef } : {}) } : {}), bodyHint: dto.bodyHint as never, excludedBodies: dto.excludedBodies as never, postedByDid: actor?.did, ...(actor?.role === 'business' && actor.actorName ? { postedByName: actor.actorName } : {}), ...this.onBehalfOf(actor, forClientId) },
      Date.now(),
      checkOnly,
    );
    if (checkOnly) return posted;
    // …and WHICH person, kept by the business itself and never on the load, which every carrier on the board reads:
    // it is who the receipt goes to when the load is delivered.
    this.businesses?.notePosted(posted.freightId, actor);
    this.shipperCodes?.issue(posted.freightId, coder, posted.packages);
    return posted;
  }

  /**
   * The receiving point a "deliver to" code names, and the business it is: refused in words when it names none — a load
   * is never sent to a place nobody could find, nor quietly posted without its receiver.
   */
  receivingPointOf(code: string): { receiver: InboundReceiver; name: string; siteName: string; location: { lat: number; lng: number } } {
    const site = this.sites?.byReceivingCode(code);
    const entity = site ? this.entities?.find(site.entityId) : undefined;
    if (!site || !entity) throw new GlosError('INVALID_INPUT', `No receiving point has the code “${code.trim()}”. Check it with the business you are sending to: it gave you the code.`, { field: 'receivingPoint' });
    return { receiver: { entityId: entity.entityId, siteId: site.siteId, name: entity.name, siteName: site.name }, name: entity.name, siteName: site.name, location: site.location };
  }

  /** The client an expeditor sends for — one of its own, or nobody's. */
  onBehalfOf(actor: IntrospectionResult, clientId: string | undefined): { onBehalfOf?: ClientRef } {
    if (!clientId) return {};
    if (actor?.role !== 'business' || !actor.tenant) throw new GlosError('FORBIDDEN', 'Only a business sends for a client of its own');
    return { onBehalfOf: clientRefOf(this.clients.require(actor.tenant, clientId)) };
  }

  private requireActiveTerm(incoterm: string | undefined, pickupCountry?: string, destCountry?: string): void {
    const term = incotermEntry(incoterm);
    if (!term) return;
    if (!pickupCountry?.trim() || !destCountry?.trim()) {
      throw new GlosError('TERM_NOT_ACTIVE', 'A trade term names a border, so say which countries this load runs between before agreeing ' + term.code + '.');
    }
    const ends: Array<{ country: string; direction: 'origin' | 'destination' }> = [
      { country: pickupCountry.trim(), direction: 'origin' },
      { country: destCountry.trim(), direction: 'destination' },
    ];
    for (const end of ends) {
      const allowed = this.presence.resolve(end.country).incoterms[end.direction];
      if (!allowed.includes(term.code)) {
        throw new GlosError(
          'TERM_NOT_ACTIVE',
          term.code + ' is not switched on for ' + end.country.toUpperCase() + ' as ' + end.direction + '. Network staff activate a term per country, per direction, and two of them are needed to switch one on.',
        );
      }
    }
  }

  private contractOrder(actor: IntrospectionResult, contractId: string | undefined, deliverOn: string | undefined, orderRef?: string): { contract?: ContractRef; deliverOn?: string; orderRef?: string } {
    if (!contractId) {
      if (deliverOn) throw new GlosError('INVALID_INPUT', 'A delivery day belongs to an order under a contract — name the contract', { field: 'contractId' });
      return {};
    }
    if (actor?.role !== 'business' || !actor.tenant) throw new GlosError('FORBIDDEN', 'Only the business that linked a contract orders under it');
    if (!this.contracts) throw new GlosError('INVALID_STATE', 'Contracts are not running in this deployment');
    if (!deliverOn || !isDay(deliverOn)) throw new GlosError('FIELD_REQUIRED', 'Say which day it must arrive', { field: 'deliverOn' });
    // "Today" is the carrier's: an order is for a day on the clock of the fleet that must bring it.
    const linked = this.contracts.requireForShipper(actor.tenant, contractId);
    if (deliverOn < this.dispatch.fleetDay(linked.fleetDid)) throw new GlosError('INVALID_INPUT', 'That day has gone — an order is for today or later', { field: 'deliverOn' });
    const contract = this.contracts.orderable(linked, deliverOn);
    const ref = orderRef?.trim();
    // The shipper's own number is used once under a contract — the same rule a sheet is held to.
    if (ref && this.dispatch.contractOrderByRef(contractId, ref)) throw new GlosError('CONFLICT', `Order ${ref} is already with ${contract.fleetName}`, { field: 'orderRef' });
    return { contract, deliverOn, ...(ref ? { orderRef: ref } : {}) };
  }
}
