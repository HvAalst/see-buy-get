import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { LoadPaidAnswer } from './screens/LoadPaidAnswer';
import type { BusinessClient, PostedLoad } from './api';

/*
 * BOTH SIDES HEARD (the user, 2026-10-27: "build the shipper answer as a fair principle"): a driver said a business's load was
 * not paid; the business answers that it paid, with a reference — once, and only somebody who may act for it.
 */
const at = '2026-10-27T11:05:00Z';
const load = (over: Partial<PostedLoad> = {}) => ({ freightId: 'frt_1', code: 'FRT-001', agreedPrice: 4200, currency: 'KES', paysDriverDirect: true, ...over }) as PostedLoad;
const client = {} as BusinessClient;
const render = (row: PostedLoad, act = true) => renderToString(<LoadPaidAnswer row={row} client={client} act={act} onChanged={() => undefined} />);

describe('a business answers a driver’s “not paid”', () => {
  it('says nothing where no driver said it was not paid', () => {
    expect(render(load())).toBe('');
  });

  it('offers the answer while there is none — to somebody who may act for the business', () => {
    const html = render(load({ notPaidDirect: { at, by: 'driver' }, canAnswerNotPaid: true }));
    expect(html).toContain(t('business.paid.saidNotPaid'));
    expect(html).toContain(t('common.paidDirect.answerAsk'));
    expect(render(load({ notPaidDirect: { at, by: 'driver' }, canAnswerNotPaid: true }), false)).not.toContain(t('common.paidDirect.answerAsk'));
  });

  it('once answered, reads its answer back and offers no second one', () => {
    const html = render(load({ notPaidDirect: { at, by: 'driver' }, paidDirectAnswer: { at, reference: 'QJK4TR21XY' } }));
    expect(html).toContain(t('business.paid.answered'));
    expect(html).toContain('QJK4TR21XY');
    expect(html).not.toContain(t('common.paidDirect.answerAsk'));
  });
});
