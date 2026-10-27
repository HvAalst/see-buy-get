import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { ReleaseScreen } from './screens/ReleaseScreen';
import { money } from './logic';
import type { ParcelView } from './types';
import type { AgentActions, AgentState } from './useAgentApp';

/*
 * WHAT THE COUNTER TAKES IN CASH, said before it hands a parcel over by its four-digit code (2026-10-27): a person's goods
 * turned round at a hub pay their way back here, and a parcel past its free days its holding fee — the same figures the
 * person's own app shows them.
 */
const at = (parcel: Partial<ParcelView>) =>
  renderToString(
    <ReleaseScreen
      state={
        {
          release: { stickerId: 'PUD-1', parcel: { parcelId: 'PUD-1', size: 'M', status: 'Ready_For_Pickup', destZone: 'Z', ...parcel }, otp: '', stars: 0, photoRef: '' },
          collect: { code: '1234', found: null },
          error: null,
          busy: null,
          shopParcels: [],
        } as unknown as AgentState
      }
      actions={{} as AgentActions}
    />,
  );

describe('the counter is told what to take in cash before the hand-over', () => {
  it('a person’s goods turned round at a hub: their way back', () => {
    const html = at({ payAtCollection: { amount: 180, currency: 'KES' } });
    expect(html).toContain(t('agent.release.wayBackTitle', { amount: money(180, 'KES') }));
    expect(html).toContain(t('agent.release.wayBackDetail'));
    // Before the code is asked for, never after it.
    expect(html.indexOf(t('agent.release.wayBackTitle', { amount: money(180, 'KES') }))).toBeLessThan(html.indexOf(t('agent.release.enterCode')));
  });

  it('past its free days: the holding fee as well', () => {
    const html = at({ status: 'Unclaimed', payAtCollection: { amount: 180, currency: 'KES' }, holdingOwed: 40, holdingCurrency: 'KES' });
    expect(html).toContain(t('agent.release.wayBackTitle', { amount: money(180, 'KES') }));
    expect(html).toContain(t('agent.collect.holdingTitle', { amount: money(40, 'KES') }));
  });

  it('nothing owed: nothing said', () => {
    const html = at({});
    expect(html).toContain(t('agent.release.enterCode'));
    expect(html).not.toContain(t('agent.release.wayBackDetail'));
    expect(html).not.toContain(t('agent.collect.holdingDetail'));
  });
});
