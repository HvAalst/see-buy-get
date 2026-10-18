import { SetMetadata } from '@nestjs/common';
import type { IntrospectionResult } from './auth.types';

/**
 * THE PEOPLE AT A SHOP'S COUNTER work it as the shop, under their own name (modules/pudo/shop-staff.types.ts). Their
 * sign-in carries the shop's role and the shop's DID, so every door a shop's sign-in opens would open for them too:
 * the shop's account, its recovery email, its payout number, its prices, its records. A door-by-door refusal missed
 * those on the day it was written (2026-10-18).
 *
 * So it is turned round, as the unlabelled route was: a member of staff is let through ONLY a door marked
 * `@AtTheCounter()` — taking parcels in, handing them over, the bags, the shelf as it stands, the reads the counter
 * needs — and refused at every other, in the guard, before the handler runs. A route added later is the owner's
 * until somebody looks at it and marks it.
 */
export const AT_THE_COUNTER_KEY = 'authAtTheCounter';
export const AtTheCounter = () => SetMetadata(AT_THE_COUNTER_KEY, true);

/** The key a staff session is revoked by: one per place at a counter, so taking somebody out of one shop ends only that. */
export const SHOP_STAFF_KEY_PREFIX = 'shopstaff:';

/** Is this sign-in one of a shop's staff — not the shop's own (its owner's email and password)? */
export function isShopStaff(actor: IntrospectionResult | undefined): boolean {
  return actor?.role === 'agent' && typeof actor.revocationKey === 'string' && actor.revocationKey.startsWith(SHOP_STAFF_KEY_PREFIX);
}

/** Said to a member of a shop's staff at a door that is the owner's. */
export const OWNER_ONLY = 'The shop’s owner does this, signed in as the shop. Staff work the counter.';
