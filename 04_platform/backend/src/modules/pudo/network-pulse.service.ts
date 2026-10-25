import { Injectable, Optional } from '@nestjs/common';
import { HandleService } from '../../foundation/handle/handle.service';
import { AgentService } from './agent.service';
import { ParcelService } from './parcel.service';
import { RatingService } from './rating.service';
import type { Parcel } from './pudo.types';

/** A median, a share or an average is published only over at least this many — fewer is an anecdote. */
export const MIN_SAMPLE = 10;
const WINDOW_DAYS = 30;
const CACHE_MS = 5 * 60 * 1000;

/** One real parcel's journey, told without a person in it: two public shops, two towns, and how long each leg took. */
export interface PulseJourney {
  fromShop: string;
  fromTown: string;
  toShop: string;
  toTown: string;
  /** Minutes from being handed in at the first shop to being ready at the second. */
  toReadyMinutes: number;
  /** Minutes from ready to collected. */
  toCollectedMinutes: number;
  /** When it was collected — so a reader can tell a journey from this week from one from last year. */
  collectedAt: string;
}

/** One trading shop as a town page shows it — what anybody standing outside it could see. */
export interface TownShop {
  shopName: string;
  landmark: string;
  openState: 'open' | 'closed';
  /** Only once there are enough ratings for an average to mean something. */
  rating?: { average: number; count: number };
  /** Its public page, `/@handle`, where it has one. */
  handle?: string;
  location?: { lat: number; lng: number };
}

/** A town's page: its trading shops. The address is `/towns/<slug>`. */
export interface TownPage {
  town: string;
  slug: string;
  country: string;
  shops: TownShop[];
}

export interface NetworkPulse {
  /** Shops trading now (approved and funded), and how many of them say they are open. */
  shops: number;
  shopsOpen: number;
  /** Distinct towns or areas with at least one trading shop, and the countries they are in. */
  towns: number;
  /** Those towns, most shops first — the same shops the counts are of, so the list and the number always agree. */
  townList: Array<{ town: string; slug: string; shops: number }>;
  countries: string[];
  /** Parcels collected by the person they were for, in the last 30 days. */
  collected30d: number;
  /** Median hours from handed in to ready at the collection shop, last 30 days. Absent below MIN_SAMPLE. */
  medianHoursToReady?: number;
  /** Average shop rating across every rating given, and how many. Absent below MIN_SAMPLE ratings. */
  shopRating?: { average: number; count: number };
  /** The most recent collected parcel's journey, where both ends were shops. */
  journey?: PulseJourney;
  windowDays: number;
  at: string;
}

/**
 * THE NETWORK, MEASURED — what the front page shows a visitor as proof, and nothing it did not measure.
 *
 * The user, 2026-10-03: "We should prove rather that it works for our target users." Proof here is not a quote from
 * a happy customer (we have none we may print, and a made-up one is a lie); it is the network's own record. Every
 * figure is counted from the registers at the moment it is asked for, a median or an average is withheld until
 * there are enough cases for it to mean something, and the one journey shown is a real parcel's, told with the
 * names of two public shops and nobody else.
 *
 * Public, so it carries nothing a competitor could not count by walking into the shops: no money, no people, no
 * parcel identifiers. Cached for five minutes — it is read by every visitor to the front page.
 */
@Injectable()
export class NetworkPulseService {
  private cached?: { at: number; pulse: NetworkPulse };
  private cachedTowns?: { at: number; towns: TownPage[] };

  constructor(
    private readonly agents: AgentService,
    private readonly parcels: ParcelService,
    private readonly ratings: RatingService,
    @Optional() private readonly handles?: HandleService,
  ) {}

  pulse(now: number = Date.now()): NetworkPulse {
    if (this.cached && now - this.cached.at < CACHE_MS) return this.cached.pulse;
    const pulse = this.measure(now);
    this.cached = { at: now, pulse };
    return pulse;
  }

  /**
   * A PAGE PER TOWN — "parcel shops in Nairobi" is what people search for, and the answer is the shops themselves.
   * Trading shops only (a shop still being checked takes no parcels), most-open first, with what anybody standing
   * outside could see: the name, the landmark, open or closed, the rating once it means something, its public page.
   */
  towns(now: number = Date.now()): TownPage[] {
    if (this.cachedTowns && now - this.cachedTowns.at < CACHE_MS) return this.cachedTowns.towns;
    const byTown = new Map<string, TownPage>();
    // Trading, and not at rest: a shop whose owner muted the account is not one anybody can use today.
    // Nor one in a country that is not open yet (COMING, 2026-10-25): it trades from the day it opens.
    for (const a of this.agents.list().filter((x) => x.status === 'ACTIVE' && !this.agents.isResting(x.did) && !this.agents.notOpenYet(x))) {
      const town = a.zone.trim();
      if (!town) continue;
      const page = byTown.get(town.toLowerCase()) ?? { town, slug: townSlug(town), country: this.agents.countryOf(a), shops: [] };
      const r = this.ratings.agentRating(a.did);
      page.shops.push({
        shopName: a.shopName,
        landmark: a.landmark,
        openState: a.openState,
        ...(r.count >= 3 && !r.isNew ? { rating: { average: r.average, count: r.count } } : {}),
        ...(this.handles?.forId(a.did)?.handle ? { handle: this.handles.forId(a.did)!.handle } : {}),
        ...(a.location ? { location: a.location } : {}),
      });
      byTown.set(town.toLowerCase(), page);
    }
    const towns = [...byTown.values()]
      .map((p) => ({ ...p, shops: p.shops.sort((x, y) => Number(y.openState === 'open') - Number(x.openState === 'open') || x.shopName.localeCompare(y.shopName)) }))
      .sort((a, b) => b.shops.length - a.shops.length || a.town.localeCompare(b.town));
    this.cachedTowns = { at: now, towns };
    return towns;
  }

  /** Uncached — what `pulse` serves. */
  measure(now: number = Date.now()): NetworkPulse {
    const trading = this.agents.list().filter((a) => a.status === 'ACTIVE' && !this.agents.isResting(a.did) && !this.agents.notOpenYet(a));
    const byDid = new Map(trading.map((a) => [a.did, a]));
    const since = now - WINDOW_DAYS * 24 * 60 * 60 * 1000;

    const all = this.parcels.list();
    const collected = all.filter((p) => p.status === 'Delivered').map((p) => ({ p, at: timeOf(p, 'Delivered') })).filter((c): c is { p: Parcel; at: number } => c.at !== null);
    const recent = collected.filter((c) => c.at >= since && c.at <= now);

    const hoursToReady = all
      .map((p) => {
        const ready = timeOf(p, 'Ready_For_Pickup');
        const handedIn = Date.parse(p.acceptedAt);
        return ready !== null && ready >= since && ready <= now && Number.isFinite(handedIn) && ready >= handedIn ? (ready - handedIn) / 3_600_000 : null;
      })
      .filter((h): h is number => h !== null);

    let ratingSum = 0;
    let ratingCount = 0;
    for (const a of trading) {
      const r = this.ratings.agentRating(a.did);
      ratingSum += r.average * r.count;
      ratingCount += r.count;
    }

    const journey = this.latestJourney(collected, byDid);
    // One entry per town however it was typed ("Nairobi", "nairobi "), shown as it was first spelt.
    const byTown = new Map<string, { town: string; slug: string; shops: number }>();
    for (const a of trading) {
      const town = a.zone.trim();
      if (!town) continue;
      const row = byTown.get(town.toLowerCase()) ?? { town, slug: townSlug(town), shops: 0 };
      row.shops += 1;
      byTown.set(town.toLowerCase(), row);
    }
    const townList = [...byTown.values()].sort((a, b) => b.shops - a.shops || a.town.localeCompare(b.town));
    return {
      shops: trading.length,
      shopsOpen: trading.filter((a) => a.openState === 'open').length,
      towns: townList.length,
      townList,
      countries: [...new Set(trading.map((a) => this.agents.countryOf(a)))].sort(),
      collected30d: recent.length,
      ...(hoursToReady.length >= MIN_SAMPLE ? { medianHoursToReady: Math.round(median(hoursToReady) * 10) / 10 } : {}),
      ...(ratingCount >= MIN_SAMPLE ? { shopRating: { average: Math.round((ratingSum / ratingCount) * 10) / 10, count: ratingCount } } : {}),
      ...(journey ? { journey } : {}),
      windowDays: WINDOW_DAYS,
      at: new Date(now).toISOString(),
    };
  }

  private latestJourney(collected: Array<{ p: Parcel; at: number }>, shops: Map<string, { shopName: string; zone: string }>): PulseJourney | undefined {
    const sorted = [...collected].sort((a, b) => b.at - a.at);
    for (const { p, at } of sorted) {
      const from = p.originAgentDid ? shops.get(p.originAgentDid) : undefined;
      const to = p.destAgentDid ? shops.get(p.destAgentDid) : undefined;
      const ready = timeOf(p, 'Ready_For_Pickup');
      const handedIn = Date.parse(p.acceptedAt);
      if (!from || !to || ready === null || !Number.isFinite(handedIn) || ready < handedIn || at < ready) continue;
      return {
        fromShop: from.shopName,
        fromTown: from.zone,
        toShop: to.shopName,
        toTown: to.zone,
        toReadyMinutes: Math.round((ready - handedIn) / 60_000),
        toCollectedMinutes: Math.round((at - ready) / 60_000),
        collectedAt: new Date(at).toISOString(),
      };
    }
    return undefined;
  }
}

/** "Dar es Salaam" → "dar-es-salaam": the town's address, the same on the server and in the app. */
export function townSlug(town: string): string {
  return town
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** When a parcel FIRST reached a status, from its own scan history. */
function timeOf(p: Parcel, status: Parcel['status']): number | null {
  const scan = p.scans.find((s) => s.status === status);
  const t = scan ? Date.parse(scan.at) : NaN;
  return Number.isFinite(t) ? t : null;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
