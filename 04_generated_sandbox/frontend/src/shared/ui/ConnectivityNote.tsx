import { useConnectivity } from '../connectivity';
import { useT } from '../i18n';
import { Icon } from './Icon';

/**
 * The one line every app shows when there is no signal.
 *
 * It replaces five apps' own "no signal" banners with a single fact read from one place, so a phone that has
 * lost its network says so on whichever screen is open, dated from the last real answer the server gave. When
 * the network is back but a screen still shows what it loaded before (`stale`), it says that instead, calmly:
 * the app is already asking again.
 *
 * What it never does is stand in for an error. A tap that NEEDS a connection — signing in, paying, handing a
 * parcel over at the counter — fails with its own sentence (`error.offline_needed`); this line only explains why.
 */
export function ConnectivityNote({ stale = false }: { stale?: boolean }) {
  const t = useT();
  const c = useConnectivity();
  if (c.online && !stale) return null;
  const since = c.lastAnswerAt ? new Date(c.lastAnswerAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <p class="stale" role="status">
      <Icon name="offline" size={20} />
      <span>{!c.online ? (since ? t('common.offline.sinceBanner', { time: since }) : t('common.offline.banner')) : t('common.offline.stale')}</span>
    </p>
  );
}
