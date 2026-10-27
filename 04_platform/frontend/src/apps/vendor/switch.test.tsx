import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { BringsBackLine, SwitchToShopSheet } from './screens/BringsBack';
import type { VendorActions, VendorLoad, VendorState } from './useVendorApp';

/*
 * A LOAD TO THE STORE'S DOOR THAT NO DRIVER HAS TAKEN (the user, 2026-10-27: "Switch to a shop"): beside raising the most it
 * pays, the store may send the box to a shop instead — picked first, priced second, and only then done.
 */
const load: VendorLoad = { freightId: 'FRT-1', code: 'FRT-AB12', description: 'Box', destLabel: 'Gate 2', weightKg: 3, status: 'available', bringsBack: { parcelId: 'PCL-9', atMdpId: 'mdp_1', hubName: 'Naivasha Hub' }, maxSpend: 400 };
const shop = { did: 'did:a', shopName: 'Mama Njeri', zone: 'Z-A', country: 'KE', openState: 'open', pricePerParcel: 1.5, currency: 'KES', location: { lat: -1.28, lng: 36.82 } };
const state = (over: Partial<VendorState> = {}) => ({ vendor: { currency: 'KES' }, loads: [load], points: [shop], pointsState: 'ready', busy: null, switchTo: null, ...over }) as unknown as VendorState;
const actions = {} as VendorActions;
const asked = (view: NonNullable<VendorState['switchTo']>['view'], backTo?: string) => state({ switchTo: { freightId: 'FRT-1', view, ...(backTo ? { backTo } : {}) } });

describe('a load to its door no driver has taken: the box to a shop instead', () => {
  it('is offered beside raising the most it pays — only while no driver has it', () => {
    const waiting = renderToString(<BringsBackLine load={load} state={state()} actions={actions} />);
    expect(waiting).toContain(t('vendor.loads.toShop'));
    expect(waiting).toContain(t('vendor.loads.raise'));
    expect(renderToString(<BringsBackLine load={{ ...load, status: 'claimed' }} state={state()} actions={actions} />)).not.toContain(t('vendor.loads.toShop'));
  });

  it('withdrawn because it went to a shop: says so, and where the new parcel is', () => {
    const html = renderToString(<BringsBackLine load={{ ...load, status: 'cancelled' }} state={state()} actions={actions} />);
    expect(html).toContain(t('vendor.loads.sentToShop', { parcel: 'PCL-9' }));
    expect(html).not.toContain(t('vendor.loads.toShop'));
  });

  it('nothing asked: no sheet', () => {
    expect(renderToString(<SwitchToShopSheet state={state()} actions={actions} />)).toBe('');
  });

  it('first the shops to pick from, then the price — the load said withdrawn, nothing of it charged', () => {
    const pick = renderToString(<SwitchToShopSheet state={asked({ parcelId: 'PCL-9', outcome: 'pick', atHub: 'Naivasha Hub' })} actions={actions} />);
    expect(pick).toContain(t('vendor.loads.toShopTitle', { code: 'FRT-AB12' }));
    expect(pick).toContain('Mama Njeri');
    expect(pick).not.toContain('Send it to');
    const priced = renderToString(<SwitchToShopSheet state={asked({ parcelId: 'PCL-9', outcome: 'bring_back', amount: 180, currency: 'KES', backTo: 'Mama Njeri', atHub: 'Naivasha Hub' }, 'did:a')} actions={actions} />);
    expect(priced).toContain(t('vendor.loads.toShopWithdrawn', { code: 'FRT-AB12' }));
    expect(priced).toMatch(/Send it to Mama Njeri · [^<]*180/);
    expect(priced).toContain(t('vendor.loads.keepDoor'));
  });

  it('refused: the reason as the server gave it', () => {
    const html = renderToString(<SwitchToShopSheet state={asked({ parcelId: 'PCL-9', outcome: 'no', why: 'A driver has taken load FRT-AB12: it comes to your door.' })} actions={actions} />);
    expect(html).toContain(t('vendor.loads.toShopNo'));
    expect(html).toContain('A driver has taken load FRT-AB12: it comes to your door.');
    expect(html).not.toContain('Send it to');
  });
});
