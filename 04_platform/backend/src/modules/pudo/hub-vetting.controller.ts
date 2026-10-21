import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { HubPapersDecisionDto, HubPapersDto, HubPapersRow } from './hub-vetting.types';
import { MdpService } from './mdp.service';
import { MediaService } from './media.service';
import type { MediaKind } from './media.types';
import { Mdp } from './pudo.types';
import { staffOf } from './staff-of';

/**
 * A HUB IS VETTED BEFORE IT WORKS (the ISO 28000 check: "hubs are not vetted at all"), the way a shop is: it sends a copy
 * of the responsible person's ID, its trading licence and a photograph of the premises from its own sign-in, and a member
 * of staff who has looked approves it, or sends it back with the reason. Until then MdpService refuses its floor work and
 * routes nothing to it. A hub staff register themselves is approved by them at registration (POST sbg/mdps).
 */
@Controller('sbg')
export class HubVettingController {
  constructor(
    private readonly mdps: MdpService,
    private readonly media: MediaService,
  ) {}

  /**
   * The hub sends its papers, signed in as itself — not its people on the floor (no @AtTheCounter: they are refused), and
   * not staff, who check papers and cannot be the ones who supplied them. Each must be a photograph this hub took and that
   * is attached to nothing else, all of them asked before anything is written.
   */
  @Roles('mdp')
  @Post('mdps/:id/papers')
  send(@Param('id') id: string, @Body() dto: HubPapersDto, @Actor() actor: IntrospectionResult): Mdp {
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A hub sends its own papers: staff check them, and cannot be the ones who supply them');
    const hub = this.mdps.require(id);
    if (!actor?.did || actor.did !== hub.did) throw new GlosError('FORBIDDEN', 'Only the hub itself sends its papers');
    this.mdps.assertCanSend(hub);
    const link = { type: 'hub' as const, id: hub.did };
    const papers: Array<[string, MediaKind]> = [[dto.idCopyRef, 'kyc_id'], [dto.licenceRef, 'kyc_licence'], ...dto.photoRefs.map((ref): [string, MediaKind] => [ref, 'shop'])];
    if (new Set(papers.map(([ref]) => ref)).size !== papers.length) throw new GlosError('PHOTO_REQUIRED', 'Each paper is a photograph of its own: take each one');
    for (const [ref] of papers) {
      if (!this.media.mayAdopt(ref, hub.did, link)) throw new GlosError('PHOTO_REQUIRED', 'That picture could not be attached — take the photograph again');
    }
    const sent = this.mdps.submitPapers(hub.mdpId, { idCopyRef: dto.idCopyRef, licenceRef: dto.licenceRef, photoRefs: dto.photoRefs });
    for (const [ref, kind] of papers) this.media.adopt(ref, hub.did, link, kind);
    return sent;
  }

  /** Hubs whose papers wait for a member of staff, the oldest first: what each said about itself, and the papers. */
  @Roles('operator')
  @Get('hub-papers')
  queue(): HubPapersRow[] {
    return this.mdps.papersQueue().map((m) => ({
      mdpId: m.mdpId,
      did: m.did,
      name: m.name,
      country: this.mdps.countryOf(m),
      zones: m.zones,
      location: m.location,
      ...(m.address ? { address: m.address } : {}),
      ...(m.contactPhone ? { contactPhone: m.contactPhone } : {}),
      createdAt: m.createdAt,
      papers: m.vetting!.papers!,
    }));
  }

  /** A member of staff, having looked: approve, or refuse with the reason the hub is shown. Named on the record. */
  @Roles('operator')
  @Post('mdps/:id/papers-decision')
  decide(@Param('id') id: string, @Body() dto: HubPapersDecisionDto, @Actor() actor: IntrospectionResult): Mdp {
    return this.mdps.decidePapers(id, dto.approve, staffOf(actor).name, dto.reason);
  }
}
