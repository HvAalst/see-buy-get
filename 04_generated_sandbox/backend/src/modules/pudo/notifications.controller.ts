import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { Public } from '../../foundation/auth/public.decorator';
import { Scopes } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { actingDid } from '../../foundation/auth/acting';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { NotificationService } from './notification.service';
import { SubscribeDto, UnsubscribeDto } from './notification.dto';

/**
 * The push spine (N1). Three authenticated routes let any signed-in human enrol / drop / test the
 * devices that receive Web Push, plus one public route that hands out the VAPID public key a browser
 * needs before it can subscribe.
 *
 * Ownership binds to the VERIFIED token DID (actingDid) — a caller can only ever manage its OWN
 * subscriptions, never assert another owner from the body. Every human role carries the
 * `notification:manage:self` scope (see actor-scopes.ts), so the routes are labelled for STRICT authz.
 * The VAPID public key is @Public by design: it is the `applicationServerKey`, not a secret, and the
 * browser must read it before it holds any token at all.
 */
@Controller('sbg/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  /** The `applicationServerKey` the browser needs to build a PushSubscription. Public, not a secret. */
  @Public()
  @Get('vapid-public-key')
  vapidPublicKey() {
    return { key: this.notifications.vapidPublicKey() };
  }

  /** Enrol this device (the browser's PushSubscription) for the authenticated owner. */
  @Scopes('notification:manage:self')
  @Post('subscribe')
  subscribe(@Body() dto: SubscribeDto, @Actor() actor: IntrospectionResult) {
    const record = this.notifications.subscribe(actingDid(actor), actor.role ?? 'anon', {
      endpoint: dto.endpoint,
      keys: dto.keys,
    });
    return { subscribed: true, createdAt: record.createdAt };
  }

  /** Drop this device (the browser unsubscribed, or the user turned notifications off). */
  @Scopes('notification:manage:self')
  @Delete('subscribe')
  unsubscribe(@Body() dto: UnsubscribeDto, @Actor() actor: IntrospectionResult) {
    this.notifications.unsubscribe(actingDid(actor), dto.endpoint);
    return { unsubscribed: true };
  }

  /** Send a test push to every device the owner has enrolled — the "it works" confirmation after opt-in. */
  @Scopes('notification:manage:self')
  @Post('test')
  async test(@Actor() actor: IntrospectionResult) {
    const devices = await this.notifications.pushToOwner(actingDid(actor), {
      kind: 'test',
      title: 'Notifications are on',
      body: 'This is a test from SeeBuyGet — you will hear about your parcels here.',
      link: '/',
      tag: 'sbg-test',
    });
    return { sent: devices };
  }
}
