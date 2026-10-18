import { Injectable } from '@nestjs/common';
import { cleanPrefix, serialCapacity, ssccOf } from '../../foundation/gs1/gs1';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';

/**
 * A SHIPPER'S OWN GS1 CODES, PRINTED ON ITS PACKAGES BESIDE OURS.
 *
 * A business that holds a GS1 company prefix says so in Business details, with the extension digit it sets aside for
 * labels printed here. From then on every load it posts with a number of packages gets one SSCC per package, under
 * that prefix, and the labels carry the GS1-128 barcode beside our own code (foundation/gs1). A business without a
 * prefix gets our code alone: we never print a prefix that is not the shipper's.
 *
 * THE BUSINESS KEEPS THIS ITSELF: staff read it and change none of it (the route refuses them by name).
 *
 * A CODE IS NEVER GIVEN TWICE. The serial counter is kept per business, per prefix, per extension digit — so going back
 * to an earlier prefix or digit carries on where it left off rather than starting again at one — and the codes a load
 * was given are kept beside it for good, whatever the business changes afterwards.
 */
export interface ShipperGs1 {
  entityId: string;
  companyPrefix: string;
  extensionDigit: number;
  setAt: string;
  setBy: string;
}

/** The SSCCs one load's packages were given: in package order, under the prefix as it was then. */
export interface PackageCodes {
  freightId: string;
  entityId: string;
  companyPrefix: string;
  codes: string[];
  issuedAt: string;
}

/** More packages than this on one load are not labelled one by one here. */
export const MAX_LABELLED_PACKAGES = 500;

@Injectable()
export class ShipperCodesService {
  private readonly settings = new PersistentMap<string, ShipperGs1>('shipper-gs1');
  /** The next serial, keyed `entityId|prefix|extension digit`. */
  private readonly serials = new PersistentMap<string, { next: number }>('shipper-gs1-serials');
  private readonly issued = new PersistentMap<string, PackageCodes>('package-codes');

  of(entityId: string | undefined): ShipperGs1 | undefined {
    return entityId ? this.settings.get(entityId) : undefined;
  }

  /** Set the prefix and extension digit, or clear them with `null`. Codes already given stay with their loads. */
  set(entityId: string, input: { companyPrefix: string; extensionDigit: number } | null, by: string, now: number = Date.now()): ShipperGs1 | undefined {
    if (input === null) {
      this.settings.delete(entityId);
      return undefined;
    }
    const companyPrefix = cleanPrefix(input.companyPrefix);
    if (!companyPrefix) throw new GlosError('VALIDATION_FAILED', 'A GS1 company prefix is 6 to 12 digits, as GS1 gave it to you', { field: 'companyPrefix' });
    if (!Number.isInteger(input.extensionDigit) || input.extensionDigit < 0 || input.extensionDigit > 9) {
      throw new GlosError('VALIDATION_FAILED', 'An extension digit is one digit, 0 to 9', { field: 'extensionDigit' });
    }
    const set: ShipperGs1 = { entityId, companyPrefix, extensionDigit: input.extensionDigit, setAt: new Date(now).toISOString(), setBy: by };
    this.settings.set(entityId, set);
    return set;
  }

  /** How many codes are left under the business's prefix and digit as they are set now; undefined without a prefix. */
  left(entityId: string): number | undefined {
    const s = this.settings.get(entityId);
    if (!s) return undefined;
    return serialCapacity(s.companyPrefix) - (this.serials.get(serialKey(s))?.next ?? 0);
  }

  /**
   * Refuse BEFORE the load is posted when its packages cannot all be given a code — rather than post the load and then
   * fail, or label some packages and not others. Nothing to say for a business without a prefix.
   */
  assertCanIssue(entityId: string | undefined, packages: number | undefined): void {
    if (!entityId || !packages) return;
    if (packages > MAX_LABELLED_PACKAGES) throw new GlosError('VALIDATION_FAILED', `Up to ${MAX_LABELLED_PACKAGES} packages are labelled one by one on a load`, { field: 'packages' });
    const left = this.left(entityId);
    if (left !== undefined && packages > left) {
      const s = this.settings.get(entityId)!;
      throw new GlosError('INVALID_STATE', `Only ${left} GS1 codes are left under extension digit ${s.extensionDigit} of your prefix. Choose another extension digit in Business details.`, { field: 'packages' });
    }
  }

  /**
   * Give a load's packages their codes, once. The same codes again on a second call; nothing for a business without a
   * prefix or a load without a number of packages.
   */
  issue(freightId: string, entityId: string | undefined, packages: number | undefined, now: number = Date.now()): PackageCodes | undefined {
    const already = this.issued.get(freightId);
    if (already) return already;
    const s = this.of(entityId);
    if (!s || !packages || packages < 1) return undefined;
    this.assertCanIssue(s.entityId, packages);
    const key = serialKey(s);
    const first = this.serials.get(key)?.next ?? 0;
    const codes = Array.from({ length: packages }, (_, i) => ssccOf(s.companyPrefix, s.extensionDigit, first + i));
    this.serials.set(key, { next: first + packages });
    const kept: PackageCodes = { freightId, entityId: s.entityId, companyPrefix: s.companyPrefix, codes, issuedAt: new Date(now).toISOString() };
    this.issued.set(freightId, kept);
    return kept;
  }

  codesFor(freightId: string): PackageCodes | undefined {
    return this.issued.get(freightId);
  }

  /** The load a package's SSCC belongs to — what a scan of the global barcode is answered with. */
  freightOfSscc(sscc: string): string | undefined {
    for (const p of this.issued.values()) if (p.codes.includes(sscc)) return p.freightId;
    return undefined;
  }
}

const serialKey = (s: ShipperGs1) => `${s.entityId}|${s.companyPrefix}|${s.extensionDigit}`;
