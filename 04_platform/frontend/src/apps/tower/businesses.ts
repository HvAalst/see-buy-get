/**
 * B1 — CUSTOMERS' BUSINESSES, as staff check them.
 *
 * A business signs itself up and works straight away; what waits for staff is being shown to strangers. Two members of
 * staff check it from its registration certificate and the ID of the person speaking for it: the first approves, a
 * second — never the same person — completes it.
 */
export type BusinessCheckState = 'unverified' | 'asked' | 'checking' | 'verified' | 'refused';

export interface BusinessRow {
  entityId: string;
  name: string;
  country: string;
  activities: string[];
  registrationNo: string;
  taxNo?: string;
  createdAt: string;
  createdBy: string;
  state: BusinessCheckState;
  askedAt?: string;
  askedBy?: string;
  firstBy?: string;
  firstAt?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  refusedBy?: string;
  refusedAt?: string;
  reason?: string;
  members: number;
  missing: string[];
  handle?: string;
  /** Round 10 — the messages to its own system, counted. Staff read it; they send nothing in its name. */
  system?: { hasAddress: boolean; delivered: number; waiting: number; givenUp: number };
}

/** Waiting on a person here: asked and not yet looked at, or approved once and waiting for a second. */
export function waitingOnStaff(rows: BusinessRow[] | null): number | null {
  return rows ? rows.filter((r) => r.state === 'asked' || r.state === 'checking').length : null;
}

/**
 * MAY THIS MEMBER OF STAFF APPROVE IT, AND IF NOT, WHY NOT — said before the button is pressed, never after.
 *
 * `papers` the certificate and the ID have to be verified first · `same` they approved it already and a second person
 * has to · `notAsked` the business has not asked · `done` it is checked.
 */
export function approveBlock(row: BusinessRow, me: string | undefined, papersVerified: boolean): 'papers' | 'same' | 'notAsked' | 'done' | null {
  if (row.state === 'verified') return 'done';
  if (row.state !== 'asked' && row.state !== 'checking') return 'notAsked';
  if (row.state === 'checking' && me && row.firstBy === me) return 'same';
  if (!papersVerified) return 'papers';
  return null;
}

export function stateTone(state: BusinessCheckState): 'ok' | 'warn' | 'info' | 'quiet' {
  if (state === 'verified') return 'ok';
  if (state === 'refused') return 'warn';
  if (state === 'asked' || state === 'checking') return 'info';
  return 'quiet';
}
