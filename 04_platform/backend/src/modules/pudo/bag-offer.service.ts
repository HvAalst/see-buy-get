import { Injectable, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import type { Signer } from '../../foundation/entity/same-person';
import { DispatchService } from './dispatch.service';
import { FlagCaseService } from './flag-case.service';
import { MonitorService } from './monitor.service';
import { NotificationService } from './notification.service';
import { ToteService } from './tote.service';

/**
 * 2026-11-06 — A BAG NOBODY HAS TAKEN, OFFERED BY STAFF TO A DRIVER THEY CHOOSE (the owner: "go ahead"). A closed bag no
 * driver near it took, offered once more further away and still waiting, is a Bags_Waiting case. From that case staff see
 * its bags, the working drivers an offer would reach — nearest first — and offer a bag to the one they choose: that
 * driver's own offer, priced as any bag, and a notice that opens it in one tap. The case keeps it, in the name of who did it.
 */
@Injectable()
export class BagOfferService {
  constructor(
    private readonly monitor: MonitorService,
    private readonly dispatch: DispatchService,
    private readonly totes: ToteService,
    private readonly cases: FlagCaseService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  /** The bags of a Bags_Waiting case: at the place it is named after, closed and waiting. */
  bagsOf(caseId: string): { place: string; bags: ReturnType<MonitorService['bagsAt']> } {
    const c = this.cases.get(caseId);
    if (c.kind !== 'Bags_Waiting') throw new GlosError('INVALID_STATE', 'This case is not about bags waiting for a driver');
    return { place: c.subject, bags: this.monitor.bagsAt(c.subject) };
  }

  /** The working drivers an offer of this bag would reach now, nearest first. */
  drivers(code: string): ReturnType<DispatchService['driversForBag']> {
    this.totes.requireByCode(code); // 404 for a bag that is not there
    return this.dispatch.driversForBag(code);
  }

  /** Offer it to the driver chosen: refused, before anything is written, where an offer could not reach them now. */
  offer(code: string, driverDid: string, staff: Signer): { offerId: string; driverDid: string; code: string } {
    const tote = this.totes.requireByCode(code);
    const chosen = this.dispatch.driversForBag(code).find((d) => d.driverDid === driverDid);
    if (!chosen) throw new GlosError('INVALID_STATE', 'That driver cannot take this bag now — not working, out of their hours, too far, or their vehicle cannot carry it. Choose another.');
    const offer = this.dispatch.offerBagTo(driverDid, code);
    if (!offer) throw new GlosError('INVALID_STATE', 'That driver cannot take this bag now. Choose another.');
    const place = this.dispatch.pickupPlace(tote.locationId)?.label ?? 'a shop';
    void this.notifications
      ?.notify(driverDid, {
        kind: 'load_nearby',
        title: 'Operations offers you a bag',
        body: `A bag at ${place}${tote.destinationLabel ? `, heading to ${tote.destinationLabel},` : ''} is waiting for a driver, and operations asks whether you can take it. It is ${chosen.km} km from you: open it to see what it pays.`,
        link: `/?offer=${offer.offerId}`,
        tag: `load:${code}:staff:${driverDid}`,
        data: { code, offerId: offer.offerId },
      })
      .catch(() => undefined);
    this.cases.noteFor('Bags_Waiting', place, staff, `Offered bag ${code} to ${chosen.name}, ${chosen.km} km away: told, and the notice opens their offer.`);
    return { offerId: offer.offerId, driverDid, code };
  }
}
