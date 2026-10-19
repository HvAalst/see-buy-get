import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles, SignedIn } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { BusinessMemberGuard } from './business-member.guard';
import { BusinessService } from './business.service';
import { ConsignmentNoteService } from './consignment-note.service';
import { DispatchService } from './dispatch.service';
import type { Freight } from './dispatch.types';
import { LoadSealService } from './load-seal.service';
import { LoadSealsView, LoadSealView, ReportBrokenSealDto, WriteSealDto } from './load-seal.types';

/** What staff, a carrier or anybody but the shipper is told at the door that writes a seal. */
const SHIPPER_ONLY = 'A seal is written by the business that sealed its load: staff and carriers read it';

/**
 * THE SEALS ON A LOAD (round 15). Read by whoever reads its consignment note — the shipper, the carrier, staff. Written,
 * before the goods are taken over, only by the business that posted the load, with the three photographs; staff are
 * refused by name, because a staff sign-in passes every role check. A broken one is reported by the driver carrying the
 * load; the reading at pickup, the re-seal at a post and the look at delivery go with those steps (dispatch).
 */
@Controller('sbg')
@UseGuards(BusinessMemberGuard)
export class LoadSealController {
  constructor(
    private readonly notes: ConsignmentNoteService,
    private readonly businesses: BusinessService,
    private readonly dispatch: DispatchService,
    private readonly seals: LoadSealService,
  ) {}

  @SignedIn()
  @Get('dispatch/freight/:id/seals')
  read(@Param('id') id: string, @Actor() actor: IntrospectionResult): LoadSealsView {
    const f = this.notes.requireReader(id, actor);
    return { freightId: f.freightId, seals: this.seals.views(f.freightId), editable: this.mayWrite(f, actor) };
  }

  /** The shipper writes a seal on its load: before pickup, a member who may act, with the three photographs. */
  @Roles('business')
  @Post('dispatch/freight/:id/seals')
  write(@Param('id') id: string, @Body() dto: WriteSealDto, @Actor() actor: IntrospectionResult): LoadSealView {
    const { f, acting } = this.shipper(id, actor);
    const seal = this.seals.write(f, { did: acting.entity.did, name: acting.member.name }, { number: dto.number, sealClass: dto.sealClass, maker: dto.maker, appliedBy: dto.appliedBy, photos: dto.photos });
    return this.seals.views(f.freightId).find((s) => s.sealId === seal.sealId)!;
  }

  /** The shipper takes a seal off its load again, before pickup. */
  @Roles('business')
  @Delete('dispatch/freight/:id/seals/:sealId')
  remove(@Param('id') id: string, @Param('sealId') sealId: string, @Actor() actor: IntrospectionResult): { removed: true } {
    const { f } = this.shipper(id, actor);
    this.seals.remove(f, sealId);
    return { removed: true };
  }

  /**
   * A seal found broken on the road — said by the driver carrying the load, and nobody else: staff are refused by name.
   * Dated when the driver saw it; with no signal it waits on the phone.
   */
  @Roles('driver')
  @Post('dispatch/freight/:id/seals/:sealId/broken')
  broken(@Param('id') id: string, @Param('sealId') sealId: string, @Body() dto: ReportBrokenSealDto, @Actor() actor: IntrospectionResult): LoadSealView {
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A broken seal is reported by the driver carrying the load');
    if (!actor?.did) throw new GlosError('UNAUTHORIZED', 'Sign in as the driver carrying this load');
    return this.dispatch.reportBrokenSeal(id, actor.did, sealId, { cause: dto.cause, note: dto.note, photoRefs: dto.photoRefs, paperRef: dto.paperRef, location: dto.location, observedAt: dto.observedAt });
  }

  private shipper(id: string, actor: IntrospectionResult | undefined) {
    if (actor?.role !== 'business') throw new GlosError('FORBIDDEN', SHIPPER_ONLY);
    const f = this.notes.requireReader(id, actor);
    const acting = this.businesses.requireMember(actor);
    if (f.postedByDid !== acting.entity.did) throw new GlosError('FORBIDDEN', SHIPPER_ONLY);
    if (!this.businesses.mayAct(acting)) throw new GlosError('FORBIDDEN', 'Viewers read the seals; a member who may act writes them');
    return { f, acting };
  }

  private mayWrite(f: Freight, actor: IntrospectionResult | undefined): boolean {
    if (actor?.role !== 'business') return false;
    try {
      const acting = this.businesses.requireMember(actor);
      return this.businesses.mayAct(acting) && f.postedByDid === acting.entity.did && this.seals.editable(f);
    } catch {
      return false;
    }
  }
}
