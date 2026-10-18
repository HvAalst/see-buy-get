import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { DidService } from '../../foundation/did/did.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { isKnownHandlingCode } from './handling-codes';
import {
  CommercialValue,
  EWaybillCore,
  PackageItem,
  Party,
  Shipment,
  TransportDetails,
  TransportMode,
} from './shipment.types';
import { SchemaValidator } from './schema/schema-validator.service';
import { HsCodeService } from './schema/hs-code.service';
import { CommodityTaggingService } from './constraints/commodity-tagging.service';
import { DangerousGoodsService } from './constraints/dangerous-goods.service';

export interface CreateShipmentInput {
  origin: string;
  destination: string;
  deliveryWindow?: { from: string; to: string };
  mode?: TransportMode;
  transportDetails?: TransportDetails;
  totalWeightKg: number;
  packageCount: number;
  packages?: PackageItem[];
  parties?: Party[];
  goods?: { description?: string; hsCode?: string; commercialValue?: CommercialValue; incoterms?: string };
  handlingCodes?: string[];
  references?: Record<string, string>;
  dangerousGoods?: { unNumber?: string; description?: string };
  shipperRef?: string;
}

export interface EnrichShipmentInput {
  goods?: Partial<EWaybillCore['goods']>;
  handlingCodes?: string[];
  references?: Record<string, string>;
  parties?: Party[];
}

/**
 * ShipmentService — creates and maintains the universal digital twin (M2-010..025, 050/051).
 * Minimal-viable creation, multi-package, party↔DID linking, genesis anchoring, and an
 * append-only amendment chain. The twin is the root that M4 tracks and SSE settles against.
 */
@Injectable()
export class ShipmentService {
  private readonly shipments = new Map<string, Shipment>();

  constructor(
    private readonly ledger: LedgerService,
    private readonly dids: DidService,
    private readonly events: EventBus,
    private readonly schema: SchemaValidator,
    private readonly hsCode: HsCodeService,
    private readonly commodity: CommodityTaggingService,
    private readonly dangerousGoods: DangerousGoodsService,
  ) {}

  /** M2-010/011/014/020/023/025: create a shipment from a minimal viable record. */
  create(input: CreateShipmentInput): Shipment {
    if (!input.origin || !input.destination) throw new BadRequestException('origin and destination are required');
    if (!(input.totalWeightKg > 0)) throw new BadRequestException('totalWeightKg must be positive');
    if (!(input.packageCount > 0)) throw new BadRequestException('packageCount must be positive');

    this.verifyParties(input.parties);

    // Auto-tag handling from the commodity (M2-031), then validate against the library (M2-030).
    const codes = Array.from(new Set([...(input.handlingCodes ?? []), ...this.commodity.suggest(input.goods?.description)]));
    const unknown = codes.filter((c) => !isKnownHandlingCode(c));
    if (unknown.length) throw new BadRequestException(`Unknown handling codes: ${unknown.join(', ')}`);

    const glosShipmentId = `GLOS-${randomBytes(8).toString('hex').toUpperCase()}`;
    const packages = this.buildPackages(input);

    // Goods as declared: an HS code is the shipper's to give, never filled in from the description (M2-024).
    const goods = { ...(input.goods ?? {}) };

    // Dangerous goods as DECLARED, by UN number, then checked against the DGR ceiling (M2-033). Never guessed from the
    // words of a description: a UN number is the shipper's declaration, and a guess would be ours.
    const customs: Record<string, unknown> = {};
    const dgInput = input.dangerousGoods?.unNumber ? { unNumber: input.dangerousGoods.unNumber } : undefined;
    if (dgInput) {
      const classification = this.dangerousGoods.classify(dgInput);
      if (classification) {
        const check = this.dangerousGoods.validate(classification, input.totalWeightKg);
        if (!check.ok) throw new BadRequestException(`Dangerous goods rejected: ${check.reason}`);
        customs.dangerousGoods = classification;
      }
    }

    const ewaybill: EWaybillCore = {
      identifiers: { glosShipmentId, shipperRef: input.shipperRef },
      parties: input.parties ?? [],
      transport: { mode: input.mode ?? 'courier', ...(input.transportDetails ?? {}) },
      goods,
      packaging: { count: input.packageCount, totalWeightKg: input.totalWeightKg, packages },
      handling: { codes },
      customs: Object.keys(customs).length ? customs : undefined,
      references: input.references ?? {},
    };

    // Validate against the published e-waybill schema (M2-020/021/022/025).
    this.schema.validate(ewaybill);

    // Genesis block (M2-050) — anchor the whole core payload.
    const anchor = this.ledger.anchor(ewaybill);
    const shipment: Shipment = {
      glosShipmentId,
      status: 'created',
      origin: input.origin,
      destination: input.destination,
      deliveryWindow: input.deliveryWindow,
      ewaybill,
      legs: [],
      milestones: [],
      versions: [{ version: 0, anchor, at: new Date().toISOString(), note: 'genesis' }],
      createdAt: new Date().toISOString(),
    };
    this.shipments.set(glosShipmentId, shipment);

    void this.events
      .publish(GlosEvent.Shipment.Created, { glosShipmentId, anchorTxId: anchor.txId }, { source: 'm2' })
      .catch(() => undefined);
    return shipment;
  }

  /** M2-012/051: progressive enrichment — new anchored version on top of the chain. */
  enrich(glosShipmentId: string, patch: EnrichShipmentInput): Shipment {
    const shipment = this.require(glosShipmentId);
    this.verifyParties(patch.parties);
    if (patch.handlingCodes) {
      const unknown = patch.handlingCodes.filter((c) => !isKnownHandlingCode(c));
      if (unknown.length) throw new BadRequestException(`Unknown handling codes: ${unknown.join(', ')}`);
      shipment.ewaybill.handling.codes = Array.from(new Set([...shipment.ewaybill.handling.codes, ...patch.handlingCodes]));
    }
    if (patch.goods) shipment.ewaybill.goods = { ...shipment.ewaybill.goods, ...patch.goods };
    if (patch.references) shipment.ewaybill.references = { ...shipment.ewaybill.references, ...patch.references };
    if (patch.parties) shipment.ewaybill.parties = [...shipment.ewaybill.parties, ...patch.parties];

    // Re-validate the enriched twin (Incoterms, HS code, namespaced tags).
    this.schema.validate(shipment.ewaybill);
    this.appendVersion(shipment, 'enrichment');
    if (shipment.status === 'created') shipment.status = 'enriched';

    void this.events
      .publish(GlosEvent.Shipment.Enriched, { glosShipmentId, version: shipment.versions.length - 1 }, { source: 'm2' })
      .catch(() => undefined);
    return shipment;
  }

  get(glosShipmentId: string): Shipment | undefined {
    return this.shipments.get(glosShipmentId);
  }

  require(glosShipmentId: string): Shipment {
    const shipment = this.shipments.get(glosShipmentId);
    if (!shipment) throw new NotFoundException(`Shipment not found: ${glosShipmentId}`);
    return shipment;
  }

  /** Append an anchored amendment referencing the prior version (M2-051). */
  appendVersion(shipment: Shipment, note: string): void {
    const previous = shipment.versions[shipment.versions.length - 1];
    const anchor = this.ledger.anchor({ ewaybill: shipment.ewaybill, legs: shipment.legs, prev: previous.anchor.hash });
    shipment.versions.push({ version: shipment.versions.length, anchor, at: new Date().toISOString(), note });
  }

  private buildPackages(input: CreateShipmentInput): PackageItem[] {
    if (input.packages?.length) return input.packages;
    const each = Math.round((input.totalWeightKg / input.packageCount) * 100) / 100;
    return Array.from({ length: input.packageCount }, (_, i) => ({ id: `pkg-${i + 1}`, weightKg: each }));
  }

  private verifyParties(parties?: Party[]): void {
    for (const party of parties ?? []) {
      if (party.did && !this.dids.exists(party.did)) {
        throw new BadRequestException(`Unknown party DID: ${party.did}`);
      }
    }
  }
}
