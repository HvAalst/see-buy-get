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
 * So the fleet says which basis it is selling on, from the four road freight actually uses:
 *
 *  - `per_trip`  a flat price, per booking, whatever is in it. The honest default for a scheduled line —
 *                and note what it means on a SHARED run: three shippers on one truck each pay it, because
 *                each is buying a place on the trip rather than a share of the diesel. A fleet selling the
 *                WHOLE vehicle expresses that by declaring the capacity it actually has, so one booking
 *                fills it and no second one can be taken.
 *  - `per_km`    distance — what a long haul is really priced on, and what vehicles already publish.
 *  - `per_hour`  time — city work, waiting, a tail-lift and two flights of stairs. Cost the clock, not the cargo.
 *  - `per_kg`    weight, for the loads where weight genuinely is what costs: steel, grain, liquids.
 */
export const RATE_BASES = ['per_trip', 'per_km', 'per_hour', 'per_kg'] as const;
export type RateBasis = (typeof RATE_BASES)[number];

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
  /** Who bought the space — a store, a shop, a person. Whoever the freight belongs to. */
  shipperDid: string;
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
  /** What it was quoted at, on the departure's basis, in the departure's currency. */
  @ApiProperty()
  price: number;
  /** What the basis was applied to — kilometres, hours, kilograms, or 1 for a trip. Kept so the price can be re-read. */
  @ApiProperty()
  units: number;
  at: string;
  status: 'booked' | 'cancelled';
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
  /** The distance the line runs, where it is known — what `per_km` is multiplied by. */
  @ApiPropertyOptional()
  km?: number;
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
  @ApiPropertyOptional()
  km?: number;
  @ApiPropertyOptional()
  note?: string;
  /** What is still for sale. Both axes, for the same reason the capacity has both. */
  remainingKg: number;
  @ApiPropertyOptional()
  remainingM3?: number;
  /** How many are already aboard — a run nobody has taken and a nearly-full one are different offers. */
  booked: number;
}
