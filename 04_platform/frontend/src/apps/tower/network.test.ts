import { describe, expect, it } from 'vitest';
import {
  AGENT_OFFLINE_H,
  agentState,
  checkedIn,
  bagsInTransit,
  coverageLine,
  fillPct,
  groupFlags,
  hubSummaries,
  offlineFor,
  ratingLabel,
  slotsLabel,
  statusMixRows,
  type AgentRow,
} from './network';

/**
 * The monitoring half of the operator's screen.
 *
 * Nothing here is waiting for a decision, which is what makes it easy to get wrong quietly. Every test
 * below is about a way a glance could mislead: a badge that names the wrong problem, a wall of identical
 * alerts nobody reads, a mix sorted so the pipeline disappears, a zero standing in for "never".
 */

const t = ((key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : key) as never;

const NOW = Date.parse('2026-09-09T12:00:00Z');
const agent = (over: Partial<AgentRow> = {}): AgentRow => ({
  did: 'did:a',
  status: 'ACTIVE',
  balance: 100,
  lastPingAt: new Date(NOW - 60_000).toISOString(),
  ...over,
});

describe('what a shop’s row says', () => {
  it('reads as a PRIORITY, not as a set of independent badges', () => {
    // A locked shop that is also offline is LOCKED. Saying "offline" would send somebody to check a
    // phone when the real answer is a decision somebody made.
    const stale = { lastPingAt: new Date(NOW - 5 * 3_600_000).toISOString() };
    expect(agentState({ ...agent({ status: 'LOCKED' }), ...stale }, NOW).key).toBe('locked');
    expect(agentState({ ...agent({ status: 'KYC_PENDING' }), ...stale }, NOW).key).toBe('kyc');
    expect(agentState({ ...agent({ status: 'DRAFT' }), ...stale }, NOW).key).toBe('draft');
    // A shop that has never been approved is not "offline" — it has never been on.
    expect(agentState({ ...agent({ status: 'APPROVED_UNFUNDED', balance: 0 }), ...stale }, NOW).key).toBe('unfunded');
  });

  it('calls a shop offline after an hour of silence, and never before', () => {
    expect(agentState(agent({ lastPingAt: new Date(NOW - 59 * 60_000).toISOString() }), NOW).key).toBe('active');
    expect(agentState(agent({ lastPingAt: new Date(NOW - 61 * 60_000).toISOString() }), NOW).key).toBe('offline');
    expect(AGENT_OFFLINE_H).toBe(1);
  });

  it('treats a shop that has NEVER checked in as offline rather than as fresh', () => {
    // The bug this prevents is a missing date parsing to 0 and reading as "pinged just now".
    expect(offlineFor(undefined, NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(agentState(agent({ lastPingAt: undefined }), NOW).key).toBe('offline');
  });

  it('warns on a float too thin to take the next parcel — at the price of a parcel at that shop’s own company', () => {
    expect(agentState(agent({ balance: 159.99, parcelPrice: 160 }), NOW).key).toBe('low');
    expect(agentState(agent({ balance: 160, parcelPrice: 160 }), NOW).key).toBe('active');
    // The same float is thin in one country and not in another: there is no one figure to measure every shop by.
    expect(agentState(agent({ balance: 4, parcelPrice: 1.6 }), NOW).key).toBe('active');
    expect(agentState(agent({ balance: 4, parcelPrice: 5000 }), NOW).key).toBe('low');
    // Not told the price, the console does not guess one.
    expect(agentState(agent({ balance: 0.01 }), NOW).key).toBe('active');
  });

  it('never calls a shop LOW on a float it does not have', () => {
    // A shop in a country where we hold no money is outside the float entirely. Warning that its till
    // is thin sends somebody to fix a thing that does not exist — and reading it as 0 would claim we
    // are holding an empty account for them.
    expect(agentState(agent({ balance: null }), NOW).key).toBe('nofloat');
    expect(agentState(agent({ balance: undefined }), NOW).key).toBe('nofloat');
    expect(agentState(agent({ balance: 0 }), NOW).key).toBe('low');
  });

  it('says “—” where there is no shelf and no rating, rather than a zero', () => {
    // "0/0" reads as a full shop; "0.0★" reads as a shop everybody hated. Both are lies about a shop
    // that simply has not been measured yet, and both are about somebody's living.
    expect(slotsLabel(agent())).toBe('—');
    expect(slotsLabel(agent({ capacity: 24, freeSlots: 5 }))).toBe('5/24');
    expect(ratingLabel(agent())).toBe('—');
    expect(ratingLabel(agent({ rating: { average: 4.25, count: 8 } }))).toBe('4.3★');
  });
});

describe('how many shops have checked in', () => {
  it('counts on exactly the rule the rows are labelled with', () => {
    // The bug this prevents is a console contradicting itself in one glance: a tile reading "1 of 6"
    // above a table in which all six say they have not checked in.
    const rows = [
      agent({ lastPingAt: new Date(NOW - 10 * 60_000).toISOString() }),
      agent({ lastPingAt: new Date(NOW - 5 * 3_600_000).toISOString() }),
      agent({ lastPingAt: undefined }),
    ];
    const { online, total } = checkedIn(rows, NOW);
    expect({ online, total }).toEqual({ online: 1, total: 3 });
    // …and the one it counted is the one whose row does NOT say "not checked in".
    expect(rows.filter((r) => agentState(r, NOW).key !== 'offline')).toHaveLength(online);
  });

  it('counts a shop that has checked in even when its row says something else', () => {
    // A locked shop that pinged a minute ago HAS checked in; its row says "locked" because that is the
    // more important thing about it, not because the phone is off.
    const locked = agent({ status: 'LOCKED', lastPingAt: new Date(NOW - 60_000).toISOString() });
    expect(checkedIn([locked], NOW).online).toBe(1);
    expect(agentState(locked, NOW).key).toBe('locked');
  });
});

describe('alerts', () => {
  const flags = [
    { type: 'Stagnant_Inventory', subject: 'P1', detail: 'At_PUDO 757h', ageHours: 757 },
    { type: 'Stagnant_Inventory', subject: 'P2', detail: 'At_PUDO 300h', ageHours: 300 },
    { type: 'Short_Shipped', subject: 'P3', detail: 'left behind', ageHours: 0 },
  ];

  it('groups by kind, because 300 identical lines is one fact', () => {
    // A wall of undifferentiated rows teaches an operator to scroll past all of them — including the one
    // that is not like the others.
    const groups = groupFlags(flags);
    expect(groups.map((g) => [g.type, g.count])).toEqual([
      ['Stagnant_Inventory', 2],
      ['Short_Shipped', 1],
    ]);
  });

  it('leads with whatever has been standing longest, and keeps one example', () => {
    const [first] = groupFlags(flags);
    expect(first.oldestHours).toBe(757);
    expect(first.example.subject).toBe('P1'); // a place to start, not just a number
  });

  it('has nothing to say about an empty list, and says it in no rows', () => {
    expect(groupFlags([])).toEqual([]);
  });
});

describe('where every parcel is', () => {
  it('reads left to right as the pipeline, not sorted by size', () => {
    // A mix sorted by count is a bar chart of nothing; sorted by the journey it is a network.
    const rows = statusMixRows({ Voided: 32, At_PUDO: 261, Created: 103, On_Bus: 16 });
    expect(rows.map((r) => r.status)).toEqual(['Created', 'At_PUDO', 'On_Bus', 'Voided']);
  });

  it('appends a status this build has never heard of rather than dropping it', () => {
    // A parcel in a state we cannot name is exactly the one worth seeing.
    const rows = statusMixRows({ At_PUDO: 2, Teleported: 1 });
    expect(rows.map((r) => r.status)).toEqual(['At_PUDO', 'Teleported']);
  });

  it('gives each row its share of the whole', () => {
    const rows = statusMixRows({ At_PUDO: 3, On_Bus: 1 });
    expect(rows[0].share).toBe(0.75);
    expect(statusMixRows({})).toEqual([]);
    expect(statusMixRows(undefined)).toEqual([]);
  });
});

describe('the hubs and their bags', () => {
  const hubs = [{ mdpId: 'h1', name: 'Central Sort' }, { mdpId: 'h2', name: 'North Sort' }];
  const totes = [
    { toteId: 't1', code: 'BAG-1', status: 'filling', locationId: 'h1', unitsUsed: 5 },
    { toteId: 't2', code: 'BAG-2', status: 'free', locationId: 'h1', unitsUsed: 0 },
    { toteId: 't3', code: 'BAG-3', status: 'in_transit', locationId: 'h1', unitsUsed: 9 },
    { toteId: 't4', code: 'BAG-4', status: 'free', locationId: 'h2', unitsUsed: 0 },
  ];

  it('shows each hub only its own bags', () => {
    const [central, north] = hubSummaries(hubs, totes);
    expect(central.filling.map((b) => b.code)).toEqual(['BAG-1']);
    expect(central.free).toBe(1);
    expect(north.filling).toEqual([]);
    expect(north.free).toBe(1);
  });

  it('counts bags on the road separately, because they belong to no hub', () => {
    expect(bagsInTransit(totes)).toBe(1);
  });

  it('never shows a bag as more than full', () => {
    expect(fillPct({ toteId: 'x', code: 'B', status: 'filling', unitsUsed: 5 })).toBe(50);
    expect(fillPct({ toteId: 'x', code: 'B', status: 'filling', unitsUsed: 14 })).toBe(100);
    expect(fillPct({ toteId: 'x', code: 'B', status: 'filling' })).toBe(0);
  });
});

describe('coverage', () => {
  it('leads with what is OPEN, not with what is registered', () => {
    // A network with sixty shops of which four are open has four, and the distance between those two
    // numbers is the thing an operator is meant to notice.
    expect(coverageLine({ registered: 60, open: 4, closed: 2, inactive: 54 }, t)).toBe('tower.network.coverageLine(open=4,registered=60,closed=2,inactive=54)');
    expect(coverageLine(undefined, t)).toBe('tower.network.coverageLine(open=0,registered=0,closed=0,inactive=0)');
  });
});
