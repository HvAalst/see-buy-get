import { Body, Controller, Delete, Get, Optional, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { noticeLangOf, noticeOf, said } from './notice-words/say';
import { PartnerMemberService } from './partner-member.service';
import { ReaderLanguageService } from './reader-language.service';
import { Public } from '../../foundation/auth/public.decorator';
import { Scopes } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { actingDid } from '../../foundation/auth/acting';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { GlosError } from '../../foundation/http/glos-error';
import { BusinessMemberGuard } from './business-member.guard';
import { NotificationService } from './notification.service';
import { welcomeAppOf } from './welcome';
import { SubscribeDto, UnsubscribeDto } from './notification.dto';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';

/** 2026-11-26 — the language an app speaks, on every call it makes (frontend/src/lib/sbg/client.ts). */
export const LANG_HEADER = 'x-sbg-lang';
const LANG_DOC = { name: LANG_HEADER, required: false, description: 'The language the app speaks (en, sw, nl, am, bg): notices are said in it, where they are written in it; anything else is English.' };

/** What a call says of itself: its headers. */
type AskedIn = { headers?: Record<string, string | string[] | undefined> };

/** The language a call asks in, where notices are written in it. */
function langOf(req: AskedIn | undefined) {
  return noticeLangOf(req?.headers?.[LANG_HEADER]);
}

/**
 * 2026-11-27 — the country whose review of its language the app reads its words in (frontend lib/sbg/client.ts): that
 * country's own words for a notice's phrases are laid over version 1. Two capital letters, or nothing.
 */
export const WORDS_COUNTRY_HEADER = 'x-sbg-words-country';
const WORDS_COUNTRY_DOC = { name: WORDS_COUNTRY_HEADER, required: false, description: 'The country whose review of the language the app reads its words in (two letters, like KE): its own words for a notice’s phrases are used.' };
function wordsCountryOf(req: AskedIn | undefined): string | undefined {
  const raw = req?.headers?.[WORDS_COUNTRY_HEADER];
  const code = String((Array.isArray(raw) ? raw[0] : raw) ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : undefined;
}

/** The person behind a sign-in — a business's or a partner's member, not the company — whose language an email is written in. */
function personOf(actor: IntrospectionResult): string | undefined {
  return actor?.personDid ?? (actor?.role === 'business' || actor?.role === 'partner' || actor?.role === 'operator' ? undefined : actor?.did);
}

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
  constructor(
    private readonly notifications: NotificationService,
    // 2026-11-26 — a partner's people: whether they are still in it is asked on every request, as on its other doors.
    @Optional() private readonly partnerMembers?: PartnerMemberService,
    // 2026-11-27 — the language a person reads their app in, kept for the emails beside notices.
    @Optional() private readonly readers?: ReaderLanguageService,
  ) {}

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
  @ApiHeader(LANG_DOC)
  @ApiHeader(WORDS_COUNTRY_DOC)
  subscribe(@Body() dto: SubscribeDto, @Actor() actor: IntrospectionResult, @Req() req?: AskedIn) {
    this.noDeviceFor(actor);
    // 2026-11-26 — the app's language, which this device is pushed in; the app gives it again when its language changes.
    const record = this.notifications.subscribe(
      actingDid(actor),
      actor.role ?? 'anon',
      {
        endpoint: dto.endpoint,
        keys: dto.keys,
      },
      langOf(req),
      wordsCountryOf(req),
    );
    this.readers?.heard(personOf(actor), langOf(req), wordsCountryOf(req));
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
      // Every app shares this route — a courier hears about loads and a fleet office about its runs, so the
      // test names no particular thing it will be about. It used to promise "your parcels" to all of them.
      // 2026-11-26 — each device in its own language.
      ...noticeOf(said('bell.test.title'), said('bell.test.body')),
      link: '/',
      tag: 'sbg-test',
    });
    return { sent: devices };
  }

  /** The caller's notification inbox (newest first) + the unread count — the in-app notification centre (N2). */
  @Scopes('notification:manage:self')
  @Get('inbox')
  @AtTheCounter()
  @ApiHeader(LANG_DOC)
  @ApiHeader(WORDS_COUNTRY_DOC)
  inbox(@Actor() actor: IntrospectionResult, @Req() req?: AskedIn) {
    this.stillIn(actor);
    const did = actingDid(actor);
    // 2026-11-02 — the first read of a bell in an app — right after the first sign-in there, or a business's people's
    // next — finds its welcome: what arrives here, and the way to the app's guide. Once per inbox (welcome.ts).
    const app = welcomeAppOf(actor?.role);
    if (app) this.notifications.welcomeOnce(did, app);
    // 2026-11-26 — said in the reader's language, the app's own (x-sbg-lang): a shared inbox to each of its people in theirs.
    // 2026-11-27 — with their country's own words for the phrases; and the language kept for the emails beside notices.
    const lang = langOf(req);
    const country = wordsCountryOf(req);
    this.readers?.heard(personOf(actor), lang, country);
    return { items: this.notifications.inboxFor(did, 50, lang, country), unread: this.notifications.unreadCount(did) };
  }

  /** Mark one of the caller's notifications read. Ownership-guarded in the service. */
  @Scopes('notification:manage:self')
  @Post('inbox/:id/read')
  @AtTheCounter()
  markRead(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    this.stillIn(actor);
    this.notifications.markRead(actingDid(actor), id, readerOf(actor));
    return { ok: true };
  }

  /** Mark all of the caller's notifications read (clears the bell badge). */
  @Scopes('notification:manage:self')
  @Post('inbox/read-all')
  @AtTheCounter()
  markAllRead(@Actor() actor: IntrospectionResult) {
    this.stillIn(actor);
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
    if (actor?.role === 'partner') throw new GlosError('FORBIDDEN', 'A partner’s notices are read in the Partner app, by its own people. They are not sent to a device.');
  }

  /** 2026-11-26 — a partner's inbox is read only by a person still in it: taken out, refused on the next click. */
  private stillIn(actor: IntrospectionResult): void {
    if (actor?.role !== 'partner') return;
    if (!this.partnerMembers) throw new GlosError('FORBIDDEN', 'This needs a Partner app sign-in');
    this.partnerMembers.requireMember(actor);
  }
}

/** An inbox several people share says who read a notice. A person's own inbox has nobody else to name. */
function readerOf(actor: IntrospectionResult): string | undefined {
  return actor?.role === 'business' || actor?.role === 'partner' ? actor.actorName : undefined;
}
