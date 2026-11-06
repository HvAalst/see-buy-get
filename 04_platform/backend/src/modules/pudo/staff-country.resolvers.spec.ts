import { StaffCountryResolvers } from './staff-country.resolvers';

/*
 * 2026-11-06 — A FLAG CASE IS NAMED AFTER WHAT IT IS ABOUT. A Bags_Waiting case: its place — a shop, a store's own place, or
 * (since bags waiting at a hub get the same; the owner: "I follow point 1 to 6") a hub. A Cargo_After_Shift case: the
 * driver, by their pass. Staff of a country see the cases of their country's places and drivers.
 */
describe('a flag case’s subject, read as a country', () => {
  const resolvers = (over: { shops?: unknown[]; docks?: unknown[]; hubs?: unknown[]; drivers?: Record<string, { did: string; jurisdiction?: string }> } = {}) => {
    const none = {} as never;
    const parcels = { get: () => { throw new Error('not a parcel'); } };
    const dispatch = { freightByCode: () => undefined };
    const totes = { byCodeMaybe: () => undefined };
    const agents = { list: () => over.shops ?? [] };
    const vendors = { list: () => over.docks ?? [], get: () => ({ country: 'UG' }) };
    const mdps = { list: () => over.hubs ?? [] };
    const byBadge = over.drivers ?? {};
    const drivers = { byBadge: (badge: string) => byBadge[badge], get: (did: string) => Object.values(byBadge).find((d) => d.did === did) };
    return new StaffCountryResolvers(none, agents as never, mdps as never, vendors as never, none, drivers as never, none, parcels as never, dispatch as never, none, none, none, none, none, none, none, none, none, none, totes as never, none, none, none);
  };
  const subjectOf = (r: StaffCountryResolvers, subject: string) => (r as unknown as { flagSubjectCountries(s: string): string[] | null }).flagSubjectCountries(subject);

  it('a hub, by its name: its country', () => {
    expect(subjectOf(resolvers({ hubs: [{ mdpId: 'mdp_1', name: 'Central Sort', country: 'KE' }] }), 'Central Sort')).toEqual(['KE']);
  });

  it('a driver, by their pass: their country', () => {
    expect(subjectOf(resolvers({ drivers: { 'DRV-0042': { did: 'did:drv:amos', jurisdiction: 'TZ' } } }), 'DRV-0042')).toEqual(['TZ']);
  });

  it('a shop by its name comes first; a subject nobody has is nothing', () => {
    expect(subjectOf(resolvers({ shops: [{ shopName: 'Central Sort', country: 'TZ' }], hubs: [{ mdpId: 'mdp_1', name: 'Central Sort', country: 'KE' }] }), 'Central Sort')).toEqual(['TZ']);
    expect(subjectOf(resolvers(), 'Nowhere')).toBeNull();
  });
});
