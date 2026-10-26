import { Body, Controller, Get, Param, Post, Put, Query, UseInterceptors } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles, Scopes } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { HubArrivalService } from './hub-arrival.service';
import { BookHubArrivalDto, HubArrivalScan, HubArrivalView, HubArrivals, HubBulkView, HubOptions, ReceiveHubArrivalDto, ScanHubArrivalDto, SetHubBulkDto, StoreHubArrivals } from './hub-arrival.types';
import { MdpService } from './mdp.service';
import { CounterLogInterceptor } from './shop-staff.controller';
import { classifySize, measuredFactor } from './pudo.config';
import type { ParcelSize } from './pudo.types';
import { VendorService } from './vendor.service';

/**
 * INBOUND SUPPLY, READING B — A HUB AS A CROSS-DOCK (HubArrivalService). Two sides, each its own:
 *  - THE STORE, signed in as itself: the hubs it may hand a parcel in at (priced), what it has to book, its arrivals —
 *    booked and withdrawn by it. Staff are refused by name: a store's records are the store's.
 *  - THE HUB: whether it takes stores' parcels in bulk and when — its owner's word, never staff's — and its floor: what is
 *    coming, taken in at the door, scanned off, finished. Its people work the floor under their own names; network staff
 *    may stand in on the floor, as they may for a bag.
 */
@Controller('sbg')
// The hub's floor acts go in its own record, under who did them, as a bag's do (COUNTER_ACTS).
@UseInterceptors(CounterLogInterceptor)
export class HubArrivalController {
  constructor(
    private readonly arrivals: HubArrivalService,
    private readonly vendors: VendorService,
    private readonly mdps: MdpService,
  ) {}

  /* ------------------------------------------------------------------------------------------- the store -- */

  /** The hubs this store may hand a parcel in at, each priced for it from there — as the mint will price it. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/hubs')
  hubOptions(
    @Param('id') id: string,
    @Query('dest') dest: string,
    @Query('size') size: string | undefined,
    @Query('l') l: string | undefined,
    @Query('w') w: string | undefined,
    @Query('h') h: string | undefined,
    @Query('kg') kg: string | undefined,
    @Query('fragile') fragile: string | undefined,
    @Actor() actor: IntrospectionResult,
  ): HubOptions {
    this.storeReads(id, actor);
    if (!dest?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say where the parcel goes: the shop the buyer collects at', { field: 'dest' });
    const [dl, dw, dh, dkg] = [l, w, h, kg].map((v) => Number(v));
    const measured = [dl, dw, dh, dkg].every((n) => Number.isFinite(n) && n > 0) ? { l: dl, w: dw, h: dh, kg: dkg } : undefined;
    const factor = measured ? measuredFactor(measured) : undefined;
    const sz: ParcelSize = measured && factor != null ? classifySize(measured) : ((size as ParcelSize) || 'M');
    const weight = Number(kg);
    const carriers = { ...(Number.isFinite(weight) && weight > 0 ? { kg: weight } : {}), ...(fragile === 'true' || fragile === '1' ? { fragile: true } : {}) };
    return { hubs: this.arrivals.options(id, dest.trim(), sz, factor ?? undefined, carriers) };
  }

  /** What this store has to book at each hub, and its arrivals. */
  @Scopes('vendor:read:self')
  @Get('vendors/:id/hub-arrivals')
  storeArrivals(@Param('id') id: string, @Actor() actor: IntrospectionResult): StoreHubArrivals {
    this.storeReads(id, actor);
    return this.arrivals.forStore(id);
  }

  /** The store books the hand-in of its parcels at a hub: which, on how many units, which day. */
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/hub-arrivals')
  book(@Param('id') id: string, @Body() dto: BookHubArrivalDto, @Actor() actor: IntrospectionResult): HubArrivalView {
    const store = this.storeActs(id, actor);
    return this.arrivals.book(id, dto, actor?.actorName?.trim() || store);
  }

  /** The store withdraws an arrival the hub has not taken in. */
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/hub-arrivals/:arrivalId/withdraw')
  withdraw(@Param('id') id: string, @Param('arrivalId') arrivalId: string, @Actor() actor: IntrospectionResult): HubArrivalView {
    const store = this.storeActs(id, actor);
    return this.arrivals.withdraw(id, arrivalId, actor?.actorName?.trim() || store);
  }

  /* --------------------------------------------------------------------------------------------- the hub -- */

  /** Whether this hub takes stores' parcels in bulk, and what is coming to it — open first. */
  @Roles('mdp', 'operator')
  @Get('mdps/:id/arrivals')
  @AtTheCounter()
  hubArrivals(@Param('id') id: string, @Actor() actor: IntrospectionResult): HubArrivals {
    this.hubActs(id, actor);
    return this.arrivals.forHub(id);
  }

  /**
   * The hub's own word that it takes stores' parcels in bulk, on these days and hours, at so many doors — or no longer
   * does. Its owner's, signed in as the hub: not its people's, and not network staff's (a hub declares its own).
   */
  @Roles('mdp', 'operator')
  @Put('mdps/:id/bulk')
  setBulk(@Param('id') id: string, @Body() dto: SetHubBulkDto, @Actor() actor: IntrospectionResult): { bulk?: HubBulkView } {
    const hub = this.mdps.require(id);
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A hub says itself whether it takes parcels in bulk, and when, signed in as the hub. Staff change nothing in its name');
    if (!actor?.did || actor.did !== hub.did) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    const bulk = this.arrivals.setBulk(id, { open: dto.open, ...(dto.hours !== undefined ? { hours: dto.hours } : {}), ...(dto.doors !== undefined ? { doors: dto.doors } : {}) }, actor?.actorName?.trim() || hub.name);
    return bulk ? { bulk } : {};
  }

  /** At the hub's door: the units that came, counted. */
  @Roles('mdp', 'operator')
  @Post('mdps/:id/arrivals/:arrivalId/receive')
  @AtTheCounter()
  receiveArrival(@Param('id') id: string, @Param('arrivalId') arrivalId: string, @Body() dto: ReceiveHubArrivalDto, @Actor() actor: IntrospectionResult): HubArrivalView {
    const hub = this.hubActs(id, actor);
    return this.arrivals.receive(id, arrivalId, { units: dto.units, note: dto.note }, actor?.actorName?.trim() || hub);
  }

  /** One parcel scanned off the units: the hub answers for it from here. */
  @Roles('mdp', 'operator')
  @Post('mdps/:id/arrivals/:arrivalId/scan')
  @AtTheCounter()
  scanArrival(@Param('id') id: string, @Param('arrivalId') arrivalId: string, @Body() dto: ScanHubArrivalDto, @Actor() actor: IntrospectionResult): HubArrivalScan {
    const hub = this.hubActs(id, actor);
    return this.arrivals.scan(id, arrivalId, dto.code, actor?.actorName?.trim() || hub);
  }

  /** Scanning finished: what was booked and not scanned is still the store's, which is told. */
  @Roles('mdp', 'operator')
  @Post('mdps/:id/arrivals/:arrivalId/finish')
  @AtTheCounter()
  finishArrival(@Param('id') id: string, @Param('arrivalId') arrivalId: string, @Actor() actor: IntrospectionResult): HubArrivalView {
    const hub = this.hubActs(id, actor);
    return this.arrivals.finish(id, arrivalId, actor?.actorName?.trim() || hub);
  }

  /* ---------------------------------------------------------------------------------------------- inside -- */

  /** The store itself reads its own — staff named and refused, as at every door of a store's own records. */
  private storeReads(id: string, actor: IntrospectionResult): string {
    const vendor = this.vendors.get(id); // 404 if unknown
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A store’s own records are the store’s. Staff read a store under Stores, and a parcel under Find a parcel');
    if (!actor?.did || actor.did !== vendor.did) throw new GlosError('FORBIDDEN', 'This store is not yours to view');
    return vendor.name;
  }

  /** The store itself changes its own — and nobody standing in. */
  private storeActs(id: string, actor: IntrospectionResult): string {
    const vendor = this.vendors.get(id); // 404 if unknown
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A store makes its own changes, signed in as that store. Staff change nothing in its name');
    if (!actor?.did || actor.did !== vendor.did) throw new GlosError('FORBIDDEN', 'This store is not yours to change');
    return vendor.name;
  }

  /** The hub's floor: its own sign-in (its owner or its people), or network staff standing in for it. */
  private hubActs(id: string, actor: IntrospectionResult): string {
    const hub = this.mdps.require(id); // 404 if unknown
    if (actor?.role !== 'operator' && (!actor?.did || actor.did !== hub.did)) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    return hub.name;
  }
}
