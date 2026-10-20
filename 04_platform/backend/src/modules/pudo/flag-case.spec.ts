import { FlagCaseService } from './flag-case.service';
import type { MonitorService, PudoFlag } from './monitor.service';
import type { PilotService } from './pilot.service';

/**
 * FLAGS AS CASES. A flag opens a case somebody takes, notes and closes with a reason; one nobody takes is escalated in
 * time; one whose condition goes away closes itself and says so; one put to rest does not come straight back.
 */
describe('flags as cases', () => {
  const H = 3_600_000;
  const T0 = Date.parse('2026-10-18T08:00:00Z');
  const stagnant = (detail = 'At_PUDO 50h'): PudoFlag => ({ type: 'Stagnant_Inventory', subject: 'PUD-1', detail, ageHours: 50 });
  const ghost: PudoFlag = { type: 'Ghost_Bus', subject: 'PUD-2', detail: 'On_Bus 7h', ageHours: 7 };
  const amina = { name: 'Amina O', key: 'opr_amina' };
  const otieno = { name: 'Otieno K', key: 'opr_otieno' };
  // What the monitor says now: set by each test, read by every sweep (list() sweeps first, as the console's read does).
  let current: PudoFlag[] = [];
  const make = () => {
    current = [];
    const svc = new FlagCaseService({ flags: () => current } as unknown as MonitorService);
    const sync = svc.sync.bind(svc);
    svc.sync = (at?: number, flags?: PudoFlag[]) => {
      if (flags) current = flags;
      sync(at, flags ?? current);
    };
    return svc;
  };

  it('opens one case a flag, with its severity, and keeps its words current while the flag is there', () => {
    const cases = make();
    cases.sync(T0, [stagnant(), ghost]);
    cases.sync(T0 + H, [stagnant('At_PUDO 51h'), ghost]);
    const live = cases.list('live', T0 + H);
    expect(live).toHaveLength(2);
    expect(live.map((c) => [c.kind, c.severity])).toEqual([
      ['Ghost_Bus', 'critical'],
      ['Stagnant_Inventory', 'medium'],
    ]);
    expect(live.find((c) => c.kind === 'Stagnant_Inventory')).toMatchObject({ detail: 'At_PUDO 51h', state: 'open', history: [{ act: 'opened', text: 'At_PUDO 50h' }] });
  });

  it('closes a case by itself when its flag goes away, and says so', () => {
    const cases = make();
    cases.sync(T0, [stagnant()]);
    const [c] = cases.list('live', T0);
    cases.take(c.caseId, amina, T0);
    cases.sync(T0 + H, []);
    expect(cases.list('live', T0 + H)).toHaveLength(0);
    expect(cases.get(c.caseId)).toMatchObject({ state: 'cleared', history: [{ act: 'opened' }, { act: 'taken', by: 'Amina O' }, { act: 'cleared' }] });
    expect(cases.get(c.caseId).owner).toBeUndefined();
  });

  it('escalates a case nobody takes in time — once — and never one somebody has', () => {
    const cases = make();
    cases.sync(T0, [ghost, stagnant()]);
    const ghostCase = cases.list('live', T0).find((c) => c.kind === 'Ghost_Bus')!;
    cases.sync(T0 + 30 * 60_000, [ghost, stagnant()]);
    expect(cases.get(ghostCase.caseId).escalatedAt).toBeUndefined();
    cases.sync(T0 + H, [ghost, stagnant()]); // critical: one hour
    cases.sync(T0 + 2 * H, [ghost, stagnant()]);
    expect(cases.get(ghostCase.caseId).history.filter((e) => e.act === 'escalated')).toHaveLength(1);
    // Taken in time, the medium one is not escalated at 24 h.
    const stuck = cases.list('live', T0).find((c) => c.kind === 'Stagnant_Inventory')!;
    cases.take(stuck.caseId, amina, T0 + 2 * H);
    cases.sync(T0 + 30 * H, [ghost, stagnant()]);
    expect(cases.get(stuck.caseId).escalatedAt).toBeUndefined();
    // Escalated first in the list, then nobody's before somebody's.
    expect(cases.list('live', T0 + 30 * H).map((c) => c.caseId)).toEqual([ghostCase.caseId, stuck.caseId]);
  });

  it('is somebody’s once taken: another is told whose, and the owner may let it go', () => {
    const cases = make();
    cases.sync(T0, [stagnant()]);
    const [c] = cases.list('live', T0);
    cases.take(c.caseId, amina, T0);
    expect(() => cases.take(c.caseId, otieno, T0)).toThrow(/Amina O has this case/);
    cases.note(c.caseId, otieno, 'Called the shop: the receiver comes tomorrow', T0 + H);
    expect(() => cases.note(c.caseId, otieno, '  ', T0 + H)).toThrow(/Write what was done/);
    cases.letGo(c.caseId, amina, T0 + 2 * H);
    expect(cases.take(c.caseId, otieno, T0 + 3 * H).owner).toEqual(otieno);
    expect(cases.get(c.caseId).history.map((e) => e.act)).toEqual(['opened', 'taken', 'note', 'let_go', 'taken']);
  });

  it('is closed only with a reason, and stays quiet until it is time to look again — then a following case opens', () => {
    const cases = make();
    cases.sync(T0, [stagnant()]);
    const [c] = cases.list('live', T0);
    expect(() => cases.done(c.caseId, amina, 'ok', 24, T0)).toThrow(/closed with a reason/);
    expect(() => cases.done(c.caseId, amina, 'Receiver collects tomorrow', 500, T0)).toThrow(/1 to 168 hours/);
    cases.done(c.caseId, amina, 'Receiver collects tomorrow', 24, T0);
    expect(() => cases.note(c.caseId, amina, 'more', T0)).toThrow(/closed/);
    // The flag is still there, but it was put to rest: nothing new for 24 hours.
    cases.sync(T0 + 23 * H, [stagnant()]);
    expect(cases.list('live', T0 + 23 * H)).toHaveLength(0);
    // Still there after its time: a following case, which says so.
    cases.sync(T0 + 25 * H, [stagnant()]);
    const [again] = cases.list('live', T0 + 25 * H);
    expect(again).toMatchObject({ follows: c.caseId, history: [{ act: 'opened_again' }] });
    expect(cases.list('closed', T0 + 25 * H).map((x) => x.caseId)).toEqual([c.caseId]);
  });

  it('counts what is waiting for somebody: the live cases nobody has taken', () => {
    const cases = make();
    cases.sync(T0, [stagnant(), ghost]);
    cases.take(cases.list('live', T0)[0].caseId, amina, T0);
    expect(cases.waiting(T0)).toBe(1);
  });

  // A network has thousands of flags (the sandbox, 3,676): the walk found a read taking 16 s and a count of the page.
  const many = (n: number): PudoFlag[] => Array.from({ length: n }, (_, i) => ({ type: 'Stagnant_Inventory', subject: `PUD-${i}`, detail: 'At_PUDO 50h', ageHours: 50 }));

  it('counts all the cases, never the page: how many, how many nobody has, how many of each kind', () => {
    const cases = make();
    cases.sync(T0, [...many(250), ghost]);
    const board = cases.board('live', undefined, T0);
    expect(board.items).toHaveLength(200);
    expect(board.total).toBe(251);
    expect(board.waiting).toBe(251);
    expect(board.kinds).toEqual([
      { kind: 'Ghost_Bus', severity: 'critical', count: 1, waiting: 1, escalated: 0 },
      { kind: 'Stagnant_Inventory', severity: 'medium', count: 250, waiting: 250, escalated: 0 },
    ]);
    // One kind asked for: its own cases and total; the counts stay of all.
    const ghosts = cases.board('live', 'Ghost_Bus', T0);
    expect(ghosts.items.map((c) => c.kind)).toEqual(['Ghost_Bus']);
    expect([ghosts.total, ghosts.waiting, ghosts.kinds.length]).toEqual([1, 251, 2]);
    // The closed list, read while all of them wait: the badge's count is still of the live ones.
    expect(cases.board('closed', undefined, T0)).toMatchObject({ items: [], total: 0, waiting: 251, kinds: [] });
  });

  it('writes a sweep once, however many cases it opens or changes — and nothing when nothing changed', () => {
    const cases = make();
    const store = (cases as unknown as { cases: { set: (k: string, v: unknown) => unknown; setMany: (e: Iterable<readonly [string, unknown]>) => unknown } }).cases;
    const set = jest.spyOn(store, 'set');
    const real = store.setMany.bind(store);
    const written: number[] = [];
    jest.spyOn(store, 'setMany').mockImplementation((e) => {
      const list = [...e];
      written.push(list.length);
      return real(list);
    });
    cases.sync(T0, many(1000));
    cases.sync(T0 + 60_000, many(1000));
    expect(set).not.toHaveBeenCalled();
    expect(written).toEqual([1000, 0]);
    expect(cases.board('live', undefined, T0).total).toBe(1000);
  });

  it('finds a taken case again in the taken list, whose it is — and an escalated case somebody took is not first any more', () => {
    const cases = make();
    cases.sync(T0, [...many(250), ghost]);
    cases.sync(T0 + 2 * H, [...many(250), ghost]); // the bus is escalated
    const bus = cases.board('live', undefined, T0 + 2 * H).items[0];
    expect(bus).toMatchObject({ kind: 'Ghost_Bus', escalatedAt: expect.any(String) });
    cases.take(bus.caseId, amina, T0 + 2 * H);
    // Nobody's come first now: with 250 of them the bus is past the first page of the live list.
    const live = cases.board('live', undefined, T0 + 2 * H);
    expect(live.items.some((c) => c.caseId === bus.caseId)).toBe(false);
    expect(live.total).toBe(251);
    // The taken list has it, and only what is taken.
    const taken = cases.board('taken', undefined, T0 + 2 * H);
    expect(taken.items.map((c) => [c.caseId, c.owner?.name])).toEqual([[bus.caseId, 'Amina O']]);
    expect([taken.total, taken.waiting]).toEqual([1, 250]);
  });

  it('closes a pilot number for good — a frozen week does not change — while an ordinary flag comes back after its rest', () => {
    const cases = make();
    const offTarget: PudoFlag = { type: 'Pilot_Off_Target', subject: '2026-W42:handshake', detail: 'Handshake 91% in 2026-W42, target 95%' };
    cases.sync(T0, [offTarget, ghost]);
    const live = cases.list('live', T0);
    expect(live.find((c) => c.kind === 'Pilot_Off_Target')).toMatchObject({ severity: 'high', state: 'open' });
    for (const c of live) cases.done(c.caseId, amina, 'Spoke to the shop about scanning every parcel', 1, T0);
    // Two hours on, both flags are still there: the bus is still unaccounted for, the week's number is still 91%.
    cases.sync(T0 + 2 * H, [offTarget, ghost]);
    expect(cases.list('live', T0 + 2 * H).map((c) => c.kind)).toEqual(['Ghost_Bus']);
  });

  it('takes the pilot’s numbers off target into its own sweep, beside the monitor’s flags', () => {
    const offTarget: PudoFlag = { type: 'Pilot_Off_Target', subject: '2026-W42:loss', detail: 'Lost or damaged 2% in 2026-W42, target under 1%' };
    const svc = new FlagCaseService({ flags: () => [ghost] } as unknown as MonitorService, { offTarget: () => [offTarget] } as unknown as PilotService);
    svc.sync(T0);
    expect(svc.list('live', T0).map((c) => c.kind).sort()).toEqual(['Ghost_Bus', 'Pilot_Off_Target']);
  });

  it('closes a tamper hold only by its release, and a new hold on the same unit opens at once — never quieted (round 35)', () => {
    const cases = make();
    const hold: PudoFlag = { type: 'Tamper_Hold', subject: 'FRT-9', detail: 'load to Nakuru · a seal on the door is not the one written · at pickup' };
    cases.sync(T0, [hold]);
    const [c] = cases.list('live', T0);
    expect(c).toMatchObject({ kind: 'Tamper_Hold', severity: 'critical' });
    expect(() => cases.done(c.caseId, amina, 'Looked into it', 24, T0)).toThrow(/closes when the unit is released/);
    expect(cases.list('live', T0)).toHaveLength(1);
    expect(cases.closeFor('Tamper_Hold', 'FRT-9', amina, 'Released: the shipper sealed it again', T0 + H)).toMatchObject({ state: 'done' });
    cases.sync(T0 + H, []);
    // The same load held again an hour later: a case at once, not after the rest a closed case is otherwise given.
    cases.sync(T0 + 2 * H, [hold]);
    expect(cases.list('live', T0 + 2 * H)).toEqual([expect.objectContaining({ kind: 'Tamper_Hold', follows: c.caseId, history: [expect.objectContaining({ act: 'opened_again' })] })]);
  });

  it('opens one case for a flag said twice in one sweep', () => {
    const cases = make();
    cases.sync(T0, [stagnant(), stagnant()]);
    expect(cases.board('live', undefined, T0).total).toBe(1);
  });

  it('drops a case that closed by itself a month ago and nobody touched — and keeps one a person worked on', () => {
    const cases = make();
    cases.sync(T0, [stagnant(), ghost]);
    const ghostCase = cases.list('live', T0).find((c) => c.kind === 'Ghost_Bus')!;
    const stuck = cases.list('live', T0).find((c) => c.kind === 'Stagnant_Inventory')!;
    cases.note(ghostCase.caseId, amina, 'Rang the bus company', T0);
    cases.sync(T0 + H, []);
    cases.sync(T0 + 29 * 24 * H, []);
    expect(cases.board('closed', undefined, T0 + 29 * 24 * H).total).toBe(2);
    cases.sync(T0 + 31 * 24 * H, []);
    expect(() => cases.get(stuck.caseId)).toThrow(/No such case/);
    expect(cases.get(ghostCase.caseId).state).toBe('cleared');
  });
});
