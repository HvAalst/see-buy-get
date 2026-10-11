import { SetMetadata } from '@nestjs/common';

/**
 * THE ENGINE UNDERNEATH IS NOT A DOOR — outside a sandbox its own routes are for network staff only.
 *
 * SeeBuyGet runs on a general engine: identity and wallets, shipments, matching, tracking, reputation, a control
 * tower, a settlement and escrow engine. The product uses pieces of it from the inside. But each piece also came
 * with routes of its own, written before anybody was told apart: most ask only for "a valid token" — any shop's, any
 * driver's — and take no identity at all; the identity and wallet ones ask for nothing, "for the prototype so the
 * wallet UX is demoable", a credit and a cash-out among them. None of the nine apps calls any of them.
 *
 * Found 2026-10-11 while closing the client secret, and closed the same day under a rule that already stood: a
 * convenience for a laptop is gated on being a laptop. So on a sandbox they are as they were — demos and tests use
 * them — and anywhere else every route of a controller marked with this is refused to everybody but a member of
 * staff signed in to their own account: a route marked `@Public()` included, and the setup key included.
 *
 * It is a mark on the CONTROLLER, read by the one guard before anything else, so a route added to one of these
 * later is closed outside a sandbox without anybody remembering to close it.
 */
export const STAFF_OUTSIDE_SANDBOX_KEY = 'authStaffOutsideSandbox';

export const StaffOnlyOutsideSandbox = () => SetMetadata(STAFF_OUTSIDE_SANDBOX_KEY, true);
