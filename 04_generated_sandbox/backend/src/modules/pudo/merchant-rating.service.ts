import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { ParcelService } from './parcel.service';
import { isFor } from './addressed-to';
import { VendorService } from './vendor.service';
import { MIN_PUBLIC_RATINGS } from './rating.service';
import { Parcel } from './pudo.types';

/**
 * What a receiver may say about a merchant — tags, never prose.
 *
 * The same choice the driver rating made, for the same reasons: prose brings moderation, defamation
 * exposure, personal details in public strings, and translation across five locales. A tag is a catalogue
 * key, so it aggregates, it translates, and there is nothing in it to moderate.
 *
 * POSITIVES ARE HALF THE LIST, deliberately. A scorecard made only of complaints is a pillory, nobody
 * good installs a widget that links to one, and "well packed" is real information a buyer wants. The set
 * is small on purpose — a long list is a survey, and the answer rate collapses.
 */
export const MERCHANT_TAGS = [
  'WELL_PACKED',
  'AS_DESCRIBED',
  'SHIPPED_FAST',
  'POOR_PACKAGING',
  'WRONG_ITEM',
  'MISSING_ITEM',
] as const;
export type MerchantTag = (typeof MERCHANT_TAGS)[number];

/** Which way a tag points, so a screen can group them and a scorecard can count them apart. */
export const POSITIVE_TAGS: ReadonlySet<MerchantTag> = new Set<MerchantTag>(['WELL_PACKED', 'AS_DESCRIBED', 'SHIPPED_FAST']);

/** One receiver's verdict on one parcel. By PARCEL, never by phone — see rate(). */
export interface MerchantRatingRecord {
  id: string;
  vendorId: string;
  parcelId: string;
  stars: number;
  tags: MerchantTag[];
  at: string;
}

/**
 * What we MEASURED, and what people said.
 *
 * `isNew` is the cold-start flag the whole reputation layer already honours (REP1): below
 * MIN_PUBLIC_RATINGS there is no headline average, because telling a shopper a new business is "rated
 * 3.0" on its third order is this network damaging somebody who has done nothing wrong.
 */
export interface MerchantScorecard {
  vendorId: string;
  name: string;
  /** Shipments this merchant actually handed to the network — the denominator for everything below. */
  shipments: number;
  /** Handed to a shop within a day of being sold, as a rate. Undefined until there is anything to say. */
  shipsNextDayRate?: number;
  /** Median hours from sale to counter — the number behind the rate, so nobody has to trust the rate alone. */
  medianHoursToHandover?: number;
  /** Sold, billed, and never handed in at all. The merchant's own failure, and invisible before this. */
  neverDroppedRate?: number;
  /** Claims that were upheld or partly upheld, over shipments. */
  upheldDisputeRate?: number;
  /** What receivers tapped, most-common first. Counts, never percentages — a percentage of four is noise. */
  tags: Array<{ tag: MerchantTag; count: number; positive: boolean }>;
  rating: { average: number; count: number; isNew: boolean };
}

/** Under a day, because that is the promise a shopper actually reads into "ships fast". */
const NEXT_DAY_H = 24;

/**
 * A merchant's reputation, built mostly out of things we watched rather than things we were told.
 *
 * THE THESIS: we carried the parcel, so we know what no review site can compute — when it was sold, when
 * it reached a counter, whether it ever arrived at all, and how its claims ended. "Handed over within a
 * day, 94% of the time" is unfakeable and uniquely ours. A star average from strangers is a crowded,
 * gameable market entered late; the measured half is the part nobody else can copy.
 *
 * THE RULE THIS LIVES OR DIES BY, decided before any of it was written: we publish only what we
 * measured, identically for every merchant, and no merchant may selectively hide it. If a merchant can
 * switch off a bad score we are worthless to buyers; if we can tune one, we are selling reputation.
 * Which is why the profile is a PUBLIC page of ours rather than something that exists only inside a
 * widget a merchant chooses to install — a score the badly-behaved can opt out of is not a score.
 *
 * Read as a sell rather than a threat: a merchant who ships fast earns a badge slow competitors cannot
 * fake, which is a real reason for a good merchant to install the widget and for a buyer to trust that
 * checkout.
 */
@Injectable()
export class MerchantRatingService {
  private readonly ratings = new PersistentMap<string, MerchantRatingRecord>('pudo-merchant-ratings');

  constructor(
    private readonly parcels: ParcelService,
    private readonly vendors: VendorService,
  ) {}

  /**
   * The receiver rates the merchant they bought from.
   *
   * ONLY the receiver, only on a parcel that was actually delivered, and only once — keyed by parcel
   * rather than by person, which is what makes this verifiable in a way a public review site structurally
   * cannot be: we carried the thing being reviewed. It is also why volume will be lower than a review
   * site's and worth more.
   *
   * A peer send has no merchant, so there is nothing to rate.
   */
  rate(input: { parcelId: string; phoneHash: string; personDid?: string; stars: number; tags?: MerchantTag[] }): { rating: MerchantRatingRecord; scorecard: MerchantScorecard } {
    const parcel = this.parcels.get(input.parcelId);
    if (!parcel.vendorId) throw new GlosError('INVALID_STATE', 'That parcel did not come from a store');
    // 404 rather than FORBIDDEN, the same rule every owner-scoped read here keeps: telling a stranger a
    // parcel exists but is not theirs tells them something about somebody else's business.
    // Theirs by the account once the parcel belongs to one — never by a number somebody else used to have.
    if (!input.phoneHash || !isFor(this.parcels.receiverOf(parcel), input)) throw new GlosError('NOT_FOUND', 'No such parcel');
    if (parcel.status !== 'Delivered') throw new GlosError('INVALID_STATE', 'You can rate the store once the parcel is delivered');
    const stars = Math.round(input.stars);
    if (!(stars >= 1 && stars <= 5)) throw new GlosError('VALIDATION_FAILED', 'Stars must be 1 to 5');
    if (this.forParcel(input.parcelId)) throw new GlosError('ALREADY_RATED', 'You have already rated this order');

    // Unknown tags are dropped rather than refused — a client one version behind should not fail to
    // deliver a rating over a catalogue key it has not heard of.
    const tags = [...new Set((input.tags ?? []).filter((t): t is MerchantTag => (MERCHANT_TAGS as readonly string[]).includes(t)))];
    const rating: MerchantRatingRecord = {
      id: `mrt_${randomBytes(8).toString('hex')}`,
      vendorId: parcel.vendorId,
      parcelId: parcel.parcelId,
      stars,
      tags,
      at: new Date().toISOString(),
    };
    this.ratings.set(rating.id, rating);
    return { rating, scorecard: this.scorecard(parcel.vendorId) };
  }

  /** Has this parcel already been rated? One verdict per shipment, so nobody can stack a merchant. */
  forParcel(parcelId: string): MerchantRatingRecord | undefined {
    return [...this.ratings.values()].find((r) => r.parcelId === parcelId);
  }

  /**
   * The scorecard — measured first, opinions second.
   *
   * Every rate is UNDEFINED rather than zero when there is nothing to compute it from. A zero would read
   * as "never late", which is the most flattering possible lie about a merchant who has shipped nothing.
   */
  scorecard(vendorId: string): MerchantScorecard {
    const vendor = this.vendors.get(vendorId);
    const all = this.parcels.list({ vendorId });
    // Shipments the merchant actually handed over. A parcel still sitting in Created has not been
    // shipped by anybody and cannot be counted for or against them here — it is counted below, on its own.
    const handed = all.filter((p) => this.handoverHours(p) != null);
    const hours = handed.map((p) => this.handoverHours(p)!).sort((a, b) => a - b);

    const sold = all.length;
    const neverDropped = all.filter((p) => p.status === 'Created' || (p.status === 'Voided' && this.handoverHours(p) == null)).length;
    const upheld = all.filter((p) => p.dispute?.state === 'resolved' && p.dispute.decision && p.dispute.decision !== 'rejected').length;

    const mine = [...this.ratings.values()].filter((r) => r.vendorId === vendorId);
    const counts = new Map<MerchantTag, number>();
    for (const r of mine) for (const tag of r.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const sum = mine.reduce((s, r) => s + r.stars, 0);

    return {
      vendorId,
      name: vendor.name,
      shipments: handed.length,
      ...(handed.length
        ? {
            shipsNextDayRate: round2(hours.filter((h) => h <= NEXT_DAY_H).length / handed.length),
            medianHoursToHandover: round2(median(hours)),
            upheldDisputeRate: round2(upheld / handed.length),
          }
        : {}),
      ...(sold ? { neverDroppedRate: round2(neverDropped / sold) } : {}),
      tags: [...counts.entries()]
        .map(([tag, count]) => ({ tag, count, positive: POSITIVE_TAGS.has(tag) }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
      rating: {
        average: mine.length ? round2(sum / mine.length) : 0,
        count: mine.length,
        isNew: mine.length < MIN_PUBLIC_RATINGS,
      },
    };
  }

  /**
   * Hours from SOLD to handed in at a counter, or nothing if it never got there.
   *
   * Read from the CREATED scan rather than from `acceptedAt`, and the difference is the whole
   * measurement: intake OVERWRITES acceptedAt with the counter's clock, so by the time a parcel has been
   * handed over the field that once held the sale time is holding the handover time instead. The scan
   * trail is the only place the original survives.
   */
  private handoverHours(parcel: Parcel): number | undefined {
    const created = parcel.scans.find((s) => s.status === 'CREATED')?.at;
    const handed = parcel.scans.find((s) => s.status === 'At_PUDO')?.at;
    if (!created || !handed) return undefined;
    const ms = new Date(handed).getTime() - new Date(created).getTime();
    return Number.isFinite(ms) && ms >= 0 ? ms / 3_600_000 : undefined;
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The MIDDLE, not the mean: one merchant's forgotten parcel should not move their published number. */
function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
