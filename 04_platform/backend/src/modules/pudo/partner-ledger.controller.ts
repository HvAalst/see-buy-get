import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { actingTenant } from '../../foundation/auth/acting';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { DriverService } from './driver.service';
import { MdpService } from './mdp.service';
import { MyPartnerOwed, PartnerLedgerService, PartnerLedgerView } from './partner-ledger.service';

/**
 * 2026-11-20 — WHAT A PARTNER OWES, READ (the payments plan, 3a; the owner: "console for staff"; the hands see it, "named"). Our
 * staff read a partner's whole record, by the partner company; a shop, a hub, a courier and a fleet's office each read what the
 * partners owe them. Nothing here moves money.
 */
@Controller('sbg')
export class PartnerLedgerController {
  constructor(
    private readonly ledger: PartnerLedgerService,
    private readonly entities: EntityService,
    private readonly drivers: DriverService,
    private readonly mdps: MdpService,
  ) {}

  /** A partner's record, for our staff: every line it owes, and what it owes each hand in all. */
  @Roles('operator')
  @ApiQuery({ name: 'payeeId', required: false, description: 'Only what it owes this one hand.' })
  @Get('entities/:entityId/partner-owed')
  ofPartner(@Param('entityId') entityId: string, @Query('payeeId') payeeId?: string): PartnerLedgerView {
    const entity = this.entities.get(entityId);
    if (entity.kind !== 'partner') throw new GlosError('NOT_FOUND', `${entity.name} is not a partner company`);
    return this.ledger.ledgerOf(entityId, { ...(payeeId ? { payeeId } : {}) });
  }

  /** A hand's own: what any partner owes it — a courier its own, a fleet's office its fleet's, a hub and a shop theirs. */
  @Roles('agent', 'mdp', 'driver', 'fleet_manager')
  @Get('partner-owed/mine')
  mine(@Actor() actor: IntrospectionResult): MyPartnerOwed {
    return this.ledger.owedTo(this.payeeIdsOf(actor));
  }

  private payeeIdsOf(actor: IntrospectionResult | undefined): string[] {
    if (actor?.role === 'agent' && actor.did) return [actor.did];
    if (actor?.role === 'mdp' && actor.did) {
      const hub = this.mdps.list().find((m) => m.did === actor.did);
      return hub ? [hub.mdpId] : [];
    }
    if (actor?.role === 'driver' && actor.did) {
      // A fleet driver's road is its fleet's to be paid for: its office reads it.
      return this.drivers.get(actor.did).managerDid ? [] : [actor.did];
    }
    if (actor?.role === 'fleet_manager') {
      const fleet = actingTenant(actor);
      return fleet ? [fleet] : [];
    }
    throw new GlosError('FORBIDDEN', 'Only a shop, a hub, a driver or a fleet’s office reads what a partner owes it');
  }
}
