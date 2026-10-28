import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { DriverCoverCard } from './screens/DriverCoverCard';
import type { DriverActions, DriverState } from './useDriverApp';

/*
 * A DRIVER RIDING FOR THEMSELVES PROVES THEIR OWN COVER (the user, 2026-10-28: "Someone willing to invest in it should be
 * rewarded for it"): send the policy; once SeeBuyGet has read it, loads that ask for cover are open.
 */
const render = (driver: Record<string, unknown> | null) =>
  renderToString(<DriverCoverCard state={{ driver } as unknown as DriverState} actions={{ uploadPhoto: async () => null, refresh: async () => undefined } as unknown as DriverActions} sbg={null} />);

describe('your own insurance cover', () => {
  it('says what cover opens, and asks for the policy', () => {
    const html = render({ did: 'did:drv:1', displayName: 'Rider' });
    expect(html).toContain(t('driver.cover.title'));
    expect(html).toContain(t('driver.cover.send'));
  });

  it('while a policy waits, says so; once read, what it covers and until when', () => {
    expect(render({ did: 'did:drv:1', displayName: 'Rider', cover: { sent: { copyRef: 'med_1', expiresAt: '2031-10-28', sentAt: '2026-10-28T10:00:00Z' } } })).toContain(t('driver.cover.sendAgain'));
    const html = render({ did: 'did:drv:1', displayName: 'Rider', cover: { copyRef: 'med_1', expiresAt: '2031-10-28', limit: 300000, currency: 'KES', policy: 'GIT-R-9' } });
    expect(html).toContain('up to 300,000 KES a load');
  });

  it('shows the reason a policy was refused, as written', () => {
    expect(render({ did: 'did:drv:1', displayName: 'Rider', cover: { refused: { reason: 'This is the quote, not the policy', at: '2026-10-28T10:00:00Z' } } })).toContain('This is the quote, not the policy');
  });

  it('asks nothing of a fleet’s driver: the fleet’s cover is theirs', () => {
    expect(render({ did: 'did:drv:2', displayName: 'Baraka', managerDid: 'did:fleet:kilima' })).toBe('');
  });
});
