import type { MessageKey, Translate } from '../../shared/i18n';

/**
 * The network at a glance — what MONITORING means here, as opposed to deciding.
 *
 * The queues in `queues.ts` are work that stops until somebody acts. This is the other half of an
 * operator's screen: nothing here is waiting for a decision, and most of it is fine most of the time.
 * That is exactly what makes it easy to get wrong, in two directions:
 *
 *   - a number with no denominator ("1 online") says nothing until you know it is one of six;
 *   - a wall of undifferentiated alerts is a wall nobody reads. 315 flags of three kinds is three facts,
 *     and rendering it as 315 rows is how an operator learns to scroll past all of them.
 *
 * Migrated from the vanilla tower, where the derived agent status in particular was already right and
 * worth carrying over exactly.
 */

/* ------------------------------------------------------------------ agents -- */

export interface AgentRow {
  did: string;
  shopName?: string;
  zone?: string;
  status?: string;
  /** Null where the network holds no money in that country — which is NOT a zero float. */
  balance?: number | null;
  /** What one parcel costs this shop's float, at its own company's price. */
  parcelPrice?: number;
  capacity?: number;
  freeSlots?: number;
  lastPingAt?: string;
  rating?: { average?: number; count?: number };
  /** The pin the shop dropped. Absent on a shop that never dropped one — which is a real state, not a
   *  missing field, and it keeps that shop off the map while leaving it in the list. */
  location?: { lat: number; lng: number };
}

export type AgentTone = 'ok' | 'warn' | 'bad' | 'info';

/** An hour without a ping is the line: a shop's app checks in far more often than that when it is on. */
export const AGENT_OFFLINE_H = 1;

/**
 * What this shop's row should SAY, in the order that matters.
 *
 * Read as a priority list, not a set of independent badges: a locked shop that is also offline is
 * locked, and saying "offline" about it would send somebody to check a phone when the real answer is a
 * decision somebody made. The registration states come first for the same reason — a shop that has not
 * been approved yet is not "offline", it has never been on.
 */
export function agentState(row: AgentRow, now: number): { key: string; tone: AgentTone; labelKey: MessageKey } {
  if (row.status === 'LOCKED') return { key: 'locked', tone: 'bad', labelKey: 'tower.network.agent.locked' };
  if (row.status === 'KYC_PENDING') return { key: 'kyc', tone: 'info', labelKey: 'tower.network.agent.kyc' };
  if (row.status === 'DRAFT') return { key: 'draft', tone: 'info', labelKey: 'tower.network.agent.draft' };
  if (row.status === 'APPROVED_UNFUNDED') return { key: 'unfunded', tone: 'warn', labelKey: 'tower.network.agent.unfunded' };
  if (offlineFor(row.lastPingAt, now) > AGENT_OFFLINE_H) return { key: 'offline', tone: 'bad', labelKey: 'tower.network.agent.offline' };
  // A shop in a country where we hold no money is not LOW on float, it is outside the float entirely —
  // and warning about a till that does not exist sends somebody to fix nothing.
  if (row.balance === null || row.balance === undefined) return { key: 'nofloat', tone: 'info', labelKey: 'tower.network.agent.noFloat' };
  // Thin against the price of ONE PARCEL at this shop's own company, which the server says beside the float. It was
  // measured against a 5 written here — right for no country, and a hundred times out the day real prices are set.
  // A shop on its credit line can still scan; this is the earlier signal, that its own money has run out.
  // An empty float is thin at any price, told or not.
  if (row.balance <= 0 || (row.parcelPrice != null && row.balance < row.parcelPrice)) return { key: 'low', tone: 'warn', labelKey: 'tower.network.agent.lowBalance' };
  return { key: 'active', tone: 'ok', labelKey: 'tower.network.agent.active' };
}

/** Hours since a shop last checked in. A shop that has NEVER checked in is infinitely offline, not zero. */
export function offlineFor(lastPingAt: string | undefined, now: number): number {
  const ms = Date.parse(lastPingAt ?? '');
  if (Number.isNaN(ms)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - ms) / 3_600_000);
}

/**
 * How many shops have checked in lately, out of how many exist.
 *
 * Derived from the SAME rule the rows use rather than read off the dashboard, and that is not
 * duplication for its own sake: the server counts "online" on its own threshold, this screen labels a
 * row "not checked in" on the one it inherited from the vanilla tower, and when the two disagree the
 * console contradicts itself in the same glance — a tile saying 1 of 6 above a table where all six say
 * they are silent. One rule, one answer, and the label says what the rule IS.
 */
export function checkedIn(rows: AgentRow[], now: number): { online: number; total: number } {
  return { online: rows.filter((row) => offlineFor(row.lastPingAt, now) <= AGENT_OFFLINE_H).length, total: rows.length };
}

/** Shelf: free of total. Absent capacity is a dash — "0/0" reads as a full shop with no shelf. */
export function slotsLabel(row: AgentRow): string {
  return row.capacity == null ? '—' : `${row.freeSlots ?? 0}/${row.capacity}`;
}

/** A rating nobody has given is not zero stars — it is no rating, and the difference is a shop's living. */
export function ratingLabel(row: AgentRow): string {
  return row.rating?.count ? `${(row.rating.average ?? 0).toFixed(1)}★` : '—';
}

/* ------------------------------------------------------------------- flags -- */

export interface FlagRow {
  type: string;
  subject: string;
  detail?: string;
  ageHours?: number;
}

export interface FlagGroup {
  type: string;
  count: number;
  /** The oldest one, in hours — how long this has been true of something. */
  oldestHours: number;
  /** One example, so the group is a place to start rather than only a number. */
  example: FlagRow;
}

/**
 * Alerts, grouped by KIND and ordered by how long the worst one has been standing.
 *
 * The vanilla tower rendered one row per flag, which was right when there were four and useless at three
 * hundred: a wall of identical lines teaches an operator to scroll past all of them, including the one
 * that is not like the others. Three hundred stagnant parcels is ONE fact about the network, and the
 * thing worth showing beside it is how long the oldest has been sitting.
 */
export function groupFlags(flags: FlagRow[]): FlagGroup[] {
  const byType = new Map<string, FlagRow[]>();
  for (const f of flags) byType.set(f.type, [...(byType.get(f.type) ?? []), f]);
  return [...byType.entries()]
    .map(([type, rows]) => {
      const sorted = [...rows].sort((a, b) => (b.ageHours ?? 0) - (a.ageHours ?? 0));
      return { type, count: rows.length, oldestHours: sorted[0]?.ageHours ?? 0, example: sorted[0] };
    })
    .sort((a, b) => b.oldestHours - a.oldestHours || b.count - a.count);
}

/** A flag type as a readable phrase. Unknown types show their own key rather than nothing. */
export function flagLabel(type: string, t: Translate): string {
  const key = `tower.network.flag.${type}` as MessageKey;
  const label = t(key);
  return label === key ? type.replace(/_/g, ' ') : label;
}

/** An age in hours, said the way somebody would say it. */
export function ageLabel(hours: number, t: Translate): string {
  if (hours < 1) return t('tower.wait.now');
  if (hours < 48) return t('tower.wait.hours', { n: Math.floor(hours) });
  return t('tower.wait.days', { n: Math.floor(hours / 24) });
}

/* -------------------------------------------------------------- status mix -- */

/**
 * Where every parcel in the network is, in the order it travels rather than alphabetically.
 *
 * The order is the point: a mix read left to right is a pipeline, and one sorted by size is a bar chart
 * of nothing. Statuses this build has never heard of are appended rather than dropped — a parcel in a
 * state we cannot name is exactly the one worth seeing.
 */
export const STATUS_ORDER = ['Created', 'At_PUDO', 'On_Bus', 'At_MDP', 'Ready_For_Pickup', 'Delivered', 'Unclaimed', 'Disputed', 'Voided'];

export function statusMixRows(mix: Record<string, number> | undefined): Array<{ status: string; count: number; share: number }> {
  const entries = Object.entries(mix ?? {});
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  const rank = (s: string) => {
    const i = STATUS_ORDER.indexOf(s);
    return i === -1 ? STATUS_ORDER.length : i;
  };
  return entries
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([status, count]) => ({ status, count, share: total ? count / total : 0 }));
}

/* -------------------------------------------------------------------- hubs -- */

export interface HubRow {
  mdpId: string;
  name?: string;
  zones?: string[];
}

export interface ToteRow {
  toteId: string;
  code: string;
  status: string;
  locationId?: string;
  destinationLabel?: string;
  destinationNodeId?: string;
  parcels?: unknown[];
  unitsUsed?: number;
}

/** A bag holds ten mediums; the fill is that, capped, because a full bag is full rather than 110%. */
export const TOTE_UNITS = 10;

export function fillPct(tote: ToteRow): number {
  return Math.min(100, Math.round(((tote.unitsUsed ?? 0) / TOTE_UNITS) * 100));
}

export interface HubSummary {
  hub: HubRow;
  /** Bags being filled here, with what is in them. */
  filling: ToteRow[];
  /** Empty bags on hand — a hub with none cannot start another destination. */
  free: number;
}

export function hubSummaries(hubs: HubRow[], totes: ToteRow[]): HubSummary[] {
  return hubs.map((hub) => {
    const here = totes.filter((tote) => tote.locationId === hub.mdpId);
    return {
      hub,
      filling: here.filter((tote) => tote.status === 'filling'),
      free: here.filter((tote) => tote.status === 'free').length,
    };
  });
}

/** Bags on the road right now — the multi-hop half of the picture, and it belongs to no single hub. */
export function bagsInTransit(totes: ToteRow[]): number {
  return totes.filter((tote) => tote.status === 'in_transit').length;
}

/* ---------------------------------------------------------------- coverage -- */

export interface CoverageCounts {
  registered?: number;
  open?: number;
  closed?: number;
  inactive?: number;
}

/**
 * The coverage line: how many shops exist, and how many are actually open right now.
 *
 * Registered is not coverage. A network with sixty shops of which four are open has four, and the
 * distance between those two numbers is the thing an operator is meant to notice.
 */
export function coverageLine(counts: CoverageCounts | undefined, t: Translate): string {
  const c = counts ?? {};
  return t('tower.network.coverageLine', {
    open: c.open ?? 0,
    registered: c.registered ?? 0,
    closed: c.closed ?? 0,
    inactive: c.inactive ?? 0,
  });
}
