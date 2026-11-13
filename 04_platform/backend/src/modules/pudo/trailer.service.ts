import { Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { MediaService } from './media.service';
import { ownPlateRequired, payloadOf, TRAILER_MAX_KG, type TrailerSpec } from './trailer-rules';

/** A trailer a driver or a fleet keeps (D1): what it is, whose, and its registration card where it has a plate of its own. */
export interface Trailer extends TrailerSpec {
  trailerId: string;
  /** A courier's own; else a fleet's. */
  ownerDriverDid?: string;
  managerDid?: string;
  registrationRef?: string;
  status: 'ACTIVE' | 'RETIRED';
  createdAt: string;
  createdBy: string;
}

/** A trailer as it is typed — kept, or hired for the day. Litres: its load space; absent where not measured. */
export interface TrailerInput {
  plate: string;
  maxKg: number;
  emptyKg: number;
  braked: boolean;
  closed: boolean;
  litres?: number;
  ramp?: boolean;
  registrationRef?: string;
}

export interface TrailerView extends Trailer {
  /** What it carries: its maximum less its own weight. */
  payloadKg: number;
}

/**
 * 2026-11-13 — TRAILERS (the owner: "consider a trailer for VANs especially — movers use vans and trailers in cities"; plan D1, "build
 * as recommended"). A courier keeps their own, a fleet its own; each says its plate, its maximum and its own weight, braked or not,
 * closed or open, its load space and whether it has ramps — what it carries is worked out, never assumed. A trailer with a plate
 * of its own shows its registration card (the Netherlands above 750 kg, Kenya always). Hitched on a shift by FleetService.
 */
@Injectable()
export class TrailerService {
  private readonly trailers = new PersistentMap<string, Trailer>('pudo-trailers');

  constructor(@Optional() private readonly media?: MediaService) {}

  /** A trailer as typed, checked: refused field by field. Used for a kept trailer and a day's hire alike. */
  spec(input: TrailerInput): TrailerSpec {
    const plate = (input.plate ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (plate.length < 2 || plate.length > 20) throw new GlosError('FIELD_REQUIRED', 'Type the trailer’s plate', { field: 'plate' });
    const maxKg = Math.round(Number(input.maxKg));
    const emptyKg = Math.round(Number(input.emptyKg));
    if (!Number.isFinite(maxKg) || maxKg < 100 || maxKg > TRAILER_MAX_KG) throw new GlosError('INVALID_INPUT', `Its maximum weight, loaded, is between 100 and ${TRAILER_MAX_KG} kg, as on its plate`, { field: 'maxKg' });
    if (!Number.isFinite(emptyKg) || emptyKg < 20 || emptyKg >= maxKg) throw new GlosError('INVALID_INPUT', 'Its own weight, empty, is more than 20 kg and less than its maximum', { field: 'emptyKg' });
    const litres = input.litres != null ? Math.round(Number(input.litres)) : undefined;
    if (litres != null && (!Number.isFinite(litres) || litres <= 0 || litres > 60_000)) throw new GlosError('INVALID_INPUT', 'Its load space is more than nothing and at most 60,000 litres', { field: 'litres' });
    return { plate, maxKg, emptyKg, braked: Boolean(input.braked), closed: Boolean(input.closed), ...(litres != null ? { volumeM3: Math.round(litres / 10) / 100 } : {}), ramp: Boolean(input.ramp) };
  }

  register(owner: { driverDid?: string; managerDid?: string }, input: TrailerInput, ctx: { country?: string; by: string; photoOwnerDid: string }, now: number = Date.now()): TrailerView {
    const spec = this.spec(input);
    const trailerId = `trl_${randomBytes(6).toString('hex')}`;
    const ref = input.registrationRef?.trim();
    if (ownPlateRequired(ctx.country, spec.maxKg)) {
      if (!ref || !this.media?.adopt(ref, ctx.photoOwnerDid, { type: 'vehicle', id: trailerId }, 'registration')) {
        throw new GlosError('PHOTO_REQUIRED', ctx.country === 'KE' ? 'A photo of the trailer’s registration card: it carries a Z plate of its own' : 'A photo of the trailer’s registration card: above 750 kg it carries a plate of its own', { field: 'registrationRef' });
      }
    }
    const trailer: Trailer = {
      ...spec,
      trailerId,
      ...(owner.managerDid ? { managerDid: owner.managerDid } : { ownerDriverDid: owner.driverDid }),
      ...(ref && ownPlateRequired(ctx.country, spec.maxKg) ? { registrationRef: ref } : {}),
      status: 'ACTIVE',
      createdAt: new Date(now).toISOString(),
      createdBy: ctx.by,
    };
    if (this.listFor(owner).some((t) => t.plate === spec.plate)) throw new GlosError('DUPLICATE', `${spec.plate} is already one of your trailers`, { field: 'plate' });
    this.trailers.set(trailerId, trailer);
    return this.view(trailer);
  }

  /** The trailers a courier or a fleet keeps, still in use. A fleet's driver also sees their fleet's. */
  listFor(owner: { driverDid?: string; managerDid?: string }): TrailerView[] {
    return [...this.trailers.values()]
      .filter((t) => t.status === 'ACTIVE' && ((owner.driverDid && t.ownerDriverDid === owner.driverDid) || (owner.managerDid && t.managerDid === owner.managerDid)))
      .sort((a, b) => a.plate.localeCompare(b.plate))
      .map((t) => this.view(t));
  }

  get(trailerId: string): Trailer {
    const t = this.trailers.get(trailerId);
    if (!t || t.status !== 'ACTIVE') throw new GlosError('NOT_FOUND', 'No such trailer');
    return t;
  }

  /** Whose it is to keep: the courier who owns it, or the fleet. */
  ownedBy(t: Trailer, owner: { driverDid?: string; managerDid?: string }): boolean {
    return Boolean((t.ownerDriverDid && t.ownerDriverDid === owner.driverDid) || (t.managerDid && t.managerDid === owner.managerDid));
  }

  retire(trailerId: string, owner: { driverDid?: string; managerDid?: string }): TrailerView {
    const t = this.get(trailerId);
    if (!this.ownedBy(t, owner)) throw new GlosError('FORBIDDEN', 'Only whoever keeps this trailer takes it off');
    t.status = 'RETIRED';
    this.trailers.set(trailerId, t);
    return this.view(t);
  }

  view(t: Trailer): TrailerView {
    return { ...t, payloadKg: payloadOf(t) };
  }
}
