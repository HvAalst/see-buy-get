import { ImportConsignment, modeOf } from './import.types';
import { AGENT_MIN_CONTAINERS } from './pudo.config';

/**
 * CL4 item 1 — THE CLEARING AGENT'S OWN RECORD, and the line through the middle of it.
 *
 * Pure functions over plain records, in the market series' and mobilisation's style: no clock, no store,
 * no service, so a figure somebody's livelihood is judged on can be reproduced exactly from the
 * containers it came from.
 *
 * WHAT MAKES THIS SLICE DIFFERENT FROM MOBILISATION is that the thing a shipper most wants to know here
 * is the thing we must never claim to know. §6:
 *
 *   > If we score clearing agents on elapsed time at the border, we systematically advertise whoever pays
 *   > bribes. An agent who is fast because they grease the queue beats a clean agent on any dashboard we
 *   > could build, and we would be publishing that as competence.
 *
 * And its general form: **absence of a seizure is not evidence of compliance.** A clean record at a
 * border is an unfalsifiable positive, and unfalsifiable positives must never be scored. So this file
 * measures NOTHING that happens at the counter. Every figure in it is about what the agent did with the
 * work in front of them, on our own timestamps, before the state was involved at all.
 *
 * THE MEASURE IS FOREKNOWLEDGE, because that is what the two real imports turned on. One agent knew every
 * document before the clearance started and a factory cleared in a morning; the other was pleasant,
 * reliable and simply did not know, and one container sat for two weeks. Nothing about the second agent
 * was slow — they were LATE TO KNOW, which is visible in our own record as a list that kept growing after
 * the importer had already started supplying it.
 *
 * FOUR RULES.
 *
 *  1. MEDIANS, NEVER MEANS. One container that sat over a public holiday must not define somebody's
 *     record, and a mean lets it. The median is what a shipper is actually asking about: the usual case.
 *  2. A THIN RECORD SHOWS AS THIN. Under AGENT_MIN_CONTAINERS there are counts and no typical times.
 *     Three containers shows three containers — not hidden, because hiding is polish, and not averaged,
 *     because a typical time from three containers is the same untruth wearing the opposite sign.
 *  3. WHAT THE STATE CONTROLS IS COUNTED, NEVER NETTED. Inspection selection, a physical examination, a
 *     queue: recorded, shown, attributed, and labelled as not the agent's doing. It is NOT subtracted
 *     from anything above it. A system that quietly discounts an agent's own figures by the holds they
 *     themselves reported has built the excuse field §6 was warning about; a reader weighs the context,
 *     the arithmetic does not.
 *  4. NO BLENDED SCORE, anywhere, ever. Blending is exactly what makes bribery look like competence.
 *     There is no weighted total in this file and there must not be one.
 */

/** One port, counted the same way as the whole — §6's per-lane rule, where the lane is a border. */
export interface AgentPortSlice {
  /** 'Mombasa', 'Djibouti' — the label the consignment carries. We do not model ports. */
  key: string;
  appointed: number;
  listed: number;
  cleared: number;
}

/**
 * WHAT THE STATE DID, as the two parties to a container account for it.
 *
 * Counted separately and shown separately. `disputed` is not a correction: the other party to that
 * container says it did not happen that way, both accounts stay on the record, and a reader sees the
 * disagreement rather than our adjudication of it — which is PRE's shape, for PRE's reason.
 */
export interface AgentHolds {
  /** Containers with at least one hold recorded against them. */
  containers: number;
  /** Holds recorded. More than one container's worth of holds can land on one container. */
  recorded: number;
  /** Of those, how many the other party to that container disputes. */
  disputed: number;
  /** By kind, most often first — so 'selected for examination' is distinguishable from 'queue'. */
  kinds: { key: string; times: number }[];
}

export interface AgentRecord {
  /** Containers this company was appointed on. The denominator for everything else. */
  appointed: number;
  /** Of those, how many they published a required list for at all. */
  listed: number;
  /** …and named a fee for. */
  quoted: number;
  /** …and that reached a road leg minted from the port: the container got moving. */
  cleared: number;
  /** Appointed, not yet finished. Not a failure and not a success yet. */
  inFlight: number;
  /**
   * THE FOREKNOWLEDGE FIGURE: containers where the list GREW after the importer had begun supplying it.
   *
   * Counted always, thin record or not, because it is a count of things that happened rather than an
   * average — and because it is the one figure in this file that describes the two-week story. A paper
   * remembered at the counter is a paper the importer had no chance to have ready.
   */
  listedLate: number;
  /** How many papers those late additions were. One forgotten paper is not five. */
  latePapers: number;
  /** Median hours from being appointed to the first paper appearing on the list. Null while thin. */
  listHours: number | null;
  /** Median hours a supplied paper waited on the agent to accept or reject it. Null while thin. */
  checkHours: number | null;
  /** Median hours from appointment to a fee being quoted. Null while thin. */
  quoteHours: number | null;
  /** True when there are too few containers for a typical time. The counts are still real. */
  thin: boolean;
  /** How many containers a typical time would need, so a screen can say so without the config. */
  ratesNeed: number;
  ports: AgentPortSlice[];
  /**
   * WHAT THEY HAVE BEEN SEEN CLEARING, by mode — sea, air, road, rail.
   *
   * Here because the first version of this record could only describe containers, which is what this
   * system happens to record rather than what agents do. An agent whose speciality is air freight was
   * invisible in their own record. The two halves of the page now read together: what they SAY they
   * clear, and what we have seen — and they are allowed to disagree, because an empty record may only
   * mean that work never came through us. See RECORD_SAYS.
   */
  modes: AgentPortSlice[];
  /** §6's other half: what the state controlled. Never folded into the figures above. */
  holds: AgentHolds;
}

/**
 * WHAT WAS MEASURED AND WHAT WAS NOT — carried in the payload, never left to a screen's footnote.
 *
 * This record's failure mode is being read as a general endorsement of an agent's competence at a border,
 * which is the one thing it deliberately says nothing about.
 */
export const AGENT_MEASURED =
  'Measured: how quickly this agent said what papers a consignment would need, whether that list grew ' +
  'afterwards, and how long supplied papers waited on them. Not measured: filing accuracy, duty, or ' +
  'anything that happened at the counter — scoring an agent on time at a border would advertise whoever ' +
  'pays bribes, and a clean customs record is not evidence of compliance. Holds are what the state did, ' +
  'shown apart and never subtracted from the figures above.';

/**
 * WHY AN EMPTY RECORD IS NOT A BAD RECORD — and this sentence is not politeness.
 *
 * We can only count the consignments that came through this network, and an agent's business is mostly
 * not ours: somebody who has cleared air freight at Nairobi for twenty years has a record here of nothing
 * at all until an importer on this platform appoints them. A finder that let silence read as incompetence
 * would be advertising our own coverage as somebody else's quality.
 *
 * Carried in the payload beside the figures, like every other caveat in this epic, so no screen can show
 * the counts without it.
 */
export const RECORD_SAYS =
  'This counts only the consignments handled through this network. An agent may have cleared thousands ' +
  'elsewhere and show nothing here — an empty record means we have not seen their work, not that there ' +
  'is none. What they say they clear is their own claim, and we do not check it.';

const HOUR_MS = 3_600_000;

/** The middle value. Even counts take the lower of the two middles, so a figure is always one real case. */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor((sorted.length - 1) / 2);
  return Math.round(sorted[mid] * 10) / 10;
}

function hoursBetween(from?: string, to?: string): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / HOUR_MS;
}

function slice(into: Map<string, AgentPortSlice>, key: string, add: { listed: boolean; cleared: boolean }): void {
  let row = into.get(key);
  if (!row) {
    row = { key, appointed: 0, listed: 0, cleared: 0 };
    into.set(key, row);
  }
  row.appointed += 1;
  if (add.listed) row.listed += 1;
  if (add.cleared) row.cleared += 1;
}

const byAppointed = (a: AgentPortSlice, b: AgentPortSlice) => b.appointed - a.appointed || b.cleared - a.cleared || a.key.localeCompare(b.key);

/**
 * Build one agent's record from the containers they were appointed on.
 *
 * THE AGENT IS DERIVED, EXACTLY AS THE HANDLE AND THE PRESENCE LEVEL ARE. There is no clearing-agent
 * registration, no capability flag and no licence with a date — CL2's first draft had that and it was
 * wrong, because being a clearing agent is not a status we award, it is work somebody was appointed to
 * do. A company that has been appointed on a container is an agent, and the evidence is the container.
 */
export function agentRecordOf(consignments: ImportConsignment[], entityId: string, now: number = Date.now()): AgentRecord {
  const mine = consignments.filter((c) => c.agentEntityId === entityId && c.appointedAt);
  const ports = new Map<string, AgentPortSlice>();
  const modes = new Map<string, AgentPortSlice>();

  let listed = 0;
  let quoted = 0;
  let cleared = 0;
  let inFlight = 0;
  let listedLate = 0;
  let latePapers = 0;
  const listTimes: number[] = [];
  const checkTimes: number[] = [];
  const quoteTimes: number[] = [];

  let holdContainers = 0;
  let holdsRecorded = 0;
  let holdsDisputed = 0;
  const holdKinds = new Map<string, number>();

  for (const c of mine) {
    const papers = c.required ?? [];
    const didList = papers.length > 0;
    const didQuote = Boolean(c.fee?.quotedAt);
    const didClear = Boolean(c.roadMintedAt);
    if (didList) listed += 1;
    if (didQuote) quoted += 1;
    if (didClear) cleared += 1;
    else inFlight += 1;
    slice(ports, c.destPort || 'unknown', { listed: didList, cleared: didClear });
    slice(modes, modeOf(c), { listed: didList, cleared: didClear });

    // How long until they said what they would need. The first paper is the one that matters: an importer
    // can start work on a list of one, and cannot start at all on a list of none.
    const firstAdded = papers.map((p) => p.addedAt).filter(Boolean).sort()[0];
    const toList = hoursBetween(c.appointedAt, firstAdded);
    if (toList != null) listTimes.push(toList);

    const toQuote = hoursBetween(c.appointedAt, c.fee?.quotedAt);
    if (toQuote != null) quoteTimes.push(toQuote);

    // What a supplied paper waited on THEM. Rejecting counts as answering: a paper sent back with a
    // reason is the agent doing their job, and treating only acceptance as an answer would push an agent
    // towards accepting a paper they should have queried.
    for (const p of papers) {
      const answered = hoursBetween(p.suppliedAt, p.acceptedAt ?? p.rejectedAt);
      if (answered != null) checkTimes.push(answered);
    }

    /*
     * THE LIST THAT GREW AFTERWARDS — the manager's chair remembered at the counter.
     *
     * A paper added after the importer had already supplied something is a paper they could not have had
     * ready, however fast everybody then moved. Compared against the FIRST supply rather than against the
     * paper's own supply, or an agent could keep adding papers indefinitely and each new one would look
     * timely against its own arrival.
     */
    const firstSupply = papers.map((p) => p.suppliedAt).filter((s): s is string => Boolean(s)).sort()[0];
    if (firstSupply) {
      const late = papers.filter((p) => p.addedAt && p.addedAt > firstSupply).length;
      if (late > 0) {
        listedLate += 1;
        latePapers += late;
      }
    }

    const holds = c.customsHolds ?? [];
    if (holds.length) holdContainers += 1;
    for (const h of holds) {
      holdsRecorded += 1;
      if ((h.accounts ?? []).some((a) => a.stance === 'disputed')) holdsDisputed += 1;
      holdKinds.set(h.kind, (holdKinds.get(h.kind) ?? 0) + 1);
    }
  }

  const thin = mine.length < AGENT_MIN_CONTAINERS;
  return {
    appointed: mine.length,
    listed,
    quoted,
    cleared,
    inFlight,
    listedLate,
    latePapers,
    listHours: thin ? null : median(listTimes),
    checkHours: thin ? null : median(checkTimes),
    quoteHours: thin ? null : median(quoteTimes),
    thin,
    ratesNeed: AGENT_MIN_CONTAINERS,
    ports: [...ports.values()].sort(byAppointed),
    modes: [...modes.values()].sort(byAppointed),
    holds: {
      containers: holdContainers,
      recorded: holdsRecorded,
      disputed: holdsDisputed,
      kinds: [...holdKinds.entries()].map(([key, times]) => ({ key, times })).sort((a, b) => b.times - a.times || a.key.localeCompare(b.key)),
    },
  };
}

/** Has this company ever been appointed to clear anything? What makes them an agent at all. */
export function isClearingAgent(consignments: ImportConsignment[], entityId: string): boolean {
  return consignments.some((c) => c.agentEntityId === entityId && c.appointedAt);
}
