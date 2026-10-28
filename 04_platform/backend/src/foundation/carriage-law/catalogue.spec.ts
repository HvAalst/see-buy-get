import { isParty, roadRegimeOf, ROAD_INSTRUMENTS } from './catalogue';

/*
 * WHICH LAW A ROAD CARRIAGE IS UNDER (the user, 2026-10-28: "Per lane, from membership"). Checked 2026-10-28 against the
 * UN Treaty Collection: no East African state is a party to the CMR; six are members of the Northern Corridor.
 */
const day = '2026-10-28';

describe('the law of a road carriage, lane by lane', () => {
  it('reads the lists it was given: 58 CMR parties, 42 to the e-CMR, six on the Northern Corridor', () => {
    expect(Object.keys(ROAD_INSTRUMENTS.cmr.parties)).toHaveLength(58);
    expect(Object.keys(ROAD_INSTRUMENTS.ecmr.parties)).toHaveLength(42);
    expect(Object.keys(ROAD_INSTRUMENTS.northern_corridor.parties).sort()).toEqual(['BI', 'CD', 'KE', 'RW', 'SS', 'UG']);
    // Only a CMR party may be a party to its protocol (e-CMR Art. 7(3)).
    for (const c of Object.keys(ROAD_INSTRUMENTS.ecmr.parties)) expect(ROAD_INSTRUMENTS.cmr.parties[c]).toBeDefined();
  });

  it('no East African state is a party to the CMR', () => {
    for (const c of ['KE', 'UG', 'TZ', 'RW', 'BI', 'ET', 'SS', 'CD']) expect(isParty('cmr', c, day)).toBe(false);
    expect(isParty('cmr', 'MA', day)).toBe(true);
  });

  it('Kenya to Uganda is under the Northern Corridor’s road protocol; Kenya to Tanzania under no convention', () => {
    expect(roadRegimeOf('KE', 'UG', day)).toEqual({ regime: 'northern_corridor', electronic: false });
    expect(roadRegimeOf('ke', 'rw', day).regime).toBe('northern_corridor');
    expect(roadRegimeOf('KE', 'TZ', day)).toEqual({ regime: 'contract', electronic: false });
    expect(roadRegimeOf('UG', 'ET', day).regime).toBe('contract');
  });

  it('the CMR when either end is a party to it — and electronic only between two parties to the e-CMR', () => {
    expect(roadRegimeOf('NL', 'DE', day)).toEqual({ regime: 'cmr', electronic: true });
    expect(roadRegimeOf('BE', 'NL', day)).toEqual({ regime: 'cmr', electronic: false }); // Belgium signed the e-CMR, never ratified
    expect(roadRegimeOf('KE', 'MA', day)).toEqual({ regime: 'cmr', electronic: false });
  });

  it('a membership that takes effect later is not yet one', () => {
    expect(isParty('ecmr', 'RS', '2026-11-01')).toBe(false);
    expect(isParty('ecmr', 'RS', '2026-11-02')).toBe(true);
    expect(roadRegimeOf('RS', 'HU', '2026-10-28')).toEqual({ regime: 'cmr', electronic: false });
    expect(roadRegimeOf('RS', 'HU', '2026-11-02')).toEqual({ regime: 'cmr', electronic: true });
  });

  it('one country, or a country not known, is national: the note cannot tell more', () => {
    expect(roadRegimeOf('KE', 'KE', day).regime).toBe('national');
    expect(roadRegimeOf(undefined, 'UG', day).regime).toBe('national');
    expect(roadRegimeOf('KE', '', day).regime).toBe('national');
  });
});
