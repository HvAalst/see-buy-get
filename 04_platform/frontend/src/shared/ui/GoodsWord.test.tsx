import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../i18n';
import { GoodsWord, goodsWordAsked } from './GoodsWord';
import type { SbgError } from '../../lib/sbg/errors';

/*
 * 2026-11-22 — TO ANOTHER EU COUNTRY (the owner's BG-2): no customs, so no invoice and no declaration — the sender says what the
 * parcel or load does not hold instead, and the server refuses it unsaid. One card for every app that sends there.
 */
const words = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
const passage = { fromCountry: 'NL', toCountry: 'BG' };

describe('goods to another EU country', () => {
  it('says there are no customs between the two countries, by name, and asks the sender’s word on what it holds', () => {
    const text = words(renderToString(<GoodsWord passage={passage} said={false} onChange={() => undefined} />));
    expect(text).toContain(t('common.union.title'));
    expect(text).toContain('From Netherlands to Bulgaria there are no customs: no invoice and no declaration.');
    expect(text).toContain(t('common.union.none'));
    expect(t('common.union.none')).toMatch(/alcohol, tobacco, medicines or weapons/);
  });

  it('shows the word as given once ticked', () => {
    const ticked = renderToString(<GoodsWord passage={passage} said onChange={() => undefined} />);
    const unticked = renderToString(<GoodsWord passage={passage} said={false} onChange={() => undefined} />);
    expect(ticked).not.toBe(unticked);
  });

  it('knows the server asking for the word from any other refusal — medicines are refused outright and asked nothing', () => {
    const asked = { code: 'GOODS_WITH_OWN_RULES', status: 400, title: '', detail: '', retryable: false, params: { field: 'noGoodsWithOwnRules', fromCountry: 'NL', toCountry: 'BG' } } as SbgError;
    expect(goodsWordAsked(asked)).toEqual(passage);
    expect(goodsWordAsked({ ...asked, params: { field: 'natureCode', fromCountry: 'NL', toCountry: 'BG' } })).toBeNull();
    expect(goodsWordAsked({ ...asked, code: 'FIELD_REQUIRED' })).toBeNull();
    expect(goodsWordAsked(null)).toBeNull();
  });
});
