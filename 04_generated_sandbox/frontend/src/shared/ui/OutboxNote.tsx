import { useEffect, useState } from 'preact/hooks';
import { discard, onOutboxChange, outboxItems, retry, type OutboxItem } from '../outbox';
import { useT } from '../i18n';
import { Icon } from './Icon';

/**
 * What has been recorded here but not yet reached the network.
 *
 * The stale banner beside this one says a READ may be old. This says a WRITE has not left — a different
 * and more consequential thing, because the person did it, walked away, and is entitled to know it is
 * still in their pocket rather than on the record.
 *
 * Two states, and they deserve different voices. Work that is merely waiting needs no action and is
 * reported calmly; work that has been REFUSED will never send itself, so it names what the server said
 * and offers the only two honest choices — try it again, or let it go.
 */
export function OutboxNote() {
  const t = useT();
  const [items, setItems] = useState<OutboxItem[]>(() => outboxItems());
  useEffect(() => onOutboxChange(() => setItems(outboxItems())), []);

  if (items.length === 0) return null;
  const blocked = items.filter((i) => i.state === 'blocked');
  const waiting = items.length - blocked.length;

  return (
    <div class="outbox">
      {waiting > 0 ? (
        <p class="stale">
          <Icon name="offline" size={20} />
          <span>{waiting === 1 ? t('common.outbox.waitingOne') : t('common.outbox.waitingMany', { count: waiting })}</span>
        </p>
      ) : null}

      {blocked.map((item) => (
        <div key={item.id} class="outbox__stuck">
          <div class="outbox__body">
            <span class="outbox__what">{item.label}</span>
            {/* The server's own words. A generic "something went wrong" would leave a shopkeeper with a
                parcel in their hand and no idea whether to hand it over. */}
            <span class="outbox__why">{item.error ?? t('common.outbox.unknown')}</span>
          </div>
          {/* Both are past the second choice on this screen, so both are text links — the design
              contract's ladder, not an invention. Letting a custody record go is the destructive one
              and says so in red. */}
          <div class="outbox__acts">
            <button type="button" class="btn btn--link" onClick={() => retry(item.id)}>
              {t('common.outbox.retry')}
            </button>
            <button type="button" class="btn btn--link btn--danger-link" onClick={() => discard(item.id)}>
              {t('common.outbox.discard')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
