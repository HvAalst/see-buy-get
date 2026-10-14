import { agentRecordOf, isClearingAgent, AGENT_MEASURED } from './agent-record';
import { AGENT_MIN_CONTAINERS } from './pudo.config';
import { ImportConsignment } from './import.types';

/**
 * CL4 item 1 — the clearing agent's record.
 *
 * Written against the two rules that make this measure honest rather than against its happy path, because
 * both are the kind a green suite quietly stops enforcing:
 *
 *  1. NOTHING THAT HAPPENED AT THE COUNTER IS SCORED. Scoring an agent on elapsed time at a border
 *     advertises whoever pays bribes, and absence of a seizure is not evidence of compliance.
 *  2. WHAT THE STATE DID IS COUNTED, NEVER NETTED. A hold the agent reported themselves must not quietly
 *     improve the figures the agent is judged on, or the field is just an excuse box.
 */

const AGENT = 'partner-ke-quickclear';
const OTHER = 'partner-ke-someone';

const H = 3_600_000;
const at = (hoursFromBase: number) => new Date(Date.parse('2026-09-01T06:00:00Z') + hoursFromBase * H).toISOString();

/** One container, appointed at hour 0, with whatever the test needs bolted on. */
function container(over: Partial<ImportConsignment> = {}): ImportConsignment {
  return {
    importId: `imp_${Math.random().toString(16).slice(2)}`,
    code: 'IMP-001',
    status: 'appointed',
    importerEntityId: 'partner-ke-importer',
    goodsDescription: 'Factory plant',
    originCountry: 'IN',
    destCountry: 'KE',
    destPort: 'Mombasa',
    agentEntityId: AGENT,
    appointedAt: at(0),
    appointedBy: 'importer',
    required: [],
    createdAt: at(-24),
    createdBy: 'importer',
    ...over,
  } as ImportConsignment;
}

const paper = (key: string, over: Record<string, unknown> = {}) =>
  ({ key, label: key, addedBy: 'agent', addedAt: at(1), ...over }) as ImportConsignment['required'][number];

/** Enough containers to pass the thin gate, all identical unless the test says otherwise. */
const enough = (over: Partial<ImportConsignment> = {}) => Array.from({ length: AGENT_MIN_CONTAINERS }, () => container(over));

describe('a clearing agent’s record', () => {
  describe('being an agent at all is DERIVED', () => {
    it('a company appointed on a container is an agent; one that never was, is not', () => {
      const all = [container(), container({ agentEntityId: OTHER })];
      expect(isClearingAgent(all, AGENT)).toBe(true);
      expect(isClearingAgent(all, 'partner-ke-nobody')).toBe(false);
    });

    it('an appointment that was never made does not count, even with the field set', () => {
      // A record carrying an agent id and no appointedAt is half-written, not an appointment.
      expect(isClearingAgent([container({ appointedAt: undefined })], AGENT)).toBe(false);
    });

    it('counts only this agent’s containers', () => {
      const r = agentRecordOf([container(), container(), container({ agentEntityId: OTHER })], AGENT);
      expect(r.appointed).toBe(2);
    });
  });

  describe('the foreknowledge figure — the two-week story, counted', () => {
    it('counts a container whose list GREW after the importer had begun supplying', () => {
      const late = container({
        required: [paper('licence', { addedAt: at(1), suppliedAt: at(5) }), paper('ministry-permit', { addedAt: at(30) })],
      });
      const r = agentRecordOf([late], AGENT);
      expect(r.listedLate).toBe(1);
      expect(r.latePapers).toBe(1);
    });

    it('does NOT count a list that was complete before anybody supplied anything', () => {
      const ready = container({
        required: [paper('licence', { addedAt: at(1), suppliedAt: at(9) }), paper('packing-list', { addedAt: at(2), suppliedAt: at(10) })],
      });
      expect(agentRecordOf([ready], AGENT).listedLate).toBe(0);
    });

    it('measures lateness against the FIRST supply, so adding papers forever cannot look timely', () => {
      // Each new paper arrives just before its own supply; against its own arrival every one looks prompt.
      const creeping = container({
        required: [
          paper('a', { addedAt: at(1), suppliedAt: at(4) }),
          paper('b', { addedAt: at(10), suppliedAt: at(12) }),
          paper('c', { addedAt: at(20), suppliedAt: at(22) }),
        ],
      });
      const r = agentRecordOf([creeping], AGENT);
      expect(r.listedLate).toBe(1);
      expect(r.latePapers).toBe(2); // b and c: the importer could not have had either ready
    });

    it('counts late additions even while the record is too thin to state a typical time', () => {
      const r = agentRecordOf([container({ required: [paper('a', { addedAt: at(1), suppliedAt: at(2) }), paper('b', { addedAt: at(9) })] })], AGENT);
      expect(r.thin).toBe(true);
      expect(r.listHours).toBeNull();
      // A count of things that happened is not an average, so hiding it would hide the whole point.
      expect(r.listedLate).toBe(1);
    });
  });

  describe('a thin record shows as thin', () => {
    it('gives counts and NO typical times below the floor', () => {
      const r = agentRecordOf([container({ required: [paper('a')] }), container({ required: [paper('a')] })], AGENT);
      expect(r.appointed).toBe(2);
      expect(r.listed).toBe(2);
      expect(r.thin).toBe(true);
      expect(r.listHours).toBeNull();
      expect(r.checkHours).toBeNull();
      expect(r.quoteHours).toBeNull();
      expect(r.ratesNeed).toBe(AGENT_MIN_CONTAINERS);
    });

    it('states them at the floor and above', () => {
      const r = agentRecordOf(enough({ required: [paper('a', { addedAt: at(3) })] }), AGENT);
      expect(r.thin).toBe(false);
      expect(r.listHours).toBe(3);
    });
  });

  describe('the response times', () => {
    it('takes the MEDIAN, so one container over a holiday cannot define a record', () => {
      const rows = [
        container({ required: [paper('a', { addedAt: at(2) })] }),
        container({ required: [paper('a', { addedAt: at(3) })] }),
        container({ required: [paper('a', { addedAt: at(4) })] }),
        container({ required: [paper('a', { addedAt: at(5) })] }),
        container({ required: [paper('a', { addedAt: at(500) })] }), // the one that sat
      ];
      const r = agentRecordOf(rows, AGENT);
      expect(r.listHours).toBe(4); // a mean would read 102.8
    });

    it('counts a rejection as an answer, so nobody is pushed into accepting a bad paper', () => {
      const rows = enough({ required: [paper('a', { suppliedAt: at(10), rejectedAt: at(12), rejectionReason: 'wrong year' })] });
      expect(agentRecordOf(rows, AGENT).checkHours).toBe(2);
    });

    it('leaves a paper nobody has answered out of the figure rather than counting it as fast', () => {
      const rows = enough({ required: [paper('a', { suppliedAt: at(10) })] });
      expect(agentRecordOf(rows, AGENT).checkHours).toBeNull();
    });

    it('is per port, because the papers a border asks for are that border’s', () => {
      const r = agentRecordOf(
        [
          container({ destPort: 'Mombasa', required: [paper('a')], roadMintedAt: at(40) }),
          container({ destPort: 'Mombasa', required: [paper('a')] }),
          container({ destPort: 'Djibouti', required: [] }),
        ],
        AGENT,
      );
      expect(r.ports).toEqual([
        { key: 'Mombasa', appointed: 2, listed: 2, cleared: 1 },
        { key: 'Djibouti', appointed: 1, listed: 0, cleared: 0 },
      ]);
      // Every container is accounted for, so nothing is quietly excluded from the record.
      expect(r.ports.reduce((n, p) => n + p.appointed, 0)).toBe(r.appointed);
    });
  });

  describe('what the state did', () => {
    const held = () =>
      container({
        required: [paper('a', { suppliedAt: at(10), acceptedAt: at(40) })],
        customsHolds: [
          { holdId: 'h1', kind: 'physical_exam', at: at(20), recordedBy: AGENT, recordedAt: at(21), accounts: [{ by: 'agent', at: at(21), stance: 'happened' }] },
          {
            holdId: 'h2',
            kind: 'queue',
            at: at(25),
            recordedBy: AGENT,
            recordedAt: at(26),
            accounts: [
              { by: 'agent', at: at(26), stance: 'happened' },
              { by: 'importer', at: at(27), stance: 'disputed', note: 'They had not filed yet' },
            ],
          },
        ],
      } as Partial<ImportConsignment>);

    it('counts holds, and counts the disputed ones with them', () => {
      const r = agentRecordOf([held()], AGENT);
      expect(r.holds.containers).toBe(1);
      expect(r.holds.recorded).toBe(2);
      // Shown WITH the count, always: a page must not be able to render the excuse without the contest.
      expect(r.holds.disputed).toBe(1);
      expect(r.holds.kinds).toEqual([
        { key: 'physical_exam', times: 1 },
        { key: 'queue', times: 1 },
      ]);
    });

    it('NEVER NETS OFF the agent’s own figures — the whole reason the split exists', () => {
      // The same container, once with holds recorded on it and once without. A hold recorded by the agent
      // must not shorten the 30 hours a supplied paper waited on them: that would be an excuse the
      // arithmetic grants itself, which is precisely what §6 refuses.
      const withHolds = agentRecordOf(Array.from({ length: AGENT_MIN_CONTAINERS }, held), AGENT);
      const without = agentRecordOf(
        Array.from({ length: AGENT_MIN_CONTAINERS }, () => container({ required: [paper('a', { suppliedAt: at(10), acceptedAt: at(40) })] })),
        AGENT,
      );
      expect(withHolds.checkHours).toBe(30);
      expect(withHolds.checkHours).toBe(without.checkHours);
      expect(withHolds.listHours).toBe(without.listHours);
      expect(withHolds.listedLate).toBe(without.listedLate);
    });
  });

  describe('what it refuses to say', () => {
    it('carries no blended score, and no figure about time at the border', () => {
      const r = agentRecordOf(enough({ required: [paper('a')] }), AGENT);
      const keys = Object.keys(r);
      expect(keys).not.toContain('score');
      expect(keys).not.toContain('rating');
      expect(keys).not.toContain('borderHours');
      expect(keys).not.toContain('clearanceHours');
      // No field anywhere claims a time from arrival to release: that is the state's clock, not theirs.
      expect(JSON.stringify(r)).not.toMatch(/border|counter|seizure/i);
    });

    it('says what was measured and what was not, in the payload', () => {
      expect(AGENT_MEASURED).toMatch(/Not measured/);
      expect(AGENT_MEASURED).toMatch(/bribes/);
      expect(AGENT_MEASURED).toMatch(/never subtracted/);
    });

    it('gives a company with no appointments an empty record rather than a bad one', () => {
      const r = agentRecordOf([container({ agentEntityId: OTHER })], AGENT);
      expect(r.appointed).toBe(0);
      expect(r.ports).toEqual([]);
      expect(r.holds.recorded).toBe(0);
      // Thin, not zero-rated: there is nothing to rate, which is a different claim from a bad rate.
      expect(r.thin).toBe(true);
      expect(r.listHours).toBeNull();
    });
  });
});
