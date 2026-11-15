import { Controller, Get, Optional, Post } from '@nestjs/common';
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
import { RoadRouter } from './road-router';
import { haversineKm } from './geo';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { GAZETTEER } from './geo-gazetteer';

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
    // 2026-11-09 — the network's places measured by road (zone pricing step 4): how many, and when.
    @Optional() private readonly roadTable?: RoadRouter,
    // 2026-11-15 — with no fleet depot yet, a shop or a hub to ask about (the owner's check met "no fleet with a depot").
    @Optional() private readonly agents?: AgentService,
    @Optional() private readonly mdps?: MdpService,
  ) {}

  @Roles('operator')
  @Get()
  view(): ConnectionsView {
    const table = this.roadTable?.state();
    return { router: { ...this.roads.status(), ...(table ? { table } : {}) }, adviser: this.adviser.connection(), mail: this.mail.connection(), push: this.notifications.connection(), sms: this.sms.connection(), sandbox: isSandbox(), reviewCode: reviewCodeState(), standInCodes: standInState(), since: SINCE };
  }

  /**
   * Ask the routing server now. The two places are a place the network knows and a point a little way off it: a fleet's
   * depot first, as a plan would ask; with none yet, a shop, then a hub, then a known town in each country (2026-11-15 —
   * a server with no fleet on it could not be checked at all). The first that has a road between them is the answer; a
   * map that does not cover one country is no failure while another answers.
   */
  @Roles('operator')
  @Post('router/check')
  async checkRouter(): Promise<RouterCheck> {
    const at = new Date().toISOString();
    // Nothing set comes first: with nobody to ask, which two places would have been asked about is beside the point.
    if (!this.roads.configured()) return { at, ok: false, why: 'no routing server is configured' };
    let last: RouterCheck | undefined;
    for (const place of this.checkPlaces()) {
      const a = place.location;
      const b = { lat: a.lat + CHECK_OFFSET_DEG, lng: a.lng + CHECK_OFFSET_DEG };
      const got = await this.roads.check(a, b);
      last = { ...got, near: place.name, apartKm: Math.round(haversineKm(a, b) * 10) / 10 };
      if (got.ok && !got.noRoad) return last;
    }
    return last ?? { at, ok: false, why: 'there is no place on the map to ask about yet' };
  }

  /** Places to ask about, in the order a plan would: a depot, a shop, a hub — then one known town in each country. */
  private checkPlaces(): Array<{ name: string; location: { lat: number; lng: number } }> {
    const on = (p?: { lat: number; lng: number }): p is { lat: number; lng: number } => Boolean(p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    const places: Array<{ name: string; location: { lat: number; lng: number } }> = [];
    const depot = this.managers.list().find((m) => on(m.location));
    if (depot?.location) places.push({ name: depot.companyName, location: depot.location });
    const shop = this.agents?.list().find((x) => on(x.location));
    if (shop?.location) places.push({ name: shop.shopName, location: shop.location });
    const hub = this.mdps?.list().find((x) => on(x.location));
    if (hub?.location) places.push({ name: hub.name, location: hub.location });
    const seen = new Set<string>();
    for (const town of GAZETTEER) {
      if (seen.has(town.country) || town.broad) continue;
      seen.add(town.country);
      places.push({ name: town.name, location: town.location });
    }
    return places.slice(0, CHECK_MOST_PLACES);
  }
}

/** The most places one check asks about: the network's own three, and a town in each country after them. */
export const CHECK_MOST_PLACES = 7;

/** How far from the depot the second place is, each way: about a kilometre and a half apart in all. */
export const CHECK_OFFSET_DEG = 0.01;
