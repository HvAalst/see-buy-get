import type { MessageKey } from '../../shared/i18n';

/**
 * THE CORRIDORS — the routes the network runs buses on, and the only place they can be drawn.
 *
 * A corridor is a promise about a zone pair, and almost everything downstream reads it as one:
 *
 *   - a shop may only TAKE IN a cross-zone parcel that some corridor serves (routing refuses "no active
 *     corridor from X to Y" where no hub can carry it instead);
 *   - the shop-counter HANDOVER manifest is built from the corridor's destination zone — every parcel
 *     waiting at that shop bound for where this bus is going;
 *   - a fleet manager can only CHOOSE among them. They cannot add one, which is right — one manager
 *     drawing a corridor would change what every shop in that zone is allowed to accept — and it left a
 *     hole, because nobody could add one at all.
 *
 * So blocking a corridor is not an edit, it is a decision that stops take-ins across a zone pair. The
 * rules here exist to keep that decision honest.
 */

export interface CorridorRow {
  corridorId: string;
  name: string;
  originZone: string;
  destZone: string;
  vehicleType?: 'bus' | 'truck';
  schedule?: string;
  status: string;
  /** Absent for the network's own. A fleet's line names the fleet that proposed it and runs it. */
  owner?: { kind: 'fleet'; managerDid: string; company: string };
  note?: string;
}

/** A driver↔vehicle coupling, which is what a shift IS. Only its corridor matters here. */
export interface CouplingRow {
  assignmentId: string;
  driverDid: string;
  corridorId?: string;
}

/** A corridor plus the one fact an operator needs before touching it: who is on it right now. */
export interface CorridorView extends CorridorRow {
  /** Shifts currently running on this corridor. Blocking is a different decision at 0 and at 4. */
  shifts: number;
}

/**
 * The corridors as a table, live ones first.
 *
 * Blocked corridors sort last rather than disappearing: a closed route is a thing an operator has to be
 * able to find and reopen, and hiding it would make "we have no corridor from A to B" and "we closed the
 * one we had" look identical.
 */
export function corridorViews(corridors: CorridorRow[], couplings: CouplingRow[]): CorridorView[] {
  const shiftsOn = new Map<string, number>();
  for (const c of couplings) {
    if (c.corridorId) shiftsOn.set(c.corridorId, (shiftsOn.get(c.corridorId) ?? 0) + 1);
  }
  // A fleet's proposal first: it is the one row here waiting on a decision. Closed ones last.
  const rank = (status: string) => (status === 'proposed' ? 0 : status === 'blocked' ? 2 : 1);
  return corridors
    .map((c) => ({ ...c, shifts: shiftsOn.get(c.corridorId) ?? 0 }))
    .sort(
      (a, b) =>
        rank(a.status) - rank(b.status) ||
        a.originZone.localeCompare(b.originZone) ||
        a.destZone.localeCompare(b.destZone),
    );
}

/**
 * Every zone this deployment actually knows about — from the shops, the hubs, and the corridors already
 * drawn.
 *
 * Offered as suggestions and never as a closed list: a zone is a string this network invents as it
 * grows, and the first corridor into a new zone is drawn before any shop is there. A picker that refused
 * an unknown zone would make the network unable to expand from the screen that plans its expansion.
 */
export function zoneOptions(
  agents: { zone?: string }[] | null,
  hubs: { zones?: string[] }[] | null,
  corridors: CorridorRow[] | null,
): string[] {
  const zones = new Set<string>();
  for (const a of agents ?? []) if (a.zone) zones.add(a.zone);
  for (const h of hubs ?? []) for (const z of h.zones ?? []) zones.add(z);
  for (const c of corridors ?? []) {
    if (c.originZone) zones.add(c.originZone);
    if (c.destZone) zones.add(c.destZone);
  }
  return [...zones].sort((a, b) => a.localeCompare(b));
}

export interface CorridorForm {
  name: string;
  originZone: string;
  destZone: string;
  vehicleType: 'bus' | 'truck';
  schedule: string;
}

export const EMPTY_CORRIDOR_FORM: CorridorForm = { name: '', originZone: '', destZone: '', vehicleType: 'bus', schedule: '' };

/**
 * What stops this corridor being drawn — said BEFORE the server has to say it.
 *
 * Only the three refusals that are certain from what is on screen. Anything else is the server's to
 * answer: a screen that guesses at a rule it does not own starts refusing things the network allows.
 */
export function corridorBlocker(form: CorridorForm, existing: CorridorRow[]): MessageKey | null {
  const origin = form.originZone.trim();
  const dest = form.destZone.trim();
  if (!origin || !dest) return 'tower.corridors.needZones';
  // A corridor within one zone is not a corridor: routing only ever asks for one when the parcel crosses
  // a zone boundary, so this one could be drawn and would never be consulted.
  if (origin === dest) return 'tower.corridors.sameZone';
  // Two ACTIVE corridors on one pair means the second is unreachable — the lookup takes the first it
  // finds. A blocked one on the same pair is not in the way, and replacing it is the normal path.
  if (existing.some((c) => c.status !== 'blocked' && c.originZone === origin && c.destZone === dest)) {
    return 'tower.corridors.duplicate';
  }
  return null;
}

/**
 * The name to send when nobody typed one.
 *
 * A corridor with no name is listed as a blank row, and a blank row in a table an operator blocks things
 * from is worse than a dull name. "Z-A → Z-B" is what the seeds have always called them.
 */
export function corridorName(form: CorridorForm): string {
  const typed = form.name.trim();
  return typed || `${form.originZone.trim()} → ${form.destZone.trim()}`;
}
