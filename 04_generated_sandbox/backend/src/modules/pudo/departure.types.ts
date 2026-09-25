import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
  status: 'booked' | 'cancelled';
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
  capacityKg: number;
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
  @ApiPropertyOptional()
  km?: number;
  @ApiPropertyOptional()
  note?: string;
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
