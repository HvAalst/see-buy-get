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
 * THE BUSINESS KEEPS THIS ITSELF: staff read it and change none of it (the route refuses them by name). The one
 * exception is a dispute two members of staff decided (gs1-dispute.service.ts): who may use the prefix follows it.
 *
 * A CODE IS NEVER GIVEN TWICE — round 18, the user: "Refuse the same digit"; "nobody can print a number another
 * business has already printed".
 *  - A prefix is shared only under different extension digits, as a group's companies share their parent's: a digit
 *    another business prints under now is refused.
 *  - The next serial under a prefix and digit is the next after the highest ANY business was given there — so a digit
 *    given up, or a prefix moved by a decision, carries on past every number already printed rather than reprinting it.
 *  - Once staff decided a dispute about a prefix, only the businesses it was decided for may use it.
 * The codes a load was given are kept beside it for good, whatever the business changes afterwards.
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

/** Who may use a prefix since staff decided a dispute about it. */
export interface PrefixOwners {
  companyPrefix: string;
  entityIds: string[];
  disputeId: string;
  decidedAt: string;
}

/** More packages than this on one load are not labelled one by one here. */
export const MAX_LABELLED_PACKAGES = 500;

@Injectable()
export class ShipperCodesService {
  private readonly settings = new PersistentMap<string, ShipperGs1>('shipper-gs1');
  /** The next serial each business was given up to, keyed `entityId|prefix|extension digit`. */
  private readonly serials = new PersistentMap<string, { next: number }>('shipper-gs1-serials');
  private readonly issued = new PersistentMap<string, PackageCodes>('package-codes');
  private readonly owners = new PersistentMap<string, PrefixOwners>('gs1-prefix-owners');

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
    this.assertMayUse(entityId, companyPrefix, input.extensionDigit);
    const set: ShipperGs1 = { entityId, companyPrefix, extensionDigit: input.extensionDigit, setAt: new Date(now).toISOString(), setBy: by };
    this.settings.set(entityId, set);
    return set;
  }

  /** Refuse a prefix staff decided is another business's, and a digit another business prints under now. */
  assertMayUse(entityId: string, companyPrefix: string, extensionDigit: number): void {
    const decided = this.owners.get(companyPrefix);
    if (decided && !decided.entityIds.includes(entityId)) {
      throw new GlosError('GS1_PREFIX_TAKEN', 'SeeBuyGet staff decided who this GS1 company prefix belongs to, and it is another business. If it is yours, show us your GS1 licence.', { field: 'companyPrefix' });
    }
    const other = [...this.settings.values()].find((s) => s.entityId !== entityId && s.companyPrefix === companyPrefix && s.extensionDigit === extensionDigit);
    if (other) {
      throw new GlosError(
        'GS1_PREFIX_TAKEN',
        `Another business prints SSCCs under this prefix with extension digit ${extensionDigit}. A prefix is shared only under different extension digits: choose another. If the prefix is yours and the other business should not use it, show us your GS1 licence.`,
        { field: 'extensionDigit' },
      );
    }
  }

  /** The other businesses using a prefix now, under any digit — and those a decision gave it to. */
  holdersOf(companyPrefix: string, except: string): string[] {
    const using = [...this.settings.values()].filter((s) => s.companyPrefix === companyPrefix && s.entityId !== except).map((s) => s.entityId);
    const decided = this.owners.get(companyPrefix)?.entityIds ?? [];
    return [...new Set([...using, ...decided])].filter((id) => id !== except);
  }

  /** The decision on a dispute, as it lands: who may use the prefix from now on. */
  ownersOf(companyPrefix: string): PrefixOwners | undefined {
    return this.owners.get(companyPrefix);
  }

  /**
   * STAFF DECIDED THE PREFIX IS THE CLAIMANT'S: the others stop printing under it (their loads keep the codes they were
   * given), the claimant prints under the digit it asked for — carrying on past every number already printed there.
   */
  award(companyPrefix: string, extensionDigit: number, toEntityId: string, fromEntityIds: string[], disputeId: string, by: string, now: number = Date.now()): void {
    for (const id of fromEntityIds) if (this.settings.get(id)?.companyPrefix === companyPrefix) this.settings.delete(id);
    this.settings.set(toEntityId, { entityId: toEntityId, companyPrefix, extensionDigit, setAt: new Date(now).toISOString(), setBy: by });
    this.owners.set(companyPrefix, { companyPrefix, entityIds: [toEntityId], disputeId, decidedAt: new Date(now).toISOString() });
  }

  /** STAFF DECIDED THE PREFIX STAYS WITH THOSE USING IT: nothing they print changes, and nobody else may take it up. */
  keepWith(companyPrefix: string, entityIds: string[], disputeId: string, now: number = Date.now()): void {
    this.owners.set(companyPrefix, { companyPrefix, entityIds: [...new Set(entityIds)], disputeId, decidedAt: new Date(now).toISOString() });
  }

  /** How many codes are left under the business's prefix and digit as they are set now; undefined without a prefix. */
  left(entityId: string): number | undefined {
    const s = this.settings.get(entityId);
    if (!s) return undefined;
    return serialCapacity(s.companyPrefix) - this.nextUnder(s.companyPrefix, s.extensionDigit);
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
    const first = this.nextUnder(s.companyPrefix, s.extensionDigit);
    const codes = Array.from({ length: packages }, (_, i) => ssccOf(s.companyPrefix, s.extensionDigit, first + i));
    this.serials.set(serialKey(s), { next: first + packages });
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

  /** The next serial under a prefix and digit: past the highest any business was given there. */
  private nextUnder(companyPrefix: string, extensionDigit: number): number {
    const tail = `|${companyPrefix}|${extensionDigit}`;
    let next = 0;
    for (const [key, v] of this.serials.entries()) if (key.endsWith(tail)) next = Math.max(next, v.next);
    return next;
  }
}

const serialKey = (s: ShipperGs1) => `${s.entityId}|${s.companyPrefix}|${s.extensionDigit}`;
