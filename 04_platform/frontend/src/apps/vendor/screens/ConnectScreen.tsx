import { Card, Checklist } from '../../../shared/ui';
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
export function ConnectScreen({ state, actions }: { state: VendorState; actions: VendorActions }) {
  const t = useT();
  const v = state.vendor;
  return (
    <div class="scr">
      <h1 class="scr__title">{t('vendor.connect.title')}</h1>
      <p class="scr__lede">{t('vendor.connect.lede')}</p>

      <Card title={t('vendor.connect.whatTitle')}>
        <Checklist items={[t('vendor.connect.what1'), t('vendor.connect.what2'), t('vendor.connect.what3'), t('vendor.connect.what4')]} />
      </Card>

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

      <h2 class="scr__section">{t('vendor.connect.devTitle')}</h2>
      <p class="card__note">{t('vendor.connect.devLede')}</p>

      <Card title={t('vendor.connect.storeId')}>
        <p class="mono-t" style="word-break:break-all">{v?.vendorId ?? '…'}</p>
        {v?.vendorId ? <CopyButton text={v.vendorId} label={t('vendor.connect.copy')} copied={t('vendor.connect.copied')} /> : null}
      </Card>

      <KeysCard state={state} actions={actions} />
      <CallbacksCard state={state} actions={actions} />
      <SecretCard state={state} actions={actions} />

      <p class="hint">
        <a href={developerPageUrl()} target="_blank" rel="noopener">
          {t('vendor.connect.docs')}
        </a>
      </p>
    </div>
  );
}
