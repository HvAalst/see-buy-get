import { ActorRole } from '../../foundation/auth/auth.types';
import { ParticipantRole } from '../m1/participant.types';
import { AccountRole } from './account.service';

/**
 * The bridge between three role systems that never spoke to each other (see the actor-taxonomy note).
 *
 *  - AccountRole ('pudo'|'driver'|'mdp') — how the PUDO field apps sign a participant in.
 *  - ActorRole   — WHICH APP the token belongs to (routing + UI register).
 *  - ParticipantRole (M1) — the shipper/carrier profile axis, orthogonal to the above.
 *
 * PUDO signs an agent in as 'pudo'; the token carries role 'agent'. This is the only mapping the
 * S2 login path needs; the ParticipantRole side is here for the M1/genesis surface to grow into.
 */
export const ACCOUNT_ROLE_TO_ACTOR: Record<AccountRole, ActorRole> = {
  pudo: 'agent',
  driver: 'driver',
  mdp: 'mdp',
};

export function actorRoleForAccount(role: AccountRole): ActorRole {
  return ACCOUNT_ROLE_TO_ACTOR[role] ?? 'anon';
}

/** Best-effort profile mapping for the M1/genesis side — a PUDO participant is carrier-like. */
export const ACCOUNT_ROLE_TO_PARTICIPANT: Record<AccountRole, ParticipantRole> = {
  pudo: ParticipantRole.Carrier,
  driver: ParticipantRole.Carrier,
  mdp: ParticipantRole.WarehouseOperator,
};
