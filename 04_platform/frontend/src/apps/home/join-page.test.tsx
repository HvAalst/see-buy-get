import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { EMPTY_JOIN, ROLES } from './logic';
import { JoinScreen } from './screens/JoinScreen';

/*
 * THE PAGE THE NAME WILL GIVE, shown under the name while signing up (the owner, 2026-10-30: "how is the public name
 * chosen, can they claim it already?"). Nobody claims one: it is made from the name, once staff have approved them.
 * Shown to a shop, a hub and a fleet, who are given a page; never to a store, which is not, nor to a driver.
 */
const role = (id: string) => ROLES.find((r) => r.id === id)!;
const render = (id: string, form: Record<string, unknown>) => {
  const state = { role: role(id), step: 'about', form: { ...EMPTY_JOIN, country: 'NL', ...form }, busy: null, countries: [], countriesState: 'idle', issuedCode: null, points: [] } as never;
  return renderToString(<JoinScreen state={state} actions={{ setForm: () => undefined } as never} />);
};

describe('signing up: the page the name will give', () => {
  it('asks a shop, a hub and a store to choose their name', () => {
    expect(render('pudo', {})).toContain('Choose your shop name');
    expect(render('mdp', {})).toContain('Choose your hub name');
    expect(render('vendor', {})).toContain('Choose your store name');
  });

  it('shows a shop and a hub their page under the name, accents and all, and says it waits for approval', () => {
    const hub = render('mdp', { displayName: 'Citroën Sorteercentrum' });
    expect(hub).toContain('/@citroen-sorteercentrum');
    expect(hub).toContain('once we have approved you');
    expect(render('pudo', { displayName: 'Mama Sarah Shop' })).toContain('/@mama-sarah-shop');
  });

  it('shows a fleet its page under the registered company name', () => {
    expect(render('fleet', { displayName: 'Kilima Logistics Ltd' })).toContain('/@kilima-logistics-ltd');
  });

  it('shows nothing while the name gives nothing, and nothing to a store or a driver', () => {
    expect(render('mdp', { displayName: '' })).not.toContain('/@');
    expect(render('vendor', { displayName: 'Nairobi Threads' })).not.toContain('/@');
    expect(render('driver', { displayName: 'Amos K.' })).not.toContain('/@');
  });
});
