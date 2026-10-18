import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../foundation/auth/public.decorator';
import { Scopes } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { actingDid } from '../../foundation/auth/acting';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { GlosError } from '../../foundation/http/glos-error';
import { BusinessMemberGuard } from './business-member.guard';
import { NotificationService } from './notification.service';
import { SubscribeDto, UnsubscribeDto } from './notification.dto';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';

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
 *
 * A BUSINESS SIGN-IN READS ITS BUSINESS'S INBOX. The token acts as the business, so the inbox is the business's and
 * its people share it: what one of them has read is read. Two things follow, and both are decided here rather than on
 * a screen. Whether the person is still in the business is asked on every request (the member guard), so somebody
 * taken out reads nothing more; and a viewer, who changes nothing, cannot mark a notice read for the others. And a
 * business is given NO DEVICE: see `noDeviceFor`.
 */
@Controller('sbg/notifications')
@UseGuards(BusinessMemberGuard)
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
  @AtTheCounter()
  subscribe(@Body() dto: SubscribeDto, @Actor() actor: IntrospectionResult) {
    this.noDeviceFor(actor);
    const record = this.notifications.subscribe(actingDid(actor), actor.role ?? 'anon', {
      endpoint: dto.endpoint,
      keys: dto.keys,
    });
    return { subscribed: true, createdAt: record.createdAt };
  }

  /** Drop this device (the browser unsubscribed, or the user turned notifications off). */
  @Scopes('notification:manage:self')
  @Delete('subscribe')
  @AtTheCounter()
  unsubscribe(@Body() dto: UnsubscribeDto, @Actor() actor: IntrospectionResult) {
    this.notifications.unsubscribe(actingDid(actor), dto.endpoint);
    return { unsubscribed: true };
  }

  /** Send a test push to every device the owner has enrolled — the "it works" confirmation after opt-in. */
  @Scopes('notification:manage:self')
  @Post('test')
  @AtTheCounter()
  async test(@Actor() actor: IntrospectionResult) {
    this.noDeviceFor(actor);
    const devices = await this.notifications.pushToOwner(actingDid(actor), {
      kind: 'test',
      title: 'Notifications are on',
      // Every app shares this route — a courier hears about loads and a fleet office about its runs, so the
      // test names no particular thing it will be about. It used to promise "your parcels" to all of them.
      body: 'This is a test from SeeBuyGet — this is where we will tell you when something needs you.',
      link: '/',
      tag: 'sbg-test',
    });
    return { sent: devices };
  }

  /** The caller's notification inbox (newest first) + the unread count — the in-app notification centre (N2). */
  @Scopes('notification:manage:self')
  @Get('inbox')
  @AtTheCounter()
  inbox(@Actor() actor: IntrospectionResult) {
    const did = actingDid(actor);
    return { items: this.notifications.inboxFor(did), unread: this.notifications.unreadCount(did) };
  }

  /** Mark one of the caller's notifications read. Ownership-guarded in the service. */
  @Scopes('notification:manage:self')
  @Post('inbox/:id/read')
  @AtTheCounter()
  markRead(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.notifications.markRead(actingDid(actor), id, readerOf(actor));
    return { ok: true };
  }

  /** Mark all of the caller's notifications read (clears the bell badge). */
  @Scopes('notification:manage:self')
  @Post('inbox/read-all')
  @AtTheCounter()
  markAllRead(@Actor() actor: IntrospectionResult) {
    this.notifications.markAllRead(actingDid(actor), readerOf(actor));
    return { ok: true };
  }

  /**
   * A BUSINESS'S NOTICES ARE READ IN THE APP, never sent to a device. A device enrolled under the business would go on
   * receiving them after its owner was taken out of the business, and — on a desk an office shares — after they had
   * signed out: nothing asks the member guard when a push leaves. Refused on the act, with the reason.
   */
  private noDeviceFor(actor: IntrospectionResult): void {
    if (actor?.role === 'business') throw new GlosError('FORBIDDEN', 'A business’s notices are read in the Business app, by its own people. They are not sent to a device.');
  }
}

/** An inbox several people share says who read a notice. A person's own inbox has nobody else to name. */
function readerOf(actor: IntrospectionResult): string | undefined {
  return actor?.role === 'business' ? actor.actorName : undefined;
}
