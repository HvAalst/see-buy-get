import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { DestinationCard } from './screens/AcceptScreen';
import { EMPTY_ACCEPT } from './logic';
import type { AgentActions, AgentState } from './useAgentApp';

/*
 * 2026-11-05 — THE OWNER: once "Collected here, at this shop" is ticked, the map and the list of other shops fold away, so
 * the counter does not scroll past a picker it no longer needs. One link brings them back.
 */
const me = { did: 'did:shop:me', zone: 'Z1', shopName: 'My Kiosk', country: 'KE' };
const other = { did: 'did:shop:other', zone: 'Z2', shopName: 'Other Kiosk', openState: 'open', takesNew: true };
const card = (destPudoDid: string) =>
  renderToString(
    <DestinationCard
      state={
        {
          agent: me,
          accept: { ...EMPTY_ACCEPT, destPudoDid, destShopName: destPudoDid === me.did ? me.shopName : destPudoDid ? other.shopName : '' },
          acceptPoints: [other],
          acceptPointsState: 'ready',
          acceptNear: null,
        } as unknown as AgentState
      }
      actions={{} as AgentActions}
    />,
  );

describe('the take-in destination, collected here', () => {
  it('shows the other shops until "Collected here" is ticked', () => {
    const html = card('');
    expect(html).toContain(t('agent.accept.here'));
    expect(html).toContain(other.shopName);
    expect(html).toContain(t('agent.accept.pickShop'));
    expect(html).not.toContain(t('agent.accept.hereOther'));
  });

  it('folds the map and the other shops away once ticked, with one link back', () => {
    const html = card(me.did);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain(t('agent.accept.hereOther'));
    expect(html).not.toContain(other.shopName);
    expect(html).not.toContain(t('agent.accept.pickShop'));
    expect(html).not.toContain(t('agent.accept.byArea'));
  });

  it('another shop picked: the list stays, and says where it is going', () => {
    const html = card(other.did);
    expect(html).toContain(other.shopName);
    expect(html).toContain(t('agent.accept.goingTo'));
    expect(html).not.toContain(t('agent.accept.hereOther'));
  });
});
