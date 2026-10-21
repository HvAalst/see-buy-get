import { Body, Controller, Get, Param, Post, UseInterceptors } from '@nestjs/common';
import { CounterLogInterceptor } from './shop-staff.controller';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles, SignedIn } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { ConsignmentNoteService } from './consignment-note.service';
import { MdpService } from './mdp.service';
import { staffOf } from './staff-of';
import { TamperService } from './tamper.service';
import { ReleaseHoldDto, ReportBagTamperDto, ReportLoadTamperDto, ReportParcelTamperDto, TamperUnitView } from './tamper.types';

/** Staff pass every role check: a report is made by whoever holds the goods, so a staff sign-in is refused by name. */
const HOLDER_ONLY = 'Tampering is reported by whoever has the goods in front of them: staff read it and release it';

/**
 * THE TAMPER PROTOCOL'S DOORS (tamper.types.ts). The driver reports on the load in their hands; a shop at its counter and
 * a hub report on a parcel in theirs; staff read every exception and release a hold, with a reason.
 */
@Controller('sbg')
@UseInterceptors(CounterLogInterceptor)
export class TamperController {
  constructor(
    private readonly tamper: TamperService,
    private readonly notes: ConsignmentNoteService,
    private readonly mdps: MdpService,
  ) {}

  /** The driver taking over or carrying the load: a seal not the one written, the seals not as the note says, a cut wrap. */
  @Roles('driver')
  @Post('dispatch/freight/:id/tamper')
  reportOnLoad(@Param('id') id: string, @Body() dto: ReportLoadTamperDto, @Actor() actor: IntrospectionResult): TamperUnitView {
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', HOLDER_ONLY);
    if (!actor?.did) throw new GlosError('UNAUTHORIZED', 'Sign in as the driver with this load');
    return this.tamper.reportOnLoad(id, actor.did, dto);
  }

  /** A load's exceptions: whoever reads its consignment note — the shipper, the carrier — and staff, with names. */
  @SignedIn()
  @Get('dispatch/freight/:id/tamper')
  forLoad(@Param('id') id: string, @Actor() actor: IntrospectionResult): TamperUnitView {
    if (actor?.role === 'operator') return this.tamper.loadView(id, 'staff');
    const f = this.notes.requireReader(id, actor);
    return this.tamper.loadView(f.freightId, 'party');
  }

  /** The shop, at its counter: a parcel it holds, its wrap or packaging cut or opened. */
  @Roles('agent')
  @Post('parcels/:id/tamper')
  @AtTheCounter()
  reportAtCounter(@Param('id') id: string, @Body() dto: ReportParcelTamperDto, @Actor() actor: IntrospectionResult): TamperUnitView {
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', HOLDER_ONLY);
    if (!actor?.did) throw new GlosError('UNAUTHORIZED', 'Sign in at the counter');
    return this.tamper.reportOnParcel(id, { as: 'shop', agentDid: actor.did, name: actor.actorName }, dto);
  }

  /** The hub, from its own sign-in: a parcel standing at it, its wrap or packaging cut or opened. */
  @Roles('mdp')
  @Post('mdps/:id/parcels/:parcelId/tamper')
  // The hub's floor (the ISO 28000 check: "a hub's own people by name"): its people work it, under their own name.
  @AtTheCounter()
  reportAtHub(@Param('id') id: string, @Param('parcelId') parcelId: string, @Body() dto: ReportParcelTamperDto, @Actor() actor: IntrospectionResult): TamperUnitView {
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', HOLDER_ONLY);
    const mdp = this.mdps.require(id);
    if (!actor?.did || actor.did !== mdp.did) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    return this.tamper.reportOnParcel(parcelId, { as: 'hub', mdpId: mdp.mdpId, mdpDid: mdp.did, mdpName: mdp.name, name: actor.actorName }, dto);
  }

  /**
   * Round 36 — the shop or the hub, about a bag it holds or is receiving: its seal not the one it was closed with, broken,
   * or the bag cut or opened. The bag is held; nobody opens it until operations releases it.
   */
  @Roles('agent', 'mdp', 'driver')
  @Post('totes/:code/tamper')
  @AtTheCounter()
  reportOnBag(@Param('code') code: string, @Body() dto: ReportBagTamperDto, @Actor() actor: IntrospectionResult): TamperUnitView {
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', HOLDER_ONLY);
    if (!actor?.did) throw new GlosError('UNAUTHORIZED', 'Sign in at the shop or the hub');
    if (actor.role === 'mdp') {
      const hub = this.mdps.list().find((m) => m.did === actor.did);
      if (!hub) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
      return this.tamper.reportOnBag(code, { as: 'hub', mdpId: hub.mdpId, mdpDid: hub.did, mdpName: hub.name, name: actor.actorName }, dto);
    }
    // Round 37 — the driver taking or carrying it.
    if (actor.role === 'driver') return this.tamper.reportOnBag(code, { as: 'driver', driverDid: actor.did, name: actor.actorName }, dto);
    return this.tamper.reportOnBag(code, { as: 'shop', agentDid: actor.did, name: actor.actorName }, dto);
  }

  /** Staff: a held unit by its code or number — every exception on it, who found it, the photographs. */
  @Roles('operator')
  @Get('ops/tamper/:ref')
  forStaff(@Param('ref') ref: string): TamperUnitView {
    return this.tamper.forStaff(ref);
  }

  /** Staff: released, with what was found and done. The case closes under the same words. */
  @Roles('operator')
  @Post('ops/tamper/:ref/release')
  release(@Param('ref') ref: string, @Body() dto: ReleaseHoldDto, @Actor() actor: IntrospectionResult): TamperUnitView {
    return this.tamper.release(ref, staffOf(actor, dto.by), dto.reason);
  }
}
