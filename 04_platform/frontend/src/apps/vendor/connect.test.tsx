import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { ConnectScreen, developerPageUrl } from './screens/ConnectScreen';
import type { VendorActions, VendorState } from './useVendorApp';

/*
 * 2026-11-15 — CONNECT YOUR SHOP SYSTEM (the owner: "the key should be shown once the owner is ready for it … a dedicated
 * page; for the owner what to do, and the developer what to do … what would be accomplished with this key, and the
 * benefits"): optional, said so first; what it does; the owner's steps with a link for the developer that carries no key;
 * then the developer's part — the store ID with a Copy button, the keys, the update address, and a secret made when asked.
 */
const state = (vendor: Record<string, unknown>) => ({ vendor: { vendorId: 'ven_7f3a', name: 'Duka Bora', country: 'KE', ...vendor }, busy: null, callbacks: [], issuedKey: null, apiKeys: [] }) as unknown as VendorState;
const actions = {} as VendorActions;

describe('connecting a shop system', () => {
  it('says first it is optional, what it does, and what the owner does — with a link for the developer and no key in it', () => {
    const html = renderToString(<ConnectScreen state={state({ hasAccount: true })} actions={actions} />);
    expect(html).toContain(t('vendor.connect.title'));
    expect(html).toContain(t('vendor.connect.lede').slice(0, 30));
    for (const k of ['vendor.connect.what1', 'vendor.connect.what2', 'vendor.connect.what3', 'vendor.connect.you1', 'vendor.connect.you3'] as const) expect(html).toContain(t(k).slice(0, 25));
    expect(html).toContain(t('vendor.connect.sendDev'));
    expect(developerPageUrl()).toMatch(/help\/connect-your-shop\/$/);
  });

  it('the developer’s part: the store ID with a Copy button, and a first secret made here, not replaced', () => {
    const html = renderToString(<ConnectScreen state={state({ hasAccount: true })} actions={actions} />);
    expect(html).toContain('ven_7f3a');
    expect(html).toContain(`>${t('vendor.connect.copy')}<`);
    expect(html).toContain(t('vendor.secret.make'));
    expect(html).not.toContain(t('vendor.secret.rotate'));
    // Once a secret was made, it is replaced.
    expect(renderToString(<ConnectScreen state={state({ hasAccount: true, secretRotatedAt: '2026-11-15T10:00:00.000Z' })} actions={actions} />)).toContain(t('vendor.secret.rotate'));
  });
});
