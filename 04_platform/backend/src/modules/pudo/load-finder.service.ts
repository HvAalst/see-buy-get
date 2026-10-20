import { Injectable } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { ssccFromScan } from '../../foundation/gs1/gs1';
import { GlosError } from '../../foundation/http/glos-error';
import { ConsignmentNoteService } from './consignment-note.service';
import { DispatchService } from './dispatch.service';
import { ShipperCodesService } from './shipper-codes.service';

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
  ) {}

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
