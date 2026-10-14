import { useState } from 'preact/hooks';
import { Button, Note, Pill, Sheet } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { canPickContact, type PickedContact, type ShareChannel } from '../../../shared/device';
import type { SendActions, SendState } from '../useSendApp';

export interface InviteSheetProps {
  open: boolean;
  onClose: () => void;
  state: SendState;
  actions: SendActions;
}

const CHANNELS: { key: ShareChannel; labelKey: MessageKey }[] = [
  { key: 'whatsapp', labelKey: 'send.invite.channelWhatsapp' },
  { key: 'sms', labelKey: 'send.invite.channelSms' },
  { key: 'email', labelKey: 'send.invite.channelEmail' },
  { key: 'telegram', labelKey: 'send.invite.channelTelegram' },
  { key: 'copy', labelKey: 'send.invite.channelCopy' },
  { key: 'system', labelKey: 'send.invite.channelSystem' },
];

/**
 * Invite friends (S28) — the low-friction, contact-picker flow ("paste a link is for pros"). Pick from
 * the address book (or add a friend), choose how to send, tap Send → it mints a per-contact link, maps it
 * to that contact ON THIS DEVICE, and opens the channel straight to them. The server only ever sees an
 * opaque token, so nothing leaks; the "pending → joined" list is read back from the token's join count.
 */
export function InviteSheet({ open, onClose, state, actions }: InviteSheetProps) {
  const t = useT();
  const [staged, setStaged] = useState<PickedContact[]>([]);
  const [channel, setChannel] = useState<ShareChannel>('whatsapp');
  const [mName, setMName] = useState('');
  const [mTel, setMTel] = useState('');

  const joinedTokens = new Set((state.invites?.invites ?? []).filter((i) => i.joined > 0).map((i) => i.token));
  // "Sent" only once the channel actually opened (delivered !== false); a failed open shows Send to retry.
  const alreadySent = (c: PickedContact) =>
    state.inviteMap.some((e) => e.delivered !== false && ((c.tel && e.tel === c.tel) || (!c.tel && c.name && e.name === c.name)));

  const pick = async () => {
    const picked = await actions.pickInviteContacts();
    setStaged((prev) => {
      const seen = new Set(prev.map((p) => p.tel || p.name));
      return [...prev, ...picked.filter((p) => !seen.has(p.tel || p.name))];
    });
  };
  const addManual = () => {
    if (!mName.trim() && !mTel.trim()) return;
    setStaged((prev) => [...prev, { name: mName.trim(), tel: mTel.trim() }]);
    setMName('');
    setMTel('');
  };

  const joinedCount = state.invites?.joined ?? 0;

  return (
    <Sheet open={open} onClose={onClose} title={t('send.invite.title')}>
      <p class="hint">{t('send.invite.intro')}</p>

      <div class="field" style="margin-top:14px">
        <span class="field__label">{t('send.invite.addFriends')}</span>
        {canPickContact() ? (
          <Button variant="outline" chevron={false} onClick={() => void pick()}>{t('send.invite.pickContacts')}</Button>
        ) : (
          <p class="hint">{t('send.invite.contactsHint')}</p>
        )}
        <div class="grid2" style="margin-top:8px">
          <input class="input" value={mName} onInput={(e) => setMName(e.currentTarget.value)} placeholder={t('send.invite.namePh')} aria-label={t('send.invite.friendName')} />
          <input class="input" value={mTel} onInput={(e) => setMTel(e.currentTarget.value)} placeholder={t('send.invite.numberPh')} inputMode="tel" aria-label={t('send.invite.friendNumber')} />
        </div>
        <Button variant="link" onClick={addManual}>{t('send.invite.addFriend')}</Button>
      </div>

      <div class="field" style="margin-top:8px">
        <span class="field__label">{t('send.invite.sendWith')}</span>
        <div class="chips" role="group" aria-label={t('send.invite.howToSend')}>
          {CHANNELS.map((c) => (
            <button key={c.key} type="button" class={`chip${channel === c.key ? ' chip--on' : ''}`} aria-pressed={channel === c.key} onClick={() => setChannel(c.key)}>
              {t(c.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {staged.length ? (
        <div class="rows" style="margin-top:14px" role="list">
          {staged.map((c) => (
            <div key={c.tel || c.name} class="row row--static" role="listitem">
              <span class="row__body">
                <span class="row__t">{c.name || c.tel}</span>
                {c.tel && c.name ? <span class="row__s">{c.tel}</span> : null}
              </span>
              <span class="row__end">
                {alreadySent(c) ? (
                  <Pill tone="ok" dot>{t('send.invite.sent')}</Pill>
                ) : (
                  <Button
                    variant="outline"
                    full={false}
                    busy={state.inviteSending === (c.tel || c.name || 'link')}
                    disabled={Boolean(state.inviteSending)} /* single-flight: no concurrent sends racing the map */
                    onClick={() => void actions.inviteContact(c, channel)}
                  >
                    {t('send.invite.send')}
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p class="hint" style="margin-top:10px">{t('send.invite.emptyHint')}</p>
      )}

      {state.inviteNote ? <Note tone="info" icon="check" title={state.inviteNote} /> : null}

      {state.inviteMap.length ? (
        <div style="margin-top:18px">
          <h3 class="scr__section">{t('send.invite.yourInvites')}</h3>
          <div class="rows" role="list">
            {state.inviteMap.map((e) => (
              <div key={e.token} class="row row--static" role="listitem">
                <span class="row__body"><span class="row__t">{e.name}</span></span>
                <span class="row__end">
                  {joinedTokens.has(e.token) ? <Pill tone="ok" dot>{t('send.invite.joined')}</Pill> : <Pill tone="idle">{t('send.pending')}</Pill>}
                </span>
              </div>
            ))}
          </div>
          <p class="hint" style="margin-top:6px">{joinedCount === 1 ? t('send.invite.joinedOne', { count: joinedCount }) : t('send.invite.joinedMany', { count: joinedCount })}</p>
        </div>
      ) : null}

      <Button variant="link" onClick={onClose}>{t('common.done')}</Button>
    </Sheet>
  );
}
