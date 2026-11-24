import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import { fiscalBody, fiscalCardWords, fiscalCodesAsked, fiscalCountriesOf, fiscalDay, fiscalEntryReady, fiscalMoment, fiscalReady } from './fiscal-codes';
import { FiscalCodeLines, FiscalCodes } from './ui/FiscalCodes';

/*
 * 2026-11-23 — THE CODES ROMANIA AND BULGARIA FOLLOW GOODS BY, as the forms ask them (backend fiscal-codes.ts; the owner:
 * "dedicated fields for both Romanian UIT and Bulgarian UTN codes"): asked where a load is taken over or delivered, answered by a
 * code with its day or a reason, and said back to the driver and the sender.
 */
describe('the codes Romania and Bulgaria follow goods by, in the apps', () => {
  it('asked where a load is taken over or delivered in either, never where it only passes', () => {
    expect(fiscalCountriesOf('NL', 'BG')).toEqual(['BG']);
    expect(fiscalCountriesOf('ro', 'BG')).toEqual(['RO', 'BG']);
    expect(fiscalCountriesOf('NL', 'DE')).toEqual([]);
  });

  it('reads the countries the server asked, and nothing from any other refusal', () => {
    expect(fiscalCodesAsked({ code: 'FIELD_REQUIRED', status: 400, title: '', detail: '', retryable: false, params: { field: 'fiscalCodes', countries: 'RO,BG' } })).toEqual(['RO', 'BG']);
    expect(fiscalCodesAsked({ code: 'FIELD_REQUIRED', status: 400, title: '', detail: '', retryable: false, params: { field: 'contactPhone' } })).toBeNull();
    expect(fiscalCodesAsked(null)).toBeNull();
    // Another field's refusal, even one that names countries, asks no code.
    expect(fiscalCodesAsked({ code: 'FIELD_REQUIRED', status: 400, title: '', detail: '', retryable: false, params: { field: 'contactPhone', countries: 'RO' } })).toBeNull();
  });

  it('ready: a reason, or a code of letters and digits with its day', () => {
    expect(fiscalEntryReady(undefined)).toBe(false);
    expect(fiscalEntryReady({ choice: 'not-listed', code: '', from: '' })).toBe(true);
    expect(fiscalEntryReady({ choice: 'code', code: 'RO 1234-5678', from: '2026-11-24' })).toBe(true);
    expect(fiscalEntryReady({ choice: 'code', code: 'RO 1234-5678', from: '' })).toBe(false);
    expect(fiscalEntryReady({ choice: 'code', code: '12#4', from: '2026-11-24' })).toBe(false);
    expect(fiscalReady({ BG: { choice: 'not-listed', code: '', from: '' } }, ['RO', 'BG'])).toBe(false);
    // 2026-11-24 — and the sender's certification, wherever anything is asked.
    expect(fiscalReady({ BG: { choice: 'not-listed', code: '', from: '' } }, ['BG'])).toBe(false);
    expect(fiscalReady({ BG: { choice: 'not-listed', code: '', from: '' }, indemnity: true }, ['BG'])).toBe(true);
    expect(fiscalReady({}, [])).toBe(true);
  });

  it('sends each asked country’s code with its day, or its reason; nothing for a country not asked', () => {
    expect(fiscalBody({ RO: { choice: 'code', code: ' 9A1B2C3D ', from: '2026-11-24' }, BG: { choice: 'not-listed', code: 'x', from: '' } }, ['RO', 'BG'])).toEqual({ ro: { code: '9A1B2C3D', from: '2026-11-24' }, bg: { exempt: 'not-listed' } });
    expect(fiscalBody({ RO: { choice: 'excise', code: '', from: '' } }, ['BG'])).toBeUndefined();
    expect(fiscalBody({ BG: { choice: 'not-listed', code: '', from: '' }, indemnity: true }, ['BG'])).toEqual({ bg: { exempt: 'not-listed' }, indemnity: true });
    expect(fiscalBody({ indemnity: true }, ['BG'])).toBeUndefined();
  });

  it('says a code back, and one that ran out or is about to', () => {
    const day = (iso: string) => fiscalDay(iso, 'en-GB');
    expect(fiscalCardWords({ country: 'RO', kind: 'UIT', code: '9A1B2C3D', validThrough: '2026-11-27' }, t, 'Romania', day)).toEqual({ line: 'Romania: UIT 9A1B2C3D, valid through 27 Nov 2026', tone: 'ok' });
    expect(fiscalCardWords({ country: 'RO', kind: 'UIT', code: '9A1B2C3D', validThrough: '2026-11-27', status: 'expired' }, t, 'Romania', day)).toMatchObject({ tone: 'danger', warn: t('common.fiscal.cardExpired', { date: '27 Nov 2026' }) });
    expect(fiscalCardWords({ country: 'BG', kind: 'UTN', exempt: 'not-listed' }, t, 'Bulgaria', day).line).toBe(t('common.fiscal.cardNotListed', { country: 'Bulgaria' }));
    expect(fiscalCardWords({ country: 'RO', kind: 'UIT', exempt: 'thresholds' }, t, 'Romania', day).line).toMatch(/no UIT code\. The sender says no part weighs over 500 kg/);
  });

  it('the card asks each country with its own words; the lines say each code, the term explained where it stands', () => {
    // 2026-11-24 — running out within 24 hours: said with its moment.
    const soon = fiscalCardWords({ country: 'RO', kind: 'UIT', code: '9A1B2C3D', validThrough: '2026-11-27', expiresAt: '2026-11-27T21:59:59.999Z', status: 'expiring_soon' }, t, 'Romania', (iso) => fiscalDay(iso, 'en-GB'), () => '27 Nov, 23:59');
    expect(soon).toMatchObject({ tone: 'warn', warn: t('common.fiscal.cardEndsSoon', { date: '27 Nov, 23:59' }) });
    expect(fiscalMoment('nonsense', 'en-GB')).toBe('nonsense');
    const form = renderToString(<FiscalCodes countries={['RO', 'BG']} value={{ RO: { choice: 'code', code: '', from: '' } }} onChange={() => undefined} idPrefix="f" />);
    expect(form).toContain(t('common.fiscal.indemnity').slice(0, 30));
    expect(form).toContain(t('common.fiscal.roHead'));
    expect(form).toContain(t('common.fiscal.bgHead'));
    expect(form).toContain(t('common.fiscal.roFrom'));
    expect(form).not.toContain(t('common.fiscal.bgFrom'));
    expect(renderToString(<FiscalCodes countries={[]} value={{}} onChange={() => undefined} idPrefix="f" />)).toBe('');
    // Bulgaria's code asks the day it was issued, not Romania's day.
    const bg = renderToString(<FiscalCodes countries={['BG']} value={{ BG: { choice: 'code', code: '', from: '' } }} onChange={() => undefined} idPrefix="f" />);
    expect(bg).toContain(t('common.fiscal.bgFrom'));
    expect(bg).not.toContain(t('common.fiscal.roFrom'));
    const lines = renderToString(<FiscalCodeLines cards={[{ country: 'RO', kind: 'UIT', code: '9A1B2C3D', validThrough: '2026-11-27' }]} title="Show at a check" />);
    expect(lines).toContain('9A1B2C3D');
    expect(lines).toContain(t('abbr.uit.name'));
    expect(renderToString(<FiscalCodeLines cards={[]} />)).toBe('');
    // 2026-11-24 — whether the load went with codes only.
    expect(renderToString(<FiscalCodeLines cards={[{ country: 'BG', kind: 'UTN', exempt: 'not-listed' }]} compliance="exempt_declared_by_sender" />)).toContain(t('common.fiscal.exemptDeclared'));
  });
});
