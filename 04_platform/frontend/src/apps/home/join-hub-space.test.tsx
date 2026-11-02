import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { EMPTY_JOIN, roleById, signupBody, stepBlocker, type JoinForm } from './logic';
import { JoinScreen } from './screens/JoinScreen';

/*
 * 2026-11-02 — A HUB SAYS ITS SPACE AS IT SIGNS UP (the owner: "shouldn't a hub also declare its space?"): on "About your
 * hub", two numbers with plain hints, started at an ordinary hub's — how many bags its floor holds at once, how many
 * parcels it sorts in a day — checked as the server checks them, and sent with the sign-up. Nobody else is asked.
 */
const role = (id: string) => roleById(id)!;
const about = (id: string, form: Partial<JoinForm> = {}) =>
  renderToString(
    <JoinScreen
      state={{ role: role(id), step: 'about', form: { ...EMPTY_JOIN, country: 'KE', ...form }, busy: null, countries: [], countriesState: 'idle', issuedCode: null, points: [] } as never}
      actions={{ setForm: () => undefined } as never}
    />,
  );
const hubForm = (over: Partial<JoinForm> = {}): JoinForm => ({ ...EMPTY_JOIN, country: 'KE', displayName: 'Central Sort', zone: 'Z-A', location: { lat: -1.28, lng: 36.82 }, ...over });

describe('a hub says its space as it signs up', () => {
  it('asks the two numbers on “About your hub”, each with its hint, started at 40 bag places and 600 parcels a day', () => {
    const html = about('mdp');
    expect(html).toContain('Your hub’s space');
    expect(html).toContain('Bag places');
    expect(html).toContain('How many bags can stand on your floor at once: bags waiting to be sorted, and bags being filled or waiting for a driver.');
    expect(html).toContain('Parcels sorted in a day');
    expect(html).toContain('How many parcels your people sort on a normal day.');
    expect(html).toMatch(/id="hub-places"[^>]*value="40"|value="40"[^>]*id="hub-places"/);
    expect(html).toMatch(/id="hub-per-day"[^>]*value="600"|value="600"[^>]*id="hub-per-day"/);
    // A shop is not asked.
    expect(about('pudo')).not.toContain('Bag places');
  });

  it('refuses what the server would, in words, before the sign-up is sent', () => {
    const hub = role('mdp');
    expect(stepBlocker(hub, 'about', hubForm(), t)).toBeNull();
    expect(stepBlocker(hub, 'about', hubForm({ bagPlaces: '0' }), t)).toBe(t('home.block.hubPlaces'));
    expect(stepBlocker(hub, 'about', hubForm({ bagPlaces: '2.5' }), t)).toBe(t('home.block.hubPlaces'));
    expect(stepBlocker(hub, 'about', hubForm({ bagPlaces: '' }), t)).toBe(t('home.block.hubPlaces'));
    expect(stepBlocker(hub, 'about', hubForm({ sortPerDay: '2000000' }), t)).toBe(t('home.block.hubPerDay'));
  });

  it('sends both numbers with the hub, as numbers', () => {
    const body = signupBody(role('mdp'), hubForm({ bagPlaces: ' 25 ', sortPerDay: '350' }), 'x') as { profile: { mdp: Record<string, unknown> } };
    expect(body.profile.mdp).toMatchObject({ bagPlaces: 25, sortPerDay: 350 });
    const shop = signupBody(role('pudo'), hubForm(), 'x') as { profile: { agent: Record<string, unknown> } };
    expect(shop.profile.agent).not.toHaveProperty('bagPlaces');
  });
});
