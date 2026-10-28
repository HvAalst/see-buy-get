import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { LoadReservations } from './screens/LoadReservations';
import type { BusinessClient, PostedLoad } from './api';

/*
 * CMR Art. 8(2): what the driver noted at taking over binds the sender only where it agrees. The sender answers once —
 * agreed, or disputed in its own words — from the load in the Business app.
 */
const row = (reservations?: PostedLoad['reservations']) => ({ freightId: 'fr_1', code: 'FRT-001', ...(reservations ? { reservations } : {}) }) as unknown as PostedLoad;
const render = (r: PostedLoad, act = true) => renderToString(<LoadReservations row={r} client={{} as BusinessClient} act={act} onChanged={() => undefined} />);

describe('the driver’s reservations, answered by the sender', () => {
  it('shows what the driver wrote, and asks the sender to agree or dispute it', () => {
    const html = render(row({ note: 'Two pallets wrapped loose', at: '2026-10-28T09:00:00Z' }));
    expect(html).toContain('Two pallets wrapped loose');
    expect(html).toContain(t('business.reservations.tagOpen'));
    expect(html).toContain(t('business.reservations.agree'));
    expect(html).toContain(t('business.reservations.dispute'));
  });

  it('once answered, says how and by whom, and asks nothing more', () => {
    const html = render(row({ note: 'Two pallets wrapped loose', at: '2026-10-28T09:00:00Z', answer: { agreed: false, note: 'Wrapped tight at loading', by: 'Wanjiku', at: '2026-10-28T10:00:00Z' } }));
    expect(html).toContain(t('business.reservations.tagDisputed'));
    expect(html).toContain('Wrapped tight at loading');
    expect(html).not.toContain(t('business.reservations.agree'));
  });

  it('a viewer reads it and cannot answer; a load with none shows nothing', () => {
    expect(render(row({ note: 'Torn sack', at: '2026-10-28T09:00:00Z' }), false)).not.toContain(t('business.reservations.agree'));
    expect(render(row())).toBe('');
  });
});
