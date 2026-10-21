import { Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { clockAt, zonesOfCountry } from './fleet-clock';

/**
 * Round 39 — THE RISK REGISTER (the user: "Staff rate, high asks seals (Recommended)"). Staff rate each corridor and each hub
 * low, medium or high for each threat — pilferage, hijacking, unrest, roadblock extortion — and look at every rating again
 * each quarter. An incident proposes a raise; a person decides it. A HIGH rating asks for seals and no night running: on a
 * high corridor parcels travel only in a bag closed on a coded seal, and nothing goes onto it at night; a bag leaves a high
 * hub only on a coded seal, and none is loaded there at night. What is rated is the network's own judgement, written by a
 * named member of staff, dated, and kept.
 */
export const RISK_SUBJECTS = ['corridor', 'hub'] as const;
export type RiskSubject = (typeof RISK_SUBJECTS)[number];
export const RISK_THREATS = ['pilferage', 'hijacking', 'unrest', 'extortion'] as const;
export type RiskThreat = (typeof RISK_THREATS)[number];
export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** A quarter: a rating is looked at again within this many days of being given. */
export const RISK_REVIEW_DAYS = 91;
/** Night, on the local clock where it happens: from 19:00 until 06:00. */
export const NIGHT_FROM = 19 * 60;
export const NIGHT_TO = 6 * 60;
const DAY = 86_400_000;

export const THREAT_WORDS: Record<RiskThreat, string> = { pilferage: 'pilferage', hijacking: 'hijacking', unrest: 'unrest', extortion: 'roadblock extortion' };

export interface RiskRating {
  subject: RiskSubject;
  id: string;
  threat: RiskThreat;
  level: RiskLevel;
  /** Why, in the rater's words — or the incident that proposed it. */
  why?: string;
  ratedBy: string;
  ratedAt: string;
  /** Looked at again by then: a quarter after it was given. */
  reviewBy: string;
}

export interface RiskProposal {
  proposalId: string;
  subject: RiskSubject;
  id: string;
  threat: RiskThreat;
  from?: RiskLevel;
  to: RiskLevel;
  /** The incident, in words: what was found, where. */
  because: string;
  /** The incident's own reference — a bag, a parcel, a load. */
  ref?: string;
  at: string;
  state: 'open' | 'accepted' | 'declined' | 'superseded';
  decidedBy?: string;
  decidedAt?: string;
  reason?: string;
}

/** One step up: unrated and low become medium, medium becomes high. */
const NEXT: Record<RiskLevel | 'unrated', RiskLevel> = { unrated: 'medium', low: 'medium', medium: 'high', high: 'high' };
const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

@Injectable()
export class RiskRegisterService {
  private readonly ratings = new PersistentMap<string, RiskRating>('risk-ratings');
  private readonly proposals = new PersistentMap<string, RiskProposal>('risk-proposals');

  constructor(@Optional() private readonly events?: EventBus) {}

  /**
   * RATED — by a named member of staff, with why. Rating again at the same level is a review: the quarter starts again. A
   * rating at or above an open proposal's answers it.
   */
  rate(subject: RiskSubject, id: string, threat: RiskThreat, level: RiskLevel, by: string, why?: string, now: number = Date.now(), tell?: { did: string; name: string }): RiskRating {
    if (!RISK_SUBJECTS.includes(subject)) throw new GlosError('INVALID_INPUT', 'A rating is of a corridor or a hub', { field: 'subject' });
    if (!RISK_THREATS.includes(threat)) throw new GlosError('INVALID_INPUT', 'Say which threat: pilferage, hijacking, unrest or roadblock extortion', { field: 'threat' });
    if (!RISK_LEVELS.includes(level)) throw new GlosError('INVALID_INPUT', 'A rating is low, medium or high', { field: 'level' });
    const who = by.trim();
    if (!who) throw new GlosError('FIELD_REQUIRED', 'Say who is rating it', { field: 'by' });
    const before = this.levelOf(subject, id, threat);
    const rating: RiskRating = { subject, id, threat, level, ...(why?.trim() ? { why: why.trim().slice(0, 300) } : {}), ratedBy: who, ratedAt: new Date(now).toISOString(), reviewBy: new Date(now + RISK_REVIEW_DAYS * DAY).toISOString() };
    this.ratings.set(key(subject, id, threat), rating);
    for (const p of this.proposals.values()) {
      if (p.state === 'open' && p.subject === subject && p.id === id && p.threat === threat && RANK[level] >= RANK[p.to]) {
        this.proposals.set(p.proposalId, { ...p, state: 'superseded', decidedBy: who, decidedAt: rating.ratedAt });
      }
    }
    // Told to whoever works under it — the hub, or the fleet that runs the corridor — when it changes.
    if (before !== level) void this.events?.publish(GlosEvent.Pudo.RiskRated, { subject, id, threat, level, from: before, ...(tell ? { tell } : {}) }, { source: 'pudo' }).catch(() => undefined);
    return rating;
  }

  levelOf(subject: RiskSubject, id: string, threat: RiskThreat): RiskLevel | undefined {
    return this.ratings.get(key(subject, id, threat))?.level;
  }

  /** Every rating of one corridor or hub, by threat. */
  ratingsOf(subject: RiskSubject, id: string): Partial<Record<RiskThreat, RiskRating>> {
    const out: Partial<Record<RiskThreat, RiskRating>> = {};
    for (const t of RISK_THREATS) {
      const r = this.ratings.get(key(subject, id, t));
      if (r) out[t] = r;
    }
    return out;
  }

  /** The threats a corridor or hub is rated high for — what makes it ask for seals and no night running. */
  highThreats(subject: RiskSubject, id: string | undefined): RiskThreat[] {
    if (!id) return [];
    return RISK_THREATS.filter((t) => this.levelOf(subject, id, t) === 'high');
  }

  /**
   * AN INCIDENT PROPOSES A RAISE: one step up for that threat, said with what happened. Nothing changes until a person
   * decides. Already high: nothing to propose. One waiting for the same corridor or hub and threat: that one stands.
   */
  propose(subject: RiskSubject, id: string, threat: RiskThreat, because: string, ref?: string, now: number = Date.now()): RiskProposal | undefined {
    const from = this.levelOf(subject, id, threat);
    if (from === 'high') return undefined;
    const waiting = [...this.proposals.values()].find((p) => p.state === 'open' && p.subject === subject && p.id === id && p.threat === threat);
    if (waiting) return waiting;
    const proposal: RiskProposal = {
      proposalId: `rsk_${randomBytes(8).toString('hex')}`,
      subject,
      id,
      threat,
      ...(from ? { from } : {}),
      to: NEXT[from ?? 'unrated'],
      because: because.slice(0, 300),
      ...(ref ? { ref } : {}),
      at: new Date(now).toISOString(),
      state: 'open',
    };
    this.proposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  /** A PERSON DECIDES: raised as proposed, or not — with the reason, which is kept. */
  decide(proposalId: string, accept: boolean, by: string, reason?: string, now: number = Date.now(), tell?: { did: string; name: string }): RiskProposal {
    const p = this.proposals.get(proposalId);
    if (!p) throw new GlosError('NOT_FOUND', 'No such proposal');
    if (p.state !== 'open') throw new GlosError('INVALID_STATE', `That proposal was ${p.state} already`);
    const who = by.trim();
    if (!who) throw new GlosError('FIELD_REQUIRED', 'Say who is deciding', { field: 'by' });
    const at = new Date(now).toISOString();
    if (accept) {
      this.rate(p.subject, p.id, p.threat, p.to, who, p.because, now, tell);
      const decided: RiskProposal = { ...p, state: 'accepted', decidedBy: who, decidedAt: at };
      this.proposals.set(p.proposalId, decided);
      return decided;
    }
    const why = reason?.trim();
    if (!why) throw new GlosError('REASON_REQUIRED', 'Say why it stays as it is: the reason is kept beside the incident');
    const decided: RiskProposal = { ...p, state: 'declined', decidedBy: who, decidedAt: at, reason: why.slice(0, 300) };
    this.proposals.set(p.proposalId, decided);
    return decided;
  }

  /** Which corridor a driver is on now: registered by FleetService (a hook, not a dependency). */
  private corridorOfDriver?: (driverDid: string) => string | undefined;
  registerCorridorOf(fn: (driverDid: string) => string | undefined): void {
    this.corridorOfDriver = fn;
  }

  /**
   * TAMPERING PROPOSES A RAISE FOR PILFERAGE: of the hub where it was found, and of the corridor of the driver who carried
   * it. A person decides each; declining one is cheap, and its reason is kept beside the incident.
   */
  proposeFromTamper(input: { hubMdpId?: string; carrierDid?: string; because: string; ref: string }, now: number = Date.now()): RiskProposal[] {
    const out: RiskProposal[] = [];
    if (input.hubMdpId) out.push(...[this.propose('hub', input.hubMdpId, 'pilferage', input.because, input.ref, now)].filter((p): p is RiskProposal => Boolean(p)));
    const corridorId = input.carrierDid ? this.corridorOfDriver?.(input.carrierDid) : undefined;
    if (corridorId) out.push(...[this.propose('corridor', corridorId, 'pilferage', input.because, input.ref, now)].filter((p): p is RiskProposal => Boolean(p)));
    return out;
  }

  /** What waits for a person, oldest first. */
  openProposals(): RiskProposal[] {
    return [...this.proposals.values()].filter((p) => p.state === 'open').sort((a, b) => a.at.localeCompare(b.at));
  }

  /** Night where it happens: the country's own clock, from 19:00 until 06:00. */
  isNight(country: string | undefined, now: number = Date.now()): boolean {
    const zone = zonesOfCountry(country)[0] ?? 'UTC';
    const m = clockAt(now, zone).minutes;
    return m >= NIGHT_FROM || m < NIGHT_TO;
  }

  /** A bag leaves a hub rated high only on a coded seal. */
  assertHubSeal(hub: { mdpId: string; name: string }, closure: { seal?: string } | undefined): void {
    const highs = this.highThreats('hub', hub.mdpId);
    if (!highs.length || closure?.seal?.trim()) return;
    throw new GlosError('RISK_SEAL_REQUIRED', `${hub.name} is rated high for ${threatsWords(highs)}: a bag leaves it only on a coded seal. Put one on, and photograph it.`, { threats: highs });
  }

  /** Nothing is loaded at a hub rated high at night. */
  assertHubDay(hub: { mdpId: string; name: string }, country: string | undefined, now: number = Date.now()): void {
    const highs = this.highThreats('hub', hub.mdpId);
    if (!highs.length || !this.isNight(country, now)) return;
    throw new GlosError('RISK_NIGHT', `${hub.name} is rated high for ${threatsWords(highs)}: nothing is loaded there between 19:00 and 06:00.`, { threats: highs });
  }

  /**
   * What a corridor rated high asks of anything going onto a driver on it: never at night; parcels only in a bag; a bag only
   * on a coded seal. Said with the corridor and the threats, so the counter knows what would let it go.
   */
  assertCorridorAllows(corridor: { corridorId: string; name: string } | undefined, act: { loose?: boolean; bagSealed?: boolean; country?: string }, now: number = Date.now()): void {
    if (!corridor) return;
    const highs = this.highThreats('corridor', corridor.corridorId);
    if (!highs.length) return;
    const rated = `${corridor.name} is rated high for ${threatsWords(highs)}`;
    if (this.isNight(act.country, now)) throw new GlosError('RISK_NIGHT', `${rated}: nothing goes onto it between 19:00 and 06:00.`, { threats: highs });
    if (act.loose) throw new GlosError('RISK_SEAL_REQUIRED', `${rated}: parcels travel on it only in a bag closed on a coded seal. Bag them, and seal the bag.`, { threats: highs });
    if (act.bagSealed === false) throw new GlosError('RISK_SEAL_REQUIRED', `${rated}: a bag travels on it only on a coded seal, and this one was closed with a photograph. Close it on a seal.`, { threats: highs });
  }
}

/** "pilferage and unrest". */
export function threatsWords(threats: readonly RiskThreat[]): string {
  const words = threats.map((t) => THREAT_WORDS[t]);
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : (words[0] ?? '');
}

const key = (subject: RiskSubject, id: string, threat: RiskThreat): string => `${subject}:${id}:${threat}`;
