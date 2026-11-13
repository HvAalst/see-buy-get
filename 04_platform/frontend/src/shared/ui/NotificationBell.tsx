import { useEffect, useState } from 'preact/hooks';
import { setIconCount } from '../appBadge';
import type { NotificationsApi } from '../../lib/sbg';
import { useT, type Translate } from '../i18n';
import { followLink, linkLeadsTo } from '../launch';
import { usePush } from '../usePush';
import { useLiveTick } from '../useLiveTick';
import { whenLine, type InboxItem } from '../push';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Note } from './ErrorNote';
import { Sheet } from './Sheet';

export interface NotificationBellProps {
  /** The signed-in app's notifications API. Null while signed out — the bell then stays inert. */
  api: NotificationsApi | null;
  /**
   * AN INBOX SEVERAL PEOPLE SHARE — a business's, read by whoever of its people is signed in. Three things differ, and
   * the server holds all three: nothing is sent to a device (so the device controls are not offered), a notice one of
   * them has read is read and says by whom, and `canMark: false` is somebody who reads and changes nothing (a
   * viewer) — a notice opens for them and stays unread for the people who can act on it.
   */
  shared?: { canMark: boolean };
}

/** Icon per notification kind (typed set — never an emoji). Unknown kinds fall back to the bell. */
const KIND_ICON: Record<string, IconName> = {
  parcel_ready: 'box',
  // 2026-11-05 — a store's order collected: how was it? (the two-tap rating)
  store_rate: 'star',
  load_nearby: 'truck',
  load_cancelled: 'truck',
  freight_problem: 'truck',
  claim_decided: 'check',
  // Their country was lowered: what stops there for them, and what does not.
  country_changed: 'pin',
  // Round 39 — where they work was rated for a threat: seals, and no night running, when it is high.
  risk_rated: 'warning',
  bus_inbound: 'bag',
  // Reading B — a store's parcels handed in at a hub: taken in, or some not there.
  hub_arrival: 'truck',
  intake_expected: 'box',
  bag_ready_to_close: 'bag',
  // 2026-11-02 — a bag held for room at its hub, or let go on; a hub's day of sorting full.
  hub_space: 'bag',
  hub_fees: 'wallet',
  trip: 'truck',
  // 2026-11-05 — pre-drop-off: the time left on a booking's place at its shop; a shop asked to make room.
  drop_off_hold: 'clock',
  shelf_full: 'box',
  // 2026-11-06 — a shop's corner for closed bags has filled.
  bag_room: 'bag',
  // 2026-11-06 — a hub told which parcels can no longer be ready in time: sort them first.
  sort_first: 'clock',
  pickup_ahead: 'truck',
  message: 'send',
  test: 'bell',
  // FP4 — papers and their dates. Without these a licence about to stop somebody working arrived under the
  // same bell as everything else; the fallback is still the bell, so a kind added on the server is never a blank.
  // A driver's hours, said by the clock: the last hour, the limit, the rest that is over.
  shift_hours: 'clock',
  papers_due: 'clock',
  papers_lapsed: 'block',
  papers_checked: 'check',
  // A day on the driver's roster changed: put on it, or taken off.
  driver_roster: 'clock',
  // A parcel past the time it was promised, still on its way.
  parcel_late: 'clock',
  // 2026-11-13 — a parcel weighed later at a hub, unlike what its sender said.
  parcel_weight: 'weight',
  // 2026-11-06 — a parcel its people were told was held up, on the road again.
  parcel_moving: 'truck',
  // 2026-11-06 — its pickup shop closed: choose another; it went to another; a shop found shut by a driver.
  parcel_choose_shop: 'home',
  parcel_shop_changed: 'home',
  parcel_shop_closed: 'home',
  parcel_shop_open: 'home',
  shop_found_shut: 'warning',
  // 2026-11-09 — SeeBuyGet gave a shop's collection point or a hub its GS1 location number.
  place_gln: 'home',
  // A defect on a vehicle: reported to the office, decided to the driver.
  vehicle_defect: 'warning',
  vehicle_service: 'warning',
  vehicle_breakdown: 'warning',
  // A courier near you broke down with bags to take on.
  takeover_nearby: 'truck',
  // A vehicle on a shift standing still longer than its fleet allows, away from any reason to.
  vehicle_standstill: 'clock',
  // A phone on a shift that has said nothing longer than its fleet allows.
  vehicle_silent: 'offline',
  // Two businesses say one GS1 prefix is theirs: to the one using it, and both when staff decide.
  gs1_dispute: 'warning',
  // A driver sent their fleet's office the renewed licence: a card to read.
  papers_sent: 'badge',
  /** A payment the shop made was confirmed by the provider — or came back. */
  money_in: 'wallet',
  box_due: 'clock',
  signup_incomplete: 'edit',
  signup_rejected: 'warning',
  load_assigned: 'truck',
  load_instructions: 'edit',
  // A run's two parties, told about each other at last: space sold and a claim for the fleet; the carrier's
  // answer for the shipper.
  space_sold: 'truck',
  claim_opened: 'warning',
  claim_answered: 'check',
  freight_delivered: 'check',
  // A business's own system stopped taking our messages about its loads.
  system_down: 'warning',
  // A version of the API its own system calls is stopping, with a year's notice and again a month before.
  api_version: 'clock',
  // 2026-11-03 — a new rule inside a version of the API, announced ahead and said again before it refuses.
  api_rule: 'clock',
  // A business's parcel waits at the shop for money for its last leg to the business's door.
  parcel_door_short: 'wallet',
  // Somebody joined or left a fleet's roster — whoever did not do it is told.
  roster_changed: 'person',
  // A fleet offered this driver a place (or took the offer back): theirs alone to answer.
  fleet_offer: 'truck',
  // The office chose their vehicle for today; the shift is still theirs to start.
  vehicle_today: 'truck',
  // P4 — orders offered, taken, left or given back between a fleet and its partners.
  order_handed_on: 'truck',
  order_split: 'truck',
  // The carrier's plan has an order outside the window its shipper asked for — or inside it after all.
  order_window: 'clock',
  // The carrier's accepted plan leaves an order on no vehicle: the one of these to act on today.
  order_left_out: 'warning',
  // A load that should have arrived and has not: its planned hour has passed, or its whole day.
  order_late: 'clock',
  // Five wrong PINs locked the way they sign in — somebody may know their number.
  security: 'lock',
  // A new version of the terms of use, the data notice or the cookie statement (2026-10-25): what changed, read there.
  terms_updated: 'scale',
  // 2026-11-02 — the bell's first notice: what arrives here, and the way to the app's guide.
  welcome: 'star',
};

/**
 * AN ACT ON A NOTICE (2026-10-30: a haulier asked for a contract records one from the notice itself): an app says, for a
 * notice of a kind it knows, what can be done about it. Since 2026-11-02 a tap on the notice takes it (the owner: "we
 * must reduce the tapping, so that's why it should open"); the bell closes when it is taken.
 */
export type NoticeAct = (item: InboxItem) => { label: string; run: () => void } | null;

/** What moves the bell in an app that listens: its own name, and nothing else. */
const BELL_ONLY = ['bell'] as const;

/** Notices whose link is a public page to read — the terms, the data notice, cookies — offered as a link under it. */
const READ_THERE = new Set(['terms_updated']);

/**
 * Where a notice points. Its own link — and a chat message sent before message notices carried one (2026-11-02) still
 * names its conversation, so it is answered in the same place.
 */
export function noticeLink(item: InboxItem): string | undefined {
  const conversation = item.data?.conversationId;
  if (item.kind === 'message' && !item.link?.includes('chat=') && typeof conversation === 'string') return `/?chat=${encodeURIComponent(conversation)}`;
  return item.link;
}

/** The one thing a notice's row offers to do about it: something to run, or a page outside the app to read. */
export type NoticeAction = { label: string; run: () => void; href?: undefined } | { label: string; href: string; run?: undefined };

/**
 * 2026-11-02 — WHAT A NOTICE'S ROW OFFERS, besides "Mark as read" (the owner: "a 'mark as read' or 'respond' button").
 * At most one, said by what it does:
 *   - the app's own act on a notice of a kind it knows (the fleet records the contract a business asked for);
 *   - "Read it" for a new version of a text everybody agreed to: the page itself, outside the app;
 *   - "Reply" where the link is a chat, "Open" where it is a place in this app — a screen, a parcel, an offer: taken
 *     there the way a tapped notification takes the person there (shared/launch.ts, followLink);
 *   - nothing where the link is the app's home, where the bell already is, or a place this app does not have.
 */
export function noticeAction(item: InboxItem, act: NoticeAct | undefined, t: Translate): NoticeAction | null {
  const own = act?.(item);
  if (own) return own;
  if (READ_THERE.has(item.kind) && item.link?.startsWith('/')) return { label: t('notify.readIt'), href: item.link };
  const link = noticeLink(item);
  const leads = linkLeadsTo(link);
  if (!leads) return null;
  // The welcome's way to the guide is said as the guide's own name, where it is kept in the app's menu.
  const label = leads === 'chat' ? t('notify.reply') : leads === 'guide' ? t('install.menu') : t('notify.open');
  return { label, run: () => void followLink(link) };
}

/**
 * The notification centre (N2b), living in the TopBar's `end` slot. The bell carries an unread badge;
 * tapping it opens a sheet that shows the inbox (history + unread) AND the Web Push controls (turn on /
 * send a test / turn off). One self-contained control across every app, so the spine is proven per
 * persona without each app growing its own state.
 *
 * Design contract: at most one solid-blue CTA per sheet — "Turn on notifications" when push is off;
 * none when it is on (the inbox is the focus; test/turn-off are links). The buttons under each notice (Mark as read,
 * Show all) are links as well: a list of solid buttons would be a list with no focus (2026-11-02). A notice that leads
 * somewhere is itself the button: one tap opens it (2026-11-02).
 */
export function NotificationBell({ api, shared, act }: NotificationBellProps & { act?: NoticeAct }) {
  const canMark = shared?.canMark ?? true;
  const [open, setOpen] = useState(false);
  // The notices opened in full, by id: kept by the sheet, so marking one read from its row leaves it as it was.
  const [opened, setOpened] = useState<string[]>([]);
  const push = usePush(api);
  // ONE LIVE VIEW: in an app that listens (a fleet office), a notice arriving or read elsewhere moves the badge now.
  const bellTick = useLiveTick(BELL_ONLY);
  useEffect(() => {
    if (bellTick) void push.loadInbox();
    // Only when told: loading on opening is usePush's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bellTick]);
  // 2026-11-02 — the count on the app's icon follows the bell's (shared/appBadge.ts); gone when signed out.
  useEffect(() => {
    setIconCount(push.unread);
  }, [push.unread]);
  useEffect(() => () => setIconCount(0), []);

  const openSheet = () => {
    setOpen(true);
    void push.loadInbox(); // refresh on open so the list is current
  };

  return (
    <>
      <span class="nbell">
        <button type="button" class="topbar__lead" onClick={openSheet} aria-label={`Notifications${push.unread ? `, ${push.unread} unread` : ''}`} title="Notifications">
          <Icon name="bell" size={24} />
        </button>
        {push.unread > 0 ? (
          <span class="nbell__badge" aria-hidden="true">
            {push.unread > 9 ? '9+' : push.unread}
          </span>
        ) : null}
      </span>

      <Sheet open={open} onClose={() => setOpen(false)} title="Notifications">
        {push.flash ? <Note tone={push.flash.tone} title={push.flash.text} /> : null}

        {shared ? (
          <p class="hint nlist__shared">
            {canMark
              ? 'This is the business’s inbox: everybody in it reads the same one. A notice one of you has read is read.'
              : 'This is the business’s inbox. You can read it; a notice stays unread until somebody who can act on it has read it.'}
          </p>
        ) : (
          <PushControls push={push} />
        )}

        <div class="nlist">
          <div class="nlist__head">
            <span class="nlist__title">Recent</span>
            {push.unread > 0 && canMark ? (
              <button type="button" class="nlist__all" onClick={() => void push.markAllRead()}>
                Mark all read
              </button>
            ) : null}
          </div>

          {/* Prefer showing what we HAVE. A failed refresh-on-open keeps the cached items in state, so
              render them (and stay consistent with the badge) rather than replacing a real list with an
              error. The error Note appears only when there is genuinely nothing cached to show. */}
          {push.items.length > 0 ? (
            <ul class="nlist__items">
              {push.items.map((it) => (
                <NotificationRow
                  key={it.id}
                  item={it}
                  open={opened.includes(it.id)}
                  onToggle={() => setOpened((ids) => (ids.includes(it.id) ? ids.filter((x) => x !== it.id) : [...ids, it.id]))}
                  onRead={canMark ? () => void push.markRead(it.id) : undefined}
                  act={act}
                  onActed={() => setOpen(false)}
                />
              ))}
            </ul>
          ) : push.inboxState === 'loading' ? (
            <p class="hint">Loading…</p>
          ) : push.inboxState === 'error' ? (
            <Note tone="warn" icon="warning" title="Couldn’t load your notifications" detail="Try again in a moment." />
          ) : (
            <p class="hint">No notifications yet.</p>
          )}
        </div>
      </Sheet>
    </>
  );
}

/** The compact push-opt-in section at the top of the sheet — state-dependent, at most one blue CTA. */
function PushControls({ push }: { push: ReturnType<typeof usePush> }) {
  if (push.state === 'loading') return null;
  if (push.state === 'unsupported') {
    return <Note tone="info" icon="warning" title="Push not available on this device" detail="This device can’t show push notifications." />;
  }
  if (push.state === 'denied') {
    return <Note tone="warn" icon="lock" title="Notifications are blocked" detail="Turn them on for this app in your browser settings, then come back." />;
  }
  if (push.state === 'on') {
    return (
      <div class="npush">
        <span class="npush__on">
          <Icon name="bell" size={18} /> On for this device
        </span>
        <span class="npush__acts">
          <button type="button" class="npush__link" disabled={push.busy !== null} onClick={() => void push.test()}>
            Send a test
          </button>
          <button type="button" class="npush__link" disabled={push.busy !== null} onClick={() => void push.disable()}>
            Turn off
          </button>
        </span>
      </div>
    );
  }
  // prompt
  return (
    <div class="npush npush--off">
      {/* One line: the sheet was opened to READ what is waiting, and three lines of why pushed it under
          the fold on a phone. */}
      <p class="npush__lede">Get told when something needs you, even when the app is closed.</p>
      <Button chevron={false} busy={push.busy === 'enable'} disabled={push.busy !== null} onClick={() => void push.enable()}>
        Turn on notifications
      </Button>
    </div>
  );
}

export interface NotificationRowProps {
  item: InboxItem;
  /** Opened in full. */
  open: boolean;
  onToggle: () => void;
  /** Marks this one read — absent for somebody who only reads a shared inbox. */
  onRead?: () => void;
  act?: NoticeAct;
  /** Something was done about it: the bell closes. */
  onActed?: () => void;
}

/**
 * One notification: what it is, the first two lines of what it says, and when. Pressing it opens that one
 * in full — and marks it read, which pressing it always did (not for somebody who only reads a shared inbox). Five-line bodies meant one notification per
 * phone screen and the next one cut in half by the bottom of the sheet.
 *
 * 2026-11-02 — AND UNDER IT, ITS OWN BUTTONS (the owner: "on the notifications on the start screen I need a 'mark as
 * read' or 'respond' button, is that possible?"): "Mark as read" while it is unread, which marks that one and opens
 * nothing.
 *
 * 2026-11-02 — ONE TAP, AND IT OPENS (the owner: "yes, just to keep drivers' safety in mind, we must reduce the tapping,
 * so that's why it should open"): a notice with somewhere to go (noticeAction) is one big target — the whole row — and
 * a tap opens that place at once, marks it read and closes the bell, as a tapped notification on the phone does. The
 * row says where it goes ("Reply ›", "Open ›"). A notice with nowhere to go opens in full on a tap, as before; one with
 * a place and more to say than two lines hold offers "Show all" under it, so nothing it says is out of reach.
 */
export function NotificationRow({ item, open, onToggle, onRead, act, onActed }: NotificationRowProps) {
  const t = useT();
  const unread = !item.readAt;
  const action = noticeAction(item, act, t);
  const markRead = unread && onRead ? onRead : undefined;
  const long = item.body.length > LONG_BODY;
  const cls = `nitem${unread ? ' nitem--unread' : ''}${open ? ' nitem--open' : ''}`;
  const inner = (
    <>
      <span class="nitem__ic">
        <Icon name={KIND_ICON[item.kind] ?? 'bell'} size={22} />
      </span>
      <span class="nitem__body">
        <span class="nitem__t">{item.title}</span>
        <span class="nitem__b">{item.body}</span>
        <span class="nitem__time">{whenLine(item)}</span>
        {/* Where the tap goes, said on the row it is a tap on. */}
        {action ? (
          <span class="nitem__go">
            {action.label}
            <Icon name="chevronRight" size={16} />
          </span>
        ) : null}
      </span>
      {unread ? <span class="nitem__dot" aria-label="unread" /> : null}
    </>
  );
  return (
    <li class={`nrow${unread ? ' nrow--unread' : ''}`}>
      {action?.href !== undefined ? (
        // The page itself, outside the app: read in a tab of its own, the app left where it was — and that is reading it.
        <a class={cls} href={action.href} target="_blank" rel="noopener noreferrer" onClick={() => (unread ? onRead?.() : undefined)}>
          {inner}
        </a>
      ) : action ? (
        <button
          type="button"
          class={cls}
          onClick={() => {
            // Doing what it asks is reading it.
            if (unread) onRead?.();
            action.run();
            onActed?.();
          }}
        >
          {inner}
        </button>
      ) : (
        <button
          type="button"
          class={cls}
          aria-expanded={open}
          onClick={() => {
            onToggle();
            if (unread) onRead?.();
          }}
        >
          {inner}
        </button>
      )}
      {markRead || (action && long) ? (
        <div class="nitem__acts">
          {action && long ? (
            <button
              type="button"
              class="nitem__act"
              aria-expanded={open}
              onClick={() => {
                onToggle();
                if (unread) onRead?.();
              }}
            >
              {t(open ? 'notify.showLess' : 'notify.showAll')}
            </button>
          ) : null}
          {markRead ? (
            <button type="button" class="nitem__act" aria-label={`${t('notify.markRead')}: ${item.title}`} onClick={markRead}>
              {t('notify.markRead')}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** About what two lines of a notice hold on a phone: more than this, and a notice with a place offers "Show all". */
const LONG_BODY = 90;
