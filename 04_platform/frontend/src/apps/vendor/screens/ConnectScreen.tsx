import { useState } from 'preact/hooks';
import { Button, Card, Checklist, ErrorNote, Note } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { frontDoorUrl } from '../../../shared/frontDoor';
import { CopyButton } from '../../../shared/CopyButton';
import type { VendorActions, VendorState } from '../useVendorApp';
import { CallbacksCard, KeysCard, SecretCard } from './StoreScreen';

/** The public page with the developer's instructions — never a key in it (help article `connect-your-shop`). */
export const developerPageUrl = () => `${frontDoorUrl()}help/connect-your-shop/`;

/**
 * 2026-11-15 — CONNECT YOUR SHOP SYSTEM (the owner: "the key should be shown once the owner is ready for it … a dedicated
 * page; for the owner what to do, and the developer what to do … what would be accomplished with this key, and the
 * benefits"). Optional, and said so first: a store ships by hand without it. What a connection does, the owner's few
 * steps, then everything a developer needs — the store's ID, its keys, the address its updates go to and the secret that
 * signs them — each made only when somebody asks for it here, each with a Copy button.
 */
export function ConnectScreen({ state, actions, developer = false }: { state: VendorState; actions: VendorActions; developer?: boolean }) {
  const t = useT();
  const v = state.vendor;
  return (
    <div class="scr">
      <h1 class="scr__title">{t('vendor.connect.title')}</h1>
      {/* 2026-11-15 — signed in as the store's developer: said who, and that this page is all there is. */}
      {developer && state.developer ? (
        <Note tone="info" icon="key" title={t('vendor.dev.signedInAs', { name: state.developer.name, store: v?.name ?? state.developer.store })} />
      ) : (
        <p class="scr__lede">{t('vendor.connect.lede')}</p>
      )}

      <Card title={t('vendor.connect.whatTitle')}>
        <Checklist items={[t('vendor.connect.what1'), t('vendor.connect.what2'), t('vendor.connect.what3'), t('vendor.connect.what4')]} />
      </Card>

      {developer ? null : (
      <Card title={t('vendor.connect.youTitle')}>
        <ol class="t-body" style="margin:0;padding-left:20px">
          <li>{t('vendor.connect.you1')}</li>
          <li>{t('vendor.connect.you2')}</li>
          <li>{t('vendor.connect.you3')}</li>
          <li>{t('vendor.connect.you4')}</li>
        </ol>
        <div style="margin-top:12px">
          <CopyButton share text={developerPageUrl()} label={t('vendor.connect.sendDev')} copied={t('vendor.connect.linkCopied')} variant="primary" />
        </div>
        <p class="hint">{t('vendor.connect.sendDevNote')}</p>
      </Card>
      )}

      {/* 2026-11-15 — or let them in on their own: a sign-in of theirs that opens only this page (the owner's). */}
      {developer ? null : <DevelopersCard state={state} actions={actions} />}

      <h2 class="scr__section">{t('vendor.connect.devTitle')}</h2>
      <p class="card__note">{t('vendor.connect.devLede')}</p>

      <Card title={t('vendor.connect.storeId')}>
        <p class="mono-t" style="word-break:break-all">{v?.vendorId ?? '…'}</p>
        {v?.vendorId ? <CopyButton text={v.vendorId} label={t('vendor.connect.copy')} copied={t('vendor.connect.copied')} /> : null}
      </Card>

      <KeysCard state={state} actions={actions} />
      <CallbacksCard state={state} actions={actions} />
      {developer ? (
        <Card title={t('vendor.secret.title')}>
          <p class="card__note">{t('vendor.dev.secretOwner')}</p>
        </Card>
      ) : (
        <SecretCard state={state} actions={actions} />
      )}

      <p class="hint">
        <a href={developerPageUrl()} target="_blank" rel="noopener">
          {t('vendor.connect.docs')}
        </a>
      </p>
    </div>
  );
}

/**
 * 2026-11-15 — YOUR DEVELOPER, LET IN ON THEIR OWN (the owner: "as recommended"): invited by name and email, they are
 * emailed a link that signs them in to this page alone; the owner sees when they last signed in, and takes them out —
 * which ends every sign-in of theirs at once.
 */
function DevelopersCard({ state, actions }: { state: VendorState; actions: VendorActions }) {
  const t = useT();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const day = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
  const rows = state.developers ?? [];
  return (
    <Card title={t('vendor.dev.title')}>
      <p class="card__note">{t('vendor.dev.note')}</p>
      {rows.map((d) => (
        <div key={d.devId} class="kv" style="margin-top:8px">
          <span>
            {d.name} · {d.email}
            <br />
            <span class="hint">{d.removedAt ? t('vendor.dev.removed', { date: day(d.removedAt) }) : d.lastSignInAt ? t('vendor.dev.lastIn', { date: day(d.lastSignInAt) }) : t('vendor.dev.invited', { date: day(d.invitedAt) })}</span>
          </span>
          {d.removedAt ? null : (
            <Button variant="link" full={false} busy={state.busy === `dev-remove:${d.devId}`} onClick={() => void actions.removeDeveloper(d.devId)}>
              {t('vendor.dev.remove')}
            </Button>
          )}
        </div>
      ))}
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="dev-name">
          {t('vendor.dev.name')}
        </label>
        <input id="dev-name" class="input" maxLength={60} autoComplete="off" value={name} onInput={(e) => setName(e.currentTarget.value)} />
      </div>
      <div class="field">
        <label class="field__label" for="dev-email">
          {t('vendor.dev.email')}
        </label>
        <input id="dev-email" class="input" type="email" inputMode="email" maxLength={120} autoComplete="off" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
      </div>
      {state.error && state.busy === null && name ? <ErrorNote error={state.error} /> : null}
      <Button
        chevron={false}
        full={false}
        disabled={name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email.trim())}
        busy={state.busy === 'dev-invite'}
        onClick={() =>
          void actions.inviteDeveloper(name, email).then((ok) => {
            if (ok) {
              setName('');
              setEmail('');
            }
          })
        }
      >
        {t('vendor.dev.invite')}
      </Button>
    </Card>
  );
}
