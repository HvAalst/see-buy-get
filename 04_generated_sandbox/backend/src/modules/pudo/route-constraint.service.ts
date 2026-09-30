import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { haversineKm } from './geo';
import { GeoPoint } from './pudo.types';
import { BoardBlocker } from './dispatch.types';
import { CONSTRAINT_EFFECT, ConstraintAccount, ConstraintKind, ConstraintStance, ConstraintView, RouteConstraint } from './route-constraint.types';
import { MediaService } from './media.service';

/** How near a point has to be to count as "on this road" — the corridor is a straight line, so this is
 *  generous on purpose. A warning about a bridge 4 km off your line is a nuisance; missing one is not. */
export const ON_ROUTE_KM = 5;

/** How near two reports must be to be the same obstacle. Two drivers stop in different laybys. */
export const SAME_SPOT_KM = 0.3;

/**
 * There is deliberately NO "surveyed" threshold here, and there must never be one.
 *
 * The tempting version of this file had one: below N reports a corridor answered NOT CHECKED, at or above
 * it the map answered for itself. That is backwards. Reports are evidence of the obstacles somebody met;
 * they are never evidence of the absence of the ones nobody met, so no number of them can promote a road
 * to "checked". One weighbridge reported on a 400 km corridor would have silenced the caveat for every
 * bridge on it. The caveat is permanent and lives on the board (`ROUTE_NOT_SURVEYED`); this service only
 * ever reports what it actually knows.
 */

/**
 * The road, as the people who drive it report it.
 *
 * The data does not exist. Nobody sells Kenyan bridge clearances, and there is no register of which
 * corridors refuse hazmat after dark. So the fleet that needs the map builds the map — one tap from the
 * cab, the way a speed-camera app works — and it becomes worth more than the routing it enables.
 *
 * THE SAFETY ASYMMETRY GOVERNS EVERYTHING HERE. A report that ADDS a constraint may be trusted cheaply:
 * one driver saying "low bridge" is enough to start warning everybody, because being wrong costs a
 * detour. A report that REMOVES one must be trusted expensively: being wrong about a bridge that is
 * still there kills somebody. So refuting never clears — it disputes, which raises it to an operator and
 * keeps warning meanwhile — and nothing expires on a timer, because time passing is not evidence.
 *
 * AND ABSENCE IS NOT CLEARANCE. A road nobody has reported is UNKNOWN, never fine. Any answer this
 * service cannot actually compute comes back as NOT CHECKED rather than as a quiet pass — a board that
 * says nothing about an unchecked bridge is a board implying there is not one, which is worse than
 * saying nothing at all.
 */
@Injectable()
export class RouteConstraintService {
  private readonly constraints = new PersistentMap<string, RouteConstraint>('pudo-route-constraints');

  constructor(private readonly media: MediaService) {}

  /**
   * One tap from the cab.
   *
   * Reports at the SAME SPOT for the same kind fold into one constraint and count as a confirmation —
   * three drivers reporting the same bridge should make the network more sure of one bridge, not draw
   * three bridges on the map.
   */
  report(input: { kind: ConstraintKind; at: GeoPoint; value?: number; note?: string; photoRef?: string; by: string }): ConstraintView {
    const effect = CONSTRAINT_EFFECT[input.kind];
    if (!effect) throw new GlosError('VALIDATION_FAILED', `Unknown constraint kind: ${input.kind}`);
    if (!Number.isFinite(input.at?.lat) || !Number.isFinite(input.at?.lng)) {
      throw new GlosError('VALIDATION_FAILED', 'A constraint needs a point on the map');
    }
    // A height or a limit is the whole content of the report — "low bridge, unknown height" cannot be
    // checked against any load, so it would warn everybody equally and mean nothing to anyone.
    if (effect.measure !== 'none' && !(typeof input.value === 'number' && input.value > 0)) {
      throw new GlosError('VALIDATION_FAILED', effect.measure === 'height_m' ? 'How high is it? A bridge with no height cannot be checked against a load' : 'What is the limit? A weight sign with no number cannot be checked against a load');
    }

    const existing = this.sameSpot(input.kind, input.at);
    if (existing) {
      // A second sighting of a known obstacle. It confirms rather than duplicates — and a report from
      // somebody who has already spoken about this one does not count twice.
      if (existing.reportedBy !== input.by && !existing.confirmedBy.includes(input.by)) existing.confirmedBy.push(input.by);
      // Somebody who previously said it was gone and now reports it is there has changed their mind, and
      // the record should stop citing them on both sides of the same question.
      existing.refutedBy = existing.refutedBy.filter((d) => d !== input.by);
      if (existing.status === 'disputed' && existing.confirmedBy.length > existing.refutedBy.length) {
        existing.status = 'active';
        delete existing.disputedAt; // no longer waiting on an operator, so it leaves their queue and its clock
      }
      // A second sighting is an ACCOUNT in its own right: its own words, its own photograph, its own date.
      // This is the whole reason the report of a known hazard is worth more than a bumped counter.
      this.account(existing, input.by, 'there', input.note, input.photoRef);
      this.constraints.set(existing.constraintId, existing);
      return constraintView(existing);
    }

    const constraint: RouteConstraint = {
      constraintId: `rc_${randomBytes(8).toString('hex')}`,
      kind: input.kind,
      at: { lat: input.at.lat, lng: input.at.lng },
      ...(effect.measure !== 'none' ? { value: input.value } : {}),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      reportedBy: input.by,
      reportedAt: new Date().toISOString(),
      confirmedBy: [],
      refutedBy: [],
      accounts: [],
      // ACTIVE from one report. This is the cheap half of the asymmetry, and it is deliberate.
      status: 'active',
    };
    this.account(constraint, input.by, 'there', input.note, input.photoRef);
    this.constraints.set(constraint.constraintId, constraint);
    return constraintView(constraint);
  }

  /**
   * Record what one person said about this hazard.
   *
   * One account per person per stance: somebody who says the same thing twice has not become two
   * witnesses. Changing their mind REPLACES what they said rather than adding to it, for the same reason
   * the DID lists drop them from the other side — the record must never cite one driver on both sides of
   * the same question.
   */
  private account(c: RouteConstraint, by: string, stance: ConstraintStance, note?: string, photoRef?: string): void {
    if (!c.accounts) c.accounts = [];
    const said = note?.trim();
    // ADOPTED BEFORE IT IS CITED, and both halves of that matter.
    //
    // Adopted, not linked: `link()` is ownership-blind, which is correct for refs this module makes
    // itself and wrong for one a client hands us. A posted hazard photo is now readable by every peer
    // (MediaService.peerViewable), so a blind link would let anybody name ANOTHER actor's media — a KYC
    // id, a delivery photo — as their hazard photo and read it straight back through the widened gate.
    //
    // And cited only if adopted: an account that names a photograph the store will not serve is a
    // footnote pointing at nothing, which is exactly the "2 photos, none shown" defect written into the
    // record instead of onto a screen. Adoption is also what stops the retention sweep reclaiming a real
    // photo as an abandoned upload. No expiry is set here — that waits for an operator to clear it.
    const kept = photoRef ? this.media.adopt(photoRef, by, { type: 'constraint', id: c.constraintId }, 'hazard') : false;
    const entry: ConstraintAccount = { by, at: new Date().toISOString(), stance, ...(said ? { note: said } : {}), ...(kept ? { photoRef } : {}) };
    const mine = c.accounts.findIndex((a) => a.by === by);
    if (mine >= 0) c.accounts[mine] = entry;
    else c.accounts.push(entry);
  }

  /** A later passer-by agrees. One vote each; the original reporter's is already counted. */
  confirm(constraintId: string, by: string, note?: string, photoRef?: string): ConstraintView {
    const c = this.require(constraintId);
    if (c.reportedBy !== by && !c.confirmedBy.includes(by)) c.confirmedBy.push(by);
    c.refutedBy = c.refutedBy.filter((d) => d !== by);
    if (c.status === 'disputed' && c.confirmedBy.length > c.refutedBy.length) {
      c.status = 'active';
      delete c.disputedAt;
    }
    // Agreement is an account too, and a photograph from somebody who saw it standing this morning is
    // what settles a dispute in the safe direction.
    this.account(c, by, 'there', note, photoRef);
    this.constraints.set(c.constraintId, c);
    return constraintView(c);
  }

  /**
   * A driver says it is not there — and it KEEPS WARNING.
   *
   * The expensive half of the asymmetry, and the single most important behaviour in this file. A refuted
   * constraint is 'disputed', which is not 'cleared': it still appears, it still blocks, and it is now in
   * front of an operator. Letting the crowd delete a hazard would mean one mistaken tap, or one driver
   * who wanted a shorter route, could remove a low bridge from everybody's map.
   */
  refute(constraintId: string, by: string, note?: string, photoRef?: string): ConstraintView {
    const c = this.require(constraintId);
    if (c.status === 'cleared') return constraintView(c);
    if (!c.refutedBy.includes(by)) c.refutedBy.push(by);
    c.confirmedBy = c.confirmedBy.filter((d) => d !== by);
    // The FIRST dispute starts the clock and later ones do not restart it: a hazard nobody has looked at
    // for a fortnight must not be pushed back down the queue by a second driver reporting the same thing.
    if (c.status !== 'disputed') c.disputedAt = new Date().toISOString();
    c.status = 'disputed';
    // THE REFUTER'S WORDS ARE THEIR OWN. This used to be `c.note = c.note + ' · ' + note`, which handed
    // the operator's queue a single sentence built out of both sides of the argument it existed to settle.
    // A photograph of a clear road is the strongest thing anybody can offer here, and it had nowhere to go.
    this.account(c, by, 'gone', note, photoRef);
    this.constraints.set(c.constraintId, c);
    return constraintView(c);
  }

  /**
   * An operator clears it — the ONLY way a constraint stops warning.
   *
   * With a reason, always, and the reason is kept. "Either forgive or regret and we don't want both": a
   * crowd-sourced hazard map has to have an auditable way to be corrected, and a clearance with no
   * recorded justification is indistinguishable from somebody deleting an inconvenient bridge.
   */
  clear(constraintId: string, by: string, reason: string): ConstraintView {
    const c = this.require(constraintId);
    if (!reason?.trim()) throw new GlosError('VALIDATION_FAILED', 'Say why it is being cleared — a hazard removed without a reason cannot be reviewed later');
    c.status = 'cleared';
    c.clearedBy = by;
    c.clearedAt = new Date().toISOString();
    c.clearReason = reason.trim();
    this.constraints.set(c.constraintId, c);
    // The photographs stop being live evidence here and only here — the clearance is the lifecycle event
    // their retention clock hangs off, exactly as a parcel's terminal state is for a delivery photo.
    this.media.anchorConstraintCleared(c.constraintId);
    return constraintView(c);
  }

  /** Everything an operator has to look at: somebody says a live hazard is not there. */
  disputed(): ConstraintView[] {
    return this.live()
      // Every dispute — and every border reported CLOSED, disputed or not. A closed border is a country-level
      // fact that waits on a staff decision (does that country's switch move?) whether or not anybody argues
      // with the report; a road hazard only needs staff once somebody says it is gone.
      .filter((c) => c.status === 'disputed' || c.kind === 'BORDER_CLOSED')
      .map(constraintView)
      // Longest-waiting first. The wait is measured from the DISPUTE, not the report: a bridge reported
      // two years ago and disputed this morning has been in front of an operator since this morning, and
      // sorting on the report date would bury every fresh dispute under the oldest hazards on the map.
      // Records written before disputedAt existed fall back to the report date, which is the only date
      // they have.
      .sort((a, b) => (a.disputedAt ?? a.reportedAt).localeCompare(b.disputedAt ?? b.reportedAt));
  }

  /** What is around here — the driver's map. Cleared ones are gone; disputed ones are still shown. */
  near(at: GeoPoint, radiusKm = 25): ConstraintView[] {
    return this.live()
      .filter((c) => haversineKm(c.at, at) <= radiusKm)
      .sort((a, b) => haversineKm(a.at, at) - haversineKm(b.at, at))
      .map(constraintView);
  }

  /** What sits on the straight line between two places. Approximate by construction — see ON_ROUTE_KM. */
  alongRoute(from: GeoPoint, to: GeoPoint): ConstraintView[] {
    return this.live()
      .filter((c) => distanceToSegmentKm(c.at, from, to) <= ON_ROUTE_KM)
      .sort((a, b) => haversineKm(from, a.at) - haversineKm(from, b.at))
      .map(constraintView);
  }

  /**
   * What stands between this load, on this vehicle, on this road.
   *
   * Returns typed blockers the board already understands, plus an explicit 'unknown' for every question it
   * was asked and could not answer — an unmeasured load against a posted limit, or a load with no route at
   * all. An empty array means only "nothing reported on this road stops you"; it is NEVER a clear route,
   * which is why the board pairs this with a caveat it cannot switch off.
   *
   * THE HEIGHT IS THE LOAD PLUS THE DECK, never the load alone: a 4.0 m load is 5.2 m on a flatbed and
   * 4.4 m on a lowboy, so "needs a lowboy" is a conclusion this function reaches, never a declaration.
   */
  checkRoute(input: { from?: GeoPoint; to?: GeoPoint; totalHeightM?: number; grossWeightKg?: number; hazmat?: boolean }): BoardBlocker[] {
    const { from, to } = input;
    // No route to check is not a clear route. Said explicitly rather than returning an empty list, which
    // every caller would read as "nothing in the way".
    if (!from || !to) {
      return [{ kind: 'unknown', code: 'ROUTE_NOT_CHECKED', message: 'We do not know which road this runs on, so nothing about it has been checked' }];
    }
    // An unreported road adds nothing here, and adds no reassurance either. The board's permanent
    // ROUTE_NOT_SURVEYED caveat is what speaks for the roads nobody has reported — see the note on the
    // absent threshold at the top of this file.
    const on = this.alongRoute(from, to);

    const out: BoardBlocker[] = [];
    for (const c of on) {
      const effect = CONSTRAINT_EFFECT[c.kind];
      if (!effect.blocks) continue; // a ferry or a weighbridge costs time, never the load
      if (effect.measure === 'height_m') {
        // Unknown height cannot clear anything either — if we do not know how tall the load is, we do
        // not know whether it fits, and that is an unknown rather than a pass.
        if (input.totalHeightM == null) {
          out.push({ kind: 'unknown', code: 'HEIGHT_UNKNOWN', message: `There is a ${c.value} m limit on this road and we do not know how tall this is on your deck` });
        } else if (c.value != null && input.totalHeightM > c.value) {
          out.push({ kind: effect.kind, code: 'OVER_HEIGHT', message: `${c.value} m limit on this road — your load stands ${round1(input.totalHeightM)} m on your deck${c.status === 'disputed' ? ' (somebody reports it is gone; still treat it as there)' : ''}` });
        }
      } else if (effect.measure === 'weight_kg') {
        if (input.grossWeightKg == null) {
          out.push({ kind: 'unknown', code: 'WEIGHT_UNKNOWN', message: `There is a ${Math.round((c.value ?? 0) / 1000)} t limit on this road and we do not know your gross weight` });
        } else if (c.value != null && input.grossWeightKg > c.value) {
          out.push({ kind: effect.kind, code: 'OVER_WEIGHT', message: `${Math.round(c.value / 1000)} t limit on this road — you would cross at ${Math.round(input.grossWeightKg / 1000)} t` });
        }
      } else if (c.kind === 'NO_HAZMAT' && input.hazmat) {
        out.push({ kind: effect.kind, code: 'HAZMAT_PROHIBITED', message: 'Hazardous cargo is not allowed on this road' });
      } else if (c.kind === 'WASHOUT') {
        out.push({ kind: effect.kind, code: 'ROAD_WASHED_OUT', message: 'This road is reported washed out' });
      }
    }
    return out;
  }

  get(constraintId: string): RouteConstraint {
    return this.require(constraintId);
  }

  /** Everything still standing. Cleared constraints are kept for audit and never shown as hazards. */
  private live(): RouteConstraint[] {
    return [...this.constraints.values()].filter((c) => c.status !== 'cleared');
  }

  private sameSpot(kind: ConstraintKind, at: GeoPoint): RouteConstraint | undefined {
    return this.live().find((c) => c.kind === kind && haversineKm(c.at, at) <= SAME_SPOT_KM);
  }

  private require(constraintId: string): RouteConstraint {
    const c = this.constraints.get(constraintId);
    if (!c) throw new GlosError('NOT_FOUND', `No such report: ${constraintId}`);
    return c;
  }
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The public shape: counts, never who said what. Who reported a bridge is nobody else's business. */
export function constraintView(c: RouteConstraint): ConstraintView {
  return {
    constraintId: c.constraintId,
    kind: c.kind,
    at: c.at,
    value: c.value,
    note: c.note,
    status: c.status,
    reportedAt: c.reportedAt,
    disputedAt: c.disputedAt,
    confirmations: c.confirmedBy.length,
    refutations: c.refutedBy.length,
    // Dated, in order, and with the author stripped — the accounts are what the operator weighs, and the
    // one thing they must never carry is who said it.
    accounts: (c.accounts ?? []).map((a) => ({
      at: a.at,
      stance: a.stance,
      ...(a.note ? { note: a.note } : {}),
      ...(a.photoRef ? { photoRef: a.photoRef } : {}),
    })),
  };
}

/**
 * How far a point lies off the straight line between two others.
 *
 * A corridor is not a straight line and this is not a router — it is deliberately generous (ON_ROUTE_KM)
 * because the failure that matters is missing a bridge, not mentioning one four kilometres away. Flat
 * approximation: over a leg of a few hundred kilometres the error is far smaller than the tolerance.
 */
export function distanceToSegmentKm(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const scale = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const ax = a.lng * scale, ay = a.lat;
  const bx = b.lng * scale, by = b.lat;
  const px = p.lng * scale, py = p.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  // A zero-length leg (both ends the same place) is just the distance to that place.
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const nearest = { lat: ay + t * dy, lng: (ax + t * dx) / scale };
  return haversineKm(p, nearest);
}
