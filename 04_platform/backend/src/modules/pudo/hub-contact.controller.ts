import { Body, Controller, Get, Optional, Param, Put } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { weekOf } from './fleet-site.service';
import { HandleDirectory } from './handle-directory.service';
import { HubArrivalService } from './hub-arrival.service';
import { HubContactService, outsideOf } from './hub-contact.service';
import { HubContactView, SetHubContactDto } from './hub-contact.types';
import { MdpService } from './mdp.service';

/**
 * A HUB'S OPENING HOURS AND HOW TO REACH IT (hub-contact.types.ts; the user, 2026-10-26). Read by the hub — its owner and
 * the people working its floor — and by network staff; written by its owner alone, as the hub's own word. Drivers and
 * stores working with the hub read it where they meet the hub; anybody, on its public page, as far as it chose.
 */
@Controller('sbg')
export class HubContactController {
  constructor(
    private readonly contacts: HubContactService,
    private readonly mdps: MdpService,
    @Optional() private readonly arrivals?: HubArrivalService,
    // Issues a newly approved hub its address (a sweep, as on the public pages): its card links to its page.
    @Optional() private readonly handleDirectory?: HandleDirectory,
  ) {}

  /** The hub's entry as it reads it: its hours, whether it is open now, its numbers and its gate. */
  @Roles('mdp', 'operator')
  @Get('mdps/:id/contact')
  @AtTheCounter()
  read(@Param('id') id: string, @Actor() actor: IntrospectionResult): HubContactView {
    const hub = this.mdps.require(id); // 404 if unknown
    if (actor?.role !== 'operator' && (!actor?.did || actor.did !== hub.did)) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    this.handleDirectory?.ensure();
    return this.contacts.viewOf(id);
  }

  /**
   * Its owner writes it: when it is open, the number drivers and stores ring, who to ask for, where to come in — and
   * whether its number and gate go on its public page too. Not its people, and not network staff: a hub's word is its own.
   */
  @Roles('mdp', 'operator')
  @Put('mdps/:id/contact')
  write(@Param('id') id: string, @Body() dto: SetHubContactDto, @Actor() actor: IntrospectionResult): HubContactView {
    const hub = this.mdps.require(id); // 404 if unknown
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A hub writes its own hours and how to reach it, signed in as the hub. Staff change nothing in its name');
    if (!actor?.did || actor.did !== hub.did) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    // The hours it takes stores' parcels in bulk stay inside the hours it is open: refused before anything is written.
    if (dto.openingHours) {
      const bulk = this.arrivals?.bulkOf(id)?.hours;
      const out = bulk ? outsideOf(bulk, weekOf(dto.openingHours)) : null;
      if (out) throw new GlosError('INVALID_INPUT', `You take stores’ parcels in bulk outside these hours (${out}): change those first, under Coming in`, { field: 'openingHours' });
    }
    this.handleDirectory?.ensure();
    return this.contacts.set(id, dto, actor?.actorName?.trim() || hub.name);
  }
}
