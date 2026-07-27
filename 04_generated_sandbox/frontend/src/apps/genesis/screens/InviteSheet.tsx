import { useState } from 'preact/hooks';
import { Button, Note, Pill, Sheet } from '../../../shared/ui';
import { canPickContact, type PickedContact, type ShareChannel } from '../../../shared/device';
import type { SendActions, SendState } from '../useSendApp';

export interface InviteSheetProps {
  open: boolean;
  onClose: () => void;
  state: SendState;
  actions: SendActions;
}

const CHANNELS: { key: ShareChannel; label: string }[] = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'sms', label: 'SMS' },
  { key: 'email', label: 'Email' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'copy', label: 'Copy link' },
  { key: 'system', label: 'Other apps' },
];

/**
 * Invite friends (S28) — the low-friction, contact-picker flow ("paste a link is for pros"). Pick from
 * the address book (or add a friend), choose how to send, tap Send → it mints a per-contact link, maps it
 * to that contact ON THIS DEVICE, and opens the channel straight to them. The server only ever sees an
 * opaque token, so nothing leaks; the "pending → joined" list is read back from the token's join count.
 */
export function InviteSheet({ open, onClose, state, actions }: InviteSheetProps) {
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

  return (
    <Sheet open={open} onClose={onClose} title="Invite friends">
      <p class="hint">Send a friend a personal link. They'll see it came from you, so it's just "Join me on SeeBuyGet".</p>

      <div class="field" style="margin-top:14px">
        <span class="field__label">Add friends</span>
        {canPickContact() ? (
          <Button variant="outline" chevron={false} onClick={() => void pick()}>Pick from contacts</Button>
        ) : (
          <p class="hint">Your contact list opens on an Android phone (Chrome). On this device, add a friend below.</p>
        )}
        <div class="grid2" style="margin-top:8px">
          <input class="input" value={mName} onInput={(e) => setMName(e.currentTarget.value)} placeholder="Name" aria-label="Friend's name" />
          <input class="input" value={mTel} onInput={(e) => setMTel(e.currentTarget.value)} placeholder="Number (optional)" inputMode="tel" aria-label="Friend's number" />
        </div>
        <Button variant="link" onClick={addManual}>Add friend</Button>
      </div>

      <div class="field" style="margin-top:8px">
        <span class="field__label">Send with</span>
        <div class="chips" role="group" aria-label="How to send">
          {CHANNELS.map((c) => (
            <button key={c.key} type="button" class={`chip${channel === c.key ? ' chip--on' : ''}`} aria-pressed={channel === c.key} onClick={() => setChannel(c.key)}>
              {c.label}
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
                  <Pill tone="ok" dot>Sent</Pill>
                ) : (
                  <Button
                    variant="outline"
                    full={false}
                    busy={state.inviteSending === (c.tel || c.name || 'link')}
                    disabled={Boolean(state.inviteSending)} /* single-flight: no concurrent sends racing the map */
                    onClick={() => void actions.inviteContact(c, channel)}
                  >
                    Send
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p class="hint" style="margin-top:10px">Pick contacts or add a friend, choose how to send, then tap Send behind each name.</p>
      )}

      {state.inviteNote ? <Note tone="info" icon="check" title={state.inviteNote} /> : null}

      {state.inviteMap.length ? (
        <div style="margin-top:18px">
          <h3 class="scr__section">Your invites</h3>
          <div class="rows" role="list">
            {state.inviteMap.map((e) => (
              <div key={e.token} class="row row--static" role="listitem">
                <span class="row__body"><span class="row__t">{e.name}</span></span>
                <span class="row__end">
                  {joinedTokens.has(e.token) ? <Pill tone="ok" dot>Joined</Pill> : <Pill tone="idle">Pending</Pill>}
                </span>
              </div>
            ))}
          </div>
          <p class="hint" style="margin-top:6px">{state.invites?.joined ?? 0} {(state.invites?.joined ?? 0) === 1 ? 'friend has' : 'friends have'} joined from your invites.</p>
        </div>
      ) : null}

      <Button variant="link" onClick={onClose}>Done</Button>
    </Sheet>
  );
}
