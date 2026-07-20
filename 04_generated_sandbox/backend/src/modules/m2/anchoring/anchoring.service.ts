import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { LedgerService } from '../../../foundation/ledger/ledger.service';
import { NetworkInfo } from '../../../foundation/ledger/ledger.types';
import { ShipmentService } from '../shipment.service';

export interface VerificationResult {
  glosShipmentId: string;
  verified: boolean;
  version: number;
  txId: string;
  blockHeight: number;
  network: NetworkInfo;
}

export interface DisclosureProof {
  glosShipmentId: string;
  attribute: string;
  present: boolean;
  proof: string; // ZK-style commitment
  genesisTxId: string;
  network: NetworkInfo;
}

/**
 * AnchoringService (M2-052/053). Lightweight client verification — recompute the current version
 * hash and check it against the permissioned ledger (Hyperledger Fabric) without running a full
 * node. Selective disclosure — prove a single attribute (e.g. "is cold-chain") is part of the
 * anchored shipment without revealing the rest of the e-waybill.
 */
@Injectable()
export class AnchoringService {
  private readonly key = process.env.GLOS_DISCLOSURE_KEY || 'glos-dev-disclosure-key';

  constructor(
    private readonly shipments: ShipmentService,
    private readonly ledger: LedgerService,
  ) {}

  /** M2-052: verify the latest anchored version against the ledger. */
  verify(glosShipmentId: string): VerificationResult {
    const shipment = this.shipments.require(glosShipmentId);
    const v = shipment.versions[shipment.versions.length - 1];
    const payload = v.version === 0 ? shipment.ewaybill : { ewaybill: shipment.ewaybill, legs: shipment.legs, prev: shipment.versions[v.version - 1].anchor.hash };
    return {
      glosShipmentId,
      verified: this.ledger.verify(payload, v.anchor.txId),
      version: v.version,
      txId: v.anchor.txId,
      blockHeight: v.anchor.blockHeight,
      network: this.ledger.networkInfo(),
    };
  }

  /** M2-053: selective disclosure — prove an attribute is present without revealing the payload. */
  disclose(glosShipmentId: string, attribute: string): DisclosureProof {
    const shipment = this.shipments.require(glosShipmentId);
    const e = shipment.ewaybill;
    const present = e.handling.codes.includes(attribute) || e.goods.incoterms === attribute || e.goods.hsCode === attribute || e.transport.mode === attribute;
    const genesis = shipment.versions[0].anchor;
    const proof = createHmac('sha256', this.key).update(`${glosShipmentId}:${attribute}:${present}:${genesis.hash}`).digest('hex');
    return { glosShipmentId, attribute, present, proof, genesisTxId: genesis.txId, network: this.ledger.networkInfo() };
  }
}
