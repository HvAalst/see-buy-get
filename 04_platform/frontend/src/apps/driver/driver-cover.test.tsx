import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { CoverSheet, DriverCoverCard, coverRowSub, keepsOwnCover } from './screens/DriverCoverCard';
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

  /* 2026-11-13 — the owner could not find it after skipping the papers: a row in the account menu, on every screen. */
  it('in the account menu: a row for a driver riding for themselves, saying where the cover stands', () => {
    const today = '2026-11-13';
    const rider = (cover?: Record<string, unknown>) => ({ did: 'did:drv:1', displayName: 'Rider', ...(cover ? { cover } : {}) }) as never;
    expect(coverRowSub(rider(), t, today)).toBe(t('driver.cover.rowOff'));
    expect(coverRowSub(rider({ sent: { copyRef: 'med_1', expiresAt: '2031-10-28', sentAt: '2026-10-28T10:00:00Z' } }), t, today)).toBe(t('driver.cover.rowSent'));
    expect(coverRowSub(rider({ refused: { reason: 'Quote, not policy', at: '2026-10-28T10:00:00Z' } }), t, today)).toBe(t('driver.cover.rowRefused'));
    expect(coverRowSub(rider({ copyRef: 'med_1', expiresAt: '2031-10-28' }), t, today)).toContain('2031');
    // Run out: not sent, as far as loads are concerned.
    expect(coverRowSub(rider({ copyRef: 'med_1', expiresAt: '2026-01-01' }), t, today)).toBe(t('driver.cover.rowOff'));
    expect(keepsOwnCover(rider())).toBe(true);
    expect(keepsOwnCover({ did: 'did:drv:2', managerDid: 'did:fleet:kilima' } as never)).toBe(false);
    expect(keepsOwnCover({ did: 'did:drv:3', removedFrom: { fleetName: 'Kilima' } } as never)).toBe(false);
    expect(keepsOwnCover(null)).toBe(false);
  });

  it('the sheet opened from the menu says where it stands, then asks for the photo, the day it runs until and the number', () => {
    const sheet = (driver: Record<string, unknown>) =>
      renderToString(<CoverSheet state={{ driver } as unknown as DriverState} actions={{ uploadPhoto: async () => null, refresh: async () => undefined } as unknown as DriverActions} sbg={null} onClose={() => undefined} withStatus />);
    const html = sheet({ did: 'did:drv:1', displayName: 'Rider', cover: { refused: { reason: 'This is the quote, not the policy', at: '2026-10-28T10:00:00Z' } } });
    expect(html).toContain('This is the quote, not the policy');
    expect(html).toContain(t('driver.cover.photo'));
    expect(html).toContain(t('driver.cover.expires'));
    expect(html).toContain(t('driver.cover.policy'));
    expect(sheet({ did: 'did:drv:2', displayName: 'Baraka', managerDid: 'did:fleet:kilima' })).toBe('');
  });
});
