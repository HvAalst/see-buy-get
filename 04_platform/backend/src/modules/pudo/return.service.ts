import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { ParcelService, parcelCurrency } from './parcel.service';
import { VendorService } from './vendor.service';
import { RoutingService } from './routing.service';
import { ShelfService } from './shelf.service';
import { WalletGateService } from './wallet-gate.service';
import { RETURN_OFFER_TTL_H, measuredFactor } from './pudo.config';
import { ReturnOffer } from './pudo.types';

/**
 * Getting a stranded parcel home.
 *
 * A parcel nobody collects used to have nowhere to go. It now has an exit, and this is the half that
 * decides whether anybody wants to pay for it.
 *
 * THE THING THAT SHAPES ALL OF THIS: the buyer paid for the goods, so the goods are the BUYER'S — sender
 * owns the shipment, receiver owns the goods, and COD is zero by construction so a store order is always
 * pre-paid by the time it reaches a shelf. A store therefore cannot abandon it, keep it, or dispose of it;
 * you cannot abandon what you do not own. What a store CAN do is offer to pay for its journey back. That
 * is the entire scope of this service, and the reason a decline leaves the parcel exactly where it was
 * rather than resolving anything.
 *
 * THE BUYER IS NOT IN THIS FLOW, and that is not an omission. For an uncollected parcel the goods never
 * left the network's custody: they are on a shop's shelf, so the return is one more leg between two nodes
 * and needs nobody to carry anything anywhere. A return the BUYER requests — where they have the goods at
 * home — is a different flow, and it is the one where a store's acceptance has to grant somebody else the
 * right to mint.
 */
@Injectable()
export class ReturnService {
  private readonly offers = new PersistentMap<string, ReturnOffer>('pudo-return-offers');

  constructor(
    private readonly parcels: ParcelService,
    private readonly vendors: VendorService,
    private readonly routing: RoutingService,
    private readonly shelf: ShelfService,
    private readonly gate: WalletGateService,
  ) {}

  /**
   * Offer every store the returns it might want, for parcels that have been stranded long enough.
   *
   * A sweep rather than a reaction, for the same reason the uncollected reminder is one: nothing HAPPENS
   * when a parcel is not collected, so there is no event to hang this on.
   *
   * Idempotent per parcel — a stranded parcel accumulates one offer, not one per sweep. A store that
   * declined is not asked again either: they answered, and asking again is nagging somebody to change
   * their mind about their own money.
   */
  sweep(now: number = Date.now()): ReturnOffer[] {
    const raised: ReturnOffer[] = [];
    // 'Unclaimed' rather than an arithmetic re-derivation of the same window. The status IS the fact
    // that nobody came; asking a store about a parcel the network has not yet admitted is stranded would
    // put two different answers to one question in front of two different people.
    for (const parcel of this.parcels.list({ status: 'Unclaimed' })) {
      if (!parcel.vendorId) continue;
      if (parcel.relinquishedAt) continue; // its owner has already let it go — see UnclaimedService
      if (this.offersFor(parcel.parcelId).length) continue; // asked once
      const offer = this.offerFor(parcel.parcelId, now);
      if (offer) raised.push(offer);
    }
    return raised;
  }

  /**
   * Build the offer for one stranded parcel, or nothing.
   *
   * Nothing, silently, is the common answer: a store that has declared no threshold has agreed to be
   * billed for nothing, and goods worth less than the journey home are not worth the journey home. Both
   * are ordinary outcomes rather than errors — this runs over the whole shelf on a timer.
   */
  offerFor(parcelId: string, now: number = Date.now()): ReturnOffer | null {
    const parcel = this.parcels.get(parcelId);
    if (parcel.status !== 'Unclaimed') return null;
    if (!parcel.vendorId || !parcel.destAgentDid) return null;
    // Back to the shop it started from. A parcel that began at a store's own dock has no origin SHOP to
    // return to, and inventing one would send somebody's goods to a place nobody chose — left for the
    // dock-return case rather than guessed at.
    const toAgentDid = parcel.originAgentDid;
    if (!toAgentDid) return null;

    const vendor = this.vendors.get(parcel.vendorId);
    // A store the network cannot reach cannot be the receiver of anything: the parcel would arrive at a
    // shop with nobody expecting it, which is the situation this whole feature exists to end.
    if (!vendor.contactMobile) return null;
    const threshold = vendor.shippingPolicy?.recoverAboveValue;
    // Undefined is not zero. A store that has said nothing has not agreed to be billed for anything;
    // a store that typed 0 has said "always ask me", which is a different sentence and a real one.
    if (threshold == null) return null;

    // What the goods are worth. `declaredValue` where the store declared one, else what the buyer paid —
    // and a parcel with neither tells us nothing about whether it is worth recovering.
    const declaredValue = parcel.declaredValue ?? parcel.subtotal;
    if (declaredValue == null) return null;
    if (declaredValue <= threshold) return null;

    // THE JOURNEY HOME IS NOT THE JOURNEY OUT. A corridor runs in a direction, so a route that carried
    // this parcel here may not carry it back — and an unroutable one must be silence, not an exception.
    // This runs over the whole shelf on a timer: one parcel that cannot get home would otherwise take
    // every parcel behind it down with it, and the sweep would look like it was working.
    let quote;
    try {
      quote = this.routing.quoteShipment(
        parcel.destAgentDid,
        toAgentDid,
        parcel.size,
        parcel.dimensionsCm ? measuredFactor({ ...parcel.dimensionsCm, kg: parcel.weightKg }) : undefined,
        { kg: parcel.weightKg, fragile: parcel.fragile },
      );
    } catch {
      return null; // nowhere to send it back through — offering a return we cannot perform is worse than none
    }
    // The shelf's half in the store's own money, beside the journey's. With no rate between the two moneys today there
    // is no figure the store could be held to, so no offer — as with a journey that cannot be routed.
    const held = this.holdingFor(parcelId, quote.currency, now);
    if (held.billed === undefined) return null;
    const offer: ReturnOffer = {
      offerId: `ret_${randomBytes(8).toString('hex')}`,
      parcelId,
      vendorId: parcel.vendorId,
      fromAgentDid: parcel.destAgentDid,
      toAgentDid,
      declaredValue,
      returnCost: quote.locked.gross,
      holdingCost: held.billed,
      currency: quote.currency,
      status: 'offered',
      offeredAt: new Date(now).toISOString(),
      // Days, not the hour a checkout quote gets. A person has to read this, think about a box they
      // cannot see, and decide about their own money — and the parcel is not going anywhere meanwhile.
      expiresAt: new Date(now + RETURN_OFFER_TTL_H * 3_600_000).toISOString(),
    };
    this.offers.set(offer.offerId, offer);
    return offer;
  }

  /**
   * The store says yes: mint the journey home and bill them for it.
   *
   * Billed here, at the figure the offer showed. A store that agreed to one number and was charged
   * another would be right to stop trusting every number this network gives them.
   *
   * The stranded parcel is CLOSED as it goes — its shelf slot released, which is the whole reason any of
   * this exists. It is not "delivered": nobody collected it, and recording it as though somebody had
   * would put a lie in the one history a damage claim is judged against.
   */
  accept(offerId: string, vendorId: string, now: number = Date.now()): { offer: ReturnOffer; returnParcelId: string } {
    const offer = this.requireOpen(offerId, vendorId, now);
    const parcel = this.parcels.get(offer.parcelId);
    if (parcel.status !== 'Unclaimed') {
      // Somebody came for it after all. The best possible outcome, and not an error to shout about.
      offer.status = 'expired';
      offer.decidedAt = new Date(now).toISOString();
      this.offers.set(offer.offerId, offer);
      throw new GlosError('INVALID_STATE', 'That parcel is no longer waiting — it has already been collected or closed');
    }

    const quote = this.routing.quoteShipment(
      offer.fromAgentDid,
      offer.toAgentDid,
      parcel.size,
      parcel.dimensionsCm ? measuredFactor({ ...parcel.dimensionsCm, kg: parcel.weightKg }) : undefined,
      { kg: parcel.weightKg, fragile: parcel.fragile },
    );
    const vendor = this.vendors.get(vendorId);
    // What the shop is owed for the days it held the slot. The store is ending the situation, so the
    // store settles it — and this is the whole of the "recover from whoever ends it" rule in one line.
    const held = this.holdingFor(offer.parcelId, quote.currency, now);
    if (held.billed === undefined) throw new GlosError('FX_REQUIRED', `No rate between ${held.owed.currency} and ${quote.currency} today — try again later`);
    // What the store pays for the shelf, in its own money; the shop is paid what it is owed, in its own (below).
    const holding = held.billed;
    const total = Math.round((quote.locked.gross + holding) * 100) / 100;
    // Checked BEFORE anything moves. The forward path can leave a parcel unpaid and block its label,
    // which is fine for a warehouse; here a store's "yes" that fails afterwards leaves a shop holding a
    // parcel that is now nobody's problem. Checked against the TOTAL, so a store cannot afford the
    // transport, be billed for both, and go negative on the half it never saw coming.
    if (this.vendors.balanceOf(vendorId) < total) {
      throw new GlosError(
        'WALLET_INSUFFICIENT',
        holding > 0
          ? `Top up first — the journey home costs ${quote.locked.gross.toFixed(2)} plus ${holding.toFixed(2)} for the shelf, ${total.toFixed(2)} ${quote.currency} in all`
          : `Top up first — the journey home costs ${quote.locked.gross.toFixed(2)} ${quote.currency}`,
      );
    }

    const { parcel: returned } = this.parcels.createInbound({
      vendorId,
      externalOrderId: parcel.externalOrderId,
      originAgentDid: offer.fromAgentDid,
      destAgentDid: offer.toAgentDid,
      // The store is the one collecting it now. Its own contact, not the buyer's — the buyer is the
      // person who did not come, and addressing the return to them would send it straight back.
      buyerMobile: vendor.contactMobile!,
      // THE SAME BOX. Copied rather than re-measured: re-measuring lets it change size between two legs
      // of one journey, which is how two people end up unable to settle what was in it.
      size: parcel.size,
      dimensionsCm: parcel.dimensionsCm,
      weightKg: parcel.weightKg,
      declaredValue: parcel.declaredValue,
      contentPhotoRef: parcel.contentPhotoRef ?? 'return',
      // The same box: its photo is the first leg's, already ours — not a new one the store must upload.
      photoOfParcel: parcel.parcelId,
      fragile: parcel.fragile,
      natureCode: parcel.natureCode,
      items: parcel.items,
      shippingPolicy: vendor.shippingPolicy,
      routeMode: 'locked',
      quote,
    });

    // The shop that held the slot is paid for it, and the store that just agreed to that is billed.
    // Both halves or neither: paying the shop out of a charge that never landed would be the network
    // quietly funding a store's return, which is not what anybody agreed to.
    if (held.owed.amount > 0) {
      this.vendors.billShipment(vendorId, parcel.parcelId, holding);
      this.gate.payLabour(offer.fromAgentDid, held.owed.amount, parcel.parcelId, 'parcel', parcel.sellerEntityId);
      parcel.holdingSettled = (parcel.holdingSettled ?? 0) + held.owed.amount;
    }

    // The stranded one is closed and its slot handed back. This is the point of the whole feature: a
    // return that left the shelf occupied would leave the network exactly as short of slots as before.
    this.shelf.release(offer.fromAgentDid, parcel.parcelId);
    this.parcels.closeAsReturned(parcel.parcelId, returned.parcelId);

    offer.status = 'accepted';
    offer.decidedAt = new Date(now).toISOString();
    offer.holdingCost = holding; // frozen at what was actually charged, not left ticking on a closed offer
    offer.returnParcelId = returned.parcelId;
    this.offers.set(offer.offerId, offer);
    return { offer, returnParcelId: returned.parcelId };
  }

  /**
   * The store says no.
   *
   * And the parcel stays exactly where it is, because it is still the buyer's. A decline settles who is
   * NOT paying for a journey home; it settles nothing about whose goods these are. What happens next —
   * notice to the owner, a holding period, then disposal under the rules of the sister's jurisdiction —
   * is a legal shape this system does not yet model, and inventing one here would be worse than the gap.
   */
  decline(offerId: string, vendorId: string, reason?: string, now: number = Date.now()): ReturnOffer {
    const offer = this.requireOpen(offerId, vendorId, now);
    offer.status = 'declined';
    offer.decidedAt = new Date(now).toISOString();
    offer.declineReason = reason?.trim() || undefined;
    this.offers.set(offer.offerId, offer);
    return offer;
  }

  /** What this store has been asked to decide. Expired ones are reported as expired, never as waiting. */
  pendingFor(vendorId: string, now: number = Date.now()): ReturnOffer[] {
    return [...this.offers.values()]
      .filter((o) => o.vendorId === vendorId)
      .map((o) => this.lapse(o, now))
      .filter((o) => o.status === 'offered')
      .sort((a, b) => a.offeredAt.localeCompare(b.offeredAt));
  }

  offersFor(parcelId: string): ReturnOffer[] {
    return [...this.offers.values()].filter((o) => o.parcelId === parcelId);
  }

  get(offerId: string): ReturnOffer {
    const offer = this.offers.get(offerId);
    if (!offer) throw new GlosError('NOT_FOUND', `Return offer not found: ${offerId}`);
    return offer;
  }

  /** An offer past its date is expired as it is READ, so a store's screen and this service can never
   *  disagree about whether they still have a decision to make. */
  private lapse(offer: ReturnOffer, now: number): ReturnOffer {
    if (offer.status === 'offered' && new Date(offer.expiresAt).getTime() <= now) {
      offer.status = 'expired';
      this.offers.set(offer.offerId, offer);
    }
    // The holding meter is re-read here too, for the same reason the expiry is: a store's screen and
    // this service must never be able to disagree about what deciding nothing has cost so far.
    if (offer.status === 'offered') offer.holdingCost = this.holdingFor(offer.parcelId, offer.currency, now).billed ?? offer.holdingCost;
    return offer;
  }

  /**
   * What the shop holding this parcel is owed for the slot right now, and what the store pays for it in `currency`.
   *
   * The shop is owed it in its own money (ParcelService.holdingOwed — the user, 2026-10-25); a store selling from
   * another country pays the converted sum, at the buffered rate every converted price carries. Within one country
   * the two are one figure. `billed` is undefined where no rate between the two moneys is known. Zero once settled.
   */
  private holdingFor(parcelId: string, currency: string, now: number): { owed: { amount: number; currency: string }; billed?: number } {
    const owed = this.parcels.holdingOwed(this.parcels.get(parcelId), now);
    return { owed, billed: this.parcels.inMoney(owed.amount, owed.currency, currency, true) };
  }

  private requireOpen(offerId: string, vendorId: string, now: number): ReturnOffer {
    const offer = this.lapse(this.get(offerId), now);
    // Another store's offer is NOT FOUND, never FORBIDDEN — the same rule the public shipment read keeps.
    if (offer.vendorId !== vendorId) throw new GlosError('NOT_FOUND', `Return offer not found: ${offerId}`);
    if (offer.status !== 'offered') throw new GlosError('INVALID_STATE', `That return was already ${offer.status}`);
    return offer;
  }
}
