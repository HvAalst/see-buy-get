import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { sameSigner, type Signer } from '../../foundation/entity/same-person';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { CASE_SEVERITIES, CASE_SEVERITY, CaseAct, CaseList, ESCALATE_AFTER_H, FlagCase, FlagCaseKindCount, FlagCaseList, FlagCaseView, FlagKind, MAX_RECHECK_H } from './flag-case.types';
import { MonitorService, PudoFlag } from './monitor.service';

/** How often the cases are checked against the flags, without anybody having to open the console. */
const SWEEP_MS = 5 * 60_000;
const HOUR = 3_600_000;
/** The most cases one read returns; the counts are always of all of them. */
const LIST_LIMIT = 200;
/** A case that closed by itself, with nothing a person did on it, is kept this long after it closed, then dropped. */
const CLEARED_KEPT_MS = 30 * 24 * HOUR;

/**
 * THE FLAGS, AS CASES (flag-case.types.ts). The monitor still says what is wrong right now; this keeps, for each thing
 * it says, a case that somebody owns, and a history of what happened to it.
 *
 * Swept every five minutes and on every read, so a case is escalated whether or not anybody is looking — that is the
 * point of escalating.
 */
@Injectable()
export class FlagCaseService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly cases = new PersistentMap<string, FlagCase>('flag-cases');
  private sweeper?: NodeJS.Timeout;

  constructor(private readonly monitor: MonitorService) {}

  onApplicationBootstrap(): void {
    this.sweeper = setInterval(() => {
      try {
        this.sync();
      } catch {
        /* a sweep that fails is tried again in five minutes */
      }
    }, SWEEP_MS);
    this.sweeper.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  /**
   * Bring the cases up to date with what the monitor says now: open one for a new flag, keep a live one's words current,
   * close one whose flag is gone, escalate one nobody has taken in time, and open a following case for a flag that was
   * put to rest and is still there after its time.
   */
  sync(now: number = Date.now(), flags: PudoFlag[] = this.monitor.flags()): void {
    const at = new Date(now).toISOString();
    // One pass to know, for every flag, its live case and its latest one — a network has thousands of flags.
    const live = new Map<string, FlagCase>();
    const latest = new Map<string, FlagCase>();
    const gone: string[] = [];
    for (const c of this.cases.values()) {
      if (c.state === 'open' || c.state === 'taken') live.set(c.key, c);
      const before = latest.get(c.key);
      if (!before || c.openedAt > before.openedAt) latest.set(c.key, c);
      // Closed by itself and never touched by a person: nothing to keep once the month is out.
      if (c.state === 'cleared' && c.closedAt && now - Date.parse(c.closedAt) > CLEARED_KEPT_MS && !c.history.some((e) => e.by)) gone.push(c.caseId);
    }
    // Written together at the end: one file write, or one transaction, however many cases changed.
    const changed = new Map<string, FlagCase>();
    const seen = new Set<string>();
    for (const f of flags) {
      const kind = f.type as FlagKind;
      const key = `${kind}:${f.subject}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const open = live.get(key);
      if (open) {
        // What the flag says now — "on the bus 30 h" becomes "31 h" — written only when it says something new.
        if (open.detail !== f.detail || (f.ageHours !== undefined && open.ageHours !== f.ageHours)) {
          open.detail = f.detail;
          if (f.ageHours !== undefined) open.ageHours = f.ageHours;
          changed.set(open.caseId, open);
        }
        continue;
      }
      // Put to rest with a reason: nothing new until its time is up.
      const rested = latest.get(key);
      if (rested?.state === 'done' && rested.quietUntil && Date.parse(rested.quietUntil) > now) continue;
      const c: FlagCase = {
        caseId: `case_${randomBytes(6).toString('hex')}`,
        key,
        kind,
        subject: f.subject,
        detail: f.detail,
        severity: CASE_SEVERITY[kind] ?? 'medium',
        state: 'open',
        openedAt: at,
        ...(f.ageHours !== undefined ? { ageHours: f.ageHours } : {}),
        ...(rested?.state === 'done' ? { follows: rested.caseId } : {}),
        history: [{ at, act: rested?.state === 'done' ? 'opened_again' : 'opened', text: f.detail }],
      };
      changed.set(c.caseId, c);
    }
    for (const c of live.values()) {
      if (!seen.has(c.key)) {
        // The condition went away: the parcel moved, the shop came back, the corridor reopened. Said, and closed.
        this.event(c, at, 'cleared', undefined, 'The flag is gone: what it was about is no longer the case');
        c.state = 'cleared';
        c.closedAt = at;
        delete c.owner;
        changed.set(c.caseId, c);
        continue;
      }
      // Nobody has it, and it has waited longer than its severity allows: escalated, once.
      if (c.state === 'open' && !c.escalatedAt && now - Date.parse(c.openedAt) >= ESCALATE_AFTER_H[c.severity] * HOUR) {
        c.escalatedAt = at;
        this.event(c, at, 'escalated', undefined, `Nobody took it within ${ESCALATE_AFTER_H[c.severity]} h`);
        changed.set(c.caseId, c);
      }
    }
    this.cases.setMany(changed.entries());
    for (const id of gone) this.cases.delete(id);
  }

  /**
   * The cases, brought up to date first: the live ones (open and taken), the taken ones, or the closed ones — at most
   * LIST_LIMIT of them, of one kind when asked. The counts are of all of them, never of the page: how many there are,
   * how many nobody has taken, and how many of each kind.
   *
   * The live list puts what nobody has first, so with thousands open a case somebody takes leaves its first page; the
   * taken list is where it is found again, with whose it is.
   */
  board(which: CaseList = 'live', kind?: string, now: number = Date.now()): FlagCaseList {
    this.sync(now);
    const rank = (c: FlagCase) => CASE_SEVERITIES.indexOf(c.severity);
    const all = [...this.cases.values()].filter((c) =>
      which === 'live' ? c.state === 'open' || c.state === 'taken' : which === 'taken' ? c.state === 'taken' : c.state === 'done' || c.state === 'cleared',
    );
    const kinds = new Map<FlagKind, FlagCaseKindCount>();
    for (const c of all) {
      const k = kinds.get(c.kind) ?? { kind: c.kind, severity: c.severity, count: 0, waiting: 0, escalated: 0 };
      k.count += 1;
      if (c.state === 'open') {
        k.waiting += 1;
        if (c.escalatedAt) k.escalated += 1;
      }
      kinds.set(c.kind, k);
    }
    // What the menu's badge counts, whichever list is read: the live cases nobody has taken.
    let waiting = 0;
    for (const c of this.cases.values()) if (c.state === 'open') waiting += 1;
    const shown = kind ? all.filter((c) => c.kind === kind) : all;
    // Escalated and still nobody's first, then nobody's before somebody's, then the most severe, then the oldest.
    const unowned = (c: FlagCase) => c.state === 'open';
    const items = shown
      .sort((a, b) =>
        which === 'closed'
          ? (b.closedAt ?? '').localeCompare(a.closedAt ?? '')
          : which === 'taken'
            ? (a.owner?.name ?? '').localeCompare(b.owner?.name ?? '') || rank(a) - rank(b) || a.openedAt.localeCompare(b.openedAt)
            : Number(unowned(b) && Boolean(b.escalatedAt)) - Number(unowned(a) && Boolean(a.escalatedAt)) ||
              Number(unowned(b)) - Number(unowned(a)) ||
              rank(a) - rank(b) ||
              a.openedAt.localeCompare(b.openedAt),
      )
      .slice(0, LIST_LIMIT)
      .map((c) => ({ ...c, openHours: Math.max(0, Math.round((now - Date.parse(c.openedAt)) / HOUR)) }));
    return {
      items,
      total: shown.length,
      waiting,
      kinds: [...kinds.values()].sort((a, b) => CASE_SEVERITIES.indexOf(a.severity) - CASE_SEVERITIES.indexOf(b.severity) || b.count - a.count),
    };
  }

  /** The live cases, the most pressing first. */
  list(which: CaseList = 'live', now: number = Date.now()): FlagCaseView[] {
    return this.board(which, undefined, now).items;
  }

  /** How many live cases nobody has taken — what the console's badge counts. */
  waiting(now: number = Date.now()): number {
    return this.board('live', undefined, now).waiting;
  }

  /** Take a case: it is now this person's, and everybody can see whose. */
  take(caseId: string, staff: Signer, now: number = Date.now()): FlagCase {
    const c = this.requireLive(caseId);
    if (c.state === 'taken' && c.owner && !sameSigner(c.owner, staff)) throw new GlosError('CONFLICT', `${c.owner.name} has this case. Ask them, or wait until they let it go.`);
    c.state = 'taken';
    c.owner = { name: staff.name, ...(staff.key ? { key: staff.key } : {}) };
    this.event(c, new Date(now).toISOString(), 'taken', staff.name);
    return this.save(c);
  }

  /** Let it go: back to nobody's, with what was done so far in the history. */
  letGo(caseId: string, staff: Signer, now: number = Date.now()): FlagCase {
    const c = this.requireLive(caseId);
    if (c.state !== 'taken') throw new GlosError('INVALID_STATE', 'Nobody has this case');
    c.state = 'open';
    delete c.owner;
    this.event(c, new Date(now).toISOString(), 'let_go', staff.name);
    return this.save(c);
  }

  /** A note on what was done or found. Anybody on staff may add one; nothing is ever changed or removed. */
  note(caseId: string, staff: Signer, text: string, now: number = Date.now()): FlagCase {
    const c = this.requireLive(caseId);
    const words = String(text ?? '').trim().slice(0, 500);
    if (!words) throw new GlosError('FIELD_REQUIRED', 'Write what was done or found', { field: 'text' });
    this.event(c, new Date(now).toISOString(), 'note', staff.name, words);
    return this.save(c);
  }

  /**
   * Done for now, with a reason: what was done, and when to look again. While its time runs no new case opens for the
   * same flag; if the flag is still there afterwards, a following case opens and says it follows this one.
   */
  done(caseId: string, staff: Signer, reason: string, recheckHours = 24, now: number = Date.now()): FlagCase {
    const c = this.requireLive(caseId);
    const words = String(reason ?? '').trim().slice(0, 500);
    if (words.length < 3) throw new GlosError('FIELD_REQUIRED', 'Say what was done: a case is closed with a reason', { field: 'reason' });
    const hours = Number(recheckHours);
    if (!Number.isFinite(hours) || hours < 1 || hours > MAX_RECHECK_H) throw new GlosError('VALIDATION_FAILED', `Look again within 1 to ${MAX_RECHECK_H} hours`, { field: 'recheckHours' });
    const at = new Date(now).toISOString();
    c.state = 'done';
    c.closedAt = at;
    c.quietUntil = new Date(now + hours * HOUR).toISOString();
    delete c.owner;
    this.event(c, at, 'done', staff.name, words);
    return this.save(c);
  }

  /**
   * Closed by the act it was opened for, done elsewhere — a parcel declared lost from its search case. Under the same
   * name and words, so the case says how it ended; nothing when no live case is open for it.
   */
  closeFor(kind: FlagKind, subject: string, staff: Signer, reason: string, now: number = Date.now()): FlagCase | undefined {
    const live = [...this.cases.values()].find((c) => c.key === `${kind}:${subject}` && (c.state === 'open' || c.state === 'taken'));
    return live ? this.done(live.caseId, staff, reason, MAX_RECHECK_H, now) : undefined;
  }

  get(caseId: string): FlagCase {
    const c = this.cases.get(caseId);
    if (!c) throw new GlosError('NOT_FOUND', 'No such case');
    return c;
  }

  private requireLive(caseId: string): FlagCase {
    const c = this.get(caseId);
    if (c.state !== 'open' && c.state !== 'taken') throw new GlosError('INVALID_STATE', 'This case is closed');
    return c;
  }


  private event(c: FlagCase, at: string, act: CaseAct, by?: string, text?: string): void {
    c.history.push({ at, act, ...(by ? { by } : {}), ...(text ? { text } : {}) });
  }

  private save(c: FlagCase): FlagCase {
    this.cases.set(c.caseId, c);
    return c;
  }
}
