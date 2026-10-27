import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../i18n';
import { PaidDirectSheet } from './PaidDirectSheet';

/**
 * "WERE YOU PAID?" (the user, 2026-10-27: "Driver ticks 'paid'"): asked once, naming the load and the amount, before the carrier
 * says on the record that the shipper paid — the driver for themselves, the office for its fleet.
 */
describe('were you paid for this load?', () => {
  const sheet = (office?: boolean) => renderToString(<PaidDirectSheet open code="FRT-042" amount="KES 4,200.00" office={office} onYes={() => undefined} onClose={() => undefined} />);

  it('names the load and the amount, says the shipper sees it, and that SeeBuyGet carries no money', () => {
    const html = sheet();
    expect(html).toContain(t('common.paidDirect.title'));
    expect(html).toContain('FRT-042');
    expect(html).toContain(t('common.paidDirect.yes', { amount: 'KES 4,200.00' }));
    expect(html).toContain(t('common.paidDirect.notYet'));
    expect(t('common.paidDirect.body', { amount: 'X', code: 'Y' })).toContain('SeeBuyGet carries no money for this load');
  });

  it('the fleet office says "we", for its fleet', () => {
    const html = sheet(true);
    expect(html).toContain(t('common.paidDirect.yesOffice', { amount: 'KES 4,200.00' }));
    expect(html).not.toContain(t('common.paidDirect.yes', { amount: 'KES 4,200.00' }));
  });
});
