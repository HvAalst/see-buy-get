import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { FiscalFields, LoadFiscal } from './screens/FiscalFields';
import type { PostedLoad } from './api';

/*
 * 2026-11-24 — THE CODES IN THE BUSINESS APP (the owner's brief): each country's code or reason, the business's certification,
 * and on a posted load whether it went with codes only, and a code running out.
 */
describe('the codes Romania and Bulgaria follow goods by, in the Business app', () => {
  it('asks each country, and the certification under them', () => {
    const html = renderToString(<FiscalFields countries={['BG']} value={{}} onChange={() => undefined} />);
    expect(html).toContain(t('common.fiscal.bgHead'));
    expect(html).toContain(t('common.fiscal.indemnity').slice(0, 30));
    expect(html).not.toContain(t('common.fiscal.roHead'));
    expect(renderToString(<FiscalFields countries={[]} value={{}} onChange={() => undefined} />)).toBe('');
  });

  it('on a posted load: whether it went with codes only, each code, and a code running out said with its moment', () => {
    const row = {
      freightId: 'frt_1',
      code: 'FRT-1',
      status: 'claimed',
      fiscalCompliance: 'declared_with_codes',
      fiscalCodes: [{ country: 'RO', kind: 'UIT', code: 'RO1234567890', validThrough: '2026-11-27', expiresAt: '2026-11-27T21:59:59.999Z', status: 'expiring_soon' }],
    } as unknown as PostedLoad;
    const html = renderToString(<LoadFiscal row={row} client={null} act={false} onChanged={() => undefined} />);
    expect(html).toContain(t('common.fiscal.declaredWithCodes'));
    expect(html).toContain('RO1234567890');
    expect(html).toContain(t('common.fiscal.cardEndsSoon', { date: '' }).slice(0, 8));
    expect(renderToString(<LoadFiscal row={{ ...row, fiscalCodes: [] } as PostedLoad} client={null} act={false} onChanged={() => undefined} />)).toBe('');
  });
});
