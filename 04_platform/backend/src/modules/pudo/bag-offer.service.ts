import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import type { Signer } from '../../foundation/entity/same-person';
import { DispatchService } from './dispatch.service';
import { FlagCaseService } from './flag-case.service';
import { MonitorService } from './monitor.service';
import { NotificationService } from './notification.service';
import { OFFER_CHAIN_SWEEP_MS, STAFF_OFFER_WAIT_MIN } from './pudo.config';
import type { Offer } from './dispatch.types';
import { ToteService } from './tote.service';

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
}

/** A bag staff started offering: whom it was offered to, in order, and how it stands. */
export interface OfferChain {
  code: string;
  place: string;
  by: string;
  startedAt: string;
  steps: OfferStep[];
  /** asking someone now; taken by one of them; nobody else could be reached; or gone from the board otherwise. */
  state: 'asking' | 'taken' | 'nobody' | 'gone';
  endedAt?: string;
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
 * next nearest driver an offer would reach; so does no answer in that time. Down the list until one takes it, or nobody
 * else can be reached: the case is told either way.
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
  ) {
    // Registered rather than asked for: dispatch is below this, and hears the "Not now" first.
    dispatch.registerDeclined((offer) => this.onDeclined(offer));
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
    return { place: c.subject, bags: this.monitor.bagsAt(c.subject).map((b) => ({ ...b, ...(this.chains.get(b.code) ? { chain: this.chains.get(b.code)! } : {}) })) };
  }

  /** The working drivers an offer of this bag would reach now, nearest first. */
  drivers(code: string): ReturnType<DispatchService['driversForBag']> {
    this.totes.requireByCode(code); // 404 for a bag that is not there
    return this.dispatch.driversForBag(code);
  }

  /**
   * Offer it to the driver chosen, and from them on down the list: refused, before anything is written, where an offer
   * could not reach them now. A chain already asking somebody passes over them for the one staff chose.
   */
  offer(code: string, driverDid: string, staff: Signer, now: number = Date.now()): { offerId: string; driverDid: string; code: string } {
    const tote = this.totes.requireByCode(code);
    const chosen = this.dispatch.driversForBag(code, now).find((d) => d.driverDid === driverDid);
    if (!chosen) throw new GlosError('INVALID_STATE', 'That driver cannot take this bag now — not working, out of their hours, too far, or their vehicle cannot carry it. Choose another.');
    const place = this.dispatch.pickupPlace(tote.locationId)?.label ?? 'a shop';
    const at = new Date(now).toISOString();
    let chain = this.chains.get(code);
    if (chain?.state === 'asking') {
      const open = chain.steps[chain.steps.length - 1];
      this.end(open, 'passed_over', at);
      this.dispatch.ignore(open.offerId); // its onDeclined finds the step ended already, and leaves it
    } else {
      chain = { code, place, by: staff.name, startedAt: at, steps: [], state: 'asking' };
    }
    const step = this.ask(chain, chosen, now);
    if (!step) throw new GlosError('INVALID_STATE', 'That driver cannot take this bag now. Choose another.');
    chain.state = 'asking';
    this.chains.set(code, chain);
    this.cases.noteFor('Bags_Waiting', place, staff, `Offered bag ${code} to ${chosen.name}, ${chosen.km} km away: told, and the notice opens their offer. "Not now", or no answer in ${STAFF_OFFER_WAIT_MIN} minutes, passes it to the next nearest driver.`);
    return { offerId: step.offerId, driverDid, code };
  }

  /**
   * The chains looked at: an offer taken ends its chain; a bag gone from the board otherwise (another driver took it, it was
   * held, it left) ends it too; an offer that waited its time with no answer passes the bag on. Answers how many moved.
   */
  sweep(now: number = Date.now()): number {
    let moved = 0;
    for (const chain of [...this.chains.values()]) {
      if (chain.state !== 'asking') continue;
      const step = chain.steps[chain.steps.length - 1];
      const offer = step ? this.dispatch.offerById(step.offerId) : undefined;
      const at = new Date(now).toISOString();
      if (offer?.status === 'claimed') {
        this.end(step, 'taken', at);
        this.finish(chain, 'taken', at, `Bag ${chain.code} taken by ${step.name}${chain.steps.length > 1 ? `, the ${chain.steps.length}th asked` : ''}.`);
        moved += 1;
        continue;
      }
      const tote = this.totes.byCodeMaybe(chain.code);
      if (!tote || tote.status !== 'available' || tote.held) {
        if (step && !step.outcome) this.end(step, 'passed_over', at);
        this.finish(chain, 'gone', at, `Bag ${chain.code} is no longer waiting here${tote?.status === 'claimed' ? ': another driver took it' : ''}.`);
        moved += 1;
        continue;
      }
      if (step && !step.outcome && Date.parse(step.until) <= now) {
        this.end(step, 'no_answer', at);
        if (offer?.status === 'pending') this.dispatch.ignore(offer.offerId);
        // (ignore() tells onDeclined, which finds the step already ended and leaves the passing on to here.)
        this.next(chain, now);
        moved += 1;
      }
    }
    return moved;
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

  /** The next nearest driver an offer would reach, not asked yet — or, with none, the chain ends and the case is told. */
  private next(chain: OfferChain, now: number): void {
    const asked = new Set(chain.steps.map((s) => s.driverDid));
    for (const d of this.dispatch.driversForBag(chain.code, now)) {
      if (asked.has(d.driverDid)) continue;
      if (this.ask(chain, d, now)) {
        this.chains.set(chain.code, chain);
        return;
      }
    }
    this.finish(chain, 'nobody', new Date(now).toISOString(), `Bag ${chain.code}: asked ${chain.steps.length} driver${chain.steps.length === 1 ? '' : 's'} — none took it, and no other working driver can be reached now.`);
  }

  /** One driver asked: their offer, waiting STAFF_OFFER_WAIT_MIN, and a notice with "Take it" and "Not now" on it. */
  private ask(chain: OfferChain, d: { driverDid: string; name: string; km: number }, now: number): OfferStep | undefined {
    const offer = this.dispatch.offerBagTo(d.driverDid, chain.code, now, { ttlMin: STAFF_OFFER_WAIT_MIN });
    if (!offer) return undefined;
    const tote = this.totes.byCodeMaybe(chain.code);
    const step: OfferStep = { driverDid: d.driverDid, name: d.name, km: d.km, offerId: offer.offerId, at: new Date(now).toISOString(), until: offer.expiresAt };
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
    this.chains.set(chain.code, chain);
    this.cases.noteFor('Bags_Waiting', chain.place, { name: 'SeeBuyGet', key: 'system' }, note);
  }
}
