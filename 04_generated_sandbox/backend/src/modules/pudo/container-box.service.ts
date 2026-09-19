import { Injectable } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GlosError } from '../../foundation/http/glos-error';
import { DispatchService } from './dispatch.service';
import {
  BoxClock,
  BoxEnding,
  BoxTimes,
  ConditionStance,
  FreeDayKind,
  FreeDaysClaim,
  InterchangeAccount,
  InterchangeSide,
  boxClock,
  normaliseContainerNo,
  parseContainerNo,
} from './container-box';

/**
 * ONE SPELL OUT OF THE TERMINAL — one arrival, one gate, one ending.
 *
 * A term rather than a flat set of dates on the box, because **the same box comes back next month under a
 * different consignment**. Dates hung on the box itself would be overwritten by the second use, and the
 * first argument about a box is always "when did we have it".
 */
export interface BoxTerm extends BoxTimes {
  termId: string;
  openedAt: string;
  /** The consignment it came in under, when there was one. A box on a domestic load has none. */
  importId?: string;
  importCode?: string;
  /** The company whose goods were inside. They see the clock, because the charge lands on them. */
  importerEntityId?: string;
  /**
   * WHO OWES THE RETURN — the agent who booked the box, and the user's own answer:
   *
   *   > "In my experience it is the agent who booked the container who is responsible for its return."
   *
   * Derived from the appointment we already recorded, never typed. A clock with no named holder is a
   * number that annoys everybody and moves nobody.
   */
  owedByEntityId?: string;
  owedByName?: string;
  /** The road leg out of the gate. Its pickup IS the out-gate — see `gateOf`. */
  roadFreightId?: string;
  /**
   * Y2 — THE LEG HOME, posted to the same board as any other load.
   *
   * Its DELIVERY is the return, in the same way the laden leg's pickup is the out-gate: the box is back
   * when the leg that took it back arrived, and nobody has to remember to type a date.
   */
  returnFreightId?: string;
  /** The depot it is going back to — a label a person types, as a port is. */
  returnDepot?: string;
  /** Who recorded the arrival, because nothing tells us and somebody has to have said it. */
  arrivedBy?: string;
  /**
   * Y3 — WHAT THE PARTIES SAY ABOUT THE BOX'S CONDITION AT EACH GATE.
   *
   * Only the accounts somebody TYPED live here. The driver's own evidence at both gates is derived from
   * the leg on every read (see `interchangeOf`), so it can never drift from the freight record, and a
   * stored copy of it could.
   */
  interchange?: { out: InterchangeAccount[]; in: InterchangeAccount[] };
}

/**
 * A container, DERIVED from its number the first time anybody names one.
 *
 * No registration form, no onboarding, nothing to keep in step — the same shape as a clearing agent, who
 * is a company that has been appointed rather than a company that applied. And deliberately **not owned by
 * a consignment**: a box that turns up on a domestic load with no import behind it is an ordinary case,
 * not an edge one, because a box is a dry lockable body and people move things in it.
 */
export interface ContainerBox {
  containerNo: string;
  /** From the number itself: the first three letters are the owner, the fourth says what the thing is. */
  ownerCode?: string;
  category?: string;
  /** The last ISO 6346 size/type code it was recorded with. The box may be re-typed; the number cannot. */
  typeCode?: string;
  /**
   * The date on the CSC safety-approval plate, carried because the user asked for it to be carried.
   *
   * Useful to a haulier who is about to be refused at a gate, and we state NOTHING about it: whether the
   * box is fit is the surveyor's verdict, not ours, exactly as CL7 refused to certify a tank.
   */
  cscPlateDate?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  terms: BoxTerm[];
}

/**
 * ONE GATE, AND EVERY ACCOUNT OF WHAT THE BOX LOOKED LIKE THERE — Y3.
 *
 * `stated: false` is the point of the shape. A gate where nothing was recorded is a gate where the
 * argument gets settled by whoever sounds more certain, so the ABSENCE is a fact worth putting on the
 * screen rather than an empty list a reader's eye slides over.
 */
export interface InterchangeView {
  side: InterchangeSide;
  /** In words: out of the terminal, or back in at the depot. */
  gate: string;
  /** When the handover happened, where the leg tells us. */
  at?: string;
  accounts: InterchangeAccount[];
  /** Every media id cited across the accounts — the photo strip, and the list this box may serve. */
  photoRefs: string[];
  /** Nobody has said anything about this gate at all. */
  stated: boolean;
  /** The accounts disagree about the condition. Nothing adjudicates it; both stand. */
  disputed: boolean;
}

export interface BoxView {
  containerNo: string;
  ownerCode?: string;
  category?: string;
  typeCode?: string;
  cscPlateDate?: string;
  firstSeenAt: string;
  /** How many spells out of a terminal this box has had with us. The argument for not owning it by one. */
  timesUsed: number;
  importCode?: string;
  owedByName?: string;
  arrivedAt?: string;
  outGatedAt?: string;
  returnedAt?: string;
  ending?: BoxEnding;
  endedBy?: string;
  endedWhere?: string;
  /** Y2 — the leg taking it home, once one is posted, and where it is up to. */
  returnLegCode?: string;
  returnLegState?: 'posted' | 'moving' | 'arrived';
  returnDepot?: string;
  /** Y2 — true where the leg home has nothing in it. Said out loud, never inferred from a small weight. */
  returnEmpty?: boolean;
  /** Y3 — both gates, always, so the one nobody recorded is visible as the one nobody recorded. */
  interchange: InterchangeView[];
  freeDays: FreeDaysClaim[];
  clock: BoxClock;
}

/**
 * THE BOX AS AN ASSET — Y0 and Y1 of `05_engineering/container_yard_and_empties.md`.
 *
 * What this service refuses to be is as important as what it is. There are no yard slots, no stacking, no
 * gate queues: that is a terminal operating system's job and we run no ports. There is no demurrage or
 * detention TARIFF, because that is the duty line again — we carry the free days the importer says they
 * were given and count down, and the charge stays between them and the line.
 *
 * AND THE BOX'S CLOCK NEVER GATES THE CARGO. Nothing in here can stop a delivery. The goods are the
 * importer's and are delivered when they are delivered; an overdue box is a separate, later obligation
 * between two other parties, and holding somebody's goods for a paperwork clock would break the parcel
 * trunk's rule at container scale.
 */
@Injectable()
export class ContainerBoxService {
  private readonly boxes = new PersistentMap<string, ContainerBox>('container-boxes');

  constructor(private readonly dispatch: DispatchService) {}

  /**
   * Refuse a number that cannot be right — the cheapest honest win in the whole epic.
   *
   * The arithmetic only. That a box exists, and whose it is, is the line's business; that the number on
   * the form checks out is ours, because everything downstream is keyed to it.
   */
  static validate(rawNo: string): string {
    const parsed = parseContainerNo(rawNo);
    if (!parsed.ok) throw new GlosError('VALIDATION_FAILED', parsed.why!);
    return parsed.containerNo;
  }

  /**
   * The box exists because somebody named it, and this is the only way one is ever created.
   *
   * Idempotent per term: naming the same box on the same consignment twice does not start a second spell,
   * and naming it on a NEW consignment does — which is the history the doc insists on keeping.
   */
  see(
    rawNo: string,
    ctx: {
      typeCode?: string;
      cscPlateDate?: string;
      importId?: string;
      importCode?: string;
      importerEntityId?: string;
      owedByEntityId?: string;
      owedByName?: string;
      roadFreightId?: string;
      returnFreightId?: string;
      returnDepot?: string;
    } = {},
    now = Date.now(),
  ): ContainerBox {
    const containerNo = ContainerBoxService.validate(rawNo);
    const parsed = parseContainerNo(containerNo);
    const at = new Date(now).toISOString();
    const box: ContainerBox =
      this.boxes.get(containerNo) ??
      {
        containerNo,
        ...(parsed.ownerCode ? { ownerCode: parsed.ownerCode } : {}),
        ...(parsed.category ? { category: parsed.category } : {}),
        firstSeenAt: at,
        lastSeenAt: at,
        terms: [],
      };

    box.lastSeenAt = at;
    if (ctx.typeCode) box.typeCode = ctx.typeCode;
    if (ctx.cscPlateDate) box.cscPlateDate = ctx.cscPlateDate;

    let term = box.terms.find((t) => !t.ending && (ctx.importId ? t.importId === ctx.importId : !t.importId));
    if (!term) {
      term = { termId: `box_${containerNo}_${box.terms.length + 1}`, openedAt: at, freeDays: [] };
      box.terms.push(term);
    }
    if (ctx.importId) term.importId = ctx.importId;
    if (ctx.importCode) term.importCode = ctx.importCode;
    if (ctx.importerEntityId) term.importerEntityId = ctx.importerEntityId;
    // The holder of the obligation follows the appointment, so a replaced agent replaces it here too.
    if (ctx.owedByEntityId) term.owedByEntityId = ctx.owedByEntityId;
    if (ctx.owedByName) term.owedByName = ctx.owedByName;
    if (ctx.roadFreightId) term.roadFreightId = ctx.roadFreightId;
    if (ctx.returnFreightId) term.returnFreightId = ctx.returnFreightId;
    if (ctx.returnDepot) term.returnDepot = ctx.returnDepot;

    this.boxes.set(containerNo, box);
    return box;
  }

  /**
   * When it landed. A RECORDED FACT, not a derived one, and the difference is the point.
   *
   * Nothing in this system watches a vessel berth, so demurrage cannot be derived the way detention can.
   * Rather than approximate it from an ETA — which is an expectation, and half of them are wrong — the
   * arrival is something a person states, with their name on it. No arrival means no demurrage clock, and
   * the clock says so in words instead of starting from a guess.
   */
  recordArrival(rawNo: string, at: string, by: string, opts: { importId?: string } = {}, now = Date.now()): BoxView {
    const box = this.require(rawNo);
    const term = this.openTerm(box, opts.importId);
    const when = Date.parse(at);
    if (!Number.isFinite(when)) throw new GlosError('VALIDATION_FAILED', 'Say when it arrived, as a date');
    if (when > now + 86_400_000) throw new GlosError('VALIDATION_FAILED', 'An arrival is something that happened — this one is in the future');
    term.arrivedAt = new Date(when).toISOString();
    term.arrivedBy = by;
    this.boxes.set(box.containerNo, box);
    return this.viewOf(box.containerNo, now)!;
  }

  /** The importer's claim about their own contract. Kept, never replaced: a correction is a second claim. */
  claimFreeDays(rawNo: string, kind: FreeDayKind, days: number, claimant: { entityId: string; by: string }, opts: { importId?: string } = {}, now = Date.now()): BoxView {
    const box = this.require(rawNo);
    const term = this.openTerm(box, opts.importId);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      throw new GlosError('VALIDATION_FAILED', 'Free days is a whole number of days from the contract with the line');
    }
    const claim: FreeDaysClaim = { kind, days, byEntityId: claimant.entityId, by: claimant.by, at: new Date(now).toISOString() };
    term.freeDays.push(claim);
    this.boxes.set(box.containerNo, box);
    return this.viewOf(box.containerNo, now)!;
  }

  /**
   * How the spell ended — and there are two endings, not one.
   *
   * `returned` is the ending the first draft of this design assumed was the only one. `bought` is the
   * user's correction and the more common case in a real market: containers are traded, so a box sold on
   * is never coming back and must never read as overdue. Both are recorded as facts, with a name and a
   * date, because the alternative is somebody silencing an alarm and the record remembering nothing.
   */
  end(rawNo: string, kind: BoxEnding, input: { at?: string; where?: string; note?: string }, by: string, opts: { importId?: string } = {}, now = Date.now()): BoxView {
    const box = this.require(rawNo);
    const term = this.openTerm(box, opts.importId);
    const at = input.at ? Date.parse(input.at) : now;
    if (!Number.isFinite(at)) throw new GlosError('VALIDATION_FAILED', 'Say when, as a date');
    if (at > now + 86_400_000) throw new GlosError('VALIDATION_FAILED', 'That date is in the future — record it when it happens');
    term.ending = {
      kind,
      at: new Date(at).toISOString(),
      by,
      ...(input.where?.trim() ? { where: input.where.trim() } : {}),
      ...(input.note?.trim() ? { note: input.note.trim().slice(0, 500) } : {}),
    };
    this.boxes.set(box.containerNo, box);
    return this.viewOf(box.containerNo, now)!;
  }

  /**
   * Y3 — ONE PARTY'S ACCOUNT OF THE BOX'S CONDITION AT A GATE, added BESIDE whatever is already there.
   *
   * Never an edit and never a deletion, which is the same shape as a road hazard's dispute and a customs
   * hold's answer, for the same reason: two parties are going to disagree about who put the hole in it,
   * and the honest structure is both accounts standing side by side with nothing adjudicating them.
   *
   * One account per person per gate: saying the same thing twice does not make somebody two witnesses,
   * so a second account from the same name replaces their own earlier one and nobody else's.
   */
  recordInterchange(
    rawNo: string,
    side: InterchangeSide,
    account: { by: string; byEntityId: string; stance: ConditionStance; note?: string; photoRefs?: string[] },
    opts: { importId?: string } = {},
    now = Date.now(),
  ): BoxView {
    const box = this.require(rawNo);
    const term = this.termFor(box, opts.importId);
    if (!term) throw new GlosError('NOT_FOUND', `No spell on ${box.containerNo} to record that against`);
    term.interchange = term.interchange ?? { out: [], in: [] };
    const mine: InterchangeAccount = {
      by: account.by,
      byEntityId: account.byEntityId,
      at: new Date(now).toISOString(),
      stance: account.stance,
      ...(account.note?.trim() ? { note: account.note.trim().slice(0, 500) } : {}),
      photoRefs: account.photoRefs ?? [],
    };
    term.interchange[side] = [...term.interchange[side].filter((a) => a.byEntityId !== account.byEntityId || a.by !== account.by), mine];
    this.boxes.set(box.containerNo, box);
    return this.viewOf(box.containerNo, now, opts)!;
  }

  /**
   * Every photograph this box's gates cite — and it is the READ GATE, not a convenience.
   *
   * A caller may fetch a photograph because it is cited by an interchange record on a box they are party
   * to. That is the same reasoning as a document grant: membership of the record is the permission, so
   * there is no separate list of who may see what to drift out of step with what is being shown.
   */
  photosOn(rawNo: string, opts: { importId?: string } = {}): string[] {
    const box = this.boxes.get(normaliseContainerNo(rawNo));
    if (!box) return [];
    const term = this.termFor(box, opts.importId);
    if (!term) return [];
    return this.interchangeOf(term).flatMap((g) => g.photoRefs);
  }

  /**
   * The box with its clock, derived on every read.
   *
   * THE OUT-GATE IS NOT A FIELD ANYBODY TYPES. It is the road leg's pickup — the event this system already
   * owns — which is what makes "the leg we mint is what starts the clock" true in code rather than in a
   * design note. A term whose leg has not been picked up has not been out-gated, however long ago the
   * paperwork was done.
   */
  viewOf(rawNo: string, now = Date.now(), opts: { importId?: string } = {}): BoxView | undefined {
    const box = this.boxes.get(normaliseContainerNo(rawNo));
    if (!box) return undefined;
    const term = this.termFor(box, opts.importId);
    /*
     * THE LEG HOME CLOSES THE CLOCK, the same way the laden leg's pickup opens it.
     *
     * Where a return leg was posted through us and has been delivered, the box is back — so the ending is
     * DERIVED from that delivery rather than waiting for somebody to remember a date. A hand-recorded
     * ending still wins, because a box can go back without its leg being ours, and the person who was
     * standing there beats a machine that was not.
     */
    const home = term ? this.returnOf(term) : undefined;
    const times: BoxTimes = term
      ? {
          ...term,
          ...(this.gateOf(term) ? { outGatedAt: this.gateOf(term) } : {}),
          ...(term.ending
            ? {}
            : home?.deliveredAt
              ? { ending: { kind: 'returned' as const, at: home.deliveredAt, by: `${home.code}, the leg that took it back`, ...(term.returnDepot ? { where: term.returnDepot } : {}) } }
              : {}),
        }
      : { freeDays: [] };
    return {
      containerNo: box.containerNo,
      ...(box.ownerCode ? { ownerCode: box.ownerCode } : {}),
      ...(box.category ? { category: box.category } : {}),
      ...(box.typeCode ? { typeCode: box.typeCode } : {}),
      ...(box.cscPlateDate ? { cscPlateDate: box.cscPlateDate } : {}),
      firstSeenAt: box.firstSeenAt,
      timesUsed: box.terms.length,
      ...(term?.importCode ? { importCode: term.importCode } : {}),
      ...(term?.owedByName ? { owedByName: term.owedByName } : {}),
      ...(times.arrivedAt ? { arrivedAt: times.arrivedAt } : {}),
      ...(times.outGatedAt ? { outGatedAt: times.outGatedAt } : {}),
      ...(times.ending?.kind === 'returned' ? { returnedAt: times.ending.at } : {}),
      ...(times.ending ? { ending: times.ending.kind, endedBy: times.ending.by } : {}),
      ...(times.ending?.where ? { endedWhere: times.ending.where } : {}),
      ...(home ? { returnLegCode: home.code, returnLegState: home.state } : {}),
      ...(home?.empty ? { returnEmpty: true } : {}),
      ...(term?.returnDepot ? { returnDepot: term.returnDepot } : {}),
      interchange: term ? this.interchangeOf(term) : [],
      freeDays: times.freeDays,
      clock: boxClock(times, now),
    };
  }

  /** Every box we have ever been told about, newest first. For an operator, and for the sweep. */
  list(now = Date.now()): BoxView[] {
    return [...this.boxes.values()]
      .map((b) => this.viewOf(b.containerNo, now)!)
      .sort((a, b) => Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt));
  }

  /** The raw record, for the sweep that needs to know who to tell. */
  raw(rawNo: string): ContainerBox | undefined {
    return this.boxes.get(normaliseContainerNo(rawNo));
  }

  all(): ContainerBox[] {
    return [...this.boxes.values()];
  }

  /* ------------------------------------------------------------------ private -- */

  /** The leg home, as it stands: posted, moving, or arrived — and whether there is anything in it. */
  private returnOf(term: BoxTerm): { code: string; state: 'posted' | 'moving' | 'arrived'; deliveredAt?: string; empty: boolean } | undefined {
    if (!term.returnFreightId) return undefined;
    try {
      const f = this.dispatch.requireFreightPublic(term.returnFreightId);
      return {
        code: f.code,
        state: f.deliveredAt ? 'arrived' : f.pickedUpAt ? 'moving' : 'posted',
        ...(f.deliveredAt ? { deliveredAt: f.deliveredAt } : {}),
        empty: Boolean(f.emptyRun),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Y3 — WHAT THE BOX LOOKED LIKE AT EACH GATE, and the driver's half of it is DERIVED.
   *
   * The evidence at both gates already exists and nobody has to be asked for anything new. At pickup the
   * freight flow demands a photograph of the secured load — which on a container leg IS a photograph of
   * the box — and it records the driver's RESERVATIONS, which is their own account of what they were
   * handed. At delivery it demands a photograph of the goods as put down, and the driver's remarks.
   *
   * So the derived account reads those two moments, and says `derived: true` so a reader knows what they
   * are looking at: a securement photo taken to prove a load was strapped down, being read as evidence of
   * a container's condition. That is a fair reading. It is not the same as somebody standing at the gate
   * and saying "there is a hole in this", which is what the typed accounts beside it are for.
   *
   * A RESERVATION IS BY DEFINITION A NOTE THAT SOMETHING WAS NOT RIGHT — a torn sack, a short count, a
   * wet pallet — so on a container leg it reads as `damaged` with the driver's own words quoted beside
   * it. Nothing else is inferred: no reservation means the driver said nothing, not that the box was
   * sound, and the account says `sound` only because a photograph with no complaint against it is the
   * ordinary meaning of a clean handover.
   */
  private interchangeOf(term: BoxTerm): InterchangeView[] {
    const typed = term.interchange ?? { out: [], in: [] };
    const derived: Record<InterchangeSide, InterchangeAccount | undefined> = { out: undefined, in: undefined };

    const leg = (freightId?: string) => {
      if (!freightId) return undefined;
      try {
        return this.dispatch.requireFreightPublic(freightId);
      } catch {
        return undefined;
      }
    };

    const laden = leg(term.roadFreightId);
    if (laden?.pickedUpAt && (laden.loadSafety?.securementPhotoRef || laden.reservations?.note)) {
      derived.out = {
        by: `the driver on ${laden.code}`,
        at: laden.pickedUpAt,
        stance: laden.reservations?.note ? 'damaged' : 'sound',
        ...(laden.reservations?.note ? { note: laden.reservations.note } : {}),
        photoRefs: laden.loadSafety?.securementPhotoRef ? [laden.loadSafety.securementPhotoRef] : [],
        derived: true,
      };
    }

    const home = leg(term.returnFreightId);
    if (home?.deliveredAt && (home.proofOfDelivery?.photoRef || home.proofOfDelivery?.remarks)) {
      derived.in = {
        by: `the driver on ${home.code}`,
        at: home.deliveredAt,
        stance: home.proofOfDelivery?.remarks ? 'damaged' : 'sound',
        ...(home.proofOfDelivery?.remarks ? { note: home.proofOfDelivery.remarks } : {}),
        photoRefs: home.proofOfDelivery?.photoRef ? [home.proofOfDelivery.photoRef] : [],
        derived: true,
      };
    }

    return (['out', 'in'] as const).map((side) => {
      const accounts = [...(derived[side] ? [derived[side]!] : []), ...typed[side]].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      const stances = new Set(accounts.map((a) => a.stance));
      return {
        side,
        gate: side === 'out' ? 'out of the terminal' : 'back in at the depot',
        ...(side === 'out' ? (laden?.pickedUpAt ? { at: laden.pickedUpAt } : {}) : home?.deliveredAt ? { at: home.deliveredAt } : {}),
        accounts,
        photoRefs: accounts.flatMap((a) => a.photoRefs),
        stated: accounts.length > 0,
        disputed: stances.size > 1,
      };
    });
  }

  /** The out-gate, DERIVED: the road leg's pickup, or nothing. A missing leg is not an out-gate. */
  private gateOf(term: BoxTerm): string | undefined {
    if (!term.roadFreightId) return undefined;
    try {
      return this.dispatch.requireFreightPublic(term.roadFreightId).pickedUpAt;
    } catch {
      return undefined;
    }
  }

  private require(rawNo: string): ContainerBox {
    const box = this.boxes.get(normaliseContainerNo(rawNo));
    if (!box) throw new GlosError('NOT_FOUND', `No container ${normaliseContainerNo(rawNo)} has been recorded`);
    return box;
  }

  /** The term to read: the open one for this consignment, else the newest. */
  private termFor(box: ContainerBox, importId?: string): BoxTerm | undefined {
    if (importId) return box.terms.find((t) => t.importId === importId) ?? undefined;
    return box.terms.find((t) => !t.ending) ?? box.terms[box.terms.length - 1];
  }

  /** The term to WRITE to. An ended spell is history and does not take new dates. */
  private openTerm(box: ContainerBox, importId?: string): BoxTerm {
    const term = importId ? box.terms.find((t) => t.importId === importId) : box.terms.find((t) => !t.ending);
    if (!term) throw new GlosError('NOT_FOUND', `No open spell on ${box.containerNo} to record that against`);
    if (term.ending) {
      throw new GlosError(
        'INVALID_STATE',
        `${box.containerNo} was already recorded as ${term.ending.kind} on ${term.ending.at.slice(0, 10)} — that spell is history. A box that comes back starts a new one.`,
      );
    }
    return term;
  }
}
