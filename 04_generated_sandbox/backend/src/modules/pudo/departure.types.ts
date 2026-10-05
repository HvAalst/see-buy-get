import { ClientRef } from './business-client.types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CARGO_NATURES, type CargoNature } from './cargo.types';

/**
 * F3 — SPACE FOR SALE ON A RUN THAT IS HAPPENING ANYWAY.
 *
 * Everything in this network so far runs one way: a shipper posts a load and carriers bid for it. That is
 * the right shape when the load is the scarce thing. It is the wrong shape for a fleet that already runs
 * Nairobi to Mombasa every Tuesday with four tonnes of air in the back — the cheapest capacity in the
 * network is a departure that is leaving regardless, and until now there was no way to sell it.
 *
 * So this inverts the market: the CARRIER advertises, and a shipper takes.
 */

/**
 * HOW A CARRIER CHARGES — and it is not one answer.
 *
 * Per kilogram is the basis an engineer reaches for first and the one that quietly loses money. Ship
 * tempex three hundred kilometres and it weighs almost nothing while filling the whole truck: priced by
 * weight that run is nearly free, and the fleet has paid for the diesel, the driver and the day. (The
 * user's own example, 2026-09-24, and the reason this is a declared enum rather than a number.)
 *
 * So the fleet says which basis it is selling on, from the three that a PLANNED run can honestly use:
 *
 *  - `per_trip`  a flat price, per booking, whatever is in it. The honest default for a scheduled line —
 *                and note what it means on a SHARED run: three shippers on one truck each pay it, because
 *                each is buying a place on the trip rather than a share of the diesel. A fleet selling the
 *                WHOLE vehicle expresses that by declaring the capacity it actually has, so one booking
 *                fills it and no second one can be taken.
 *  - `per_km`    distance — what a long haul is really priced on, and what vehicles already publish.
 *  - `per_kg`    weight, for the loads where weight genuinely is what costs: steel, grain, liquids.
 *
 * `per_hour` WAS HERE AND IS GONE, and the reason is worth keeping.
 *
 * It looked like the fourth real basis — city work, a tail-lift, two flights of stairs. But a departure is
 * a run that is already planned: it leaves at a stated time and goes a known distance, so the driver names
 * the price up front and the shipper agrees to it before anything moves. Nobody sells a scheduled line by
 * the hour, because neither side knows the number until it is over. (The user, 2026-09-24: *"this usually
 * is settled upfront. The driver names his price, the distance is known and so is the expected price for
 * the trip."*)
 *
 * What is genuinely hourly is the thing that goes WRONG — see `WaitingTerms` below.
 */
export const RATE_BASES = ['per_trip', 'per_km', 'per_kg'] as const;
export type RateBasis = (typeof RATE_BASES)[number];

/**
 * WAITING TIME — the one clock in freight that really does run by the hour.
 *
 * A truck arrives at the appointed hour to load and is told to wait. The trip price does not move, because
 * the trip has not changed; what has been spent is the driver's day, and the trade's own answer is that the
 * side who caused the delay pays for it. (The user, 2026-09-24: *"it happens pretty often that a truck comes
 * at an appointed time for loading and is then told to wait. It is usually acceptable that the place where
 * the delay happens has to pay for the waiting time."*)
 *
 * Two numbers, and both matter:
 *
 *  - `freeMin`  loading is EXPECTED to take a while, and a carrier who starts billing at minute one is not
 *               charging for a delay, they are charging for the job. The free window is what makes the rest
 *               of this defensible: nothing is owed until the wait stops being ordinary.
 *  - `perHour`  what is owed after that, pro rata by the minute. Not per started hour: rounding eleven
 *               minutes up to a whole one is the move that turns a fair rule into a grievance, and a fleet
 *               that wants a bigger number can raise the rate in the open.
 *
 * Optional on a departure, and absent means FREE: a fleet that has not said it charges for waiting has not
 * charged for waiting, and no clock runs against a shipper who was never told about one.
 */
export class WaitingTerms {
  /** Minutes at each stop that are simply part of the job. */
  @ApiProperty()
  freeMin: number;
  /** Per hour beyond the free window, pro rata, in the departure's currency. */
  @ApiProperty()
  perHour: number;
}

/**
 * WHERE THE DELAY HAPPENED — which is the same question as who pays for it.
 *
 * The whole point of demurrage is that it does not land on whoever happens to be holding the contract. A
 * truck kept standing at the collection gate was kept there by the shipper; one kept standing at the
 * delivery gate was kept there by the consignee. Recording the PLACE is what makes the charge attributable,
 * and a model that only knew "this booking waited 90 minutes" would have to guess, which in practice means
 * billing the shipper for the receiver's warehouse.
 */
export const DELAY_PLACES = ['loading', 'delivery'] as const;
export type DelayPlace = (typeof DELAY_PLACES)[number];

/**
 * One stop's clock, as the driver actually recorded it.
 *
 * Both timestamps are the SERVER's, taken when the driver taps. A typed time is a claim and would make this
 * a bargaining chip; a tap is a record. The cost of that choice is a driver who forgets to tap, which is why
 * the fleet can waive a charge with a reason rather than argue about a number nobody can check.
 */
export class WaitingRecord {
  @ApiProperty({ enum: DELAY_PLACES })
  where: DelayPlace;
  /** When the vehicle presented itself. Until this exists there is no clock and nothing is owed. */
  arrivedAt: string;
  /** When it was free to go. Absent while the driver is still standing there. */
  @ApiPropertyOptional()
  freeAt?: string;
  /** Total minutes on site, free window included. Kept so the charge can be re-read rather than trusted. */
  @ApiProperty()
  waitedMin: number;
  /** Minutes beyond the free window — the only ones that cost anything. */
  @ApiProperty()
  billableMin: number;
  /** What those minutes came to. Zero while the wait is still ordinary, and zero when waived. */
  @ApiProperty()
  amount: number;
  /**
   * WHO IT LANDS ON, spelled out rather than inferred at reading time: `shipper` for a delay at loading,
   * `consignee` for one at delivery. Stored because the attribution is the feature.
   */
  @ApiProperty({ enum: ['shipper', 'consignee'] })
  bearer: 'shipper' | 'consignee';
  /** Set when the fleet let it go, with their reason. A waived charge stays visible: it happened. */
  @ApiPropertyOptional()
  waivedReason?: string;
}

/**
 * HOW THE SHIPPER PAYS THE FLEET — and the answer is never "through us".
 *
 * A shipper agreed 450 on our screens and nothing anywhere told them who to pay, when, or how. That is
 * the hole, and the fix is NOT to invent an invoice: we are not the merchant of record for this. Board
 * freight is priced BY us and books a payable to the carrier at delivery because the shipper paid US.
 * A departure is the fleet's own price, agreed directly, and money we never collected must not become a
 * liability we pretend to hold — money model rule 5, from the other side.
 *
 * So this is a RECORD AND NEVER A POSTING, in the words CV2 already settled on for exactly this: two
 * parties paying each other off-platform, written down so neither has to remember what was said.
 *
 * Reusing SETTLE_METHODS / SETTLE_WHEN rather than a second vocabulary, because a shipper who has read
 * one settlement card in this product has read them all.
 */
export const SETTLE_METHODS = ['cash', 'mobile_money', 'bank', 'other'] as const;
export type SettleMethod = (typeof SETTLE_METHODS)[number];
export const SETTLE_WHEN = ['on_pickup', 'on_delivery', 'after_delivery'] as const;
export type SettleWhen = (typeof SETTLE_WHEN)[number];

export class SettleTerms {
  @ApiProperty({ enum: SETTLE_METHODS })
  method: SettleMethod;
  @ApiProperty({ enum: SETTLE_WHEN })
  when: SettleWhen;
}

/**
 * WHAT THE CARRIER CARRIES OF THE RISK — said, and never ours.
 *
 * The network does not insure goods on a run and is not going to. What it was doing instead was saying
 * NOTHING, and silence on a screen that quotes a price reads as cover: a shipper who books 450 through us
 * and is never told otherwise reasonably assumes somebody is behind the goods.
 *
 * So the carrier states its own position — a goods-in-transit policy and what it is good for, or plainly
 * that it holds none — and the shipper states what the load is worth. Neither number is a promise of ours.
 * Together they are the two facts a forwarder or a broker needs to arrange real cover for the gap, which
 * is the most this network can honestly offer: not the cover, but a state legible enough to price.
 */
export class CarrierCover {
  /** What their goods-in-transit policy pays up to, per load, in the run's currency. Zero means none. */
  @ApiProperty()
  limit: number;
  /** The insurer and policy, as the carrier writes it. What a forwarder rings to verify. */
  @ApiPropertyOptional()
  policy?: string;
}

/**
 * What the driver recorded at the door. The board’s shape, field for field, on purpose: a shipper
 * comparing a haul and a run should not find two different ideas of what proof is.
 */
export class ProofOfDelivery {
  /** Who took the goods, in their own name. Two characters minimum — "x" is not a receiver. */
  @ApiProperty()
  receiverName: string;
  /** A photograph of the goods as put down. A mediaId, adopted from the driver’s own upload. */
  @ApiProperty()
  photoRef: string;
  /** Anything the driver wants on the record — a reservation, a remark, a note about the state. */
  @ApiPropertyOptional()
  remarks?: string;
  /** The unload checklist keys they confirmed. */
  @ApiProperty({ type: [String] })
  confirmed: string[];
  at: string;
  /** Who tapped it — the driver at the door, or the office closing a run off a bad signal. */
  by: string;
}

/** What the driver confirmed before pulling away, and the photograph of the load as secured. */
export class LoadSafety {
  @ApiProperty({ type: [String] })
  confirmed: string[];
  @ApiPropertyOptional()
  securementPhotoRef?: string;
  at: string;
  by: string;
}

/**
 * WHY A CARRIER GIVES A SHIPPER'S SPACE BACK — coded, with room for what the list does not cover.
 *
 * Coded rather than free text because the shipper reads the reason in their own language, and because the
 * reasons are not alike: "the goods are not what was booked" is the one a shipper can put right and book
 * again, while every other one means finding another truck. `overbooked` is on the list on purpose — the
 * space promised twice is exactly what own-load recording exists to prevent, and a carrier who says so
 * has told the shipper the truth. `other` carries a sentence, and is refused without one.
 */
export const GIVE_BACK_REASONS = ['vehicle_unavailable', 'no_driver', 'goods_not_as_booked', 'overbooked', 'other'] as const;
export type GiveBackReason = (typeof GIVE_BACK_REASONS)[number];

/**
 * WHY A CARRIER CALLS OFF A WHOLE RUN — and what each reason is ABOUT, which decides what happens next.
 *
 *  - About the carrier's own means (`vehicle_unavailable`, `no_driver`): nothing changed in the world, other
 *    trucks on the route still go, so the shipper is pointed at them. The first two share their codes and
 *    words with a single booking given back: the same act, described once.
 *  - About the road or the border (`road_closed`, `border_closed`): every truck on that route meets the same
 *    closure, so the shipper is told NOT to rush onto another run there. The closure itself goes onto the
 *    hazard map through the ordinary report procedure, as a step the carrier confirms — never automatically,
 *    because "the road was closed" is the cheapest excuse there is, and one carrier's word must not move the
 *    whole network.
 *  - The carrier's business choice (`not_enough_loads`): honest to offer, and the one reason that says
 *    something about reliability. Recorded; never scored without a decision to.
 */
export const RUN_CANCEL_REASONS = ['vehicle_unavailable', 'no_driver', 'road_closed', 'border_closed', 'not_enough_loads', 'other'] as const;
export type RunCancelReason = (typeof RUN_CANCEL_REASONS)[number];

/** Reasons that are about the route itself: every truck there meets them, so nobody is sent to another run on it. */
export const ROUTE_REASONS: readonly RunCancelReason[] = ['road_closed', 'border_closed'];

/**
 * Each reason as a sentence, for the two places that print English: the consignment note and the notice.
 * `other` has none of its own — the carrier's words are the reason.
 */
export const RUN_REASON_SENTENCE: Record<RunCancelReason, string> = {
  vehicle_unavailable: 'The truck is off the road',
  no_driver: 'There is no driver for the run',
  road_closed: 'The road is closed',
  border_closed: 'The border is closed',
  not_enough_loads: 'Too little was booked for the run to go',
  other: '',
};

export class RunCancellation {
  @ApiProperty({ enum: RUN_CANCEL_REASONS })
  reason: RunCancelReason;
  /** The carrier's own words: required for `other`, optional beside any coded reason. */
  @ApiPropertyOptional()
  note?: string;
  at: string;
  /** The hazard report filed with it, when the carrier put a closure on the map. */
  @ApiPropertyOptional()
  constraintId?: string;
}

/** Who gave a booking back, and — when it was the carrier — why. Kept on the booking so both sides can read it back. */
export class BookingCancellation {
  @ApiProperty({ enum: ['shipper', 'carrier'] })
  by: 'shipper' | 'carrier';
  @ApiPropertyOptional({ enum: GIVE_BACK_REASONS })
  reason?: GiveBackReason;
  /** The carrier's own words: required for `other`, optional beside any coded reason. */
  @ApiPropertyOptional()
  note?: string;
  at: string;
}

export const CLAIM_KINDS = ['damaged', 'short', 'not_received'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

/**
 * A SHIPPER SAYING SOMETHING WENT WRONG — recorded, evidenced, and never adjudicated by us.
 *
 * The board has claims with awards, caps and clawback, because on a board haul the network is the
 * merchant of record: it took the shipper’s money, so it can take some of it back off the carrier. A
 * run is the fleet’s own price paid directly to them. We never held the money and we carry no cover, so
 * an award of ours would be an award of somebody else’s money — which is not a thing to build.
 *
 * What CAN be built, and is the thing informal freight is actually missing, is the RECORD: the claim,
 * dated, against a consignment note, beside a photograph of the load as secured and a photograph of it
 * as delivered, with the carrier’s answer next to it. Two parties arguing in a WhatsApp thread have
 * none of that. Two parties arguing over this have all of it, and so does the forwarder, insurer or
 * magistrate either of them takes it to.
 *
 * The same three kinds as the board, in the same words, because a shipper should not have to learn a
 * second vocabulary for the same bad day.
 */
export class BookingClaim {
  @ApiProperty({ enum: CLAIM_KINDS })
  kind: ClaimKind;
  @ApiProperty()
  description: string;
  /** The shipper’s own photograph of what arrived. Beside the carrier’s two, not instead of them. */
  @ApiPropertyOptional()
  photoRef?: string;
  /** What they say it cost them, in the run’s currency. Their figure, like the declared value. */
  @ApiPropertyOptional()
  amount?: number;
  @ApiProperty()
  raisedAt: string;
  /**
   * WHAT THE CARRIER SAID BACK, which is the half that makes this a record rather than an accusation.
   *
   * `accepted` and `refused` are the carrier’s own words about their own liability — never ours, and
   * never binding through us. Absent means they have not answered yet, which is itself a fact worth
   * being able to point at.
   */
  @ApiPropertyOptional({ enum: ['accepted', 'refused'] })
  answer?: 'accepted' | 'refused';
  @ApiPropertyOptional()
  answerNote?: string;
  @ApiPropertyOptional()
  answeredAt?: string;
}

export class DepartureRate {
  @ApiProperty({ enum: RATE_BASES })
  basis: RateBasis;
  /** In the currency of the country the fleet stands in. */
  @ApiProperty()
  amount: number;
  /**
   * The least this departure will take, whatever the arithmetic says.
   *
   * Not a detail: on every basis except `per_trip` a small booking can price at almost nothing, and a
   * carrier who has stopped, opened the back and strapped something down has already spent the expensive
   * part of the job. Optional, because a flat trip price needs no floor.
   */
  @ApiPropertyOptional()
  minCharge?: number;
  @ApiProperty()
  currency: string;
}

export class DepartureBooking {
  bookingId: string;
  /**
   * WHOSE LOAD THIS IS — and it is the difference between a marketplace and a run sheet.
   *
   *  `sold`  a shipper found this departure in the offer list and took the space. We quoted it, they
   *          agreed to it, and both sides can read the same price for the same reason.
   *  `own`   the fleet already had this customer long before it came anywhere near us. Nothing here was
   *          sold, priced or promised by this network; the fleet is telling us the load exists so that
   *          the space it fills stops being advertised to somebody else.
   *
   * F4, and the reason F3 is usable at all. A fleet with a book of business had two options and both were
   * bad: stay off the offer list, or publish capacity it has not got. The second ends with a shipper
   * standing at a gate beside a truck that was full before they booked it.
   */
  @ApiProperty({ enum: ['sold', 'own'] })
  kind: 'sold' | 'own';
  /**
   * Who bought the space — a store, a shop, a person. Whoever the freight belongs to.
   *
   * On an `own` load this is the FLEET's own DID, because the fleet is the party answerable to us for what
   * is on their truck and their customer has no account here to name. Who it is actually for is `customer`.
   */
  shipperDid: string;
  /** B2 — which person in a business booked it: the business's DID is shared by everybody in it. */
  @ApiPropertyOptional() bookedByName?: string;
  /**
   * The key behind this booking's public tracking link — the same link format and page as a load's. Only on space
   * somebody bought (`sold`): a fleet's own customer is not ours to hand a link to. Absent on bookings made before.
   */
  @ApiPropertyOptional() trackingKey?: string;
  /** B4 — the client an expeditor sent this for, as their agent. The client is the SENDER on the note. A copy, not a link. */
  @ApiPropertyOptional({ type: ClientRef }) onBehalfOf?: ClientRef;
  /**
   * THE FLEET'S OWN CUSTOMER, in whatever name the fleet files them under. Only on `own`, and required
   * there: a load with no customer against it is not a booking, it is a hole in the capacity that nobody
   * can account for a week later.
   *
   * A name and not an account, because the whole point is that these people are not here. In a country
   * where we only match, the fleet IS the local operator and arrives carrying its customers with it.
   *
   * It never leaves the fleet's own screens. A shipper reading the offer list learns how full the truck
   * is and not one thing about who else is on it.
   */
  @ApiPropertyOptional()
  customer?: string;
  /** The load itself, where one exists on the board. Absent for space bought ahead of the goods. */
  @ApiPropertyOptional()
  freightId?: string;
  description: string;
  weightKg: number;
  /** Cubic metres, where the shipper measured. See `binds` for why both axes are kept. */
  @ApiPropertyOptional()
  volumeM3?: number;
  /**
   * WHAT THE GOODS ARE, in the vocabulary the board already uses.
   *
   * A booking used to be a free-text description, a weight and a volume — which meant hazmat could be put
   * on a food-grade tanker and nothing anywhere would notice. The board has known better since S30: a
   * nature maps to a vehicle capability, and a load is never offered to a vehicle that lacks it.
   *
   * The same rule, on the same enum, because a shipper who has learned what FOP means on one screen has
   * learned it on all of them — and because a second vocabulary for the same fact is how two halves of a
   * product drift into disagreeing about whether a load may travel.
   */
  @ApiProperty({ enum: CARGO_NATURES })
  nature: CargoNature;
  /**
   * WHAT IT IS WORTH, as the shipper declares it. Optional and never verified.
   *
   * Not a valuation and not a promise: it is the number a forwarder needs to arrange cover, the number a
   * claim is argued against, and the number that makes "the carrier's policy stops at 200,000" mean
   * something rather than nothing. Absent is a real answer — plenty of loads are not worth insuring.
   */
  @ApiPropertyOptional()
  declaredValue?: number;
  /**
   * WHICH AXIS ACTUALLY FILLED THE TRUCK for this booking — 'weight' or 'space'.
   *
   * Recorded rather than derived later, because it is the whole argument for why the price was what it
   * was, and a fleet reading a past run deserves to see that the load which cost them the trip was the
   * light one. It is also the honest answer to "why did my pallet of foam cost that".
   */
  @ApiProperty({ enum: ['weight', 'space'] })
  binds: 'weight' | 'space';
  /**
   * What it was quoted at, on the departure's basis, in the departure's currency.
   *
   * On an `own` load this is whatever the fleet said they charge, and zero where they did not say. It is
   * their figure for their own run sheet: we did not quote it, we do not hold anybody to it, and no ledger
   * moves because of it. Which is why every screen keeps it apart from what was sold here.
   */
  @ApiProperty()
  price: number;
  /** What the basis was applied to — kilometres, kilograms, or 1 for a trip. Kept so the price can be re-read. */
  @ApiProperty()
  units: number;
  at: string;
  /**
   * WHERE THIS LOAD GOT TO, and the third state is the one the model was missing.
   *
   * A run used to go open → departed and then stop. The goods reached a door, somebody took them, and no
   * record of that existed anywhere — while the rest of this product is meticulous about custody. The
   * waiting clock even had the driver standing at the DELIVERY gate tapping, which proved the truck got
   * there and never that the load came off it.
   *
   *  `booked`     aboard, or going to be
   *  `delivered`  handed over, by the driver who was standing there
   *  `cancelled`  given back before it travelled, by the shipper or the fleet
   */
  @ApiProperty({ enum: ['booked', 'delivered', 'cancelled'] })
  status: 'booked' | 'delivered' | 'cancelled';
  /** Set when `cancelled`: which side gave it back, and the carrier's reason. Absent on bookings given back before it was kept. */
  @ApiPropertyOptional({ type: BookingCancellation })
  cancellation?: BookingCancellation;
  /** When it was handed over. The server's clock, like the gate taps, and for the same reason. */
  @ApiPropertyOptional()
  deliveredAt?: string;
  /**
   * PROOF, at the standard the board already holds a delivery to.
   *
   * This used to be an optional name and nothing else, which made the same act — a driver handing goods
   * to somebody at a door — provable on a board haul and unprovable on a run. A shipper discovering that
   * asymmetry after a load went missing would be right to feel misled, and the fix is not to soften the
   * board: it is to hold this to the same line. A name AND a photograph, because "delivered" without
   * either is the driver’s word against the sender’s, and with them it is box 24 of a consignment note.
   *
   * It is the DRIVER this protects first, which is the part worth remembering when it feels like a
   * burden at a gate in the rain.
   */
  @ApiPropertyOptional({ type: ProofOfDelivery })
  pod?: ProofOfDelivery;
  /** Who took it. Kept flat as well as on the proof, because every screen reads this one line. */
  @ApiPropertyOptional()
  receivedBy?: string;
  /**
   * WHAT THE DRIVER CONFIRMED AT LOADING — the securement half, which the board also has.
   *
   * A load that arrives broken is argued about at the OTHER end of the journey, and the photograph that
   * settles it was taken hours earlier. Recorded at the loading gate, where the driver is already
   * standing and already tapping.
   */
  @ApiPropertyOptional({ type: LoadSafety })
  loadSafety?: LoadSafety;
  /** What the shipper says went wrong, and what the carrier said back. Never decided by us. */
  @ApiPropertyOptional({ type: BookingClaim })
  claim?: BookingClaim;
  /**
   * THE CLOCKS, one per stop, and empty on a run where nothing went wrong.
   *
   * Kept on the BOOKING rather than the departure because a shared truck waits for one shipper at a time:
   * three loads on the same run, and the two-hour stand at the second collection belongs to the second
   * shipper alone. A departure-level total would be exactly the unattributable number this exists to avoid.
   */
  @ApiProperty({ type: [WaitingRecord] })
  waiting: WaitingRecord[];
}

export class Departure {
  departureId: string;
  /** The fleet's own published line. Only its owner may put a departure on it. */
  corridorId: string;
  lineName: string;
  managerDid: string;
  company: string;
  originZone: string;
  destZone: string;
  /** When the vehicle actually goes. The one fact a shipper plans around. */
  leavesAt: string;
  /**
   * WHAT IS FOR SALE, ON BOTH AXES, because whichever runs out first is what "full" means.
   *
   * A truck is not a number of kilograms. The parcel side of this product worked that out already and
   * prices a parcel on `max(kg, volume / divisor)`; this is the same fact at truck scale. A fleet that
   * declared only kilograms would sell four tonnes of tempex it cannot physically fit, and one that
   * declared only cubic metres would sell a load of steel that breaks its axle.
   *
   * Space is optional: a fleet that has not measured its hold says nothing rather than guessing, and then
   * only weight binds — which is stated on the booking rather than assumed.
   */
  /**
   * WHICH TRUCK, and it is required — unlike the driver.
   *
   * The thing being sold here is the space in a particular hold, so a run that names no vehicle is
   * selling a number somebody typed. It was exactly that: capacityKg was a bare figure, and a fleet
   * could publish forty tonnes on a van with nothing anywhere to say otherwise.
   *
   * The DRIVER stays optional for the opposite reason. Who is behind the wheel on Tuesday is a rostering
   * detail that changes; which vehicle is going is the offer.
   */
  vehicleId: string;
  /** What a shipper and a gate actually recognise. Copied at declaration, like the line name. */
  plate: string;
  vehicleClass: string;
  /**
   * What is for sale, which is at most what the vehicle holds.
   *
   * DERIVED BY DEFAULT and capped always: a fleet may sell less than the whole truck — a genuine choice,
   * and since F4 usually expressed by recording their own load instead — but never more than it has.
   */
  capacityKg: number;
  /**
   * Cubic metres, still DECLARED rather than derived: the vehicle registry holds a weight and no volume,
   * so there is nothing to read it from. Left that way rather than guessed from the class, because a
   * box body and a flatbed of the same tonnage are not the same offer.
   */
  @ApiPropertyOptional()
  capacityM3?: number;
  @ApiProperty({ type: DepartureRate })
  rate: DepartureRate;
  /**
   * What happens when the truck is kept standing. Absent means the fleet does not charge for waiting —
   * see `WaitingTerms`, and note that absent is FREE rather than unlimited-and-unspoken.
   */
  @ApiPropertyOptional({ type: WaitingTerms })
  waiting?: WaitingTerms;
  /**
   * How the shipper pays the fleet. Required of every new run; absent on records declared before this
   * existed, and a screen reading absence says the fleet has not said rather than inventing an answer.
   */
  @ApiPropertyOptional({ type: SettleTerms })
  settle?: SettleTerms;
  /**
   * What the CARRIER's own insurance covers, where they have said. Absent means they have not said, which
   * a screen reports as exactly that — never as "covered" and never as "not covered".
   */
  @ApiPropertyOptional({ type: CarrierCover })
  cover?: CarrierCover;
  /** The distance the line runs, where it is known — what `per_km` is multiplied by. */
  @ApiPropertyOptional()
  km?: number;
  /**
   * WHO IS DRIVING IT, once the fleet has said.
   *
   * Not decoration: the waiting clock is recorded by the person standing at the gate, so without this there
   * is no one holding a phone who is allowed to start it. A departure with no driver yet is ordinary — the
   * fleet sells the space first and rosters later — and nothing about it can be clocked until there is one.
   */
  @ApiPropertyOptional()
  driverDid?: string;
  @ApiPropertyOptional()
  driverName?: string;
  /** What the fleet wants a shipper to know: a tail-lift, a reefer, "no hazmat". */
  @ApiPropertyOptional()
  note?: string;
  /**
   * open       taking bookings
   * closed     the fleet stopped selling, and what is booked still travels
   * departed   it has gone
   * cancelled  the run is not happening, and everybody booked on it has to be told
   */
  @ApiProperty({ enum: ['open', 'closed', 'departed', 'cancelled'] })
  status: 'open' | 'closed' | 'departed' | 'cancelled';
  /** When the fleet said it had left. Stamped once, at that moment — what a tracking page counts "under way" from. */
  @ApiPropertyOptional() departedAt?: string;
  /**
   * Why it was called off, kept rather than only announced.
   *
   * The notice goes out once, the day it happens; the shipper looking at the wreckage of their week a
   * fortnight later is reading this screen, not their notifications. Required when anybody was aboard.
   */
  @ApiPropertyOptional()
  cancelledReason?: string;
  /**
   * The same, structured: the coded reason the apps translate, the carrier's words, and the hazard report
   * filed with it. `cancelledReason` stays as the sentence, because the consignment note prints English.
   */
  @ApiPropertyOptional({ type: RunCancellation })
  cancellation?: RunCancellation;
  @ApiProperty({ type: [DepartureBooking] })
  bookings: DepartureBooking[];
  createdAt: string;
}

/** A departure as a SHIPPER reads it: what is left, and what theirs would cost. */
export class DepartureOffer {
  departureId: string;
  lineName: string;
  company: string;
  originZone: string;
  destZone: string;
  leavesAt: string;
  @ApiProperty({ type: DepartureRate })
  rate: DepartureRate;
  /**
   * The waiting terms, on the SHIPPER's side of the glass — because the one thing worse than being charged
   * for keeping a truck standing is being charged for it by surprise. A shipper who can see "60 minutes
   * free, then 40 an hour" before booking can plan a loading bay around it; one who learns it afterwards
   * has been billed for a rule they were never told.
   */
  @ApiPropertyOptional({ type: WaitingTerms })
  waiting?: WaitingTerms;
  /** Who they pay and when — before booking, for the same reason the waiting terms are. */
  @ApiPropertyOptional({ type: SettleTerms })
  settle?: SettleTerms;
  /** What the carrier's own policy covers. Absent means they have not said. Never our cover. */
  @ApiPropertyOptional({ type: CarrierCover })
  cover?: CarrierCover;
  /** What the vehicle can handle, so a shipper knows before typing whether their load can go on it. */
  @ApiProperty({ type: [String] })
  handles: string[];
  @ApiPropertyOptional()
  km?: number;
  @ApiPropertyOptional()
  note?: string;
  /** The class of vehicle it is going on. Not the plate: that is the fleet's, and a shipper does not need it. */
  vehicleClass: string;
  /** What is still for sale. Both axes, for the same reason the capacity has both. */
  remainingKg: number;
  @ApiPropertyOptional()
  remainingM3?: number;
  /**
   * How many loads are already aboard — a run nobody has taken and a nearly-full one are different offers.
   *
   * Counts the fleet's OWN customers too, because this is a fact about the truck rather than about the
   * market: five loads aboard means five places the driver has to stop. It is only a count. Who they are
   * is the fleet's business and stays on the fleet's screens.
   */
  booked: number;
}

/**
 * WHAT A SHIPPER BOOKED, AS THE SHIPPER READS IT — the view this feature shipped without.
 *
 * There were three ways to read a departure and none of them was this one: the fleet's own runs, the
 * public offer list, and the driver's roster. So a shop took space, saw a toast, and the booking left
 * their world — they could not check when it leaves, show it to anybody, or find out it had been called
 * off. The route to give the space back existed and no screen could reach it.
 *
 * It is the run and the booking flattened together on purpose. A shipper does not think "my booking on
 * departure dep_a3f"; they think "the pallet going to Mombasa on Tuesday", and every field they need to
 * think that is here. What is NOT here is anybody else's load: how full the truck is belongs to the
 * offer list, and who else is on it belongs to nobody.
 */
export class MyDepartureBooking {
  bookingId: string;
  /** The public tracking link to hand to whoever is receiving the goods — or to the client an expeditor booked for. */
  @ApiPropertyOptional() trackingKey?: string;
  @ApiPropertyOptional() trackingUrl?: string;
  /** B4 — the client an expeditor sent this for, as their agent. The client is the SENDER on the note. A copy, not a link. */
  @ApiPropertyOptional({ type: ClientRef }) onBehalfOf?: ClientRef;
  departureId: string;
  company: string;
  lineName: string;
  originZone: string;
  destZone: string;
  leavesAt: string;
  /** What they sent, what it weighed, what it cost — their own row, read back. */
  description: string;
  @ApiProperty({ enum: CARGO_NATURES })
  nature: CargoNature;
  @ApiPropertyOptional()
  declaredValue?: number;
  weightKg: number;
  @ApiPropertyOptional()
  volumeM3?: number;
  price: number;
  currency: string;
  /** Where cover stands on this load, kept on the booking because that is where it is read months later. */
  @ApiPropertyOptional({ type: CarrierCover })
  cover?: CarrierCover;
  @ApiProperty({ enum: ['booked', 'delivered', 'cancelled'] })
  bookingStatus: 'booked' | 'delivered' | 'cancelled';
  /**
   * WHO gave it back and why. The shipper's screen used to read every cancelled booking as "You
   * cancelled" — including the ones the carrier gave back, which is telling somebody they did a thing
   * that was done to them.
   */
  @ApiPropertyOptional({ type: BookingCancellation })
  cancellation?: BookingCancellation;
  /**
   * THE RUN's state, which is a different fact from the booking's and the one that usually matters.
   *
   * A booking still reading `booked` on a run reading `cancelled` is not a contradiction: it is the
   * difference between goods somebody gave back and goods stranded by a fleet, and a shipper looking at
   * the wreckage of their week needs to see which happened to them.
   */
  @ApiProperty({ enum: ['open', 'closed', 'departed', 'cancelled'] })
  runStatus: 'open' | 'closed' | 'departed' | 'cancelled';
  /** Why the run was called off. The notice went out once; this screen is read afterwards. */
  @ApiPropertyOptional()
  cancelledReason?: string;
  /** Structured: which kind of reason, so the shipper's screen can say what to do next in their own language. */
  @ApiPropertyOptional({ type: RunCancellation })
  runCancellation?: RunCancellation;
  /** Other runs on the same route still open for booking — offered only when the reason is not the route itself. */
  @ApiPropertyOptional()
  alternatives?: number;
  @ApiPropertyOptional()
  deliveredAt?: string;
  @ApiPropertyOptional()
  receivedBy?: string;
  /** The proof itself — the shipper is the party it exists for, so they can read it, not just its date. */
  @ApiPropertyOptional({ type: ProofOfDelivery })
  pod?: ProofOfDelivery;
  /** Their own claim, and the carrier’s answer to it. */
  @ApiPropertyOptional({ type: BookingClaim })
  claim?: BookingClaim;
  /** Whether there is still something to claim about: delivered, and inside the window. */
  claimable: boolean;
  /** The waiting terms they agreed to, so a charge is never the first they hear of the rule. */
  @ApiPropertyOptional({ type: WaitingTerms })
  waiting?: WaitingTerms;
  /** And how they settle it, on the booking as well as the offer — read long after the offer is gone. */
  @ApiPropertyOptional({ type: SettleTerms })
  settle?: SettleTerms;
  /** What standing time has cost THEM — their own rows only, never another shipper's on the same truck. */
  @ApiProperty({ type: [WaitingRecord] })
  waits: WaitingRecord[];
  /** Whether they can still take it off. False once the truck has gone, and once it has been handed over. */
  cancellable: boolean;
  at: string;
}
