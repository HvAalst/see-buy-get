import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import { sizePriceLine } from './sizePrice';
import { SizePriceNote } from './SizePriceNote';

/*
 * SIZE OR WEIGHT, WHICHEVER IS MORE (the user, 2026-10-27: "build the say"): under a measured parcel's price, which of the
 * two set it and what it counts as — with the rule a tap away. Nothing under a parcel priced by its size band.
 */
describe('what set a measured parcel’s price', () => {
  it('says size set it, with what the box counts as and what it weighs — the box from the question: 50 × 40 × 30 cm, 6 kg', () => {
    expect(sizePriceLine({ by: 'size', countsAsKg: 7.6, weighsKg: 6 }, t)).toBe('Priced by its size: it counts as 7.6 kg — it weighs 6 kg.');
  });

  it('says weight set it, when the box weighs more than its size counts as', () => {
    expect(sizePriceLine({ by: 'weight', countsAsKg: 9, weighsKg: 9 }, t)).toBe('Priced by its weight, 9 kg — by its size it counts as less (9 kg).');
  });

  it('says a whole bag, the most one parcel is charged', () => {
    expect(sizePriceLine({ by: 'size', countsAsKg: 50, weighsKg: 3, wholeBag: true }, t)).toBe('Priced as a whole bag, the most one parcel is charged: by its size it counts as 50 kg.');
  });

  it('says nothing for a parcel priced by its size band — and shows the rule a tap away when it does say', () => {
    expect(sizePriceLine(undefined, t)).toBeNull();
    expect(renderToString(<SizePriceNote />)).toBe('');
    const html = renderToString(<SizePriceNote chargedBy={{ by: 'size', countsAsKg: 7.6, weighsKg: 6 }} />);
    expect(html).toContain('it counts as 7.6 kg');
    expect(html).toContain(t('common.whatIsThis', { title: t('common.sizePrice.whyTitle') }));
    expect(t('common.sizePrice.whyRule')).toContain('divided by 7,875');
    expect(t('common.sizePrice.whyMore')).toContain(t('help.size-price.title'));
  });
});
