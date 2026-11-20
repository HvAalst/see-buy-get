import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { randomBytes } from 'crypto';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { AgentService } from './agent.service';
import { ClaudeGateway, type ClaudeReply, type ClaudeRequest } from './claude.gateway';
import { MdpService } from './mdp.service';
import { ParcelService } from './parcel.service';
import { LISTED_AT, PARTNER_WORKS, PartnerLedgerService, type PartnerOwedLine, type PartnerPayeeKind, type PartnerWork } from './partner-ledger.service';

/**
 * 2026-11-20 — CHECKS ON THE PARTNER'S FIGURES (the payments plan, 3b; the owner: "We also need AI anti fraud scrutiny on the
 * figures"). What a partner owes, step by step, is read for fraud and for mistakes: first by fixed rules, every hour — a step
 * owed twice, pay for a parcel the hand never held, a shop's own parcels, amounts off the partner's list, unusual volumes —
 * then once a day by an AI review of the week's figures, which sees tokens in place of names, phone numbers and ids. Each
 * finding says why, in figures, and waits for our staff to look; nothing here stops a step, holds a payout or moves money.
 */
export const PARTNER_CHECK_RULES = ['twice', 'never_held', 'own_parcels', 'off_list', 'volume', 'ai'] as const;
export type PartnerCheckRule = (typeof PARTNER_CHECK_RULES)[number];
export type PartnerReviewWhy = 'refused' | 'cut_short' | 'unreadable' | 'unreachable';

/** Works done once for a parcel, a hand-over sheet or an arrival: a second line for the same one is owed twice. */
const ONCE: readonly PartnerWork[] = ['take_in', 'shelving', 'release', 'handover', 'sort', 'receiving'];
/** Works on a bag, whose code comes round again trip after trip: owed twice when twice within a day. */
const ONCE_A_DAY: readonly PartnerWork[] = ['pass_on', 'bag_load', 'road'];
const DAY_MS = 86_400_000;
/** Paid more than this many times the partner's own list figure for the work. */
export const OFF_LIST_MULTIPLE = 2;
/** Unusual volume: at least this many steps in a day, and this many times the hand's usual… */
export const VOLUME_FLOOR = 10;
export const VOLUME_TIMES = 3;
/** …its usual being the days it worked in the fortnight before, once there are at least this many of them. */
export const VOLUME_HISTORY_DAYS = 5;
/** A hand with no steps in the fortnight before: this many in one day is looked at. */
export const VOLUME_NEW_HAND = 30;
/** The model the daily review runs on — the one the plan adviser runs on. */
export const REVIEW_MODEL = 'claude-opus-5-5';
export const REVIEW_DAYS = 7;
export const REVIEW_MAX_ROWS = 2000;
/** A finding keeps at most this many of the lines it was made of. */
const MAX_LINES_KEPT = 50;
const LOOK_EVERY_MS = 60 * 60_000;
/** Staff may ask for a review again only an hour after the last: every one is paid for. */
const ASK_AGAIN_AFTER_MS = 60 * 60_000;

/** The figures a finding is made of: the console says them in the reader's own language. */
export interface PartnerFlagFacts {
  work?: PartnerWork;
  reference?: string;
  times?: number;
  amount?: number;
  listed?: number;
  currency?: string;
  day?: string;
  count?: number;
  usual?: number;
  parcels?: string[];
  /** Paid for a parcel that is not on record at all. */
  missing?: boolean;
}

export interface PartnerFlag {
  flagId: string;
  /** One finding per rule, hand and thing found: found again, it is the same finding — reopened if something new is in it. */
  key: string;
  partnerEntityId: string;
  rule: PartnerCheckRule;
  payeeId: string;
  payeeKind: PartnerPayeeKind;
  lineIds: string[];
  facts: PartnerFlagFacts;
  /** The AI review's own words (English), with its tokens put back. */
  reason?: string;
  severity: 'look' | 'urgent';
  foundAt: string;
  looked?: { by: string; at: string; note?: string };
}

export interface PartnerReview {
  partnerEntityId: string;
  day: string;
  at: string;
  state: 'done' | 'failed' | 'off';
  flags: number;
  why?: PartnerReviewWhy;
  rows?: number;
}

export type Finding = Pick<PartnerFlag, 'key' | 'rule' | 'payeeId' | 'payeeKind' | 'lineIds' | 'facts' | 'severity'> & { reason?: string };

/** What the rules read beyond the lines themselves: a parcel's chain and numbers, a shop's own number, a hub's name. */
export interface CheckWorld {
  parcel(id: string): { custody?: Array<{ holderKind: string; holderId: string }>; senderPhoneHash?: string; receiverPhoneHash?: string } | undefined;
  shopPhoneHash(did: string): string | undefined;
  hubName(mdpId: string): string | undefined;
}

const dayOf = (at: string | number): string => new Date(at).toISOString().slice(0, 10);

/** The lines still owed: neither a take-back nor taken back. */
export function openLines(lines: PartnerOwedLine[]): PartnerOwedLine[] {
  const undone = new Set(lines.map((l) => l.undoes).filter((id): id is string => Boolean(id)));
  return lines.filter((l) => !l.undoes && !undone.has(l.lineId)).sort((a, b) => a.at.localeCompare(b.at));
}

/** THE FIXED RULES, over a partner's lines — pure, so each is held to by its own test. */
export function findFlags(lines: PartnerOwedLine[], world: CheckWorld, now: number): Finding[] {
  const open = openLines(lines);
  const found = new Map<string, Finding>();
  const add = (f: Finding): void => {
    const was = found.get(f.key);
    if (!was) found.set(f.key, f);
    else was.lineIds = [...new Set([...was.lineIds, ...f.lineIds])];
  };

  // 1. A STEP OWED TWICE: the same work for the same parcel, sheet or arrival — or for the same bag within a day.
  const groups = new Map<string, PartnerOwedLine[]>();
  for (const l of open) {
    if (!l.work || (!ONCE.includes(l.work) && !ONCE_A_DAY.includes(l.work))) continue;
    const k = `${l.payeeId}|${l.work}|${l.reference}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  for (const [k, group] of groups) {
    if (group.length < 2) continue;
    const first = group[0];
    const finding = (ls: PartnerOwedLine[], key: string): Finding => ({ key, rule: 'twice', payeeId: first.payeeId, payeeKind: first.payeeKind, lineIds: ls.map((l) => l.lineId), facts: { work: first.work, reference: first.reference, times: ls.length }, severity: 'urgent' });
    if (ONCE.includes(first.work as PartnerWork)) {
      add(finding(group, `twice|${k}`));
      continue;
    }
    let run: PartnerOwedLine[] = [first];
    const flush = (): void => {
      if (run.length > 1) add(finding(run, `twice|${k}|${dayOf(run[0].at)}`));
    };
    for (const l of group.slice(1)) {
      if (Date.parse(l.at) - Date.parse(run[run.length - 1].at) < DAY_MS) run.push(l);
      else {
        flush();
        run = [l];
      }
    }
    flush();
  }

  // 2. PAID FOR A PARCEL IT NEVER HELD: a shop's work on a parcel, or a hub's sort, by a hand its chain never names.
  for (const l of open) {
    const shop = l.payeeKind === 'shop' && l.refType === 'parcel';
    const hub = l.payeeKind === 'hub' && l.step === 'sort';
    if (!shop && !hub) continue;
    const parcel = world.parcel(l.reference);
    const base = { key: `never_held|${l.payeeId}|${l.reference}`, rule: 'never_held' as const, payeeId: l.payeeId, payeeKind: l.payeeKind, lineIds: [l.lineId], severity: 'urgent' as const };
    if (!parcel) {
      add({ ...base, facts: { reference: l.reference, ...(l.work ? { work: l.work } : {}), missing: true } });
      continue;
    }
    // A parcel whose chain was never kept has nothing to read it against: never a finding made of an absence.
    if (!parcel.custody?.length) continue;
    const name = shop ? l.payeeId : world.hubName(l.payeeId);
    const held = parcel.custody.some((leg) => leg.holderKind === (shop ? 'shop' : 'hub') && (leg.holderId === l.payeeId || (name !== undefined && leg.holderId === name)));
    if (!held) add({ ...base, facts: { reference: l.reference, ...(l.work ? { work: l.work } : {}) } });
  }

  // 3. A SHOP'S OWN PARCELS: sent or received on the shop's own number, or sent to the number they came from — per shop, per day.
  const own = new Map<string, { payeeId: string; day: string; lines: string[]; parcels: Set<string> }>();
  for (const l of open) {
    if (l.payeeKind !== 'shop' || l.refType !== 'parcel') continue;
    const parcel = world.parcel(l.reference);
    if (!parcel) continue;
    const mine = world.shopPhoneHash(l.payeeId);
    const from = parcel.senderPhoneHash;
    const to = parcel.receiverPhoneHash;
    const itsOwn = (mine && (from === mine || to === mine)) || (from && from === to);
    if (!itsOwn) continue;
    const day = dayOf(l.at);
    const k = `${l.payeeId}|${day}`;
    const e = own.get(k) ?? { payeeId: l.payeeId, day, lines: [], parcels: new Set<string>() };
    e.lines.push(l.lineId);
    e.parcels.add(l.reference);
    own.set(k, e);
  }
  for (const [k, e] of own) {
    add({ key: `own_parcels|${k}`, rule: 'own_parcels', payeeId: e.payeeId, payeeKind: 'shop', lineIds: e.lines, facts: { day: e.day, count: e.parcels.size, parcels: [...e.parcels].slice(0, 10) }, severity: 'look' });
  }

  // 4. OFF THE PARTNER'S LIST: paid more than twice what its own list said for the work, when it was owed.
  for (const l of open) {
    if (!(typeof l.listed === 'number' && l.listed > 0) || !(l.amount > l.listed * OFF_LIST_MULTIPLE)) continue;
    add({ key: `off_list|${l.lineId}`, rule: 'off_list', payeeId: l.payeeId, payeeKind: l.payeeKind, lineIds: [l.lineId], facts: { ...(l.work ? { work: l.work } : {}), reference: l.reference, amount: l.amount, listed: l.listed, currency: l.currency }, severity: 'look' });
  }

  // 5. UNUSUAL VOLUME: yesterday and today, each against the hand's own fortnight before.
  const perHand = new Map<string, { kind: PartnerPayeeKind; days: Map<string, string[]> }>();
  for (const l of open) {
    const h = perHand.get(l.payeeId) ?? { kind: l.payeeKind, days: new Map<string, string[]>() };
    const day = dayOf(l.at);
    h.days.set(day, [...(h.days.get(day) ?? []), l.lineId]);
    perHand.set(l.payeeId, h);
  }
  for (const day of [dayOf(now - DAY_MS), dayOf(now)]) {
    for (const [payeeId, h] of perHand) {
      const that = h.days.get(day) ?? [];
      if (!that.length) continue;
      const before = [...h.days.entries()].filter(([d]) => d < day && Date.parse(day) - Date.parse(d) <= 14 * DAY_MS).map(([, ids]) => ids.length);
      const usual = before.length ? before.reduce((a, b) => a + b, 0) / before.length : 0;
      const unusual = before.length >= VOLUME_HISTORY_DAYS ? that.length >= Math.max(VOLUME_FLOOR, Math.ceil(VOLUME_TIMES * usual)) : before.length === 0 && that.length >= VOLUME_NEW_HAND;
      if (!unusual) continue;
      add({ key: `volume|${payeeId}|${day}`, rule: 'volume', payeeId, payeeKind: h.kind, lineIds: that.slice(0, MAX_LINES_KEPT), facts: { day, count: that.length, ...(before.length ? { usual: Math.round(usual) } : {}) }, severity: 'look' });
    }
  }
  return [...found.values()];
}

/**
 * WHAT THE AI REVIEW IS SHOWN — tokens, never a name, a phone number or an id: hands as H1, H2…, parcels and bags as R1, R2…;
 * with each step's day, hour, work, amount and the list figure it was owed against, and what the fixed rules raised already.
 */
export function reviewInput(lines: PartnerOwedLine[], flagged: Array<Pick<PartnerFlag, 'rule' | 'payeeId'>>, list: Record<string, number>, currency: string): { text: string; hands: Map<string, string>; refs: Map<string, string>; rows: number } {
  const handOf = new Map<string, string>();
  const refOf = new Map<string, string>();
  const token = (map: Map<string, string>, id: string, prefix: string): string => {
    let t = map.get(id);
    if (!t) {
      t = `${prefix}${map.size + 1}`;
      map.set(id, t);
    }
    return t;
  };
  const recent = lines.slice(-REVIEW_MAX_ROWS);
  const rows = recent.map((l) => [l.at.slice(0, 10), Number(l.at.slice(11, 13)), token(handOf, l.payeeId, 'H'), l.payeeKind, l.work ?? l.step, token(refOf, l.reference, 'R'), l.amount, l.listed ?? null, Boolean(l.undoes)]);
  const alreadyFlagged = flagged.filter((f) => handOf.has(f.payeeId)).map((f) => ({ rule: f.rule, hand: handOf.get(f.payeeId) }));
  const text = JSON.stringify({
    currency,
    list,
    truncated: lines.length > recent.length,
    columns: ['day', 'hourUtc', 'hand', 'kindOfHand', 'work', 'parcelOrBag', 'amount', 'listed', 'takenBack'],
    rows,
    alreadyFlagged,
  });
  const flip = (m: Map<string, string>) => new Map([...m.entries()].map(([id, t]) => [t, id]));
  return { text, hands: flip(handOf), refs: flip(refOf), rows: rows.length };
}

const REVIEW_BRIEF = [
  'You check the figures of a parcel network’s partner company for fraud and for mistakes.',
  'The partner pays shops, hubs and drivers for each step of a parcel, at its own list. Each row is one step owed: the day, the hour (UTC), the hand, its kind, the work, the parcel or bag it was for, the amount, the partner’s list figure for that work when it was owed, and whether it was taken back.',
  'Names, phone numbers and ids are replaced by tokens: H1, H2… for hands, R1, R2… for parcels and bags.',
  'Flag only what a staff member should look at, especially what fixed rules miss: a hand paid for far more steps than it could have handled, steps at hours when shops are shut, the same parcels going round between the same hands, amounts that drift upward, or a hand whose steps are mostly taken back.',
  'The fixed rules already raised are listed under alreadyFlagged: do not repeat them.',
  'Each flag names one hand token and says why in one or two plain sentences, citing the figures. Mark it urgent only where money is likely being taken. Return no flags when nothing stands out.',
].join(' ');

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    flags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hand: { type: 'string', description: 'The hand token, as in the rows: H1, H2…' },
          reason: { type: 'string', description: 'Why staff should look, in one or two sentences, citing the figures.' },
          severity: { type: 'string', enum: ['look', 'urgent'] },
        },
        required: ['hand', 'reason', 'severity'],
        additionalProperties: false,
      },
    },
  },
  required: ['flags'],
  additionalProperties: false,
};

/** The one request a day's review makes. */
export function reviewRequest(text: string): ClaudeRequest {
  return {
    model: REVIEW_MODEL,
    max_tokens: 4000,
    system: REVIEW_BRIEF,
    messages: [{ role: 'user', content: text }],
    // A read of a week's figures, once a day: the model's default depth, its answer held to the schema.
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
    // If a safety classifier declines the request, it is re-run on the model Anthropic recommends for that case.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
}

/** The review's answer, read: its flags with their tokens put back — or why there are none to read. */
export function readReview(reply: Pick<ClaudeReply, 'stop_reason' | 'content'>, hands: Map<string, string>, refs: Map<string, string> = new Map()): { flags: Array<{ payeeId: string; reason: string; severity: 'look' | 'urgent' }> } | { why: PartnerReviewWhy } {
  if (reply.stop_reason === 'refusal') return { why: 'refused' };
  if (reply.stop_reason === 'max_tokens') return { why: 'cut_short' };
  const block = reply.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return { why: 'unreadable' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    return { why: 'unreadable' };
  }
  const raw = (parsed as { flags?: unknown } | null)?.flags;
  if (!Array.isArray(raw)) return { why: 'unreadable' };
  const back = (words: string): string => words.replace(/\b([HR])(\d+)\b/g, (t) => (t.startsWith('H') ? hands.get(t) : refs.get(t)) ?? t);
  const flags = raw
    .flatMap((f: { hand?: unknown; reason?: unknown; severity?: unknown }) => {
      const payeeId = typeof f?.hand === 'string' ? hands.get(f.hand.trim()) : undefined;
      const reason = typeof f?.reason === 'string' ? back(f.reason.trim()).slice(0, 600) : '';
      if (!payeeId || !reason) return [];
      return [{ payeeId, reason, severity: f.severity === 'urgent' ? ('urgent' as const) : ('look' as const) }];
    })
    .slice(0, 20);
  return { flags };
}

/* ------------------------------------------------------------------------------------------------ what staff read -- */

export class PartnerFlagFactsView {
  @ApiPropertyOptional({ enum: PARTNER_WORKS }) work?: PartnerWork;
  @ApiPropertyOptional() reference?: string;
  @ApiPropertyOptional() times?: number;
  @ApiPropertyOptional() amount?: number;
  @ApiPropertyOptional() listed?: number;
  @ApiPropertyOptional() currency?: string;
  @ApiPropertyOptional() day?: string;
  @ApiPropertyOptional() count?: number;
  @ApiPropertyOptional() usual?: number;
  @ApiPropertyOptional({ type: [String] }) parcels?: string[];
  @ApiPropertyOptional() missing?: boolean;
}

export class PartnerFlagLookedView {
  @ApiProperty() by: string;
  @ApiProperty() at: string;
  @ApiPropertyOptional() note?: string;
}

export class PartnerFlagRow {
  @ApiProperty() flagId: string;
  @ApiProperty({ enum: PARTNER_CHECK_RULES }) rule: PartnerCheckRule;
  @ApiProperty() payeeId: string;
  @ApiProperty({ enum: ['shop', 'hub', 'driver', 'fleet'] }) payeeKind: PartnerPayeeKind;
  @ApiProperty({ type: [String] }) lineIds: string[];
  @ApiProperty({ type: PartnerFlagFactsView }) facts: PartnerFlagFactsView;
  @ApiPropertyOptional({ description: 'The AI review’s own words (English).' }) reason?: string;
  @ApiProperty({ enum: ['look', 'urgent'] }) severity: 'look' | 'urgent';
  @ApiProperty() foundAt: string;
  @ApiPropertyOptional({ type: PartnerFlagLookedView }) looked?: PartnerFlagLookedView;
}

export class PartnerReviewRow {
  @ApiProperty() day: string;
  @ApiProperty() at: string;
  @ApiProperty({ enum: ['done', 'failed', 'off'] }) state: 'done' | 'failed' | 'off';
  @ApiProperty() flags: number;
  @ApiPropertyOptional({ enum: ['refused', 'cut_short', 'unreadable', 'unreachable'] }) why?: PartnerReviewWhy;
  @ApiPropertyOptional() rows?: number;
}

export class PartnerChecksView {
  @ApiProperty({ type: [PartnerFlagRow] }) open: PartnerFlagRow[];
  @ApiProperty({ type: [PartnerFlagRow] }) looked: PartnerFlagRow[];
  @ApiPropertyOptional({ type: PartnerReviewRow }) review?: PartnerReviewRow;
  @ApiProperty({ description: 'Whether the server has a key for the AI review.' }) aiReady: boolean;
}

export class PartnerFlagLookedDto {
  @ApiPropertyOptional({ maxLength: 500, description: 'What staff found, in a few words.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

function rowOf(f: PartnerFlag): PartnerFlagRow {
  return {
    flagId: f.flagId,
    rule: f.rule,
    payeeId: f.payeeId,
    payeeKind: f.payeeKind,
    lineIds: f.lineIds,
    facts: f.facts,
    ...(f.reason ? { reason: f.reason } : {}),
    severity: f.severity,
    foundAt: f.foundAt,
    ...(f.looked ? { looked: f.looked } : {}),
  };
}

function reviewRowOf(r: PartnerReview): PartnerReviewRow {
  return { day: r.day, at: r.at, state: r.state, flags: r.flags, ...(r.why ? { why: r.why } : {}), ...(typeof r.rows === 'number' ? { rows: r.rows } : {}) };
}

@Injectable()
export class PartnerChecksService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('PartnerChecks');
  /** Keyed `${partnerEntityId}|${finding key}`: one finding, however often it is found. */
  private readonly flags = new PersistentMap<string, PartnerFlag>('partner-flags');
  /** Keyed `${partnerEntityId}|${day}`: one AI review a day per partner. */
  private readonly reviews = new PersistentMap<string, PartnerReview>('partner-reviews');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly ledger: PartnerLedgerService,
    private readonly entities: EntityService,
    private readonly parcels: ParcelService,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    @Optional() private readonly claude?: ClaudeGateway,
  ) {}

  onApplicationBootstrap(): void {
    void this.due().catch((err) => this.logger.warn(`partner checks: ${(err as Error).message}`));
    this.timer = setInterval(() => void this.due().catch(() => undefined), LOOK_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Every hour: the fixed rules for every partner with figures; the day's AI review where it has not run yet. */
  async due(now: number = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const partnerEntityId of this.ledger.partnersWithLines()) {
        this.check(partnerEntityId, now);
        if (!this.reviews.has(`${partnerEntityId}|${dayOf(now)}`) && this.ledger.linesOf(partnerEntityId, now - REVIEW_DAYS * DAY_MS).length) await this.review(partnerEntityId, now);
      }
    } finally {
      this.running = false;
    }
  }

  /** The fixed rules over the partner's last month. Returns what was found new, or found again with something new in it. */
  check(partnerEntityId: string, now: number = Date.now()): PartnerFlag[] {
    const lines = this.ledger.linesOf(partnerEntityId, now - 30 * DAY_MS);
    return findFlags(lines, this.world(), now).flatMap((f) => this.keep(partnerEntityId, f, now) ?? []);
  }

  /**
   * THE DAY'S AI REVIEW. Not set up (no key on the server): said, never pretended. Asked by staff: once an hour at most.
   * What it returns is kept as findings for staff — never acted on.
   */
  async review(partnerEntityId: string, now: number = Date.now(), opts: { asked?: boolean } = {}): Promise<PartnerReviewRow> {
    if (opts.asked) {
      const last = this.lastReview(partnerEntityId);
      if (last && now - Date.parse(last.at) < ASK_AGAIN_AFTER_MS) throw new GlosError('RATE_LIMITED', 'The AI review ran less than an hour ago: ask again later');
    }
    const day = dayOf(now);
    const record = (r: Pick<PartnerReview, 'state' | 'flags' | 'why' | 'rows'>): PartnerReviewRow => {
      const kept: PartnerReview = { partnerEntityId, day, at: new Date(now).toISOString(), state: r.state, flags: r.flags, ...(r.why ? { why: r.why } : {}), ...(typeof r.rows === 'number' ? { rows: r.rows } : {}) };
      this.reviews.set(`${partnerEntityId}|${day}`, kept);
      return reviewRowOf(kept);
    };
    if (!this.claude?.configured()) return record({ state: 'off', flags: 0 });
    const lines = this.ledger.linesOf(partnerEntityId, now - REVIEW_DAYS * DAY_MS);
    if (!lines.length) return record({ state: 'done', flags: 0, rows: 0 });
    const amounts = this.entities.amountsFor(partnerEntityId);
    const list = Object.fromEntries(PARTNER_WORKS.flatMap((w) => (LISTED_AT[w] ? [[w, amounts[LISTED_AT[w] as keyof typeof amounts] as number]] : [])));
    const raised = [...this.flags.values()].filter((f) => f.partnerEntityId === partnerEntityId && !f.looked && f.rule !== 'ai');
    const input = reviewInput(lines, raised, list, amounts.currency ?? this.entities.get(partnerEntityId).currency ?? '');
    let reply: ClaudeReply;
    try {
      reply = await this.claude.create(reviewRequest(input.text));
    } catch (err) {
      // The reason stays in the log: never a provider's words in front of staff.
      this.logger.warn(`AI review for ${partnerEntityId} did not reach the model: ${(err as Error).message}`);
      return record({ state: 'failed', flags: 0, why: 'unreachable', rows: input.rows });
    }
    const read = readReview(reply, input.hands, input.refs);
    if ('why' in read) return record({ state: 'failed', flags: 0, why: read.why, rows: input.rows });
    for (const f of read.flags) {
      const kind = lines.find((l) => l.payeeId === f.payeeId)?.payeeKind ?? 'shop';
      this.keep(partnerEntityId, { key: `ai|${day}|${f.payeeId}`, rule: 'ai', payeeId: f.payeeId, payeeKind: kind, lineIds: [], facts: { day }, severity: f.severity, reason: f.reason }, now);
    }
    return record({ state: 'done', flags: read.flags.length, rows: input.rows });
  }

  /** What staff read on the partner's page: what is still to look at, what was looked at, and the last AI review. */
  checksOf(partnerEntityId: string): PartnerChecksView {
    const mine = [...this.flags.values()].filter((f) => f.partnerEntityId === partnerEntityId).sort((a, b) => b.foundAt.localeCompare(a.foundAt));
    const last = this.lastReview(partnerEntityId);
    return {
      open: mine.filter((f) => !f.looked).slice(0, 100).map(rowOf),
      looked: mine.filter((f) => f.looked).slice(0, 30).map(rowOf),
      ...(last ? { review: reviewRowOf(last) } : {}),
      aiReady: Boolean(this.claude?.configured()),
    };
  }

  /** Looked at, by name, with what was found: the finding stays on the record, closed — reopened only by something new in it. */
  markLooked(partnerEntityId: string, flagId: string, by: string, note?: string, now: number = Date.now()): PartnerFlagRow {
    const hit = [...this.flags.entries()].find(([, f]) => f.flagId === flagId && f.partnerEntityId === partnerEntityId);
    if (!hit) throw new GlosError('NOT_FOUND', 'There is no such finding on this partner');
    const [key, flag] = hit;
    if (!flag.looked) {
      flag.looked = { by, at: new Date(now).toISOString(), ...(note?.trim() ? { note: note.trim().slice(0, 500) } : {}) };
      this.flags.set(key, flag);
    }
    return rowOf(flag);
  }

  private lastReview(partnerEntityId: string): PartnerReview | undefined {
    return [...this.reviews.values()].filter((r) => r.partnerEntityId === partnerEntityId).sort((a, b) => b.at.localeCompare(a.at))[0];
  }

  /** Kept once per key: new → a finding; found again with lines it did not have → updated, and reopened if it was closed. */
  private keep(partnerEntityId: string, f: Finding, now: number): PartnerFlag | undefined {
    const key = `${partnerEntityId}|${f.key}`;
    const was = this.flags.get(key);
    if (!was) {
      const flag: PartnerFlag = { flagId: `pf_${randomBytes(9).toString('base64url')}`, key: f.key, partnerEntityId, rule: f.rule, payeeId: f.payeeId, payeeKind: f.payeeKind, lineIds: f.lineIds.slice(0, MAX_LINES_KEPT), facts: f.facts, ...(f.reason ? { reason: f.reason } : {}), severity: f.severity, foundAt: new Date(now).toISOString() };
      this.flags.set(key, flag);
      return flag;
    }
    if (!f.lineIds.some((id) => !was.lineIds.includes(id))) return undefined;
    was.lineIds = [...new Set([...was.lineIds, ...f.lineIds])].slice(-MAX_LINES_KEPT);
    was.facts = f.facts;
    delete was.looked;
    this.flags.set(key, was);
    return was;
  }

  private world(): CheckWorld {
    const quietly = <T>(read: () => T): T | undefined => {
      try {
        return read();
      } catch {
        return undefined;
      }
    };
    return {
      parcel: (id) => quietly(() => this.parcels.get(id)),
      shopPhoneHash: (did) => quietly(() => this.agents.get(did).phoneHash),
      hubName: (mdpId) => quietly(() => this.mdps.require(mdpId).name),
    };
  }
}
