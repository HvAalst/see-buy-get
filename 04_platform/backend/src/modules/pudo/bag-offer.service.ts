import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import type { Signer } from '../../foundation/entity/same-person';
import { DispatchService } from './dispatch.service';
import { FlagCaseService } from './flag-case.service';
import { MonitorService } from './monitor.service';
import { NotificationService } from './notification.service';
import { CHAIN_RETRY_EVERY_MIN, CHAIN_TELL_BUYERS_AFTER_CHECKS, OFFER_CHAIN_SWEEP_MS, STAFF_OFFER_WAIT_MIN } from './pudo.config';
import type { Offer } from './dispatch.types';
import type { Tote } from './pudo.types';
import { ToteService } from './tote.service';
import { clockAt, utcDay, zonesOfCountry } from './fleet-clock';

/** One driver asked, in a bag's chain of offers, and how it ended. */
export interface OfferStep {
  driverDid: string;
  name: string;
  km: number;
  offerId: string;
  at: string;
  /** When the offer stops waiting for an answer. */
  until: string;
  /** taken; said "not now"; no answer in time; or passed over when staff chose another. */
  outcome?: 'taken' | 'not_now' | 'no_answer' | 'passed_over';
  endedAt?: string;
  /** 2026-11-06 — the try it was asked in: 0 the first (staff's own offer), one more for each try after. */
  round?: number;
}

/** A bag staff started offering: whom it was offered to, in order, and how it stands. */
export interface OfferChain {
  code: string;
  place: string;
  by: string;
  startedAt: string;
  steps: OfferStep[];
  /**
   * asking someone now; waiting for its next hourly try, nobody able to take it now; taken by one of them; or gone from the
   * board otherwise. ('nobody' ended a chain before the hourly tries of 2026-11-06 — kept so a chain of that morning reads.)
   */
  state: 'asking' | 'waiting' | 'taken' | 'nobody' | 'gone';
  endedAt?: string;
  /** The bag's trip it was started on (its `filledAt`): a bag emptied and filled again is a new trip, and not this chain's. */
  trip?: string;
  /** 2026-11-06 — the try it is on: 0 the first. */
  round?: number;
  /** When nobody could first be reached: offered again every hour from then. */
  waitingSince?: string;
  /** How many times it has been offered again on the hour. */
  tries?: number;
  /** When, waiting, it is offered again. */
  nextTryAt?: string;
  /** When the people of its parcels were told it is held up — and the parcels in it then. */
  heldUpToldAt?: string;
  toldParcelIds?: string[];
  /** When they were told it is on the road again. */
  onRoadToldAt?: string;
}

const RETRY_MS = CHAIN_RETRY_EVERY_MIN * 60_000;
/** 2026-11-09 — "Not now" this many times to one bag in a day is "not today": not asked again until the next (Q4). */
const NOT_NOW_IS_NOT_TODAY = 2;
const SYSTEM: Signer = { name: 'SeeBuyGet', key: 'system' };

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number): string {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}

/** 2026-11-09 — the day a moment falls on, on the clock of a country (its first time zone); none known, the UTC day. */
export function dayInCountry(ms: number, country?: string): string {
  const zone = zonesOfCountry(country)[0];
  return zone ? clockAt(ms, zone).day : utcDay(ms);
}

/** The next whole try after `now`, counted on the hour from when it began waiting. */
export function nextTryAfter(waitingSince: string, now: number): number {
  const since = Date.parse(waitingSince);
  return since + (Math.floor(Math.max(0, now - since) / RETRY_MS) + 1) * RETRY_MS;
}

/**
 * 2026-11-06 — A BAG NOBODY HAS TAKEN, OFFERED BY STAFF TO A DRIVER THEY CHOOSE (the owner: "go ahead"). A closed bag no
 * driver near it took, offered once more further away and still waiting, is a Bags_Waiting case. From that case staff see
 * its bags, the working drivers an offer would reach — nearest first — and offer a bag to the one they choose: that
 * driver's own offer, priced as any bag, and a notice that opens it in one tap. The case keeps it, in the name of who did it.
 *
 * …AND NOBODY WAITS ON A DRIVER WHO DOES NOT WANT IT (the owner: "an option for the driver; 'not now' so we need not wait
 * and look automatically for another option? besides also the 20 minutes for in case there is no response"). The offer
 * waits STAFF_OFFER_WAIT_MIN for an answer. "Not now" — in the app, or straight from the notice — passes it at once to the
 * next nearest driver an offer would reach; so does no answer in that time. Down the list until one takes it.
 *
 * …AND, NOBODY ABLE TO TAKE IT NOW, OFFERED AGAIN EVERY HOUR (the owner: "check every hour after 24 hour checks and notify
 * the buyer that they will be notified when their parcel is on the road again"). Where nobody else can be reached, the
 * chain waits and offers it again on the hour — the nearest first, each driver once a try. A day after nobody could first
 * be reached (CHAIN_TELL_BUYERS_AFTER_CHECKS tries), the people of its parcels are told it is held up and that they hear
 * when it moves; the moment a driver scans it aboard, they hear it. Taken and let go again, or held and released, on the
 * same trip, it is offered again. The case is told each step that matters.
 */
@Injectable()
export class BagOfferService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BagOfferService.name);
  private readonly chains = new PersistentMap<string, OfferChain>('pudo-bag-offer-chains');
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly monitor: MonitorService,
    private readonly dispatch: DispatchService,
    private readonly totes: ToteService,
    private readonly cases: FlagCaseService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly events?: EventBus,
  ) {
    // Registered rather than asked for: dispatch is below this, and hears the "Not now" first.
    dispatch.registerDeclined((offer) => this.onDeclined(offer));
    // The moment a driver scans it aboard: the people told it was held up hear that it is on the road again.
    this.events?.subscribe<{ code?: string }>(GlosEvent.Pudo.BagLoaded, (e) => this.onLoaded(e.payload.code));
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      try {
        this.sweep();
      } catch (err) {
        this.logger.warn(`offer chain sweep failed: ${(err as Error).message}`);
      }
    }, OFFER_CHAIN_SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The bags of a Bags_Waiting case: at the place it is named after, closed and waiting — each with its chain of offers. */
  bagsOf(caseId: string): { place: string; bags: Array<ReturnType<MonitorService['bagsAt']>[number] & { chain?: OfferChain }> } {
    const c = this.cases.get(caseId);
    if (c.kind !== 'Bags_Waiting') throw new GlosError('INVALID_STATE', 'This case is not about bags waiting for a driver');
    return {
      place: c.subject,
      bags: this.monitor.bagsAt(c.subject).map((b) => {
        const chain = this.chainFor(b.code);
        return { ...b, ...(chain ? { chain } : {}) };
      }),
    };
  }

  /** The working drivers an offer of this bag would reach now, nearest first. */
  drivers(code: string): ReturnType<DispatchService['driversForBag']> {
    this.totes.requireByCode(code); // 404 for a bag that is not there
    return this.dispatch.driversForBag(code);
  }

  /**
   * Offer it to the driver chosen, and from them on down the list: refused, before anything is written, where an offer
   * could not reach them now. A chain already asking somebody passes over them for the one staff chose; one waiting for its
   * next hour goes on with a new try, its tries and whom it told kept.
   */
  offer(code: string, driverDid: string, staff: Signer, now: number = Date.now()): { offerId: string; driverDid: string; code: string } {
    const tote = this.totes.requireByCode(code);
    const chosen = this.dispatch.driversForBag(code, now).find((d) => d.driverDid === driverDid);
    if (!chosen) throw new GlosError('INVALID_STATE', 'That driver cannot take this bag now — not working, out of their hours, too far, or their vehicle cannot carry it. Choose another.');
    const place = this.dispatch.pickupPlace(tote.locationId)?.label ?? 'a shop';
    const at = new Date(now).toISOString();
    const was = this.chainFor(code);
    const chain: OfferChain = was && was.state !== 'nobody' ? was : { code, place, by: staff.name, startedAt: at, steps: [], state: 'asking', round: 0, ...(tote.filledAt ? { trip: tote.filledAt } : {}) };
    const open = was?.state === 'asking' ? was.steps[was.steps.length - 1] : undefined;
    // Asking now: the one chosen is asked in this try. Waiting, or ended on this trip: a new try.
    const round = chain === was && was.state !== 'asking' ? (was.round ?? 0) + 1 : (chain.round ?? 0);
    const step = this.ask(chain, chosen, now, round);
    if (!step) throw new GlosError('INVALID_STATE', 'That driver cannot take this bag now. Choose another.');
    // Only now it is offered: the one being asked passed over for the one staff chose.
    if (open && !open.outcome) {
      this.end(open, 'passed_over', at);
      this.dispatch.ignore(open.offerId); // its onDeclined finds the step ended already, and leaves it
    }
    chain.round = round;
    chain.state = 'asking';
    delete chain.endedAt;
    delete chain.nextTryAt;
    this.chains.set(code, chain);
    this.cases.noteFor('Bags_Waiting', place, staff, `Offered bag ${code} to ${chosen.name}, ${chosen.km} km away: told, and the notice opens their offer. "Not now", or no answer in ${STAFF_OFFER_WAIT_MIN} minutes, passes it to the next nearest driver.`);
    return { offerId: step.offerId, driverDid, code };
  }

  /**
   * The chains looked at: an offer taken ends its chain; a bag gone from the board otherwise (another driver took it, it was
   * held, it left) ends it too; an offer that waited its time with no answer passes the bag on; one waiting for its next hour
   * is offered again when it comes; a day after nobody could first be reached, its people are told; a bag back on the board
   * on the same trip is offered again. Answers how many moved.
   */
  sweep(now: number = Date.now()): number {
    let moved = 0;
    try {
      moved += this.startForCases(now);
    } catch (err) {
      this.logger.warn(`starting offer chains for waiting bags: ${(err as Error).message}`);
    }
    for (const chain of [...this.chains.values()]) {
      try {
        const did = chain.state === 'asking' ? this.sweepAsking(chain, now) : chain.state === 'waiting' ? this.sweepWaiting(chain, now) : chain.state === 'taken' || chain.state === 'gone' ? this.sweepBack(chain, now) : false;
        if (did) moved += 1;
      } catch (err) {
        this.logger.warn(`offer chain of bag ${chain.code}: ${(err as Error).message}`);
      }
    }
    return moved;
  }

  /**
   * 2026-11-09 — THE CHAIN STARTS ITSELF (the owner, Q5: "start automatically"): a bag of a live Bags_Waiting case — closed
   * and waiting for a driver longer than the case allows — with no chain on its trip is offered by SeeBuyGet as staff would:
   * the nearest working driver an offer would reach first, down the list on "Not now" or no answer, and — nobody able to take
   * it now — every hour. Staff can still offer it to a driver they choose. Answers how many chains started.
   */
  private startForCases(now: number): number {
    let started = 0;
    for (const c of this.cases.list('live', now)) {
      if (c.kind !== 'Bags_Waiting') continue;
      for (const b of this.monitor.bagsAt(c.subject, now)) {
        const tote = this.totes.byCodeMaybe(b.code);
        if (!tote || tote.status !== 'available' || tote.held || tote.waitsForRoom || this.chainFor(b.code)) continue;
        const chain: OfferChain = { code: b.code, place: c.subject, by: SYSTEM.name, startedAt: new Date(now).toISOString(), steps: [], state: 'asking', round: 0, ...(tote.filledAt ? { trip: tote.filledAt } : {}) };
        this.cases.noteFor('Bags_Waiting', c.subject, SYSTEM, `Bag ${b.code} has waited ${b.waitedHours} h: offered to the working drivers near it, the nearest first — "Not now", or no answer in ${STAFF_OFFER_WAIT_MIN} minutes, passes it to the next.`);
        this.next(chain, now);
        started += 1;
      }
    }
    return started;
  }

  /** Asking somebody: taken, gone from the board, or no answer in time — passed on. A day waiting, its people told. */
  private sweepAsking(chain: OfferChain, now: number): boolean {
    const step = chain.steps[chain.steps.length - 1];
    const offer = step ? this.dispatch.offerById(step.offerId) : undefined;
    const at = new Date(now).toISOString();
    if (step && offer?.status === 'claimed') {
      this.end(step, 'taken', at);
      this.finish(chain, 'taken', at, `Bag ${chain.code} taken by ${step.name}${chain.steps.length > 1 ? `, the ${ordinal(chain.steps.length)} asked` : ''}.`);
      return true;
    }
    const tote = this.totes.byCodeMaybe(chain.code);
    const claimed = tote?.status === 'claimed';
    if (!this.waitingHere(chain, tote)) {
      if (step && !step.outcome) this.end(step, 'passed_over', at);
      this.finish(chain, 'gone', at, `Bag ${chain.code} is no longer waiting here${claimed ? ': another driver took it' : ''}.`);
      return true;
    }
    const told = this.tellIfHeldUp(chain, tote, now);
    if (step && !step.outcome && Date.parse(step.until) <= now) {
      this.end(step, 'no_answer', at);
      if (offer?.status === 'pending') this.dispatch.ignore(offer.offerId);
      // (ignore() tells onDeclined, which finds the step already ended and leaves the passing on to here.)
      this.next(chain, now);
      return true;
    }
    return told;
  }

  /** Waiting for its next hour: gone from the board, its people told after a day, or — the hour come — offered again. */
  private sweepWaiting(chain: OfferChain, now: number): boolean {
    const tote = this.totes.byCodeMaybe(chain.code);
    const claimed = tote?.status === 'claimed';
    if (!this.waitingHere(chain, tote)) {
      this.finish(chain, 'gone', new Date(now).toISOString(), `Bag ${chain.code} is no longer waiting here${claimed ? ': a driver took it' : ''}.`);
      return true;
    }
    const told = this.tellIfHeldUp(chain, tote, now);
    if (chain.nextTryAt && Date.parse(chain.nextTryAt) > now) return told;
    chain.tries = (chain.tries ?? 0) + 1;
    chain.round = (chain.round ?? 0) + 1;
    chain.state = 'asking';
    delete chain.nextTryAt;
    this.next(chain, now); // the nearest asked first again — or it waits for the next hour
    return true;
  }

  /** Taken and let go again, or held and released — waiting here again on the same trip: offered again, the nearest first. */
  private sweepBack(chain: OfferChain, now: number): boolean {
    if (chain.trip === undefined) return false; // a chain of before trips were kept: it cannot tell this trip from the next
    const tote = this.totes.byCodeMaybe(chain.code);
    if (!this.waitingHere(chain, tote)) return false;
    const why = chain.state === 'taken' ? ': the driver who took it let it go' : '';
    chain.round = (chain.round ?? 0) + 1;
    chain.state = 'asking';
    delete chain.endedAt;
    this.cases.noteFor('Bags_Waiting', chain.place, SYSTEM, `Bag ${chain.code} is waiting here again${why} — offered again, the nearest driver first.`);
    this.next(chain, now);
    return true;
  }

  /** Still closed and waiting for a driver, here, on the trip its chain began on. */
  private waitingHere(chain: OfferChain, tote: Tote | undefined): tote is Tote {
    return tote !== undefined && tote.status === 'available' && !tote.held && (chain.trip === undefined || tote.filledAt === chain.trip);
  }

  /** Its chain, where it began on the trip the bag is on now (a chain of before trips were kept: as it stands). */
  private chainFor(code: string): OfferChain | undefined {
    const chain = this.chains.get(code);
    if (!chain || chain.trip === undefined) return chain;
    return this.totes.byCodeMaybe(code)?.filledAt === chain.trip ? chain : undefined;
  }

  /**
   * A day after nobody could first be reached, and still waiting: the people of the parcels in it told it is held up, and
   * that they hear when it moves (the dispatcher tells them; in the app, never a text). Once a trip.
   */
  private tellIfHeldUp(chain: OfferChain, tote: Tote, now: number): boolean {
    if (!chain.waitingSince || chain.heldUpToldAt) return false;
    if (now - Date.parse(chain.waitingSince) < CHAIN_TELL_BUYERS_AFTER_CHECKS * RETRY_MS) return false;
    chain.heldUpToldAt = new Date(now).toISOString();
    chain.toldParcelIds = [...tote.parcels];
    this.chains.set(chain.code, chain);
    void this.events?.publish(GlosEvent.Pudo.BagHeldUp, { code: chain.code, parcelIds: chain.toldParcelIds, place: chain.place }, { source: 'pudo' }).catch(() => undefined);
    const n = tote.parcels.length;
    this.cases.noteFor('Bags_Waiting', chain.place, SYSTEM, `Bag ${chain.code}: no driver has taken it in a day of offers every hour — the people of its ${n} parcel${n === 1 ? ' are' : 's are'} told it is held up, and told again when it is on the road.`);
    return true;
  }

  /** Scanned aboard: the people told it was held up hear that it is on the road again — for the parcels still in it. Once. */
  private onLoaded(code?: string): void {
    const chain = code ? this.chains.get(code) : undefined;
    if (!chain?.heldUpToldAt || chain.onRoadToldAt) return;
    const inBag = new Set(this.totes.byCodeMaybe(chain.code)?.parcels ?? []);
    const parcelIds = (chain.toldParcelIds ?? []).filter((id) => inBag.has(id));
    if (!parcelIds.length) return; // another trip of the same bag, or its parcels taken out of it
    chain.onRoadToldAt = new Date().toISOString();
    this.chains.set(chain.code, chain);
    void this.events?.publish(GlosEvent.Pudo.BagOnTheRoadAgain, { code: chain.code, parcelIds, place: chain.place }, { source: 'pudo' }).catch(() => undefined);
    this.cases.noteFor('Bags_Waiting', chain.place, SYSTEM, `Bag ${chain.code} is on the road: the people of its parcels are told.`);
  }

  /** "Not now" from the driver asked: passed on to the next at once. */
  private onDeclined(offer: Offer): void {
    if (offer.kind !== 'tote') return;
    const chain = this.chains.get(offer.ref);
    if (!chain || chain.state !== 'asking') return;
    const step = chain.steps[chain.steps.length - 1];
    if (!step || step.offerId !== offer.offerId || step.outcome) return;
    this.end(step, 'not_now', new Date().toISOString());
    this.next(chain, Date.now());
  }

  /**
   * The next nearest driver an offer would reach, not asked yet in this try — or, with none, it waits for the next hour
   * (the case told the first time it does).
   */
  private next(chain: OfferChain, now: number): void {
    const round = chain.round ?? 0;
    const asked = new Set(chain.steps.filter((s) => (s.round ?? 0) === round).map((s) => s.driverDid));
    const notToday = this.notToday(chain, now);
    for (const d of this.dispatch.driversForBag(chain.code, now)) {
      if (asked.has(d.driverDid) || notToday.has(d.driverDid)) continue;
      if (this.ask(chain, d, now, round)) {
        this.chains.set(chain.code, chain);
        return;
      }
    }
    const first = chain.waitingSince === undefined;
    if (first) chain.waitingSince = new Date(now).toISOString();
    chain.state = 'waiting';
    chain.nextTryAt = new Date(nextTryAfter(chain.waitingSince!, now)).toISOString();
    this.chains.set(chain.code, chain);
    if (first) {
      const n = chain.steps.length;
      const asked = n ? `asked ${n} driver${n === 1 ? '' : 's'} — none took it, and no other working driver can be reached now` : 'no working driver an offer would reach can be reached now';
      this.cases.noteFor('Bags_Waiting', chain.place, SYSTEM, `Bag ${chain.code}: ${asked}. It is offered again every hour; if nobody has taken it in a day, the people of its parcels are told it is held up.`);
    }
  }

  /**
   * 2026-11-09 — THE DRIVERS WHO SAID "NOT NOW" TO THIS BAG TWICE TODAY (the owner, Q4: a second "Not now" is "Not today"):
   * not asked again in its hourly tries until the day is over — the day on the clock of the country the bag waits in.
   */
  private notToday(chain: OfferChain, now: number): Set<string> {
    const tote = this.totes.byCodeMaybe(chain.code);
    const country = tote ? this.dispatch.pickupCountry(tote.locationId) : undefined;
    const dayOf = (ms: number) => dayInCountry(ms, country);
    const today = dayOf(now);
    const count = new Map<string, number>();
    for (const s of chain.steps) {
      if (s.outcome !== 'not_now' || !s.endedAt || dayOf(Date.parse(s.endedAt)) !== today) continue;
      count.set(s.driverDid, (count.get(s.driverDid) ?? 0) + 1);
    }
    return new Set([...count].filter(([, n]) => n >= NOT_NOW_IS_NOT_TODAY).map(([did]) => did));
  }

  /** One driver asked: their offer, waiting STAFF_OFFER_WAIT_MIN, and a notice with "Take it" and "Not now" on it. */
  private ask(chain: OfferChain, d: { driverDid: string; name: string; km: number }, now: number, round: number): OfferStep | undefined {
    const offer = this.dispatch.offerBagTo(d.driverDid, chain.code, now, { ttlMin: STAFF_OFFER_WAIT_MIN });
    if (!offer) return undefined;
    const tote = this.totes.byCodeMaybe(chain.code);
    const step: OfferStep = { driverDid: d.driverDid, name: d.name, km: d.km, offerId: offer.offerId, at: new Date(now).toISOString(), until: offer.expiresAt, round };
    chain.steps.push(step);
    void this.notifications
      ?.notify(d.driverDid, {
        kind: 'load_nearby',
        title: 'Operations offers you a bag',
        body: `A bag at ${chain.place}${tote?.destinationLabel ? `, heading to ${tote.destinationLabel},` : ''} is waiting for a driver, and operations asks whether you can take it. It is ${d.km} km from you: open it to see what it pays. Not now? Say so, and it goes to the next driver.`,
        link: `/?offer=${offer.offerId}`,
        tag: `load:${chain.code}:staff:${d.driverDid}`,
        actions: [
          { action: 'take', title: 'Take it' },
          { action: 'no', title: 'Not now' },
        ],
        data: { code: chain.code, offerId: offer.offerId, declineToken: this.dispatch.mintDeclineToken(offer.offerId, now) },
      })
      .catch(() => undefined);
    return step;
  }

  private end(step: OfferStep, outcome: NonNullable<OfferStep['outcome']>, at: string): void {
    step.outcome = outcome;
    step.endedAt = at;
  }

  private finish(chain: OfferChain, state: OfferChain['state'], at: string, note: string): void {
    chain.state = state;
    chain.endedAt = at;
    delete chain.nextTryAt;
    this.chains.set(chain.code, chain);
    this.cases.noteFor('Bags_Waiting', chain.place, SYSTEM, note);
  }
}
