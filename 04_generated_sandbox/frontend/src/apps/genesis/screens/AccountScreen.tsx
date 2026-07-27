import { useEffect, useRef, useState } from 'preact/hooks';
import { AuthImage, Button, Card, CodeBoxes, ErrorNote, Icon, MediaLibrary, Note, Pill, ReadAloud, Sheet } from '../../../shared/ui';
import { codeReady, roleMeta } from '../logic';
import { ROLE_APPS } from '../api';
import { InviteSheet } from './InviteSheet';
import type { PersonView, RoleLinkView } from '../types';
import type { SendActions, SendState } from '../useSendApp';

export interface AccountScreenProps {
  state: SendState;
  actions: SendActions;
}

/**
 * The account home + role switcher (S21). "One person, one account, many roles" made visible: the
 * person sees every role they hold and can act as any of them — tapping a role hands its token to that
 * role's own app and opens it, so a sender who is also a driver never signs in twice. Change-PIN lives
 * in a sheet (its own context, its own primary); sign-out is the outline action.
 */
export function AccountScreen({ state, actions }: AccountScreenProps) {
  const [pinOpen, setPinOpen] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const avatarInput = useRef<HTMLInputElement>(null);
  const id = state.identity;
  if (!id) return null;

  const roles = id.roles;
  const others = roles.filter((r) => r.role !== 'consumer');

  useEffect(() => {
    if (state.invitesState === 'idle') void actions.loadInvites();
  }, [state.invitesState, actions]);

  useEffect(() => {
    if (state.mediaState === 'idle') void actions.loadMyMedia();
  }, [state.mediaState, actions]);

  return (
    <div class="scr">
      <h1 class="scr__title">{id.displayName ? `Hi, ${id.displayName}` : 'Your account'}</h1>
      <p class="scr__lede">Signed in as {state.authPhone || 'your phone'}.</p>

      {state.accountError ? <ErrorNote error={state.accountError} /> : null}
      {state.accountNote ? <Note tone="ok" icon="check" title={state.accountNote} /> : null}

      {/* S29: a real name + photo instead of the impersonal "You / mobile". The name is stored in the
          identity vault (PII), the photo is owner-gated media — both are shown only to the person and, as
          a name, on the invites they send ("Join Hans on SeeBuyGet"). */}
      <Card title="Your profile">
        <button type="button" class="row" onClick={() => { setNameDraft(id.displayName ?? ''); setProfileOpen(true); }}>
          <span class="row__ic row__ic--avatar"><Avatar id={id} load={actions.loadMedia} /></span>
          <span class="row__body">
            <span class="row__t">{id.displayName || 'Add your name'}</span>
            <span class="row__s">{id.displayName ? 'Your name and photo appear on invites you send' : 'A name and photo make your invites personal'}</span>
          </span>
          <span class="row__end"><Icon name="chevronRight" size={22} /></span>
        </button>
      </Card>

      <Card title="Act as">
        <div class="rows">
          <div class="row row--static">
            <span class="row__ic"><Icon name={roleMeta('consumer').icon} size={24} /></span>
            <span class="row__body">
              <span class="row__t">{roleMeta('consumer').label}</span>
              <span class="row__s">{roleMeta('consumer').blurb}</span>
            </span>
            <span class="row__end"><Pill tone="ok" dot>This is you</Pill></span>
          </div>

          {others.map((r) => (
            <RoleRow key={`${r.role}:${r.entityDid}`} link={r} busy={state.switchBusy === r.role} onSwitch={() => void actions.switchRole(r.role)} />
          ))}
        </div>
        {others.length ? <p class="hint">Tap a role to open its app — no need to sign in again.</p> : <p class="hint">You only have the sender account for now.</p>}
      </Card>

      <Card title="Invite friends">
        {state.invites && state.invites.joined > 0 ? (
          <p class="hint">{state.invites.joined} {state.invites.joined === 1 ? 'friend has' : 'friends have'} joined from your link.</p>
        ) : (
          <p class="hint">Share SeeBuyGet — your friends can send and collect too.</p>
        )}
        <div style="margin-top:10px">
          <Button variant="outline" chevron={false} onClick={() => { void actions.loadInvites(); setInviteOpen(true); }}>
            Invite a friend
          </Button>
        </div>
      </Card>

      {/* S27 media library: all the person's photos in one place, grouped by how long each is kept —
          so the retention is visible and nothing feels hoarded. Always shown (empty/loading/error states
          too) so the feature is discoverable even before you have any photos. Evidence is view-only. */}
      <section aria-label="Your photos">
        <h2 class="scr__section">Your photos</h2>
        {state.mediaState === 'error' ? (
          <Card>
            <p class="hint">We couldn't load your photos.</p>
            <div style="margin-top:10px">
              <Button variant="outline" chevron={false} onClick={() => void actions.loadMyMedia()}>Try again</Button>
            </div>
          </Card>
        ) : state.mediaState !== 'ready' && state.media.length === 0 ? (
          <Card><p class="hint">Getting your photos…</p></Card>
        ) : state.media.length > 0 ? (
          <>
            <MediaLibrary media={state.media} load={actions.loadMedia} onRemove={actions.removeMedia} removingId={state.mediaRemoving} />
            <p class="hint" style="margin-top:8px">Old photos are removed automatically — you do not need to clean up.</p>
          </>
        ) : (
          <Card>
            <p class="hint">No photos yet. Proof photos from your deliveries appear here — and clear automatically after their keep-time, so nothing piles up.</p>
          </Card>
        )}
      </section>

      <Card title="Sign in">
        <div class="rows">
          <button type="button" class="row" onClick={() => { setNewPin(''); setPinOpen(true); }}>
            <span class="row__ic"><Icon name="keypad" size={24} /></span>
            <span class="row__body">
              <span class="row__t">Change your PIN</span>
              <span class="row__s">The 4 digits you use to sign in</span>
            </span>
            <span class="row__end"><Icon name="chevronRight" size={22} /></span>
          </button>
        </div>
      </Card>

      <div class="scr__cta">
        <Button variant="outline" chevron={false} onClick={() => actions.signOut()}>
          Sign out
        </Button>
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => `You are signed in. You hold ${roles.length} ${roles.length === 1 ? 'role' : 'roles'}.`} label="Read this aloud" />
      </div>

      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Change your PIN">
        <div class="field">
          <span class="field__label">Your new 4-digit PIN</span>
          <CodeBoxes id="change-pin" label="Your new 4-digit PIN" length={4} value={newPin} onInput={setNewPin} disabled={state.accountBusy} />
        </div>
        <Button
          chevron={false}
          disabled={!codeReady(newPin, 4)}
          busy={state.accountBusy}
          onClick={async () => {
            await actions.changePin(newPin);
            setPinOpen(false);
          }}
        >
          Save PIN
        </Button>
        <Button variant="link" onClick={() => setPinOpen(false)}>Cancel</Button>
      </Sheet>

      <Sheet open={profileOpen} onClose={() => setProfileOpen(false)} title="Your profile">
        {/* The avatar: pick a photo → it uploads and applies at once (the old one is purged server-side). */}
        <div class="avatarpick">
          <span class="avatarpick__pic"><Avatar id={id} load={actions.loadMedia} size={64} /></span>
          <div class="avatarpick__act">
            <input
              ref={avatarInput}
              class="photo__input"
              type="file"
              accept="image/*"
              capture="user"
              disabled={state.avatarBusy}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (f) void actions.saveAvatar(f);
              }}
            />
            <Button variant="outline" chevron={false} busy={state.avatarBusy} onClick={() => avatarInput.current?.click()}>
              {id.avatarMediaId ? 'Change photo' : 'Add a photo'}
            </Button>
            <p class="hint" style="margin-top:6px">A clear photo helps friends recognise your invites.</p>
          </div>
        </div>

        <div class="field">
          <label class="field__label" for="profile-name">Your name</label>
          <input
            id="profile-name"
            class="input"
            type="text"
            autocomplete="name"
            maxLength={80}
            value={nameDraft}
            onInput={(e) => setNameDraft(e.currentTarget.value)}
            placeholder="e.g. Hans van Aalst"
          />
        </div>
        <Button
          chevron={false}
          disabled={!nameDraft.trim() || nameDraft.trim() === (id.displayName ?? '')}
          busy={state.savingProfile}
          onClick={async () => {
            // Close only on success — a failed save keeps the sheet + the typed name so it can be retried.
            if (await actions.saveDisplayName(nameDraft)) setProfileOpen(false);
          }}
        >
          Save name
        </Button>
        <Button variant="link" onClick={() => setProfileOpen(false)}>Done</Button>
      </Sheet>

      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} state={state} actions={actions} />
    </div>
  );
}

/** The person's avatar as a round image (owner-gated media → AuthImage), or a placeholder when unset. */
function Avatar({ id, load, size = 42 }: { id: PersonView; load: SendActions['loadMedia']; size?: number }) {
  if (id.avatarMediaId) {
    return <AuthImage mediaId={id.avatarMediaId} load={load} alt="Your profile photo" />;
  }
  const initial = id.displayName?.trim()?.[0]?.toUpperCase() ?? '';
  return initial
    ? <span class="avatar__initial">{initial}</span>
    : <Icon name="person" size={Math.round(size * 0.55)} />;
}

function RoleRow({ link, busy, onSwitch }: { link: RoleLinkView; busy: boolean; onSwitch: () => void }) {
  const meta = roleMeta(link.role);
  const active = link.status === 'active';
  const canOpen = active && Boolean(ROLE_APPS[link.role]);
  return (
    <button type="button" class="row" disabled={!canOpen || busy} onClick={onSwitch}>
      <span class="row__ic"><Icon name={meta.icon} size={24} /></span>
      <span class="row__body">
        <span class="row__t">{meta.label}</span>
        <span class="row__s">{meta.blurb}</span>
      </span>
      <span class="row__end">
        {active ? null : <Pill tone="idle">{link.status === 'pending' ? 'Pending' : 'Paused'}</Pill>}
        <Icon name="chevronRight" size={22} />
      </span>
    </button>
  );
}
