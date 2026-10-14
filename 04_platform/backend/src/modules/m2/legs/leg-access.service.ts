import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { CredentialService } from '../../../foundation/credentials/credential.service';
import { deriveRequirements, isKnownHandlingCode } from '../handling-codes';
import { ShipmentService } from '../shipment.service';
import { HandoverPoint, Leg, LegAgreedTerms, LegProposal, Shipment } from '../shipment.types';

/**
 * LegAccessService (M2-062 + §5.3 data isolation). Enforces the rule that an actor assigned to a
 * leg sees ONLY that leg — its handover, constraints and negotiation — and the masked shipment
 * header. They cannot see other legs, other carriers, parties, or commercial data. The shipper
 * (owner) sees any leg. Actors negotiate that leg's terms within this scope.
 */
export interface LegView {
  glosShipmentId: string;
  transportMode: string;
  leg: {
    index: number;
    mode: string;
    origin: string;
    destination: string;
    handover: HandoverPoint;
    constraints: string[]; // inherited + leg-specific
    assignedCarrierDid?: string;
    negotiation: Leg['negotiation'];
  };
  // Deliberately omitted: other legs, parties, consignee, commercial value, full e-waybill.
}

@Injectable()
export class LegAccessService {
  constructor(
    private readonly shipments: ShipmentService,
    private readonly credentials: CredentialService,
  ) {}

  /**
   * Assign a carrier to a leg (normally driven by an M3 per-leg match). The carrier's VC
   * requirements for this leg are verified against the M1 identity vault first (§5.5).
   */
  assignCarrier(glosShipmentId: string, legIndex: number, carrierDid: string): LegView {
    const { shipment, leg } = this.leg(glosShipmentId, legIndex);
    const { mandatoryVCs } = deriveRequirements([...leg.constraints, ...leg.legConstraints]);
    const missing = mandatoryVCs.filter((vc) => !this.credentials.hasValid(carrierDid, vc));
    if (missing.length) throw new BadRequestException(`Carrier lacks required credentials for this leg: ${missing.join(', ')}`);
    leg.assignedCarrierDid = carrierDid;
    return this.project(shipment, leg);
  }

  /** Add a leg-specific constraint on top of the inherited master constraints (M2-062). */
  addLegConstraint(glosShipmentId: string, legIndex: number, code: string, requesterDid: string): LegView {
    if (!isKnownHandlingCode(code)) throw new BadRequestException(`Unknown handling code: ${code}`);
    const { shipment, leg } = this.leg(glosShipmentId, legIndex);
    this.authorize(shipment, leg, requesterDid);
    if (!leg.legConstraints.includes(code)) leg.legConstraints.push(code);
    return this.project(shipment, leg);
  }

  /** Scoped leg view — enforces data isolation. */
  view(glosShipmentId: string, legIndex: number, requesterDid: string): LegView {
    const { shipment, leg } = this.leg(glosShipmentId, legIndex);
    this.authorize(shipment, leg, requesterDid);
    return this.project(shipment, leg);
  }

  /** Propose terms for a leg (shipper or the assigned carrier). */
  propose(glosShipmentId: string, legIndex: number, fromDid: string, input: { price: number; currency: string; note?: string }): LegView {
    const { shipment, leg } = this.leg(glosShipmentId, legIndex);
    this.authorize(shipment, leg, fromDid);
    if (!(input.price > 0)) throw new BadRequestException('price must be positive');
    const proposal: LegProposal = { id: `lp_${randomBytes(6).toString('hex')}`, fromDid, price: input.price, currency: input.currency, note: input.note, at: new Date().toISOString() };
    leg.negotiation.proposals.push(proposal);
    return this.project(shipment, leg);
  }

  /** Accept a proposal → the leg's agreed terms. */
  accept(glosShipmentId: string, legIndex: number, byDid: string, proposalId: string): LegView {
    const { shipment, leg } = this.leg(glosShipmentId, legIndex);
    this.authorize(shipment, leg, byDid);
    const proposal = leg.negotiation.proposals.find((p) => p.id === proposalId);
    if (!proposal) throw new NotFoundException(`Proposal not found: ${proposalId}`);
    const agreed: LegAgreedTerms = { proposalId, price: proposal.price, currency: proposal.currency, byDid, at: new Date().toISOString() };
    leg.negotiation.agreed = agreed;
    return this.project(shipment, leg);
  }

  // --- internals ---

  private leg(glosShipmentId: string, legIndex: number): { shipment: Shipment; leg: Leg } {
    const shipment = this.shipments.require(glosShipmentId);
    const leg = shipment.legs[legIndex];
    if (!leg) throw new NotFoundException(`Leg ${legIndex} not found (decompose the shipment first)`);
    return { shipment, leg };
  }

  private shipperDid(shipment: Shipment): string | undefined {
    return shipment.ewaybill.parties.find((p) => p.role === 'shipper')?.did;
  }

  /** Authorization = the leg's assigned carrier, or the shipment's shipper. */
  private authorize(shipment: Shipment, leg: Leg, requesterDid: string): void {
    const ok = requesterDid === leg.assignedCarrierDid || requesterDid === this.shipperDid(shipment);
    if (!ok) throw new ForbiddenException('Not authorized for this leg (data is isolated per leg)');
  }

  private project(shipment: Shipment, leg: Leg): LegView {
    return {
      glosShipmentId: shipment.glosShipmentId,
      transportMode: shipment.ewaybill.transport.mode,
      leg: {
        index: leg.index,
        mode: leg.mode,
        origin: leg.origin,
        destination: leg.destination,
        handover: leg.handover,
        constraints: [...leg.constraints, ...leg.legConstraints],
        assignedCarrierDid: leg.assignedCarrierDid,
        negotiation: leg.negotiation,
      },
    };
  }
}
