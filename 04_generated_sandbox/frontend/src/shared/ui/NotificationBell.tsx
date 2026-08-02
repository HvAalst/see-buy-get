import { useState } from 'preact/hooks';
import type { NotificationsApi } from '../../lib/sbg';
import { usePush } from '../usePush';
import { Button } from './Button';
import { Icon } from './Icon';
import { Note } from './ErrorNote';
import { Sheet } from './Sheet';

export interface NotificationBellProps {
  /** The signed-in app's notifications API. Null while signed out — the bell then stays inert. */
  api: NotificationsApi | null;
}

/**
 * The notifications control that lives in the TopBar's `end` slot (N1b). A bell opens a sheet that
 * turns real Web Push on for THIS device, sends a test, or turns it off — the same self-contained
 * control across every app, so the spine is proven per persona without each app growing its own state.
 *
 * Design contract: exactly one solid-blue CTA per sheet state — "Turn on" when off, "Send a test" when
 * on; everything else is an outline/link. (N2 grows this sheet into the full in-app notification centre.)
 */
export function NotificationBell({ api }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const push = usePush(api);
  const on = push.state === 'on';

  return (
    <>
      <button type="button" class="topbar__lead" onClick={() => setOpen(true)} aria-label="Notifications" title="Notifications">
        <Icon name="bell" size={24} />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Notifications">
        {push.flash ? <Note tone={push.flash.tone} title={push.flash.text} /> : null}

        {push.state === 'loading' ? (
          <p class="hint">Checking…</p>
        ) : push.state === 'unsupported' ? (
          <Note tone="info" icon="warning" title="Not available on this device" detail="This device can’t show push notifications." />
        ) : push.state === 'denied' ? (
          <Note
            tone="warn"
            icon="lock"
            title="Notifications are blocked"
            detail="Turn them on for this app in your browser settings, then come back."
          />
        ) : on ? (
          <>
            <Note
              tone="ok"
              icon="bell"
              title="Notifications are on"
              detail="You’ll hear about your parcels and work on this device — even when the app is closed."
            />
            <Button chevron={false} busy={push.busy === 'test'} disabled={push.busy !== null} onClick={() => void push.test()}>
              Send a test
            </Button>
            <Button variant="link" busy={push.busy === 'disable'} onClick={() => void push.disable()}>
              Turn off on this device
            </Button>
          </>
        ) : (
          <>
            <p class="scr__lede">
              Get told the moment something needs you — a parcel arrives, a load is near, a bus is inbound — right on your
              screen, even when the app is closed.
            </p>
            <Button chevron={false} busy={push.busy === 'enable'} disabled={push.busy !== null} onClick={() => void push.enable()}>
              Turn on notifications
            </Button>
          </>
        )}
      </Sheet>
    </>
  );
}
