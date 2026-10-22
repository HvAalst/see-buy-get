import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { MailService } from '../../foundation/mail/mail.service';
import { PersistentMap } from '../../foundation/store/persistent-map';

/**
 * Round 40 — THE TRAIL, ANCHORED OUTSIDE OUR DATABASE (the user: "Daily to an auditor").
 *
 * Every pickup, delivery, seal, scan and damage report is fingerprinted into one chain, each link taken over the one before
 * (fabric-ledger.adapter.ts). That proves a record was not changed — unless somebody rewrote the whole chain, which whoever
 * holds the database could. So once a day the chain's head — its height and its newest id — is emailed to an auditor's
 * address, and kept here. Anything rewritten before that day gives another id at that height, and the auditor's copy no
 * longer matches: a check staff can run against any copy an auditor reads out (check()).
 *
 * The auditor's address is the one setting an insider would want to redirect quietly, so it changes only by two members of
 * staff — one asks, ANOTHER approves — and the address it had is told. The email waits in the outbox until a mail provider
 * is wired (MailService.delivers()); the record here is kept either way, saying so.
 */

/** Once a day, from this minute after midnight UTC. */
export const DAILY_AT_MINUTE = 5;
const SWEEP_MS = 15 * 60 * 1000;
const KEEP_DAYS_SHOWN = 30;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface StaffWho {
  operatorId: string;
  name: string;
}

interface Auditor {
  address: string;
  setAt: string;
  proposedBy: StaffWho;
  approvedBy: StaffWho;
}

interface AuditorProposal {
  address: string;
  at: string;
  by: StaffWho;
}

/** One day's head, as it was sent and kept. */
export interface DailyHead {
  /** The UTC day it stands for. */
  date: string;
  at: string;
  /** How many anchors the chain held, and its newest: height and id. Height 0 is an empty chain. */
  height: number;
  txId: string;
  /** Whether the chain was whole when it was read; where it broke, if not. */
  whole: boolean;
  brokenAt?: number;
  /** Who it went to; nobody when no auditor was named that day. */
  to?: string;
  /** Handed to the mail service (which keeps it in the outbox while no provider is wired). */
  mailed: boolean;
}

export interface AnchorsView {
  auditor?: { address: string; setAt: string; proposedBy: string; approvedBy: string };
  proposal?: { address: string; at: string; by: string; mine: boolean };
  /** Newest first, each with whether the chain still gives the same id at its height. */
  heads: Array<DailyHead & { stillMatches: boolean }>;
  /** When the next one goes, and whether email leaves the building yet. */
  nextAt: string;
  delivers: boolean;
}

export interface CopyCheck {
  height: number;
  match: boolean;
  /** What the chain gives at that height now, when it has one. */
  txId?: string;
  at?: string;
  /** In words, for the screen. */
  why: string;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dueAt = (date: string) => Date.parse(`${date}T00:00:00Z`) + DAILY_AT_MINUTE * 60_000;

@Injectable()
export class TrailAnchorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TrailAnchorService.name);
  private readonly auditor = new PersistentMap<string, Auditor | AuditorProposal>('trail-auditor');
  private readonly heads = new PersistentMap<string, DailyHead>('trail-heads');
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly ledger: LedgerService,
    @Optional() private readonly mail?: MailService,
  ) {}

  onApplicationBootstrap(): void {
    void this.sweep().catch((e) => this.logger.warn(`trail anchor: ${(e as Error).message}`));
    this.timer = setInterval(() => void this.sweep().catch(() => undefined), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private current(): Auditor | undefined {
    return this.auditor.get('current') as Auditor | undefined;
  }

  private waiting(): AuditorProposal | undefined {
    return this.auditor.get('proposed') as AuditorProposal | undefined;
  }

  /** One member of staff asks for the auditor's address to be this. Another approves it before it counts. */
  propose(address: string, by: StaffWho, now: number = Date.now()): AnchorsView {
    const a = address?.trim().toLowerCase() ?? '';
    if (!EMAIL.test(a) || a.length > 200) throw new GlosError('VALIDATION_FAILED', 'An email address, as the auditor gave it', { field: 'address' });
    if (this.current()?.address === a) throw new GlosError('INVALID_STATE', 'That is the address already', { field: 'address' });
    if (this.waiting()) throw new GlosError('INVALID_STATE', 'A change is already waiting for a second member of staff: approve or decline it first');
    this.auditor.set('proposed', { address: a, at: new Date(now).toISOString(), by });
    return this.view(by, now);
  }

  /**
   * ANOTHER member of staff approves or declines. Approved, it counts from now: the address it had is told, and the new one
   * is told what it will receive. Declined, it says why — the person who asked reads it.
   */
  async decide(approve: boolean, by: StaffWho, reason?: string, now: number = Date.now()): Promise<AnchorsView> {
    const p = this.waiting();
    if (!p) throw new GlosError('INVALID_STATE', 'No change of the auditor’s address is waiting');
    if (p.by.operatorId === by.operatorId) throw new GlosError('FORBIDDEN', 'A second member of staff decides: not the one who asked');
    if (!approve) {
      if (!reason?.trim()) throw new GlosError('REASON_REQUIRED', 'Say why: the person who asked reads it');
      this.auditor.delete('proposed');
      this.logger.log(`auditor address ${p.address} declined by ${by.name}: ${reason.trim()}`);
      return this.view(by, now);
    }
    const before = this.current();
    const at = new Date(now).toISOString();
    this.auditor.set('current', { address: p.address, setAt: at, proposedBy: p.by, approvedBy: by });
    this.auditor.delete('proposed');
    const said = { to: p.address, proposedBy: p.by.name, approvedBy: by.name, at, nextAt: new Date(this.nextDue(now)).toISOString() };
    if (before) await this.mail?.send('trail-auditor-changed', { address: before.address }, { ...said, from: before.address });
    await this.mail?.send('trail-auditor-named', { address: p.address }, said);
    return this.view(by, now);
  }

  /** When the next daily head goes. */
  private nextDue(now: number): number {
    const today = dueAt(dayOf(now));
    // Today's is kept: tomorrow's. Not yet: today's minute, or now when that minute has passed and the next look sends it.
    return this.heads.has(dayOf(now)) ? today + 24 * 3_600_000 : Math.max(today, now);
  }

  /**
   * THE DAILY HEAD: once per UTC day, from a few minutes after midnight — the chain read as it stands, kept, and mailed to the
   * auditor. A day already kept is not sent again; a server down at midnight sends when it is back.
   */
  async sweep(now: number = Date.now()): Promise<DailyHead | undefined> {
    const date = dayOf(now);
    if (this.heads.has(date) || now < dueAt(date)) return undefined;
    const head = this.ledger.head();
    const check = this.ledger.check();
    const auditor = this.current();
    const record: DailyHead = {
      date,
      at: new Date(now).toISOString(),
      height: head?.height ?? 0,
      txId: head?.txId ?? '',
      whole: check?.whole ?? true,
      ...(check?.brokenAt ? { brokenAt: check.brokenAt } : {}),
      ...(auditor ? { to: auditor.address } : {}),
      mailed: false,
    };
    // Kept before it is mailed: a day is never sent twice because the mail service took its time.
    this.heads.set(date, record);
    if (auditor && this.mail) {
      record.mailed = await this.mail.send('trail-head', { address: auditor.address }, { date, height: record.height, txId: record.txId, whole: record.whole, ...(record.brokenAt ? { brokenAt: record.brokenAt } : {}) }, now);
      this.heads.set(date, record);
    }
    return record;
  }

  /**
   * AN AUDITOR'S COPY, CHECKED: the height and id an email said, against the id the chain gives at that height now — worked
   * out again from every fingerprint up to it, never read from the ids kept beside them.
   */
  check(height: number, txId: string): CopyCheck {
    const h = Math.trunc(Number(height));
    const said = txId?.trim().toLowerCase() ?? '';
    if (!Number.isInteger(h) || h < 1) throw new GlosError('VALIDATION_FAILED', 'The height, as a whole number from the email', { field: 'height' });
    if (!/^[0-9a-f]{64}$/.test(said)) throw new GlosError('VALIDATION_FAILED', 'The fingerprint, as the 64 letters and digits in the email', { field: 'txId' });
    const now = this.ledger.recomputedAt(h);
    if (!now) return { height: h, match: false, why: 'The chain has no link at that height now: it is shorter than it was, or a part of it is missing.' };
    const match = now.txId === said;
    return {
      height: h,
      match,
      txId: now.txId,
      at: now.at,
      why: match ? 'The chain still gives this fingerprint at this height: nothing up to it has been changed since.' : 'The chain gives another fingerprint at this height now: something up to it has been changed since the copy was made.',
    };
  }

  /** For staff: who receives it, what waits, and the days kept — newest first, each checked against the chain as it is now. */
  view(reader?: StaffWho, now: number = Date.now()): AnchorsView {
    const a = this.current();
    const p = this.waiting();
    const heads = [...this.heads.values()]
      .sort((x, y) => y.date.localeCompare(x.date))
      .slice(0, KEEP_DAYS_SHOWN)
      .map((d) => ({ ...d, stillMatches: d.height === 0 ? true : this.ledger.recomputedAt(d.height)?.txId === d.txId }));
    return {
      ...(a ? { auditor: { address: a.address, setAt: a.setAt, proposedBy: a.proposedBy.name, approvedBy: a.approvedBy.name } } : {}),
      ...(p ? { proposal: { address: p.address, at: p.at, by: p.by.name, mine: Boolean(reader && reader.operatorId === p.by.operatorId) } } : {}),
      heads,
      nextAt: new Date(this.nextDue(now)).toISOString(),
      delivers: Boolean(this.mail?.delivers()),
    };
  }
}
