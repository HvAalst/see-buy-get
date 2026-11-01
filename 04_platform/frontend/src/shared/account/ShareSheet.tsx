import { useEffect, useState } from 'preact/hooks';
import { narrow } from '../../lib/sbg';
import { useT, type MessageKey } from '../i18n';
import { Button, Note, Sheet } from '../ui';
import { canPickContact, channelsFor, countryOfLocale, openChannel, pickContacts, type PickedContact, type ShareChannel } from '../device';
import type { AccountApi } from './useAccount';

/** The link a shared invite carries: the front page, where every kind of sign-up starts — with the inviter's token. */
export function inviteUrl(origin: string, token: string | null): string {
  return token ? `${origin}/?invite=${encodeURIComponent(token)}` : `${origin}/`;
}

/** The person's reusable share link among their invites: the one made for sharing, if there is one. */
export function shareTokenOf(summary: { invites?: Array<{ token: string; channels?: string[] }> } | null): string | null {
  return summary?.invites?.find((i) => i.channels?.includes('share'))?.token ?? null;
}

/**
 * How a picked contact is messaged straight, by number: WhatsApp where it leads (it opens a chat with a number), a text
 * message where Telegram or WeChat lead — neither opens a chat with a number from outside.
 */
export function directChannel(channels: ShareChannel[]): 'whatsapp' | 'sms' {
  return channels[0] === 'whatsapp' ? 'whatsapp' : 'sms';
}

/**
 * 2026-11-01 — SHARE SEEBUYGET, from every app's settings (the owner: "share sbg would open the contact list on mobile,
 * and create a link and a rich card that can be shared among the popular apps used in BRICS countries").
 *
 * One link per person, made once and reused: the front page with their invite token, so whoever signs up through it is
 * counted to them. The link's card (picture, title, line) is the front page's own. "Share" opens the phone's share sheet,
 * which holds the contacts and every app on the phone; the buttons below come in the order people share where the
 * person lives (Telegram first in Ethiopia, WeChat in China…), and where the phone lets a site read the address book,
 * contacts can be picked and messaged straight. The numbers never leave the phone.
 */
export function ShareSheet({ open, onClose, api }: { open: boolean; onClose: () => void; api: AccountApi }) {
  const t = useT();
  const [token, setToken] = useState<string | null>(null);
  const [joined, setJoined] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedContact[]>([]);

  useEffect(() => {
    if (!open) return;
    setNote(null);
    let live = true;
    void (async () => {
      // The link made for sharing before, or a new one — never a new token each time the sheet opens.
      const mine = narrow<{ invites?: Array<{ token: string; channels?: string[] }>; joined?: number }>((await api.myInvites()).data);
      if (!live) return;
      setJoined(mine?.joined ?? 0);
      const kept = shareTokenOf(mine);
      if (kept) return setToken(kept);
      const made = narrow<{ token?: string }>((await api.createInvite(['share'])).data);
      // No token (a sign-in with no person behind it, or the limit reached): the plain link still goes.
      if (live) setToken(made?.token ?? null);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const url = inviteUrl(globalThis.location?.origin ?? '', token);
  const name = api.account?.displayName?.trim();
  const text = name ? t('account.share.textNamed', { name }) : t('account.share.text');
  const channels = channelsFor(api.account?.addressParts?.country ?? countryOfLocale(globalThis.navigator?.language));
  const direct = directChannel(channels);
  const send = async (channel: ShareChannel, to?: PickedContact) => {
    const how = await openChannel(channel, { text, url, ...(to?.tel ? { tel: to.tel } : {}), ...(to?.email ? { email: to.email } : {}) });
    setNote(how === 'copied' ? t('account.share.copied') : how === 'failed' ? t('account.share.failed') : null);
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('account.share.title')}>
      <p class="share__lede">{t('account.share.lede')}</p>
      <div class="share__acts">
        <Button chevron={false} onClick={() => void send('system')}>
          {t('account.share.share')}
        </Button>
        {canPickContact() ? (
          <Button
            variant="outline"
            chevron={false}
            onClick={async () => {
              const chosen = await pickContacts();
              setPicked((prev) => [...prev, ...chosen.filter((c) => !prev.some((p) => (p.tel || p.name) === (c.tel || c.name)))]);
            }}
          >
            {t('account.share.pick')}
          </Button>
        ) : null}
      </div>
      {picked.length ? (
        <ul class="share__people">
          {picked.map((c) => (
            <li key={c.tel || c.name} class="share__person">
              <span class="share__who">
                <b>{c.name || c.tel}</b>
                {c.tel && c.name ? <small>{c.tel}</small> : null}
              </span>
              {c.tel || c.email ? (
                <Button variant="outline" full={false} chevron={false} onClick={() => void send(c.tel ? direct : 'email', c)}>
                  {t(`account.share.channel.${c.tel ? direct : 'email'}` as MessageKey)}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p class="share__label" id="share-with">
        {t('account.share.with')}
      </p>
      <div class="share__chips" role="group" aria-labelledby="share-with">
        {channels.map((c) => (
          <button key={c} type="button" class="chip chip--tap" onClick={() => void send(c)}>
            {t(`account.share.channel.${c}` as MessageKey)}
          </button>
        ))}
      </div>
      <p class="share__link">{t('account.share.yourLink', { url })}</p>
      {joined > 0 ? <Note tone="ok" icon="check" title={t('account.share.joined', { n: joined })} /> : null}
      {note ? (
        <p class="share__said" role="status">
          {note}
        </p>
      ) : null}
      <Button variant="link" onClick={onClose}>
        {t('common.close')}
      </Button>
    </Sheet>
  );
}
