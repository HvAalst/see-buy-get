import { SiteService, SITE_KINDS } from './site.service';

/**
 * A place a company saves once and chooses afterwards.
 *
 * The cases worth asserting are the ones that decide whether a TRUCK goes to the right gate and whether
 * a consignment note says something true: how the point was arrived at, who can see the list, and what
 * happens when somebody saves the same port twice.
 */
describe('the places a company keeps', () => {
  const fresh = () => new SiteService();

  it('takes a dropped pin at its word and records that it was a pin', () => {
    const s = fresh();
    const port = s.declare('imp', { kind: 'port', name: 'Mombasa — gate 4', location: { lat: -4.0619, lng: 39.6417 } }, 'Hans');
    expect(port).toMatchObject({ kind: 'port', name: 'Mombasa — gate 4', from: 'pin' });
    expect(port.location).toEqual({ lat: -4.0619, lng: 39.6417 });
  });

  it('resolves an address through the gazetteer, and says the point came from an address', () => {
    const s = fresh();
    const where = s.declare('imp', { kind: 'delivery', name: 'Our warehouse', address: 'Industrial Area, Nairobi' }, 'Hans');
    // The CENTRE of a place we know, which is a different claim from a gate somebody stood at — hence `from`.
    expect(where.from).toBe('address');
    expect(where.address).toBe('Industrial Area, Nairobi');
    expect(where.location.lat).toBeLessThan(0);
  });

  it('refuses an address it cannot place rather than guessing at one', () => {
    const s = fresh();
    // A wrong pin on a document with legal weight is worse than a refusal somebody can act on.
    expect(() => s.declare('imp', { kind: 'delivery', name: 'Somewhere', address: 'Flat 2, Somewheresville' }, 'Hans')).toThrow(/do not know/i);
    expect(() => s.declare('imp', { kind: 'delivery', name: 'Nothing said' }, 'Hans')).toThrow(/pin or write an address/i);
  });

  it('will not keep two ports with one name, because that is the confusion it exists to end', () => {
    const s = fresh();
    s.declare('imp', { kind: 'port', name: 'Mombasa', location: { lat: -4.04, lng: 39.66 } }, 'Hans');
    expect(() => s.declare('imp', { kind: 'port', name: 'mombasa', location: { lat: -4.05, lng: 39.67 } }, 'Hans')).toThrow(/already have a place/i);
    // A DELIVERY place may share the name: they are different lists answering different questions.
    expect(() => s.declare('imp', { kind: 'delivery', name: 'Mombasa', location: { lat: -4.05, lng: 39.67 } }, 'Hans')).not.toThrow();
  });

  it('is one company-s own list and nobody else-s', () => {
    const s = fresh();
    const mine = s.declare('imp', { kind: 'port', name: 'Mombasa', location: { lat: -4.04, lng: 39.66 } }, 'Hans');
    s.declare('rival', { kind: 'port', name: 'Mombasa', location: { lat: -4.04, lng: 39.66 } }, 'Someone');
    expect(s.list('imp').map((x) => x.siteId)).toEqual([mine.siteId]);
    // A pooled list is a list somebody else can put a wrong pin in.
    expect(() => s.require('rival', mine.siteId)).toThrow(/No such place/);
    expect(s.require('imp', mine.siteId).name).toBe('Mombasa');
  });

  it('lists alphabetically, never by how often they were used', () => {
    const s = fresh();
    const at = { lat: -1.28, lng: 36.81 };
    s.declare('imp', { kind: 'delivery', name: 'Zanzibar depot', location: at }, 'Hans');
    s.declare('imp', { kind: 'delivery', name: 'Athi River yard', location: at }, 'Hans');
    // Most-used-first is a ranking of somebody-s own work, and this product does not publish rankings.
    expect(s.list('imp', 'delivery').map((x) => x.name)).toEqual(['Athi River yard', 'Zanzibar depot']);
  });

  it('refuses a point that is not on this planet', () => {
    const s = fresh();
    expect(() => s.declare('imp', { kind: 'port', name: 'Nowhere', location: { lat: 91, lng: 0 } }, 'Hans')).toThrow(/planet/);
    /*
     * THREE, and they are the chain a container travels: the quay, the counter, the yard. The middle
     * one arrived when the user asked how a landlocked import is shown — a reefer discharged at
     * Djibouti and cleared at Modjo is two places and therefore two legs, and a model with one "port"
     * on it cannot say that.
     */
    expect([...SITE_KINDS]).toEqual(['port', 'clearance', 'delivery']);
  });
});
