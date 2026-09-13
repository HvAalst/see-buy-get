import { HelpLink } from '../../../shared/guide/HelpLink';
import { CredentialAge } from '../../../shared/account/CredentialAge';
import { pinChangeBlocker } from '../../../shared/account/password';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AuthImage, Button, Card, CodeBoxes, ErrorNote, Icon, LanguageSwitcher, MediaLibrary, Note, Pill, ReadAloud, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { roleMeta } from '../logic';
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
  const t = useT(); // re-render this screen's translated strings when the language changes
  const [pinOpen, setPinOpen] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
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
      <h1 class="scr__title">{id.displayName ? t('common.greeting', { name: id.displayName }) : t('account.title')}</h1>
      <p class="scr__lede">{t('send.account.signedInAs', { phone: state.authPhone || t('send.account.yourPhoneFallback') })}</p>

      {state.accountError ? <ErrorNote error={state.accountError} /> : null}
      {state.accountNote ? <Note tone="ok" icon="check" title={state.accountNote} /> : null}

      {/* S29: a real name + photo instead of the impersonal "You / mobile". The name is stored in the
          identity vault (PII), the photo is owner-gated media — both are shown only to the person and, as
          a name, on the invites they send ("Join Hans on SeeBuyGet"). */}
      <Card title={t('send.account.profileTitle')}>
        <button type="button" class="row" onClick={() => { setNameDraft(id.displayName ?? ''); setProfileOpen(true); }}>
          <span class="row__ic row__ic--avatar"><Avatar id={id} load={actions.loadMedia} /></span>
          <span class="row__body">
            <span class="row__t">{id.displayName || t('send.account.addYourName')}</span>
            <span class="row__s">{id.displayName ? t('send.account.nameOnInvites') : t('send.account.nameMakesPersonal')}</span>
          </span>
          <span class="row__end"><Icon name="chevronRight" size={22} /></span>
        </button>
      </Card>

      <Card title={t('send.account.actAs')}>
        <div class="rows">
          <div class="row row--static">
            <span class="row__ic"><Icon name={roleMeta('consumer', t).icon} size={24} /></span>
            <span class="row__body">
              <span class="row__t">{roleMeta('consumer', t).label}</span>
              <span class="row__s">{roleMeta('consumer', t).blurb}</span>
            </span>
            <span class="row__end"><Pill tone="ok" dot>{t('send.account.thisIsYou')}</Pill></span>
          </div>

          {others.map((r) => (
            <RoleRow key={`${r.role}:${r.entityDid}`} link={r} busy={state.switchBusy === r.role} onSwitch={() => void actions.switchRole(r.role)} />
          ))}
        </div>
        {others.length ? <p class="hint">{t('send.account.tapRole')}</p> : <p class="hint">{t('send.account.onlySender')}</p>}
      </Card>

      <Card title={t('send.account.inviteFriends')}>
        {state.invites && state.invites.joined > 0 ? (
          <p class="hint">{state.invites.joined === 1 ? t('send.account.joinedOne', { count: state.invites.joined }) : t('send.account.joinedMany', { count: state.invites.joined })}</p>
        ) : (
          <p class="hint">{t('send.account.shareApp')}</p>
        )}
        <div style="margin-top:10px">
          <Button variant="outline" chevron={false} onClick={() => { void actions.loadInvites(); setInviteOpen(true); }}>
            {t('send.account.inviteAFriend')}
          </Button>
        </div>
      </Card>

      {/* S27 media library: all the person's photos in one place, grouped by how long each is kept —
          so the retention is visible and nothing feels hoarded. Always shown (empty/loading/error states
          too) so the feature is discoverable even before you have any photos. Evidence is view-only. */}
      <section aria-label={t('send.account.yourPhotos')}>
        <h2 class="scr__section">{t('send.account.yourPhotos')}</h2>
        {state.mediaState === 'error' ? (
          <Card>
            <p class="hint">{t('send.account.photosError')}</p>
            <div style="margin-top:10px">
              <Button variant="outline" chevron={false} onClick={() => void actions.loadMyMedia()}>{t('common.retry')}</Button>
            </div>
          </Card>
        ) : state.mediaState !== 'ready' && state.media.length === 0 ? (
          <Card><p class="hint">{t('send.account.photosLoading')}</p></Card>
        ) : state.media.length > 0 ? (
          <>
            <MediaLibrary media={state.media} load={actions.loadMedia} onRemove={actions.removeMedia} removingId={state.mediaRemoving} />
            <p class="hint" style="margin-top:8px">{t('send.account.photosAuto')}</p>
          </>
        ) : (
          <Card>
            <p class="hint">{t('send.account.photosEmpty')}</p>
          </Card>
        )}
      </section>

      <Card title={t('common.language')}>
        <LanguageSwitcher />
      </Card>

      <div class="scr__foot">
        <HelpLink app="send" />
      </div>

      <Card title={t('send.account.signInTitle')}>
        <div class="rows">
          <button type="button" class="row" onClick={() => { setNewPin(''); setCurrentPin(''); setPinOpen(true); }}>
            <span class="row__ic"><Icon name="keypad" size={24} /></span>
            <span class="row__body">
              <span class="row__t">{t('send.account.changePin')}</span>
              <span class="row__s">{t('send.account.changePinSub')}</span>
              <CredentialAge iso={state.identity?.pinChangedAt} class="row__s" />
            </span>
            <span class="row__end"><Icon name="chevronRight" size={22} /></span>
          </button>
        </div>
      </Card>

      <div class="scr__cta">
        <Button variant="outline" chevron={false} onClick={() => actions.signOut()}>
          {t('send.account.signOut')}
        </Button>
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => (roles.length === 1 ? t('send.account.aloudOne') : t('send.account.aloudMany', { count: roles.length }))} label={t('send.readAloud')} />
      </div>

      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title={t('send.account.changePin')}>
        <div class="field">
          <span class="field__label">{t('send.currentPin')}</span>
          <CodeBoxes id="current-pin" label={t('send.currentPin')} length={4} value={currentPin} onInput={setCurrentPin} disabled={state.accountBusy} />
        </div>
        <div class="field">
          <span class="field__label">{t('send.newPin')}</span>
          <CodeBoxes id="change-pin" label={t('send.newPin')} length={4} value={newPin} onInput={setNewPin} disabled={state.accountBusy} />
        </div>
        <Button
          chevron={false}
          disabled={pinChangeBlocker({ current: currentPin, next: newPin }) !== null}
          busy={state.accountBusy}
          onClick={async () => {
            if (await actions.changePin(currentPin, newPin)) setPinOpen(false);
          }}
        >
          {t('send.account.savePin')}
        </Button>
        <Button variant="link" onClick={() => setPinOpen(false)}>{t('common.cancel')}</Button>
      </Sheet>

      <Sheet open={profileOpen} onClose={() => setProfileOpen(false)} title={t('send.account.profileTitle')}>
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
              {id.avatarMediaId ? t('send.account.changePhoto') : t('send.account.addPhoto')}
            </Button>
            <p class="hint" style="margin-top:6px">{t('send.account.photoHelps')}</p>
          </div>
        </div>

        <div class="field">
          <label class="field__label" for="profile-name">{t('send.account.yourName')}</label>
          <input
            id="profile-name"
            class="input"
            type="text"
            autocomplete="name"
            maxLength={80}
            value={nameDraft}
            onInput={(e) => setNameDraft(e.currentTarget.value)}
            placeholder={t('send.account.namePlaceholder')}
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
          {t('send.account.saveName')}
        </Button>
        <Button variant="link" onClick={() => setProfileOpen(false)}>{t('common.done')}</Button>
      </Sheet>

      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} state={state} actions={actions} />
    </div>
  );
}

/** The person's avatar as a round image (owner-gated media → AuthImage), or a placeholder when unset. */
function Avatar({ id, load, size = 42 }: { id: PersonView; load: SendActions['loadMedia']; size?: number }) {
  const t = useT();
  if (id.avatarMediaId) {
    return <AuthImage mediaId={id.avatarMediaId} load={load} alt={t('send.account.profilePhotoAlt')} />;
  }
  const initial = id.displayName?.trim()?.[0]?.toUpperCase() ?? '';
  return initial
    ? <span class="avatar__initial">{initial}</span>
    : <Icon name="person" size={Math.round(size * 0.55)} />;
}

function RoleRow({ link, busy, onSwitch }: { link: RoleLinkView; busy: boolean; onSwitch: () => void }) {
  const t = useT();
  const meta = roleMeta(link.role, t);
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
        {active ? null : <Pill tone="idle">{link.status === 'pending' ? t('send.pending') : t('send.paused')}</Pill>}
        <Icon name="chevronRight" size={22} />
      </span>
    </button>
  );
}
