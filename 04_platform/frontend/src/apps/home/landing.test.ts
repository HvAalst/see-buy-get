import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { appsOnThisDevice, formatDuration, readDeepLink } from './logic';

describe('the front page', () => {
  it('offers a returning visitor exactly the apps this device has signed in to', () => {
    const store = new Map([
      ['glos-driver-did', 'did:glos:a'],
      ['glos-send-did', 'did:glos:b'],
      ['glos-agent-did', ''], // signed out leaves nothing worth offering
    ]);
    expect(appsOnThisDevice({ getItem: (k) => store.get(k) ?? null }).map((a) => a.href)).toEqual(['/driver/', '/send/']);
    // B1 — somebody who works for a business is offered the Business app, and it has a name to be offered by.
    store.set('glos-business-did', 'did:glos:c');
    expect(appsOnThisDevice({ getItem: (k) => store.get(k) ?? null }).map((a) => a.href)).toEqual(['/driver/', '/send/', '/business/']);
    expect(t('home.landing.back.business')).toBe('Business app');
    expect(appsOnThisDevice(undefined)).toEqual([]);
    // Storage that throws (a locked-down browser) offers nothing and breaks nothing.
    expect(appsOnThisDevice({ getItem: () => { throw new Error('denied'); } })).toEqual([]);
  });

  it('says a duration the way a person reads it', () => {
    expect(formatDuration(0, t)).toBe('0 min');
    expect(formatDuration(45, t)).toBe('45 min');
    expect(formatDuration(540, t)).toBe('9 h');
    expect(formatDuration(545, t)).toBe('9 h 5 min');
    expect(formatDuration(3 * 24 * 60, t)).toBe('3 days');
  });

  it('follows a card’s address to its screen, and nothing it does not know', () => {
    expect(readDeepLink('?join=driver')).toEqual({ join: 'driver' });
    // 2026-11-12 — an invitation from "where hubs are needed": the place filled in; a point that does not read as one is dropped.
    expect(readDeepLink('?join=mdp&near=2.3284,37.9899&place=Marsabit')).toEqual({ join: 'mdp', near: { lat: 2.3284, lng: 37.9899 }, place: 'Marsabit' });
    expect(readDeepLink('?join=mdp&near=999,1&place=')).toEqual({ join: 'mdp' });
    expect(readDeepLink('?join=mdp&near=95,181')).toEqual({ join: 'mdp' });
    expect(readDeepLink('?join=mdp&near=javascript:1')).toEqual({ join: 'mdp' });
    expect(readDeepLink('?go=market')).toEqual({ go: 'market' });
    // 2026-11-08 — which price zone a place is in (zone pricing): a real address too.
    expect(readDeepLink('?go=zones')).toEqual({ go: 'zones' });
    expect(readDeepLink('?join=admin')).toBeNull();
    expect(readDeepLink('?go=tower')).toBeNull();
    expect(readDeepLink('')).toBeNull();
  });
});
