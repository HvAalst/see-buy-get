import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AuthImage } from '../ui/AuthImage';
import { Button } from '../ui/Button';
import { ErrorNote } from '../ui/ErrorNote';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { CodeBoxes } from '../ui/CodeBoxes';
import { ExplainerReset } from '../ui/Explainer';
import { HelpLink } from '../guide/HelpLink';
import type { GuideApp } from '../guide/articles';
import { CredentialAge } from './CredentialAge';
import { pinChangeBlocker } from './password';
import { useT } from '../i18n';
import { publicPageUrl } from '../../lib/sbg/config';
import type { AccountApi } from './useAccount';

export interface AccountMenuProps {
  api: AccountApi;
  /** Which app's help articles the Help row opens. Typed, so a menu cannot point at a guide that has
   *  no articles — the help link would then render a heading over nothing. */
  app: GuideApp;
  /** Sign out of THIS app — every app already knows how, and none of them do it the same way. */
  onSignOut: () => void;
  /**
   * Override where the public page opens. Almost never needed: the menu works it out from the handle
   * with `publicPageUrl`, which already knows the split-port sandbox has the site on another origin.
   */
  onOpenHandle?: (handle: string) => void;
  /** An app with its own invite flow passes it; the row is omitted where there is none. */
  onInvite?: () => void;
  /**
   * TWO CREDENTIALS, AND THEY ARE NOT THE SAME THING.
   *
   * A driver reopens their app with a 4-digit PIN held against the person. A shopkeeper and a hub sign in
   * with an email and a password held against the ACCOUNT. Both are real, some people have both, and a
   * menu that offered a PIN change to somebody who has never set one would send them to a sheet that can
   * only refuse them. So the PIN row appears when there is a PIN, and an app whose sign-in is a password
   * passes this to put its own change-password sheet in the same place.
   */
  onChangePassword?: () => void;
  /** Anything the app wants at the foot of the menu — a read-aloud control, a shift-specific link. */
  extra?: ComponentChildren;
  /**
   * Rows about the PERSON that only one app knows — who a driver drives for. Same shape as the rows above, so the
   * menu looks the same wherever they are; the menu closes when one is chosen.
   */
  rows?: Array<{ key: string; icon: Parameters<typeof Icon>[0]['name']; label: string; sub?: string; onClick: () => void }>;
}

/**
 * THE AVATAR, AND EVERYTHING THAT BELONGS TO THE PERSON RATHER THAN THE JOB.
 *
 * The driver app's foot carried a read-aloud button, a help link, a "stop showing me tips" control and
 * "Not you? Sign out", loose, on two different faces of the same screen — and there was no way at all to
 * change a PIN or say where you live. Those are not shift controls. They belong to the human holding the
 * phone, who may also keep a shop and manage a fleet, and they belong in one place that looks the same
 * wherever they are. (The user, 2026-09-24: *"Now it's a bit messy on the bottom of the My Van page."*)
 *
 * IT LIVES IN THE TOP BAR, in the slot that answers "who am I". The tab bar went icons-only, so a name
 * had nowhere else to be; and the foot of a scrolling screen is the one place a person has to travel to.
 *
 * ROWS ARE OMITTED, NEVER DISABLED. A fleet driver has no public page, so there is no handle row for
 * them — not a greyed one. An app with no invite flow shows no invite row. A disabled row is a promise
 * the product is not keeping, and a menu of them reads as a list of things you are not allowed to do.
 */
export function AccountMenu({ api, app, onSignOut, onOpenHandle, onInvite, onChangePassword, extra, rows }: AccountMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<'profile' | 'pin' | 'address' | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // A drop-down that only closes by pressing its own button is a trap on a phone, where the rest of the
  // screen is the obvious way out. Escape too: a keyboard user must never be parked inside it.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const me = api.account;
  const name = me?.displayName?.trim() || t('account.menu.you');

  /*
   * NO PERSON, NO MENU — the omission rule applied to the whole thing rather than to a row.
   *
   * Not every sign-in is a human being. A store signs in with a vendor id and a shared secret, which is a
   * machine credential whoever is at the counter uses; there is no photo, no PIN and no address behind it,
   * and the account surface says so with a 403. An avatar that opens onto "You are not allowed to do that"
   * is worse than no avatar: it tells somebody the product has an account for them and then refuses it.
   *
   * Only on FORBIDDEN, which is the server saying "this token is nobody". A network failure or an expired
   * token leaves the menu in place, because those are temporary and the sign-out inside it is exactly what
   * the person needs.
   */
  if (api.error?.code === 'FORBIDDEN' && !me) return null;
  const handleHref = me?.handle ? publicPageUrl(me.handle) : null;
  const openPage = () => {
    if (!me?.handle) return;
    if (onOpenHandle) return onOpenHandle(me.handle);
    // A new tab, not this one: a driver reading their own page must not lose the shift screen behind it.
    if (handleHref) window.open(handleHref, '_blank', 'noopener,noreferrer');
  };

  return (
    <div class="acct" ref={wrap}>
      <button
        type="button"
        class="acct__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('account.menu.open', { name })}
        onClick={() => setOpen((v) => !v)}
      >
        <span class="acct__pic">
          <Face api={api} />
        </span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} class="acct__caret" />
      </button>

      {open ? (
        <div class="acct__menu" role="menu">
          <div class="acct__head">
            <span class="acct__pic acct__pic--lg">
              <Face api={api} />
            </span>
            <span class="acct__who">
              <span class="acct__name">{name}</span>
              {/* The handle, where they have one. A fact first: most people never learn their own. */}
              {me?.handle ? <span class="acct__handle">@{me.handle}</span> : null}
            </span>
          </div>

          {api.error ? <ErrorNote error={api.error} /> : null}

          <MenuRow icon="camera" label={t('account.menu.photo')} sub={me?.avatarMediaId ? t('account.menu.photoSet') : t('account.menu.photoNone')} onClick={() => { setOpen(false); setSheet('profile'); }} />
          <MenuRow icon="pin" label={t('account.menu.address')} sub={me?.address || t('account.menu.addressNone')} onClick={() => { setOpen(false); setSheet('address'); }} />
          {/* Only where a PIN exists. Somebody who signed up with an email has never set one, and the
              sheet behind this row could do nothing for them but refuse. */}
          {me?.hasPin ? (
            <MenuRow icon="keypad" label={t('account.menu.pin')} sub={me.pinChangedAt ? undefined : t('account.menu.pinSub')} onClick={() => { setOpen(false); setSheet('pin'); }}>
              {me.pinChangedAt ? <CredentialAge iso={me.pinChangedAt} class="row__s" /> : null}
            </MenuRow>
          ) : null}
          {onChangePassword ? (
            <MenuRow icon="lock" label={t('account.menu.password')} sub={t('account.menu.passwordSub')} onClick={() => { setOpen(false); onChangePassword(); }} />
          ) : null}
          {/*
            * THEIR PUBLIC PAGE — and only for somebody who HAS one.
            *
            * An owner-driver is a party the network contracts with directly and answers on /@handle; a
            * fleet driver does not, because the fleet is the party. So the server sends a handle to the
            * first and nothing to the second, and this row simply is not there for them. Not greyed:
            * a disabled row is a promise the product is not keeping.
            *
            * `publicPageUrl` returns null for anything that is not a well-formed handle, which is the
            * one case where the name is worth showing with no door behind it rather than a door that
            * opens somewhere unintended — the header above already shows it.
            */}
          {handleHref ? <MenuRow icon="person" label={t('account.menu.page')} sub={`@${me!.handle}`} onClick={() => { setOpen(false); openPage(); }} /> : null}
          {onInvite ? <MenuRow icon="send" label={t('account.menu.invite')} sub={t('account.menu.inviteSub')} onClick={() => { setOpen(false); onInvite(); }} /> : null}
          {(rows ?? []).map((r) => (
            <MenuRow key={r.key} icon={r.icon} label={r.label} sub={r.sub} onClick={() => { setOpen(false); r.onClick(); }} />
          ))}

          <div class="acct__foot">
            <HelpLink app={app} />
            {/* Restoring dismissed teaching belongs to the person, not to a screen — and it renders
                nothing at all when they have not put anything away. */}
            <ExplainerReset who={me?.personId} />
            {extra}
            <Button variant="link" full={false} onClick={() => { setOpen(false); onSignOut(); }}>
              {t('account.menu.signOut')}
            </Button>
          </div>
        </div>
      ) : null}

      <ProfileSheet open={sheet === 'profile'} onClose={() => setSheet(null)} api={api} />
      <AddressSheet open={sheet === 'address'} onClose={() => setSheet(null)} api={api} />
      <PinSheet open={sheet === 'pin'} onClose={() => setSheet(null)} api={api} onSignOut={onSignOut} />
    </div>
  );
}

/** The photo, or their initial, or nobody. Same three states at every size. */
function Face({ api }: { api: AccountApi }) {
  const t = useT();
  const me = api.account;
  if (me?.avatarMediaId) return <AuthImage mediaId={me.avatarMediaId} load={api.loadMedia} alt={t('account.menu.photoAlt')} />;
  const initial = me?.displayName?.trim()?.[0]?.toUpperCase();
  return initial ? <span class="avatar__initial">{initial}</span> : <Icon name="person" size={20} />;
}

function MenuRow({ icon, label, sub, onClick, children }: { icon: Parameters<typeof Icon>[0]['name']; label: string; sub?: string; onClick: () => void; children?: ComponentChildren }) {
  return (
    <button type="button" class="row" role="menuitem" onClick={onClick}>
      <span class="row__ic">
        <Icon name={icon} size={22} />
      </span>
      <span class="row__body">
        <span class="row__t">{label}</span>
        {sub ? <span class="row__s">{sub}</span> : null}
        {children}
      </span>
      <span class="row__end">
        <Icon name="chevronRight" size={20} />
      </span>
    </button>
  );
}

/** Name and photo. One sheet, because a person setting one usually sets the other. */
function ProfileSheet({ open, onClose, api }: { open: boolean; onClose: () => void; api: AccountApi }) {
  const t = useT();
  const [name, setName] = useState('');
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setName(api.account?.displayName ?? '');
  }, [open, api.account?.displayName]);

  const pick = async (f: File) => {
    // Downscaled in the browser before it leaves: the cheapest phone in this network is also the one on
    // the worst connection, and a 4MB camera original is a minute of somebody's data for a 64px circle.
    const dataUrl = await shrink(f);
    if (dataUrl) await api.saveAvatar(dataUrl);
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('account.menu.photo')}>
      <div class="avatarpick">
        <span class="avatarpick__pic">
          <Face api={api} />
        </span>
        <div class="avatarpick__act">
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            disabled={api.busy}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = ''; // so picking the same file twice still fires
              if (f) void pick(f);
            }}
          />
          <Button variant="outline" chevron={false} busy={api.busy} onClick={() => file.current?.click()}>
            {api.account?.avatarMediaId ? t('account.menu.changePhoto') : t('account.menu.addPhoto')}
          </Button>
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="acct-name">
          {t('account.menu.name')}
        </label>
        <input id="acct-name" class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder={t('account.menu.namePh')} />
        <p class="hint">{t('account.menu.nameHint')}</p>
      </div>

      {api.error ? <ErrorNote error={api.error} /> : null}
      <Button chevron={false} busy={api.busy} disabled={!name.trim()} onClick={async () => { if (await api.save({ displayName: name.trim() })) onClose(); }}>
        {t('common.save')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('common.cancel')}
      </Button>
    </Sheet>
  );
}

function AddressSheet({ open, onClose, api }: { open: boolean; onClose: () => void; api: AccountApi }) {
  const t = useT();
  const [address, setAddress] = useState('');
  useEffect(() => {
    if (open) setAddress(api.account?.address ?? '');
  }, [open, api.account?.address]);

  return (
    <Sheet open={open} onClose={onClose} title={t('account.menu.address')}>
      <p class="t-body">{t('account.menu.addressBody')}</p>
      <div class="field">
        <label class="field__label" for="acct-address">
          {t('account.menu.address')}
        </label>
        <textarea id="acct-address" class="input" rows={3} value={address} onInput={(e) => setAddress(e.currentTarget.value)} placeholder={t('account.menu.addressPh')} />
      </div>
      {api.error ? <ErrorNote error={api.error} /> : null}
      <Button chevron={false} busy={api.busy} onClick={async () => { if (await api.save({ address: address.trim() })) onClose(); }}>
        {t('common.save')}
      </Button>
      {/* Taking it back is a real act with its own control, not something you discover by clearing a box. */}
      {api.account?.address ? (
        <Button variant="link" onClick={async () => { if (await api.save({ address: '' })) onClose(); }}>
          {t('account.menu.addressClear')}
        </Button>
      ) : null}
      <Button variant="link" onClick={onClose}>
        {t('common.cancel')}
      </Button>
    </Sheet>
  );
}

/**
 * Changing the PIN ends every session it opened — including this one, necessarily, because the token
 * carries the person as its revocation key. So this says so BEFORE, and signs out AFTER. Pretending
 * otherwise would leave the app holding a dead token and failing at whatever the person did next.
 */
function PinSheet({ open, onClose, api, onSignOut }: { open: boolean; onClose: () => void; api: AccountApi; onSignOut: () => void }) {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  useEffect(() => {
    if (open) {
      setCurrent('');
      setNext('');
    }
  }, [open]);

  const blocker = pinChangeBlocker({ current, next });

  return (
    <Sheet open={open} onClose={onClose} title={t('account.menu.pin')}>
      <p class="t-body">{t('account.menu.pinBody')}</p>
      <div class="field">
        <span class="field__label">{t('account.menu.currentPin')}</span>
        <CodeBoxes id="acct-pin-current" label={t('account.menu.currentPin')} length={4} value={current} onInput={setCurrent} disabled={api.busy} />
      </div>
      <div class="field">
        <span class="field__label">{t('account.menu.newPin')}</span>
        <CodeBoxes id="acct-pin-new" label={t('account.menu.newPin')} length={4} value={next} onInput={setNext} disabled={api.busy} />
      </div>
      {api.error ? <ErrorNote error={api.error} /> : null}
      <Button
        chevron={false}
        busy={api.busy}
        disabled={blocker !== null}
        onClick={async () => {
          if (!(await api.changePin(current, next))) return;
          onClose();
          onSignOut();
        }}
      >
        {t('account.menu.savePin')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('common.cancel')}
      </Button>
    </Sheet>
  );
}

/**
 * Downscale a picked photo to a 512px square-ish JPEG before upload.
 *
 * Resolves null rather than throwing on anything unreadable — a HEIC the browser cannot decode, a file
 * that is not really an image — so the caller shows nothing rather than a stack trace.
 */
async function shrink(file: File, max = 512): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return null;
  }
}
