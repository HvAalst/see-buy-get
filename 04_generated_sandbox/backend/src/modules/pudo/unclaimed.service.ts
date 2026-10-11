import { Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { ParcelService } from './parcel.service';
import { AgentService } from './agent.service';
import { ShelfService } from './shelf.service';
import { ReturnService } from './return.service';
import { WalletGateService } from './wallet-gate.service';
import { EXTENSION_H, FREE_EXTENSIONS, UNCOLLECTED_H, holdingFeeFor } from './pudo.config';
import { Parcel, ReceiverIntent, isCollectable } from './pudo.types';

/** One line an operator can act on, for a parcel whose owner has given up their claim. */
export interface DisposalRow {
  parcelId: string;
  agentDid?: string;
  /**
   * The shop holding it, BY NAME. The console printed the DID in this column — eighteen characters of
   * did:glos: in the place an operator reads to know whose shelf this is and who is owed. An id on a
   * screen is a bug, and the screen cannot resolve a name it was never sent, so the server does.
   */
  shopName?: string;
  relinquishedAt: string;
  heldDays: number;
  declaredValue?: number;
  owedToShop: number;
}

/**
 * The end of a collection window, and the four things a person can do about it.
 *
 * WHAT THIS IS NOT: a way to stop somebody collecting their parcel. 'Unclaimed' marks a change in TERMS
 * — the free window is over, the shop is being paid by the day, somebody owes for that — and the box is
 * still on the shelf, still releasable to whoever holds the code, for as long as it is there. A status
 * that locked the door would punish precisely the one person who eventually did the right thing.
 *
 * THE DEFAULT IS SILENCE. Most receivers will never answer a final notice, so every path below has to be
 * an outcome BETTER than the default rather than a gate in front of it: with no answer at all the parcel
 * still becomes unclaimed, the store is still offered the return, and an operator can still close it.
 * Nothing in here is allowed to make the network wait on a person.
 *
 * WHO OWNS WHAT decides who may do what, and it is the constraint this whole file is shaped around.
 * Sender owns the shipment; receiver owns the goods; the network only ever holds custody. So the
 * receiver is the only party with anything to relinquish, a store can only offer to pay for a journey
 * home, and nobody at all can make a physical box stop existing by pressing a button.
 */
@Injectable()
export class UnclaimedService {
  constructor(
    private readonly parcels: ParcelService,
    private readonly shelf: ShelfService,
    private readonly returns: ReturnService,
    private readonly gate: WalletGateService,
    // Optional so the specs that build this by hand keep working — app.boot.spec catches it missing.
    @Optional() private readonly agents?: AgentService,
  ) {}

  /**
   * Move parcels past their free window into 'Unclaimed', and start their holding clock.
   *
   * A sweep rather than a reaction, for the same reason the reminder is one: nothing HAPPENS when a
   * parcel is not collected. There is no event to hang this on — the absence of one IS the event.
   *
   * Runs before the return sweep, and that ordering is the design: a store is asked whether it wants a
   * parcel home only once the network has established that nobody is coming for it.
   */
  sweep(now: number = Date.now()): Parcel[] {
    const moved: Parcel[] = [];
    for (const parcel of this.parcels.list({ status: 'Ready_For_Pickup' })) {
      // No stamp means a record written before readyAt existed. Ageing it off the scan list instead
      // would reset the clock every time somebody fumbled their collection code, so it is left alone.
      if (!parcel.readyAt) continue;
      if (now - new Date(parcel.readyAt).getTime() <= UNCOLLECTED_H * 3_600_000) continue;
      // Its receiver is not being shown the code (their account was moved without its PIN): the free window does not
      // run out on somebody who cannot collect. It closes on the first sweep after the code shows again.
      if (this.parcels.codeHeldUntil(parcel, now)) continue;
      moved.push(this.parcels.markUnclaimed(parcel.parcelId, now));
    }
    return moved;
  }

  /**
   * What is owed for the shelf slot, and what the shop has earned for holding it.
   *
   * ONE NUMBER FOR BOTH, deliberately: the shop's entitlement and the receiver's bill are the same
   * figure, and the moment they are computed in two places is the moment a shopkeeper and a counter
   * screen start disagreeing about it in front of a customer.
   */
  owed(parcelId: string, now: number = Date.now()): number {
    const parcel = this.parcels.get(parcelId);
    return holdingFeeFor({ unclaimedAt: parcel.unclaimedAt, now, shipmentCost: parcel.shipmentCost, settled: parcel.holdingSettled, perDay: parcel.holdingFeePerDay });
  }

  /**
   * The receiver answers the final notice.
   *
   * Each choice DOES something — see ReceiverIntent — because a reason field that changes nothing is a
   * survey, and this is not a survey. It is the last chance to reach an outcome better than the default.
   * The answer is recorded whichever it is, including the ones that move nothing operationally: "they
   * told us they are ill" is the difference between a network that wrote somebody's goods off and one
   * that knew what it was doing when it did.
   */
  respond(parcelId: string, choice: ReceiverIntent, note?: string, now: number = Date.now()): { parcel: Parcel; outcome: string } {
    const parcel = this.parcels.get(parcelId);
    if (!isCollectable(parcel.status)) {
      throw new GlosError('INVALID_STATE', 'That parcel is no longer waiting — it has already been collected or closed');
    }
    parcel.receiverResponse = { choice, at: new Date(now).toISOString(), note: note?.trim() || undefined };

    switch (choice) {
      case 'coming':
        return { parcel: this.extend(parcelId, now), outcome: 'extended' };
      case 'proxy':
        // The nomination needs a name, so it arrives on its own call. Answering "someone else will come"
        // already buys the time that makes making the nomination worth anything.
        return { parcel: this.extend(parcelId, now), outcome: 'awaiting-nomination' };
      case 'relinquish':
        return { parcel: this.relinquish(parcelId, now), outcome: 'relinquished' };
      case 'not-mine':
        // NOT a kind of abandonment, and the one answer after which disposal is the last thing we may
        // do. It is a claim against whoever sent it, so the parcel stays exactly where it is and any
        // open return offer stays open — the store may well still want it back, now more than before.
        this.parcels.annotate(parcelId, 'receiver', 'receiver says they did not order this');
        return { parcel, outcome: 'raised-with-sender' };
    }
  }

  /**
   * More time — the answer we most want to hear.
   *
   * THE FIRST ONE IS FREE. The common response to a final notice is no response, and silence costs this
   * network more than a few shelf-days: it ends in a return nobody wanted or a box nobody may lawfully
   * touch. Charging somebody for telling us the truth teaches them that saying nothing is cheaper. The
   * second is priced, because by then it has stopped being information and become storage.
   *
   * A priced extension is charged as HOLDING rather than as a fee of its own: the shop is holding the
   * same slot either way, and a second meter on one shelf bills one thing twice.
   */
  extend(parcelId: string, now: number = Date.now()): Parcel {
    const parcel = this.parcels.get(parcelId);
    if (!isCollectable(parcel.status)) throw new GlosError('INVALID_STATE', 'That parcel is no longer waiting');
    const free = (parcel.extensionsUsed ?? 0) < FREE_EXTENSIONS;
    // Anything already owed is settled to the shop as the window closes, so a second window starts its
    // meter at zero instead of quietly compounding what the first one ran up.
    if (!free) this.settleToShop(parcel, now);
    const days = Math.round(EXTENSION_H / 24);
    return this.parcels.reopenCollection(
      parcelId,
      now,
      !free,
      // The days bought now run at today's rate, in the money of the company whose shop holds the parcel.
      free ? `held ${days} more days at the receiver's request` : `held ${days} more days · ${this.parcels.holdingRateNow(parcel).currency} ${this.parcels.holdingRateNow(parcel).perDay.toFixed(2)} per day`,
    );
  }

  /**
   * Somebody else will come for it.
   *
   * A second code, bound to a named person. This STRENGTHENS the release secret rather than bending it:
   * the workaround it replaces is a receiver reading their own code down the phone to a neighbour, which
   * we cannot see, cannot record, and cannot afterwards tell apart from a stranger who guessed. The
   * receiver's own code keeps working — naming a neighbour does not stop you coming yourself — and the
   * shop still learns neither of them.
   */
  nominate(parcelId: string, name: string, phoneHash?: string, now: number = Date.now()): { name: string; code: string } {
    const parcel = this.parcels.get(parcelId);
    if (!isCollectable(parcel.status)) throw new GlosError('INVALID_STATE', 'That parcel is no longer waiting');
    const clean = (name ?? '').trim();
    if (!clean) throw new GlosError('VALIDATION_FAILED', 'Name the person who will collect it');
    parcel.collectProxy = { name: clean, phoneHash, code: `COL-${randomBytes(4).toString('hex').toUpperCase()}`, nominatedAt: new Date(now).toISOString() };
    // The NAME goes in the trail; the code does not. A shop reading its own parcel's history must be
    // able to see who is expected, and must not be able to see what will let them through the door.
    this.parcels.annotate(parcelId, 'receiver', `${clean} named to collect on the receiver's behalf`);
    // NAMING SOMEBODY IS AN ANSWER. Before this it was only a code: the receiver had told us a neighbour
    // was coming, and the network went on treating the parcel as one nobody had spoken for — still
    // lapsing, and still being offered back to the store while that neighbour was on their way.
    parcel.receiverResponse ??= { choice: 'proxy', at: new Date(now).toISOString() };
    // …and it buys the same time any other "somebody is coming" answer buys. Guarded on the status rather
    // than on a counter so it is bought ONCE: a receiver who answered 'proxy' first has already left
    // Unclaimed, and a second grant here would spend their free extension on the same decision twice.
    if (parcel.status === 'Unclaimed') this.extend(parcelId, now);
    return { name: clean, code: parcel.collectProxy.code };
  }

  /**
   * The receiver gives up their claim.
   *
   * Three things this is not. It is not a store's decision — the goods are the buyer's, and you cannot
   * abandon what you do not own. It is not 'Voided' — the shipment was performed, all the way, and
   * saying otherwise puts a lie in the history a claim would be judged against. And it is not disposal:
   * there is a real box in a real shop, and destroying it is a legal shape per jurisdiction rather than
   * a button. What it does is put the parcel in a queue a person has to work.
   *
   * A FUNDED CLAIM OUTRANKS IT. If a store still has an open offer to pay for the journey home they get
   * it: the receiver said they did not want it, not that it should be destroyed, and disposing of goods
   * somebody is standing ready to pay to recover is the one outcome nobody here asked for.
   */
  relinquish(parcelId: string, now: number = Date.now()): Parcel {
    const parcel = this.parcels.get(parcelId);
    if (!isCollectable(parcel.status)) throw new GlosError('INVALID_STATE', 'That parcel is no longer waiting');
    // Giving up early still ends the free window: the shop is holding a slot for goods nobody wants.
    if (parcel.status === 'Ready_For_Pickup') this.parcels.markUnclaimed(parcelId, now);
    parcel.relinquishedAt = new Date(now).toISOString();
    const claimed = this.hasOpenOffer(parcelId);
    this.parcels.annotate(
      parcelId,
      'receiver',
      claimed ? 'receiver gave up their claim · the sender may still bring it home' : 'receiver gave up their claim · awaiting disposal',
    );
    return parcel;
  }

  /**
   * The parcels a person has to deal with by hand.
   *
   * Relinquished, with nobody standing ready to pay for them, and a real box on a real shelf. A QUEUE
   * rather than a status, because what happens to them is decided by the law of the sister's
   * jurisdiction and not by this system — and modelling a disposal rule we do not know would be worse
   * than showing an operator the list and letting them apply the one they do.
   */
  awaitingDisposal(now: number = Date.now()): DisposalRow[] {
    return this.parcels
      .list({ status: 'Unclaimed' })
      .filter((p) => p.relinquishedAt && !this.hasOpenOffer(p.parcelId))
      .map((p) => ({
        parcelId: p.parcelId,
        agentDid: p.destAgentDid,
        ...(p.destAgentDid && this.agents?.find(p.destAgentDid)?.shopName ? { shopName: this.agents.find(p.destAgentDid)!.shopName } : {}),
        relinquishedAt: p.relinquishedAt!,
        heldDays: Math.max(0, Math.floor((now - new Date(p.unclaimedAt ?? p.relinquishedAt!).getTime()) / 86_400_000)),
        declaredValue: p.declaredValue,
        owedToShop: holdingFeeFor({ unclaimedAt: p.unclaimedAt, now, shipmentCost: p.shipmentCost, settled: p.holdingSettled, perDay: p.holdingFeePerDay }),
      }))
      .sort((a, b) => a.relinquishedAt.localeCompare(b.relinquishedAt));
  }

  /**
   * Close out a parcel nobody will pay for, and settle what the shop is owed for having held it.
   *
   * THIS IS WHERE THE SHOP IS MADE WHOLE. Everywhere else the holding fee is recovered from whoever
   * ended the situation — the receiver at the counter, the store inside its return cost. Here nobody
   * ended it, and the network absorbs it rather than letting a shortfall settle quietly on a shopkeeper
   * who did the work and had no say in any of it.
   */
  writeOff(parcelId: string, by: string, reason?: string, now: number = Date.now()): { parcelId: string; paidToShop: number } {
    const parcel = this.parcels.get(parcelId);
    if (!parcel.relinquishedAt) {
      throw new GlosError('INVALID_STATE', 'Only a parcel whose owner has given up their claim can be closed this way');
    }
    if (this.hasOpenOffer(parcelId)) {
      throw new GlosError('INVALID_STATE', 'The sender still has an open offer to bring this home');
    }
    const paidToShop = this.settleToShop(parcel, now);
    // cancel() releases the shelf slot and writes the terminal scan — the shop gets its slot back here
    // exactly as it does on the return path, which was the point of all of this.
    this.parcels.cancel(parcelId, by, reason?.trim() || 'disposed under local rules');
    return { parcelId, paidToShop };
  }

  /**
   * Pay the destination shop what the shelf slot earned, from the network.
   *
   * Called on the paths where nobody else settles it. The shop's entitlement never depended on which of
   * those paths happened — it accrued from the day the free window closed — and this is the difference
   * between that being true and it merely being said.
   */
  settleToShop(parcel: Parcel, now: number = Date.now()): number {
    const owed = holdingFeeFor({ unclaimedAt: parcel.unclaimedAt, now, shipmentCost: parcel.shipmentCost, settled: parcel.holdingSettled, perDay: parcel.holdingFeePerDay });
    if (owed <= 0 || !parcel.destAgentDid) return 0;
    this.gate.payLabour(parcel.destAgentDid, owed, parcel.parcelId, 'parcel', parcel.sellerEntityId);
    parcel.holdingSettled = (parcel.holdingSettled ?? 0) + owed;
    return owed;
  }

  private hasOpenOffer(parcelId: string): boolean {
    return this.returns.offersFor(parcelId).some((o) => o.status === 'offered');
  }
}
