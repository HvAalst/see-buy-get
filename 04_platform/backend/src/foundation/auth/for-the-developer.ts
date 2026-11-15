import { SetMetadata } from '@nestjs/common';
import type { IntrospectionResult } from './auth.types';

/**
 * 2026-11-15 — A STORE'S DEVELOPER signs in as the store, under their own name (modules/pudo/store-developer.service.ts):
 * their sign-in carries the store's role and DID, so every door the store's opens would open for them too — its money,
 * its orders, its buyers, its account. So it is turned round, as the counter's is (at-the-counter.ts): a developer is let
 * through ONLY a door marked `@ForTheDeveloper()` — the store's record, its keys, where its order updates go and their
 * messages — and refused at every other, in the guard, before the handler runs. A route added later is the owner's until
 * somebody looks at it and marks it.
 */
export const FOR_THE_DEVELOPER_KEY = 'authForTheDeveloper';
export const ForTheDeveloper = () => SetMetadata(FOR_THE_DEVELOPER_KEY, true);

/** The key a developer's sessions are revoked by: one per developer of one store, so taking them out ends only that. */
export const STORE_DEVELOPER_KEY_PREFIX = 'storedev:';

/** Is this sign-in a store's developer — not the store's own (its owner's email and password)? */
export function isStoreDeveloper(actor: IntrospectionResult | undefined): boolean {
  return actor?.role === 'genesis' && typeof actor.revocationKey === 'string' && actor.revocationKey.startsWith(STORE_DEVELOPER_KEY_PREFIX);
}

/** Said to a developer at a door that is the owner's. */
export const DEVELOPER_ONLY = 'A developer’s sign-in opens only “Connect your shop system”: the store’s keys and where its order updates go. The owner does the rest.';
