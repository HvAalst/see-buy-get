import { auditActor } from '../../foundation/auth/acting';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { GlosError } from '../../foundation/http/glos-error';
import { isSandbox } from '../../foundation/runtime/sandbox';

/**
 * WHICH MEMBER OF STAFF — by name for the record, and by the key their sessions answer to for telling two apart.
 *
 * The shared operator key cannot say who holds it, so outside a sandbox a decision that needs two people refuses it.
 * On a laptop the typed name stands in, so a demo can play both people.
 *
 * One place, because every two-person decision asks the same question: checking a business, moving an account.
 */
export function staffOf(actor: IntrospectionResult | undefined, typed?: string): { name: string; key: string } {
  if (!isSandbox() && !actor?.actorName) {
    throw new GlosError('FORBIDDEN', 'A decision that needs two people needs a named sign-in — the shared operator key cannot say who is at the keyboard');
  }
  const name = auditActor(actor as IntrospectionResult, typed);
  return { name, key: actor?.actorName && actor.revocationKey ? actor.revocationKey : `typed:${name}` };
}
