import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SHOP_STAFF_KEY_PREFIX } from '../../foundation/auth/at-the-counter';

// Who a staff sign-in is, and what it is told at the owner's doors, live beside the guard that refuses them.
export { isShopStaff, OWNER_ONLY } from '../../foundation/auth/at-the-counter';

/**
 * THE PEOPLE AT A SHOP'S COUNTER (the user, 2026-10-18: "who is at the counter" → staff sign in with their own phone + PIN).
 *
 * A shop is one account with one email and password, and it was passed round: whoever stood at the counter typed it, and
 * every act was recorded against the shop. Now the owner adds a person by phone number; they accept from their own
 * sign-in; on the shop's phone each signs in with their number and PIN; every counter act is kept under their name; and
 * the owner alone handles money, prices, hours and people. Removing somebody ends their sessions at once.
 *
 * A NUMBER ADDRESSES, IT ADMITS NOBODY: the owner gets the same answer whether or not the number has an account, and the
 * invitation waits for whoever proves the number with their own PIN.
 */
export const MAX_SHOP_STAFF = 10;

/** The key a staff session is revoked by: one per membership, so taking somebody out of one shop ends only that. */
export const STAFF_KEY_PREFIX = SHOP_STAFF_KEY_PREFIX;

export interface ShopStaffMember {
  memberId: string;
  shopDid: string;
  /** Who the invitation is for until they accept: the number's hash, and the account that number was certainly for. */
  phoneHash: string;
  forPersonDid?: string;
  phoneEnds: string;
  /** What the shop calls them, and what every act of theirs is recorded under. */
  name: string;
  invitedBy: string;
  invitedAt: string;
  personDid?: string;
  joinedAt?: string;
  declinedAt?: string;
  removedAt?: string;
  removedBy?: string;
}

export type ShopStaffState = 'invited' | 'working' | 'declined' | 'removed';

/** One of the shop's people, as its owner sees them. */
export class ShopStaffView {
  @ApiProperty() memberId: string;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'The last three digits of the number they were added by.' }) phoneEnds: string;
  @ApiProperty({ enum: ['invited', 'working', 'declined', 'removed'] }) state: ShopStaffState;
  @ApiProperty() invitedAt: string;
  @ApiPropertyOptional() joinedAt?: string;
  @ApiPropertyOptional() removedAt?: string;
}

/** A shop a person was added to, as they see it from their own sign-in. */
export class ShopInvitationView {
  @ApiProperty() memberId: string;
  @ApiProperty() shopDid: string;
  @ApiProperty() shopName: string;
  @ApiProperty({ description: 'What the shop calls them.' }) name: string;
  @ApiProperty({ enum: ['invited', 'working'] }) state: 'invited' | 'working';
  @ApiProperty() invitedAt: string;
}

/** A staff session: a sign-in that acts as the shop, under this person's name. */
export class ShopStaffSession {
  @ApiProperty() shopDid: string;
  @ApiProperty() shopName: string;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'Their place at this counter: what the app keeps their acts made without a signal under.' }) memberId: string;
  @ApiProperty() token: { access_token: string; expires_in?: number };
}

/** One act at the counter, and who did it. Kept for the shop's owner only — never on the parcel, which other shops read. */
export class CounterAct {
  @ApiProperty() at: string;
  @ApiProperty({ description: 'What was done: took a parcel in, handed one over, …' }) act: string;
  @ApiPropertyOptional({ description: 'The parcel, bag or load it was about.' }) ref?: string;
  @ApiProperty({ description: 'Who: the person’s name, or "the owner" for the shop’s own sign-in.' }) by: string;
  @ApiProperty() staff: boolean;
}
