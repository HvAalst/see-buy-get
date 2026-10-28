/**
 * THE LAW A LOAD ON THE ROAD IS CARRIED UNDER — which international instrument, if any, governs a road carriage
 * between two countries. The user, 2026-10-28, on the consignment note: "Per lane, from membership".
 *
 * Until now every load whose two ends were in different countries was printed as "subject to the CMR". The CMR applies
 * only when the place of taking over or the place of delivery is in a contracting country (Art. 1(1)), and no East
 * African state is one: a Kenya–Uganda load was told it was under a convention that does not reach it.
 *
 * Membership is a FACT about a country, kept here with its source and the day it was checked, never worked out:
 *
 *   CMR    Convention on the Contract for the International Carriage of Goods by Road, Geneva 1956.
 *          UN Treaty Collection XI-B-11, 58 parties. In Africa only Morocco and Tunisia.
 *   e-CMR  Additional Protocol to the CMR concerning the Electronic Consignment Note, Geneva 2008.
 *          UN Treaty Collection XI-B-11-b, 42 parties. Open only to CMR parties (Art. 7(3)); in force for a new party
 *          90 days after it deposits its instrument (Art. 8(2)).
 *   Northern Corridor  Northern Corridor Transit and Transport Agreement (Nairobi, 2007), Protocol No. 6 (road
 *          transport): Burundi, DR Congo, Kenya, Rwanda, South Sudan, Uganda. Its consignment note asks the same
 *          particulars as the CMR's and its statement names "this Protocol" (Art. 21). Tanzania and Ethiopia are not
 *          members.
 *
 * A change in membership is a change here, with its date — the same as a country's trade terms in the Incoterms
 * catalogue: data read by everybody, edited by nobody at runtime.
 */
export type RoadInstrumentKey = 'cmr' | 'ecmr' | 'northern_corridor';

export interface RoadInstrument {
  key: RoadInstrumentKey;
  name: string;
  /** Where the list of parties was read. */
  source: string;
  checkedOn: string;
  /** The parties, by ISO country code. A date where membership takes effect later than the day it was checked. */
  parties: Record<string, string | true>;
}

const each = (codes: string, later: Record<string, string> = {}): Record<string, string | true> =>
  Object.fromEntries(codes.split(/\s+/).filter(Boolean).map((c) => [c, later[c] ?? true]));

export const ROAD_INSTRUMENTS: Record<RoadInstrumentKey, RoadInstrument> = {
  cmr: {
    key: 'cmr',
    name: 'Convention on the Contract for the International Carriage of Goods by Road (CMR), Geneva 1956',
    source: 'https://treaties.un.org/Pages/ViewDetails.aspx?src=TREATY&mtdsg_no=XI-B-11&chapter=11&clang=_en',
    checkedOn: '2026-10-28',
    parties: each('AF AL AM AT AZ BY BE BA BG HR CY CZ DK EE FI FR GE DE GR HU IR IE IT JO KZ KG LV LB LT LU MT MN ME MA NL MK NO OM PK PL PT MD RO RU RS SK SI ES SE CH SY TJ TN TR TM UA GB UZ'),
  },
  ecmr: {
    key: 'ecmr',
    name: 'Additional Protocol to the CMR concerning the Electronic Consignment Note (e-CMR), Geneva 2008',
    source: 'https://treaties.un.org/Pages/ViewDetails.aspx?src=TREATY&mtdsg_no=XI-B-11-b&chapter=11&clang=_en',
    checkedOn: '2026-10-28',
    // Serbia acceded on 4 August 2026: in force for it 90 days later (Art. 8(2)).
    parties: each('AL AM AT AZ BY BG CZ DK EE FI FR DE GR HU IR IT KG LV LT LU ME NL MK NO OM PL PT MD RO RU RS SK SI ES SE CH TJ TR TM UA GB UZ', { RS: '2026-11-02' }),
  },
  northern_corridor: {
    key: 'northern_corridor',
    name: 'Northern Corridor Transit and Transport Agreement, Protocol No. 6 (road transport)',
    source: 'https://www.ttcanc.org/wp-content/uploads/2026/08/English-Bk.pdf',
    checkedOn: '2026-10-28',
    parties: each('BI CD KE RW SS UG'),
  },
};

/** Whether a country is a party to an instrument on a day: a later date is not yet. */
export function isParty(key: RoadInstrumentKey, country: string | undefined, onDay: string): boolean {
  const at = country ? ROAD_INSTRUMENTS[key].parties[country.trim().toUpperCase()] : undefined;
  return at === true || (typeof at === 'string' && at <= onDay);
}

/**
 * THE REGIME OF A ROAD CARRIAGE between two countries, on a day:
 *
 *   national           both ends in one country, or a country not known — the note cannot tell, and says nothing more
 *   cmr                either end in a CMR country (Art. 1(1)); `electronic` when both are parties to the e-CMR
 *   northern_corridor  both ends in Northern Corridor states, and neither in a CMR one
 *   contract           two countries no instrument joins: the carriage is under its contract and the national law
 *                      that governs it — which law that is, is not for the note to say
 */
export type RoadRegime = 'national' | 'cmr' | 'northern_corridor' | 'contract';

export function roadRegimeOf(from: string | undefined, to: string | undefined, onDay: string): { regime: RoadRegime; electronic: boolean } {
  const a = from?.trim().toUpperCase();
  const b = to?.trim().toUpperCase();
  if (!a || !b || a === b) return { regime: 'national', electronic: false };
  if (isParty('cmr', a, onDay) || isParty('cmr', b, onDay)) return { regime: 'cmr', electronic: isParty('ecmr', a, onDay) && isParty('ecmr', b, onDay) };
  if (isParty('northern_corridor', a, onDay) && isParty('northern_corridor', b, onDay)) return { regime: 'northern_corridor', electronic: false };
  return { regime: 'contract', electronic: false };
}
