import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../../shared/i18n';
import { MintScreen } from './MintScreen';
import type { VendorActions, VendorState } from '../useVendorApp';

/*
 * WHERE THE BUYER COLLECTS (2026-10-25). The store was told to "ask the buyer for their three words" — the guess the
 * user ruled out in the Send app the same day ("nearly mission impossible for new comers and they have no way to
 * confirm if their guess is right"). What is held to here: the step asks for the address on the order, or a tap on
 * the map, and credits where an address is found.
 */
const dest = (over: Partial<VendorState> = {}) =>
  renderToString(
    <MintScreen
      state={
        {
          mintStep: 'dest',
          points: [{ did: 'did:a', shopName: 'Mama Njeri', zone: 'Z-A', country: 'KE', openState: 'open', pricePerParcel: 1.5, currency: 'KES', location: { lat: -1.28, lng: 36.82 } }],
          pointsState: 'ready',
          error: null,
          ...over,
        } as unknown as VendorState
      }
      actions={{} as VendorActions}
    />,
  );

describe('where the buyer collects', () => {
  it('asks for the buyer’s address, or a tap on the map — never for their three words', () => {
    const html = dest();
    expect(html).toContain(t('vendor.mint.buyerPlace'));
    expect(html).toContain(t('vendor.mint.buyerPlacePh'));
    expect(html).toContain(t('vendor.mint.placeHint'));
    expect(html).not.toContain('goldfox calmriver blueowl');
    expect(html).not.toMatch(/their three words/);
  });

  it('credits OpenStreetMap, where the address is found, with the link it asks for', () => {
    expect(dest()).toContain('href="https://www.openstreetmap.org/copyright"');
  });
});
