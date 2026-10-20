import { Injectable, Optional } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { ssccFromScan } from '../../foundation/gs1/gs1';
import { GlosError } from '../../foundation/http/glos-error';
import { ConsignmentNoteService } from './consignment-note.service';
import { DispatchService } from './dispatch.service';
import { ShipperCodesService } from './shipper-codes.service';
import { ParcelService } from './parcel.service';
import type { Parcel } from './pudo.types';
import { MdpService } from './mdp.service';

/**
 * A LOAD FOUND BY WHAT WAS SCANNED (round 19, the user: "A scan finds the load"; "Every scan box we have").
 *
 * A package carries two codes a scanner may meet: the GS1-128 barcode of its SSCC, under the shipper's prefix, and our
 * QR — the load's tracking address. A person may also type the load's own code off the label. Any of them, scanned into
 * any box at a counter, a hub or a driver's pickup, finds its load — for whoever could already open that load (its
 * shipper, its carrier, staff), and for nobody else: an identifier opens nothing. To anyone else, a load that exists and
 * one that does not read the same.
 */

/** What a scan names: a package by its SSCC, a load by its tracking key, or by its own code. */
export type LoadRef = { sscc: string } | { trackingKey: string } | { code: string };

/**
 * Read a scan as a load's code, or as nothing. An SSCC in any form a scanner hands over (`]C1`, `00`, `(00)`, bare); the
 * QR on our label (`…/send/?track=T-…`) or a bare tracking key; a load's code typed off the label (`FRT-12`).
 */
export function loadRefOf(raw: string | undefined | null): LoadRef | undefined {
  const text = String(raw ?? '').trim();
  const sscc = ssccFromScan(text);
  if (sscc) return { sscc };
  const fromUrl = /[?&]track=([^&#\s]+)/i.exec(text)?.[1];
  const key = (fromUrl ? safeDecode(fromUrl) : text).toUpperCase();
  if (/^T-[0-9A-F]{6,}$/.test(key)) return { trackingKey: key };
  if (/^FRT-\d+$/i.test(text)) return { code: text.toUpperCase() };
  return undefined;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The one answer for a code that names no load this caller can open — whether or not the load exists. */
export const NO_LOAD_YOU_CAN_OPEN = 'No load you can open has that code';

/** The one answer for a barcode that names no parcel this caller handles now — whether or not the parcel exists. */
export const NO_PARCEL_YOU_HANDLE = 'No parcel you handle has that barcode';

/** Round 32 — the store parcel a scanned SSCC belongs to: what the scan box goes on with, as if our QR were read. */
export class ParcelFoundView {
  @ApiProperty() parcelId!: string;
  @ApiProperty() sscc!: string;
  @ApiProperty() status!: string;
}

export class LoadFoundView {
  freightId: string;
  code: string;
  description: string;
  pickupLabel: string;
  destLabel: string;
  status: string;
  /** Found by a package's SSCC: which package of how many, and the SSCC as read. */
  @ApiPropertyOptional() package?: number;
  @ApiPropertyOptional() packages?: number;
  @ApiPropertyOptional() sscc?: string;
}

@Injectable()
export class LoadFinderService {
  constructor(
    private readonly codes: ShipperCodesService,
    private readonly dispatch: DispatchService,
    private readonly notes: ConsignmentNoteService,
    // Round 32 — a store parcel's SSCC: its parcel, and who handles it now.
    @Optional() private readonly parcels?: ParcelService,
    @Optional() private readonly mdps?: MdpService,
  ) {}

  /**
   * Round 32 — A STORE PARCEL'S SSCC FINDS ITS PARCEL (the user: "A store parcel's SSCC at our counters"; "Every scan
   * box"). Since round 29 a store's parcel carries its own GS1-128 barcode; a scan of it found nothing, the box looking only
   * for a load. Now it finds the parcel — for whoever handles that parcel now and nobody else: the shop it is taken in at
   * or going to, the hub it stands at, staff. Serials run in order under a prefix, so to anybody else a parcel that exists
   * and one that does not read the same: the barcode is never a way to walk a store's parcels.
   */
  findParcel(scanned: string | undefined, actor: IntrospectionResult | undefined): ParcelFoundView {
    const sscc = ssccFromScan(scanned);
    if (!sscc) throw new GlosError('VALIDATION_FAILED', 'That is not a GS1 barcode: scan the barcode under SSCC on the label, or our QR', { field: 'scanned' });
    const nobody = () => new GlosError('NOT_FOUND', NO_PARCEL_YOU_HANDLE);
    const parcelId = this.codes.parcelOfSscc(sscc);
    let p: Parcel | undefined;
    try {
      p = parcelId ? this.parcels?.get(parcelId) : undefined;
    } catch {
      p = undefined; // a code given to a parcel since removed reads as no parcel at all
    }
    if (!p || !this.handles(p, actor)) throw nobody();
    return { parcelId: p.parcelId, sscc, status: p.status };
  }

  /** Who handles a parcel now: staff; the shop it was taken in at or is going to; the hub it stands at. */
  private handles(p: { originAgentDid?: string; destAgentDid?: string; atMdpId?: string }, actor: IntrospectionResult | undefined): boolean {
    if (actor?.role === 'operator') return true;
    if (actor?.role === 'agent' && actor.did) return p.originAgentDid === actor.did || p.destAgentDid === actor.did;
    if (actor?.role === 'mdp' && actor.did) return Boolean(p.atMdpId) && this.mdps?.list().find((m) => m.did === actor.did)?.mdpId === p.atMdpId;
    return false;
  }

  find(scanned: string | undefined, actor: IntrospectionResult | undefined): LoadFoundView {
    const ref = loadRefOf(scanned);
    if (!ref) throw new GlosError('VALIDATION_FAILED', 'That is not a load’s code: scan the barcode or the QR on its label, or type its code (FRT-…)', { field: 'scanned' });
    const nobody = () => new GlosError('NOT_FOUND', NO_LOAD_YOU_CAN_OPEN);
    let freightId: string | undefined;
    let pkg: { no: number; of: number; sscc: string } | undefined;
    if ('sscc' in ref) {
      const found = this.codes.packageOf(ref.sscc);
      freightId = found?.freightId;
      if (found) pkg = { no: found.no, of: found.of, sscc: ref.sscc };
    } else if ('trackingKey' in ref) {
      freightId = this.dispatch.freightByTrackingKey(ref.trackingKey)?.freightId;
    } else {
      freightId = this.dispatch.freightByCode(ref.code)?.freightId;
    }
    if (!freightId) throw nobody();
    let f;
    try {
      f = this.notes.requireReader(freightId, actor);
    } catch {
      // Somebody else's load reads exactly as no load at all.
      throw nobody();
    }
    return {
      freightId: f.freightId,
      code: f.code,
      description: f.description,
      pickupLabel: f.pickupLabel,
      destLabel: f.destLabel,
      status: f.status,
      ...(pkg ? { package: pkg.no, packages: pkg.of, sscc: pkg.sscc } : {}),
    };
  }
}
