import { Injectable } from '@nestjs/common';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { GlosError } from '../../foundation/http/glos-error';
import { EntityService } from '../../foundation/entity/entity.service';
import { ContainerBoxService } from './container-box.service';
import { CONTACT_BASIS, ContactCard, ContactCardService } from './contact-card.service';
import { normaliseContainerNo, parseContainerNo } from './container-box';
import type { GeoPoint } from './pudo.types';

/**
 * A YARD THAT WANTS TO BE FINDABLE — Y4, and the user's own shape for it:
 *
 *   > "We don't hold empties, but what's up if we keep a register of where they hang around, if a yard
 *   > wants a network where they can actually be registered."
 *
 * We hold no empties and take no custody. What a yard cannot build for itself is being findable, and what
 * a gate man with a notebook cannot know is what is arriving today. Both of those are ours. Everything
 * else about a yard is not.
 *
 * ---------------------------------------------------------------------------------------------------
 * WHY THERE IS NO LAYOUT IN HERE, and it is not because yard planning is unimportant.
 *
 * The user put it exactly right: yard management is mainly smart planning. That planning answers one
 * question forty times a day — where do I put this box so I do not have to move it twice — and answering
 * it needs the yard's GEOMETRY (blocks, rows, tiers, what ground takes a four-high stack), the RULES that
 * bind a slot to a box (a reefer needs a powered row; dangerous goods need segregation distances that
 * differ by class and by jurisdiction; tier weights and ground bearing decide what may sit on what), and
 * the DEPARTURE ORDER.
 *
 * The first two are a model of somebody else's physical site. We have never seen it, we do not know what
 * machine is on it this week, and a segregation distance we got wrong is the kind of advice that hurts
 * somebody. That is the line CL7 drew refusing to certify a tank fit for food, in the same place.
 *
 * The third we already hold, because Y2 put the leg home on the board. So this service records the
 * position the yard WRITES — "C-12, third row", their handwriting — and never assigns one, and it tells
 * them what is on its way. The planning input, never the plan.
 * ---------------------------------------------------------------------------------------------------
 */

export interface EmptyDepot {
  /** A depot is a COMPANY that says it holds empties — not a fifth participant type. */
  entityId: string;
  /** What the yard calls itself. Their words: we run no yards and have nothing to check it against. */
  placeLabel: string;
  country: string;
  location?: GeoPoint;
  note?: string;
  saidAt: string;
  saidBy: string;
  /** Kept rather than deleted: a yard that stopped holding empties still held them last month. */
  closedAt?: string;
  closedBy?: string;
}

/**
 * ONE BOX THE YARD SAYS IS STANDING THERE — a claim, attributed and dated.
 *
 * `position` is the yard's OWN WORDS for where it is, kept so a haulier can be told where to drive and a
 * gate man can find it. It is a label and not a coordinate in a model we pretend to hold: recording a
 * position and assigning one are different jobs, and only the first is honestly ours.
 */
export interface DepotBoxSaid {
  containerNo: string;
  position?: string;
  note?: string;
  at: string;
  by: string;
}

export interface DepotRegister {
  entityId: string;
  placeLabel: string;
  country: string;
  note?: string;
  closed: boolean;
  /** What the yard says is standing there. Their claim. */
  said: DepotBoxSaid[];
  /** Boxes whose leg home ended here — ours, and incomplete by construction. */
  derived: Array<{ containerNo: string; legCode: string; at?: string; empty: boolean }>;
  /** What is on its way here and has not arrived. The one thing a notebook cannot know. */
  inbound: Array<{ containerNo: string; legCode: string; state: string; empty: boolean }>;
  /** In BOTH lists — a fact, not a merge. The two sources are never added into one number. */
  inBoth: number;
  /** How to reach them, written by them. The finder's whole purpose, and it first shipped without it. */
  contact?: ContactCard & { basis: string };
  /** One sentence saying where each number came from. Screens print it verbatim. */
  basis: string;
}

export const DEPOT_BASIS =
  'Two sources, kept apart: what the yard SAYS is standing there, and what we DERIVED from legs that ended here. ' +
  'The first can be stale and the second is incomplete, so they are never added together. Where a box is standing inside the yard is the yard’s own note, never ours.';

@Injectable()
export class EmptyDepotService {
  private readonly depots = new PersistentMap<string, EmptyDepot>('empty-depots');
  /** What each yard says is standing there, keyed by company. One entry per box. */
  private readonly said = new PersistentMap<string, DepotBoxSaid[]>('empty-depot-said');

  constructor(
    private readonly entities: EntityService,
    private readonly boxes: ContainerBoxService,
    // The yard's own entry — how to reach them, written by them. One card per company, never a second copy.
    private readonly contacts: ContactCardService,
  ) {}

  /**
   * A yard opts in. A CLAIM, exactly as a clearing agent's advertisement is a claim: attributed, dated,
   * and never checked, because there is nothing to check it against — we run no yards.
   */
  declare(entityId: string, input: { placeLabel: string; country: string; location?: GeoPoint; note?: string }, by: string, now = Date.now()): EmptyDepot {
    const company = this.entities.get(entityId);
    const placeLabel = input.placeLabel?.trim();
    if (!placeLabel) throw new GlosError('FIELD_REQUIRED', 'Say what the yard is called — an entry nobody can recognise helps nobody find you');
    const country = input.country?.trim().toUpperCase();
    if (!country || country.length !== 2) throw new GlosError('VALIDATION_FAILED', 'Give the country as a two-letter code');
    const depot: EmptyDepot = {
      entityId: company.entityId,
      placeLabel: placeLabel.slice(0, 120),
      country,
      ...(input.location ? { location: input.location } : {}),
      ...(input.note?.trim() ? { note: input.note.trim().slice(0, 600) } : {}),
      saidAt: new Date(now).toISOString(),
      saidBy: by,
      // Re-declaring RE-OPENS: the new record carries no closedAt, and a yard that comes back is the same
      // yard under the same company — its boxes and its history are where it left them.
    };
    this.depots.set(company.entityId, depot);
    return depot;
  }

  /** It stopped holding empties. Kept and marked, never deleted — it held them last month. */
  close(entityId: string, by: string, now = Date.now()): EmptyDepot {
    const depot = this.require(entityId);
    depot.closedAt = new Date(now).toISOString();
    depot.closedBy = by;
    this.depots.set(entityId, depot);
    return depot;
  }

  /**
   * THE FINDER — alphabetical, and never ranked.
   *
   * The same refusal as the clearing-agent directory: an ordering is a judgement, and a yard that knows
   * how to climb a list will climb it. What a caller gets is the yards and what each SAYS it holds, so
   * the next step is a telephone call rather than our opinion.
   *
   * The counts travel, the numbers do not: which boxes are standing in a yard is a map of somebody
   * else's assets, and publishing it to every participant serves nobody who is deciding where to drive.
   */
  list(q: { country?: string; text?: string } = {}, now = Date.now()): Array<EmptyDepot & { saidCount: number; derivedCount: number; inboundCount: number; contact?: ContactCard & { basis: string }; basis: string }> {
    const country = q.country?.trim().toUpperCase();
    const text = q.text?.trim().toLowerCase();
    return [...this.depots.values()]
      .filter((d) => !d.closedAt)
      .filter((d) => (country ? d.country === country : true))
      .filter((d) => (text ? `${d.placeLabel} ${d.note ?? ''}`.toLowerCase().includes(text) : true))
      .map((d) => {
        const register = this.registerOf(d.entityId, now);
        const card = this.contacts.of(d.entityId);
        return {
          ...d,
          saidCount: register.said.length,
          derivedCount: register.derived.length,
          inboundCount: register.inbound.length,
          // A finder that says "ring them" and prints no number is the defect this closes.
          ...(card ? { contact: { ...card, basis: CONTACT_BASIS } } : {}),
          basis: DEPOT_BASIS,
        };
      })
      .sort((a, b) => a.placeLabel.localeCompare(b.placeLabel));
  }

  /** The yard says a box is standing there — one entry per box, so saying it twice is a correction. */
  say(entityId: string, rawNo: string, input: { position?: string; note?: string }, by: string, now = Date.now()): DepotRegister {
    this.require(entityId);
    const parsed = parseContainerNo(rawNo);
    if (!parsed.ok) throw new GlosError('VALIDATION_FAILED', parsed.why!);
    const rows = [...(this.said.get(entityId) ?? [])].filter((r) => r.containerNo !== parsed.containerNo);
    rows.push({
      containerNo: parsed.containerNo,
      // THEIR words. A position we generated would be a slot we assigned, which is the thing we do not do.
      ...(input.position?.trim() ? { position: input.position.trim().slice(0, 60) } : {}),
      ...(input.note?.trim() ? { note: input.note.trim().slice(0, 300) } : {}),
      at: new Date(now).toISOString(),
      by,
    });
    this.said.set(entityId, rows);
    return this.registerOf(entityId, now);
  }

  /** It left. Removed from what the yard SAYS — never from what we derived, which is a movement record. */
  gone(entityId: string, rawNo: string, now = Date.now()): DepotRegister {
    this.require(entityId);
    const containerNo = normaliseContainerNo(rawNo);
    this.said.set(
      entityId,
      [...(this.said.get(entityId) ?? [])].filter((r) => r.containerNo !== containerNo),
    );
    return this.registerOf(entityId, now);
  }

  /**
   * THE REGISTER, with its two sources kept apart and a third thing a notebook cannot hold.
   *
   * `said` is the yard's claim. `derived` is ours and incomplete by construction — it only knows the legs
   * that came through us. `inbound` is the planning input: what is on its way here, whether a driver has
   * it yet, and whether there is anything in it.
   */
  registerOf(entityId: string, now = Date.now()): DepotRegister {
    const depot = this.require(entityId);
    const said = [...(this.said.get(entityId) ?? [])].sort((a, b) => (a.containerNo < b.containerNo ? -1 : 1));
    const legs = this.boxes.atDepot(entityId);
    const derived = legs.filter((l) => l.state === 'arrived').map(({ containerNo, legCode, at, empty }) => ({ containerNo, legCode, ...(at ? { at } : {}), empty }));
    const inbound = legs.filter((l) => l.state !== 'arrived').map(({ containerNo, legCode, state, empty }) => ({ containerNo, legCode, state, empty }));
    const saidNos = new Set(said.map((r) => r.containerNo));
    return {
      entityId: depot.entityId,
      placeLabel: depot.placeLabel,
      country: depot.country,
      ...(depot.note ? { note: depot.note } : {}),
      closed: Boolean(depot.closedAt),
      said,
      derived,
      inbound,
      inBoth: derived.filter((d) => saidNos.has(d.containerNo)).length,
      ...(this.contacts.of(entityId) ? { contact: { ...this.contacts.of(entityId)!, basis: CONTACT_BASIS } } : {}),
      basis: DEPOT_BASIS,
    };
  }

  of(entityId: string): EmptyDepot | undefined {
    return this.depots.get(entityId);
  }

  private require(entityId: string): EmptyDepot {
    const depot = this.depots.get(entityId);
    if (!depot) throw new GlosError('NOT_FOUND', 'That company has not said it holds empties');
    return depot;
  }
}
