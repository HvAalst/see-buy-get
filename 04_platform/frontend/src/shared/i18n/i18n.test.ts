import { beforeEach, describe, expect, it } from 'vitest';
import { detectLocale, formatMoney, formatNumber, getLocale, isLocale, isRTL, setLocale, t } from './index';

// The vitest env is `node` (no document/localStorage) — the module no-ops those safely, so we assert on the
// pure translation/format behaviour, not the document stamping (which only runs in a browser).
beforeEach(() => setLocale('en'));

describe('i18n core', () => {
  it('translates in the active locale and interpolates {params}, across a switch', () => {
    expect(t('common.retry')).toBe('Try again');
    expect(t('common.greeting', { name: 'Ada' })).toBe('Hi, Ada');

    setLocale('sw');
    expect(getLocale()).toBe('sw');
    expect(t('common.retry')).toBe('Jaribu tena');
    expect(t('common.greeting', { name: 'Ada' })).toBe('Habari, Ada');

    setLocale('fr');
    expect(t('common.greeting', { name: 'Ada' })).toBe('Bonjour, Ada');
  });

  it('falls back to the key for an unknown message and keeps an unmatched placeholder', () => {
    expect(t('nope.nope' as never)).toBe('nope.nope');
    expect(t('common.greeting')).toBe('Hi, {name}'); // no params → the placeholder is left intact
  });

  it('guards the supported set (isLocale/isRTL) and ignores an unknown setLocale', () => {
    expect(isLocale('am')).toBe(true);
    expect(isLocale('zz')).toBe(false);
    expect(isRTL('ar')).toBe(true);
    expect(isRTL('en')).toBe(false);

    setLocale('sw');
    setLocale('zz' as never); // not a locale → ignored, stays sw
    expect(getLocale()).toBe('sw');
  });

  it('detectLocale returns a supported locale', () => {
    expect(isLocale(detectLocale())).toBe(true);
  });

  it('formats numbers and money for the active locale (Intl)', () => {
    setLocale('en');
    expect(formatNumber(1000)).toBe('1,000');
    expect(formatMoney(1234.5)).toBe('1,234.50');
    expect(formatMoney(1234.5, 'USD')).toContain('1,234.50');
    // A per-km rate is set to the thousandth: the currency's own two decimals would show 0.083 as 0.08. Intl keeps the
    // code and the figure together with a no-break space ( ).
    expect(formatMoney(0.0834, 'KES', 3)).toBe('KES\u00a00.083');
    expect(formatMoney(0.08, 'KES', 3)).toBe('KES\u00a00.080');
    expect(formatMoney(0.0834, undefined, 3)).toBe('0.083');
  });
});
