import { useEffect, useState } from 'preact/hooks';
import type { NotificationsApi } from '../../lib/sbg';
import { useT } from '../i18n';
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
};

/** What moves the bell in an app that listens: its own name, and nothing else. */
const BELL_ONLY = ['bell'] as const;

/** Notices whose link is a public page to read — the terms, the data notice, cookies — offered as a link once opened. */
const READ_THERE = new Set(['terms_updated']);

/**
 * The notification centre (N2b), living in the TopBar's `end` slot. The bell carries an unread badge;
 * tapping it opens a sheet that shows the inbox (history + unread) AND the Web Push controls (turn on /
 * send a test / turn off). One self-contained control across every app, so the spine is proven per
 * persona without each app growing its own state.
 *
 * Design contract: at most one solid-blue CTA per sheet — "Turn on notifications" when push is off;
 * none when it is on (the inbox is the focus; test/turn-off are links).
 */
export function NotificationBell({ api, shared }: NotificationBellProps) {
  const canMark = shared?.canMark ?? true;
  const [open, setOpen] = useState(false);
  const push = usePush(api);
  // ONE LIVE VIEW: in an app that listens (a fleet office), a notice arriving or read elsewhere moves the badge now.
  const bellTick = useLiveTick(BELL_ONLY);
  useEffect(() => {
    if (bellTick) void push.loadInbox();
    // Only when told: loading on opening is usePush's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bellTick]);

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
                <NotificationRow key={it.id} item={it} onRead={canMark ? () => void push.markRead(it.id) : undefined} />
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

/**
 * One notification: what it is, the first two lines of what it says, and when. Pressing it opens that one
 * in full — and marks it read, which pressing it always did (not for somebody who only reads a shared inbox). Five-line bodies meant one notification per
 * phone screen and the next one cut in half by the bottom of the sheet.
 */
function NotificationRow({ item, onRead }: { item: InboxItem; onRead?: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const unread = !item.readAt;
  const readThere = open && READ_THERE.has(item.kind) && item.link?.startsWith('/') ? item.link : null;
  return (
    <li>
      <button
        type="button"
        class={`nitem${unread ? ' nitem--unread' : ''}${open ? ' nitem--open' : ''}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((was) => !was);
          if (unread) onRead?.();
        }}
      >
        <span class="nitem__ic">
          <Icon name={KIND_ICON[item.kind] ?? 'bell'} size={22} />
        </span>
        <span class="nitem__body">
          <span class="nitem__t">{item.title}</span>
          <span class="nitem__b">{item.body}</span>
          <span class="nitem__time">{whenLine(item)}</span>
        </span>
        {unread ? <span class="nitem__dot" aria-label="unread" /> : null}
      </button>
      {readThere ? (
        <a class="nitem__more" href={readThere} target="_blank" rel="noopener noreferrer">
          {t('notify.readIt')}
        </a>
      ) : null}
    </li>
  );
}
