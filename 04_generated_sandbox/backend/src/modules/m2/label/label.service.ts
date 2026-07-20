import { Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'crypto';
import { EventBus } from '../../../foundation/events/event-bus.service';
import { GlosEvent } from '../../../foundation/events/glos-events';
import { ShipmentService } from '../shipment.service';
import { Shipment } from '../shipment.types';

// Handling code → printable pictogram (M2-040).
const PICTOGRAMS: Record<string, string> = {
  TEMP_2_8C: '❄️', TEMP_FROZEN: '🧊', PERISHABLE: '⏳', KEEP_DRY: '☂️',
  THIS_WAY_UP: '⬆️', NO_STACK: '🚫', STACK_MAX_2: '2️⃣',
  FRAGILE: '🥚', SHOCK_SENSITIVE: '💥',
  DG_CLASS_1: '💣', DG_CLASS_2: '🛢️', DG_CLASS_3: '🔥', DG_CLASS_6: '☠️', DG_CLASS_7: '☢️', DG_CLASS_9: '⚠️',
  HIGH_VALUE: '💎', SECURITY_SEAL: '🔒',
};

export interface CarrierOverlay {
  carrierDid?: string;
  barcode: string;
  routing?: string;
  at: string;
}

export interface SmartLabel {
  glosShipmentId: string;
  qrData: string;
  humanReadable: string;
  neutralDescription: string;
  pictograms: string[];
  signature: string;
  watermark: string;
  genesisTxId: string;
  overlays: CarrierOverlay[];
  createdAt: string;
}

/**
 * LabelService (M2-040..043). Generates the Universal GLOS Smart Label: a globally-unique GLOS
 * Shipment ID (QR + human-readable), a NEUTRAL description (no commercial/PII), handling
 * pictograms, a cryptographic signature, and an anti-tamper watermark tied to the label hash.
 * The GLOS ID stays the permanent primary key; carrier barcodes attach only as overlays.
 */
@Injectable()
export class LabelService {
  private readonly labels = new Map<string, SmartLabel>();
  private readonly signingKey = process.env.GLOS_LABEL_KEY || 'glos-dev-label-key';

  constructor(
    private readonly shipments: ShipmentService,
    private readonly events: EventBus,
  ) {}

  generate(glosShipmentId: string): SmartLabel {
    const shipment = this.shipments.require(glosShipmentId);
    const neutralDescription = this.neutral(shipment);
    const pictograms = shipment.ewaybill.handling.codes.map((c) => PICTOGRAMS[c]).filter(Boolean);
    const genesisTxId = shipment.versions[0].anchor.txId;
    const qrData = `GLOS:${glosShipmentId}|verify:https://verify.glos.network/${glosShipmentId}`;

    const core = { glosShipmentId, neutralDescription, pictograms, genesisTxId };
    const signature = createHmac('sha256', this.signingKey).update(JSON.stringify(core)).digest('hex');
    const watermark = createHash('sha256').update(signature).digest('hex').slice(0, 12); // M2-043

    const label: SmartLabel = {
      glosShipmentId,
      qrData,
      humanReadable: glosShipmentId,
      neutralDescription,
      pictograms,
      signature,
      watermark,
      genesisTxId,
      overlays: [],
      createdAt: new Date().toISOString(),
    };
    this.labels.set(glosShipmentId, label);
    void this.events.publish(GlosEvent.Shipment.LabelGenerated, { glosShipmentId }, { source: 'm2' }).catch(() => undefined);
    return label;
  }

  /** M2-041: append a carrier's barcode/routing as an overlay; GLOS ID stays primary. */
  addOverlay(glosShipmentId: string, overlay: { carrierDid?: string; barcode: string; routing?: string }): SmartLabel {
    const label = this.get(glosShipmentId);
    label.overlays.push({ ...overlay, at: new Date().toISOString() });
    return label;
  }

  get(glosShipmentId: string): SmartLabel {
    return this.labels.get(glosShipmentId) ?? this.generate(glosShipmentId);
  }

  /** Recompute and compare the signature — detects tampering (M2-043). */
  verifySignature(glosShipmentId: string): boolean {
    const label = this.labels.get(glosShipmentId);
    if (!label) return false;
    const core = { glosShipmentId, neutralDescription: label.neutralDescription, pictograms: label.pictograms, genesisTxId: label.genesisTxId };
    return createHmac('sha256', this.signingKey).update(JSON.stringify(core)).digest('hex') === label.signature;
  }

  /** M2-042: render the label in a printer format. */
  render(glosShipmentId: string, format: 'json' | 'svg' | 'zpl' | 'epl'): string | SmartLabel {
    const label = this.get(glosShipmentId);
    if (format === 'json') return label;
    if (format === 'svg') return this.svg(label);
    if (format === 'zpl') return this.zpl(label);
    return this.epl(label);
  }

  private neutral(shipment: Shipment): string {
    const p = shipment.ewaybill.packaging;
    return `Shipment ${shipment.glosShipmentId} · ${p.count} package(s) · ${p.totalWeightKg}kg`;
  }

  private svg(label: SmartLabel): string {
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="220">',
      '<rect width="400" height="220" fill="#fff" stroke="#0E3B2D"/>',
      `<text x="16" y="32" font-size="18" font-weight="bold" fill="#0E3B2D">${label.humanReadable}</text>`,
      `<text x="16" y="58" font-size="12" fill="#1B1B1B">${label.neutralDescription}</text>`,
      `<text x="16" y="96" font-size="28">${label.pictograms.join(' ')}</text>`,
      `<rect x="280" y="60" width="100" height="100" fill="#000"/><text x="284" y="175" font-size="9">QR ${label.glosShipmentId}</text>`,
      `<text x="16" y="200" font-size="9" fill="#6B7280">sig ${label.signature.slice(0, 16)}… wm ${label.watermark}</text>`,
      '</svg>',
    ].join('');
  }

  private zpl(label: SmartLabel): string {
    return `^XA^FO20,20^A0N,30,30^FD${label.humanReadable}^FS^FO20,60^A0N,20,20^FD${label.neutralDescription}^FS^FO20,100^BQN,2,6^FDLA,${label.qrData}^FS^FO20,300^A0N,15,15^FDwm:${label.watermark}^FS^XZ`;
  }

  private epl(label: SmartLabel): string {
    return ['N', `A20,20,0,4,1,1,N,"${label.humanReadable}"`, `A20,70,0,3,1,1,N,"${label.neutralDescription}"`, `b20,110,Q,s7,"${label.qrData}"`, 'P1'].join('\n');
  }
}
