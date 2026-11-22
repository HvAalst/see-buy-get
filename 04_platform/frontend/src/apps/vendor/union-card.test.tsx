import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { UnionCard } from './screens/UnionCard';

/*
 * 2026-11-22 — TO ANOTHER EU COUNTRY (the owner's BG-2): no customs, so no invoice and no declaration — the store says what the
 * parcel does not hold instead, and the server refuses it unsaid.
 */
const words = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'");

describe('a store’s parcel to another EU country', () => {
  it('says there are no customs between the two countries, by name, and asks the store’s word on what it holds', () => {
    const text = words(renderToString(<UnionCard passage={{ union: 'EU', fromCountry: 'NL', toCountry: 'BG' }} said={false} onChange={() => undefined} />));
    expect(text).toContain(t('vendor.union.title'));
    expect(text).toContain('From Netherlands to Bulgaria there are no customs: no invoice and no declaration.');
    expect(text).toContain(t('vendor.union.none'));
    expect(t('vendor.union.none')).toMatch(/alcohol, tobacco, medicines or weapons/);
  });

  it('shows the word as given once ticked', () => {
    const ticked = renderToString(<UnionCard passage={{ union: 'EU', fromCountry: 'NL', toCountry: 'BG' }} said onChange={() => undefined} />);
    const unticked = renderToString(<UnionCard passage={{ union: 'EU', fromCountry: 'NL', toCountry: 'BG' }} said={false} onChange={() => undefined} />);
    expect(ticked).not.toBe(unticked);
  });
});
