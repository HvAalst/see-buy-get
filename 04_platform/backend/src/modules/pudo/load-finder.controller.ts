import { Controller, Get, Query } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { SignedIn } from '../../foundation/auth/scopes.decorator';
import { LoadFinderService, LoadFoundView, ParcelFoundView } from './load-finder.service';

/**
 * THE LOAD A SCAN NAMES (round 19). Every scan box — a shop's counter, a hub, a driver's pickup, the console — asks here
 * when what was scanned is a load's code rather than its own kind: the package's SSCC, our label's QR, the load's code.
 * Signed in, at a counter too; answered only to whoever could already open the load.
 */
@Controller('sbg')
export class LoadFinderController {
  constructor(private readonly finder: LoadFinderService) {}

  @SignedIn()
  @AtTheCounter()
  @Get('dispatch/find-load')
  find(@Query('scanned') scanned: string, @Actor() actor: IntrospectionResult): LoadFoundView {
    return this.finder.find(scanned, actor);
  }

  /**
   * Round 32 — the store parcel a scanned SSCC belongs to: every parcel box at a shop and a hub asks here before it
   * treats the barcode as a load's. Answered only to whoever handles that parcel now.
   */
  @SignedIn()
  @AtTheCounter()
  @Get('scan/parcel')
  findParcel(@Query('scanned') scanned: string, @Actor() actor: IntrospectionResult): ParcelFoundView {
    return this.finder.findParcel(scanned, actor);
  }
}
