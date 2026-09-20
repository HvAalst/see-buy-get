import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { randomBytes } from 'node:crypto';

/**
 * PERMISSION TO MOVE GOODS THAT HAVE NOT BEEN CLEARED.
 *
 * A container discharged at Djibouti and cleared at Modjo travels the first leg UNDER BOND: it is inside
 * the country, it has not entered it, and duty has not been paid on it. Every customs authority licenses
 * that movement separately — a transporter's transit licence and a bond or guarantee standing behind the
 * duty, so that a box which never arrives at the inland counter is somebody's debt rather than nobody's.
 *
 * The user's instruction, when asked whether to model this or leave it to the parties: *"the permission
 * is enforced. Our aim is to smoothen logistics, not closing an eye and wait for trouble."* So it is a
 * record with a date on it, and the board asks it before it offers a bonded load to anybody.
 *
 * HELD BY THE CARRIER, NOT THE VEHICLE. A transit licence is issued to the transport company, the way an
 * operator's licence is; the truck is just the truck. So the holder is whoever the network CONTRACTS
 * with for the carriage — a fleet by its manager's DID, or an owner-driver by their own — which is the
 * same line [[rule-a-handle-follows-the-contract]] draws, and the same line `settlingEntityIdOf` draws
 * when it decides who gets paid.
 *
 * PER COUNTRY, because a bond runs under one customs authority and stops at its frontier. A carrier
 * authorised for Ethiopian transit has no standing at a Kenyan counter, and a single global flag would
 * have said they did.
 *
 * NOT THE PLATFORM'S OPERATING BOND. `FleetManager.bondPaid` is a refundable deposit this network holds
 * as an activation gate — our commercial arrangement with a fleet. This is a customs instrument held by
 * a state. Two different things that share an English word, and conflating them would let a fleet that
 * paid us a deposit move somebody's uncleared cargo.
 *
 * WE DO NOT VERIFY IT. The reference and the date are as the carrier states them, recorded against the
 * person who typed them — the same stance as every other paper on this network. What we enforce is that
 * a claim EXISTS and is in date; whether the authority behind it is genuine is a customs matter, and
 * pretending otherwise would be the "closed eye" the user was objecting to, wearing a badge.
 */
export interface TransitAuthority {
  authorityId: string;
  /** The carrier: a fleet manager's DID, or an owner-driver's own DID. */
  carrierDid: string;
  /** ISO 3166-1 alpha-2, upper case. A bond is one authority's, and stops at its frontier. */
  country: string;
  /** The licence or bond number the customs authority issued, as the carrier states it. */
  reference: string;
  /** YYYY-MM-DD. A transit licence always has one; a permission with no end is not a permission. */
  expiresAt: string;
  recordedBy: string;
  recordedAt: string;
  /** Set when somebody withdraws it — kept, never deleted, because it was true while it stood. */
  withdrawnAt?: string;
  withdrawnBy?: string;
  withdrawnReason?: string;
}

export const TRANSIT_BASIS =
  'A transit authority is recorded as the carrier states it, against the person who typed it. We check ' +
  'that one exists and is in date before a bonded load is offered; we do not verify it with the customs ' +
  'authority that issued it.';

/**
 * THE DECISION ITSELF, with nothing injected — so the rule can be read in one place and tested by
 * calling it rather than by a spec restating it.
 *
 * `permitted` is the answer to "does this carrier hold a live authority for that country", asked by the
 * caller because only the caller knows who the carrier is.
 */
export function transitRefusal(
  load: { bonded?: boolean; bondCountry?: string; pickupCountry?: string },
  permitted: (country: string | undefined) => boolean,
): { code: 'NO_TRANSIT_AUTHORITY'; message: string } | undefined {
  // A leg that is not bonded is not gated. Said first and plainly: clearing a container must never make
  // it HARDER to move, which is what inheriting this gate onto the delivery leg would do.
  if (!load.bonded) return undefined;
  const country = load.bondCountry || load.pickupCountry;
  if (permitted(country)) return undefined;
  return {
    code: 'NO_TRANSIT_AUTHORITY',
    message: country
      ? `This container has not been cleared yet. Carrying it needs a transit authority for ${country}, and none is on record for you.`
      : 'This container has not been cleared yet, and no transit authority is on record for you.',
  };
}

@Injectable()
export class TransitAuthorityService {
  private readonly rows = new PersistentMap<string, TransitAuthority>('transit-authorities');

  /**
   * Record one. Refused rather than corrected where it cannot be trusted: a date in the past is somebody
   * copying last year's licence, and a permission that is already spent is worse than none — it reads as
   * cover on a screen and is not.
   */
  declare(
    input: { carrierDid: string; country: string; reference: string; expiresAt: string },
    by: string,
    now = Date.now(),
  ): TransitAuthority {
    const carrierDid = input.carrierDid?.trim();
    if (!carrierDid) throw new GlosError('FIELD_REQUIRED', 'Say which carrier holds this authority');
    const country = input.country?.trim().toUpperCase();
    if (!country || !/^[A-Z]{2}$/.test(country)) throw new GlosError('VALIDATION_FAILED', 'A transit authority runs in ONE country — give its two-letter code');
    const reference = input.reference?.trim();
    if (!reference) throw new GlosError('FIELD_REQUIRED', 'Give the licence or bond number the customs authority issued');
    const expiresAt = input.expiresAt?.trim();
    if (!expiresAt || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) || Number.isNaN(Date.parse(expiresAt))) {
      throw new GlosError('VALIDATION_FAILED', 'Say when it runs out, written YYYY-MM-DD');
    }
    if (dayEnd(expiresAt) <= now) throw new GlosError('VALIDATION_FAILED', `That authority ran out on ${expiresAt} — record the renewed one`);
    if (!by?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say who is recording this');

    // A renewal SUPERSEDES rather than stacking: two live authorities for one country in one carrier's
    // name is two answers to a question that has one, and the board would have to pick.
    for (const existing of this.liveAll(carrierDid, country, now)) {
      this.rows.set(existing.authorityId, { ...existing, withdrawnAt: new Date(now).toISOString(), withdrawnBy: by.trim(), withdrawnReason: `Replaced by ${reference}` });
    }

    const authority: TransitAuthority = {
      authorityId: `trn_${randomBytes(8).toString('hex')}`,
      carrierDid,
      country,
      reference,
      expiresAt,
      recordedBy: by.trim(),
      recordedAt: new Date(now).toISOString(),
    };
    this.rows.set(authority.authorityId, authority);
    return authority;
  }

  /** Withdrawn, never deleted: it was true while it stood, and a leg carried under it is still a fact. */
  withdraw(authorityId: string, by: string, reason: string, now = Date.now()): TransitAuthority {
    const row = this.rows.get(authorityId);
    if (!row) throw new GlosError('NOT_FOUND', 'No such transit authority');
    if (row.withdrawnAt) return row;
    if (!reason?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say why it is being withdrawn');
    const next = { ...row, withdrawnAt: new Date(now).toISOString(), withdrawnBy: by.trim(), withdrawnReason: reason.trim() };
    this.rows.set(authorityId, next);
    return next;
  }

  /** Everything ever recorded for one carrier, newest first — a register, including what has lapsed. */
  list(carrierDid: string): TransitAuthority[] {
    return [...this.rows.values()]
      .filter((a) => a.carrierDid === carrierDid)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  }

  /** The one that stands today for this country, or nothing. This is the question the board asks. */
  liveFor(carrierDid: string, country: string, now = Date.now()): TransitAuthority | undefined {
    return this.liveAll(carrierDid, country, now)[0];
  }

  /** May this carrier move uncleared goods in this country today? */
  permits(carrierDid: string | undefined, country: string | undefined, now = Date.now()): boolean {
    if (!carrierDid || !country) return false;
    return this.liveFor(carrierDid, country, now) !== undefined;
  }

  private liveAll(carrierDid: string, country: string, now: number): TransitAuthority[] {
    return [...this.rows.values()]
      .filter((a) => a.carrierDid === carrierDid && a.country === country.toUpperCase() && !a.withdrawnAt && dayEnd(a.expiresAt) > now)
      .sort((a, b) => b.expiresAt.localeCompare(a.expiresAt));
  }
}

/**
 * A licence is good for the WHOLE of the day it expires. Read as midnight UTC it would stop a truck that
 * is still legally on the road — the same date-only trap `paperDay` exists for on the other side.
 */
function dayEnd(day: string): number {
  return Date.parse(`${day}T23:59:59.999Z`);
}
