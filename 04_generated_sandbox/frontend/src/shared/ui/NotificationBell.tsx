import { useState } from 'preact/hooks';
import type { NotificationsApi } from '../../lib/sbg';
import { usePush } from '../usePush';
import { relativeTime, type InboxItem } from '../push';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Note } from './ErrorNote';
import { Sheet } from './Sheet';

export interface NotificationBellProps {
  /** The signed-in app's notifications API. Null while signed out — the bell then stays inert. */
  api: NotificationsApi | null;
}

/** Icon per notification kind (typed set — never an emoji). Unknown kinds fall back to the bell. */
const KIND_ICON: Record<string, IconName> = {
  parcel_ready: 'box',
  load_nearby: 'truck',
  load_cancelled: 'truck',
  bus_inbound: 'bag',
  intake_expected: 'box',
  bag_ready_to_close: 'bag',
  message: 'send',
  test: 'bell',
};

/**
 * The notification centre (N2b), living in the TopBar's `end` slot. The bell carries an unread badge;
 * tapping it opens a sheet that shows the inbox (history + unread) AND the Web Push controls (turn on /
 * send a test / turn off). One self-contained control across every app, so the spine is proven per
 * persona without each app growing its own state.
 *
 * Design contract: at most one solid-blue CTA per sheet — "Turn on notifications" when push is off;
 * none when it is on (the inbox is the focus; test/turn-off are links).
 */
export function NotificationBell({ api }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const push = usePush(api);

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

        <PushControls push={push} />

        <div class="nlist">
          <div class="nlist__head">
            <span class="nlist__title">Recent</span>
            {push.unread > 0 ? (
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
                <NotificationRow key={it.id} item={it} onRead={() => void push.markRead(it.id)} />
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
      <p class="npush__lede">Get told the moment something needs you — a parcel arrives, a load is near — right on your screen, even when the app is closed.</p>
      <Button chevron={false} busy={push.busy === 'enable'} disabled={push.busy !== null} onClick={() => void push.enable()}>
        Turn on notifications
      </Button>
    </div>
  );
}

function NotificationRow({ item, onRead }: { item: InboxItem; onRead: () => void }) {
  const unread = !item.readAt;
  return (
    <li>
      <button type="button" class={`nitem${unread ? ' nitem--unread' : ''}`} onClick={onRead}>
        <span class="nitem__ic">
          <Icon name={KIND_ICON[item.kind] ?? 'bell'} size={22} />
        </span>
        <span class="nitem__body">
          <span class="nitem__t">{item.title}</span>
          <span class="nitem__b">{item.body}</span>
          <span class="nitem__time">{relativeTime(item.createdAt)}</span>
        </span>
        {unread ? <span class="nitem__dot" aria-label="unread" /> : null}
      </button>
    </li>
  );
}
