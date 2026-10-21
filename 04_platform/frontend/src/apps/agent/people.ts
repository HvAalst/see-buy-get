import type { Result } from '../../lib/sbg';
import type { MessageKey, Translate } from '../../shared/i18n';

/*
 * THE PEOPLE AT THE COUNTER (backend shop-staff.types.ts; the user, 2026-10-18: staff sign in with their own phone + PIN).
 * The owner adds a person by number; they say yes from their own sign-in; every counter act is kept under their name.
 */

export type StaffState = 'invited' | 'working' | 'declined' | 'removed';

export interface StaffRow {
  memberId: string;
  name: string;
  phoneEnds: string;
  state: StaffState;
  invitedAt: string;
  joinedAt?: string;
  removedAt?: string;
}

export interface CounterActRow {
  at: string;
  act: string;
  ref?: string;
  by: string;
  staff: boolean;
}

/** The line under a person: where they stand, and the number they were added by (its last three digits). */
export function staffLine(row: Pick<StaffRow, 'state' | 'phoneEnds'>, t: Translate, prefix = 'agent.people.state'): string {
  return t(`${prefix}.${row.state}` as MessageKey, { ends: row.phoneEnds });
}

/** Whether the owner can still take this person out: invited or working. */
export function canRemove(row: Pick<StaffRow, 'state'>): boolean {
  return row.state === 'invited' || row.state === 'working';
}

/** One act at the counter in words: who, what, and what it was about. */
export function actLine(a: CounterActRow, t: Translate): string {
  const who = a.staff ? a.by : t('agent.people.owner');
  return a.ref ? `${who} ${a.act} · ${a.ref}` : `${who} ${a.act}`;
}

type Post = <T>(path: string, body: unknown) => Promise<Result<T>>;
type GetJson = <T>(path: string) => Promise<Result<T>>;

export interface PeopleApi {
  list: () => Promise<Result<StaffRow[]>>;
  add: (phone: string, name: string) => Promise<Result<StaffRow>>;
  remove: (memberId: string) => Promise<Result<StaffRow>>;
  log: () => Promise<Result<CounterActRow[]>>;
}

/** A shop's people (its counter), or a hub's (its floor: the ISO 28000 check, "a hub's own people by name"). */
export function peopleApi(get: GetJson, post: Post, place: 'shop' | 'hub' = 'shop'): PeopleApi {
  const base = place === 'hub' ? '/v1/sbg/hub/staff' : '/v1/sbg/shop/staff';
  return {
    list: () => get<StaffRow[]>(base),
    add: (phone, name) => post<StaffRow>(base, { phone: phone.trim(), name: name.trim() }),
    remove: (memberId) => post<StaffRow>(`${base}/${encodeURIComponent(memberId)}/remove`, {}),
    log: () => get<CounterActRow[]>(place === 'hub' ? '/v1/sbg/hub/floor-log' : '/v1/sbg/shop/counter-log'),
  };
}
