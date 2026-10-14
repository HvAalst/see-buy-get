import { useState } from 'preact/hooks';
import { Button } from './Button';
import { Icon } from './Icon';
import type { NotificationsApi } from '../../lib/sbg';
import { usePush } from '../usePush';

/**
 * ASKING FOR NOTIFICATIONS, WHERE SOMEBODY WILL SEE THE ASK.
 *
 * The opt-in has existed since the notification spine shipped, and it lived inside the bell's sheet —
 * which means you find it by tapping a bell to read notifications you are not getting. Every persona in
 * this network has at least one thing they are waiting on: a payment to be confirmed, a bus arriving, a
 * licence checked. Waiting is exactly the state in which somebody does not think to go looking for a
 * settings toggle.
 *
 * SO IT ASKS FIRST, AND IT ASKS IN OUR OWN WORDS BEFORE THE BROWSER'S.
 *
 * `Notification.requestPermission()` is fired from the button here and never on load. That is not
 * politeness, it is the only thing that works: a prompt with no context is refused, browsers now require
 * a user gesture, and Chrome and Firefox both punish a page that asks and is dismissed — the second ask
 * is quieter and the third may never appear at all. A permission you can only be granted once is a
 * permission you get one honest attempt at, so this card says what they would be told BEFORE the
 * irreversible bit.
 *
 * AND IT TAKES NO FOR AN ANSWER. Dismissing it is remembered per device, because a banner that returns
 * every morning is how somebody learns to block a site. It reappears only if they clear the browser's
 * storage — and the bell still holds the control for anybody who changes their mind.
 */
export interface PushPromptProps {
  api: NotificationsApi | null;
  /** Why THIS person would want them, in their own terms. One line; the card says the rest. */
  reason: string;
  title: string;
  turnOn: string;
  notNow: string;
  /** Distinguishes the dismissal per app, so turning it away in one is not turning it away in all. */
  storageKey: string;
}

const dismissed = (key: string): boolean => {
  try {
    return globalThis.localStorage?.getItem(key) === '1';
  } catch {
    // A browser with storage blocked simply gets asked again. Better than a card that cannot be dismissed.
    return false;
  }
};

export function PushPrompt({ api, reason, title, turnOn, notNow, storageKey }: PushPromptProps) {
  const push = usePush(api);
  const [hidden, setHidden] = useState(() => dismissed(storageKey));

  /*
   * Shown for exactly one state: this device COULD be told and is not. Never while the state is still
   * being read (a card that flashes on every load is its own kind of nagging), never when push is
   * already on, and never when it is blocked or unsupported — in those two the ask is not ours to make
   * and the bell's sheet says what to do instead.
   */
  if (hidden || !api || push.state !== 'prompt') return null;

  const dismiss = () => {
    try {
      globalThis.localStorage?.setItem(storageKey, '1');
    } catch {
      /* not remembering it is survivable; not honouring it now is not */
    }
    setHidden(true);
  };

  return (
    <section class="pushask">
      <span class="pushask__ic">
        <Icon name="bell" size={24} />
      </span>
      <div class="pushask__body">
        <p class="pushask__t">{title}</p>
        <p class="pushask__s">{reason}</p>
        {/* The result line the hook already produces — a refusal must not look like nothing happened. */}
        {push.flash ? <p class={`pushask__flash pushask__flash--${push.flash.tone}`}>{push.flash.text}</p> : null}
        <div class="pushask__acts">
          <Button chevron={false} full={false} busy={push.busy === 'enable'} onClick={() => void push.enable()}>
            {turnOn}
          </Button>
          <Button variant="link" full={false} onClick={dismiss}>
            {notNow}
          </Button>
        </div>
      </div>
    </section>
  );
}
