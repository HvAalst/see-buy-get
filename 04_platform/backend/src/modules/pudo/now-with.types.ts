import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 2026-11-15 — WHO HAS IT NOW (the owner: "the receiver should see which driver or hub has his parcel at the moment it is
 * passed on"; plan R1). Named as the network contracts with them: a shop or a sorting hub by its name; on the road the
 * company (a fleet's trading name, or the name an independent courier rides under) and the kind of vehicle. Never a person's
 * phone, never a person's own name where a company carries it.
 */
export const NOW_WITH_KINDS = ['sender', 'shop', 'hub', 'carrier'] as const;
export type NowWithKind = (typeof NOW_WITH_KINDS)[number];

export class NowWithView {
  @ApiProperty({ enum: NOW_WITH_KINDS }) kind: NowWithKind;
  /** The shop's, the hub's or the carrier's name — absent where the record names nobody we can look up. */
  @ApiPropertyOptional() name?: string;
  /** On the road: the kind of vehicle (bike, motorcycle, tuktuk, car, van, bus, truck). */
  @ApiPropertyOptional() vehicle?: string;
  /** Since when it has been in these hands. */
  since: string;
  /** A load: false while a driver has taken it but not yet picked it up. */
  @ApiPropertyOptional() pickedUp?: boolean;
}
