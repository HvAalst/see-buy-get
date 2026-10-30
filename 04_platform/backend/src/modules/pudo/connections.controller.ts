import { Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { MailService } from '../../foundation/mail/mail.service';
import { SmsService } from '../../foundation/sms/sms.service';
import { isSandbox } from '../../foundation/runtime/sandbox';
import { reviewCodeState } from '../../foundation/runtime/review-code';
import { standInState } from '../../foundation/runtime/standin-code';
import { ConnectionsView, RouterCheck } from './connections.types';
import { FleetManagerService } from './fleet-manager.service';
import { NotificationService } from './notification.service';
import { PlanAdviserService } from './plan-adviser.service';
import { OsrmRoadMatrix } from './road-matrix';
import { haversineKm } from './geo';

/** When this server started: what it remembers of its connections is since then. */
const SINCE = new Date().toISOString();

/**
 * WHAT THIS SERVER IS CONNECTED TO — for staff, and only for staff.
 *
 * A fleet's office is told what it needs where it works: its plan says which distances it was made on, and the adviser
 * says when it is not set up. Whether the two services behind that are set up, and answering, is the operator's to
 * know and to put right — and until this there was no screen that said it, only a paragraph in a README.
 *
 * Mail, push and the text that carries a code are here for the same reason, and are read the same way: each service
 * says what the sender it was started with does with what it is handed. Nothing is sent from here to find out — a
 * test email is an email to somebody, and a test push or a test text needs somebody's phone.
 *
 * Reading changes nothing. Checking asks the routing server one question about two places near a fleet's depot:
 * coordinates, as a plan sends — no order, no name. The adviser is not asked anything from here: a model is not
 * pinged, and what the last office's question met says whether it is answering.
 */
@Controller('sbg/connections')
export class ConnectionsController {
  constructor(
    private readonly roads: OsrmRoadMatrix,
    private readonly adviser: PlanAdviserService,
    private readonly managers: FleetManagerService,
    private readonly mail: MailService,
    private readonly notifications: NotificationService,
    private readonly sms: SmsService,
  ) {}

  @Roles('operator')
  @Get()
  view(): ConnectionsView {
    return { router: this.roads.status(), adviser: this.adviser.connection(), mail: this.mail.connection(), push: this.notifications.connection(), sms: this.sms.connection(), sandbox: isSandbox(), reviewCode: reviewCodeState(), standInCodes: standInState(), since: SINCE };
  }

  /**
   * Ask the routing server now. The two places are a fleet's depot and a point a little way off it: places a plan
   * would really ask about, on whatever map the operator's server holds.
   */
  @Roles('operator')
  @Post('router/check')
  async checkRouter(): Promise<RouterCheck> {
    const at = new Date().toISOString();
    // Nothing set comes first: with nobody to ask, which two places would have been asked about is beside the point.
    if (!this.roads.configured()) return { at, ok: false, why: 'no routing server is configured' };
    const depot = this.managers.list().find((m) => m.location && Number.isFinite(m.location.lat) && Number.isFinite(m.location.lng));
    if (!depot?.location) return { at, ok: false, why: 'there is no fleet with a depot on the map yet, so there are no two places to ask about' };
    const a = depot.location;
    const b = { lat: a.lat + CHECK_OFFSET_DEG, lng: a.lng + CHECK_OFFSET_DEG };
    const got = await this.roads.check(a, b);
    return { ...got, near: depot.companyName, apartKm: Math.round(haversineKm(a, b) * 10) / 10 };
  }
}

/** How far from the depot the second place is, each way: about a kilometre and a half apart in all. */
export const CHECK_OFFSET_DEG = 0.01;
