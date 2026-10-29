/**
 * CARRIAGE BY AIR, AS DATA (the user, 2026-10-29: "flower exports, but also live stock imports … perishables, pharmacy";
 * research in 05_engineering/research/air_law_2026-10-29.md, air_ops_2026-10-29.md).
 *
 * We carry the road to and from the airport, and hold the air papers; we never book, issue or sign the air carriage. What
 * this file answers, from the law of the route and our own records only: which air convention governs a route, the limit it
 * puts on the airline's liability and when claims must be made, whether an air waybill number is well formed, and which
 * airline its prefix belongs to. Everything is dated and sourced; where we do not know, it says so rather than guess.
 */

export type AirInstrumentKey = 'mc99' | 'map4' | 'hague' | 'warsaw';

export interface AirInstrument {
  key: AirInstrumentKey;
  name: string;
  source: string;
  /** The date on the depositary's list we read. */
  listDated: string;
  checkedOn: string;
}

const ICAO = 'https://www.icao.int/sites/default/files/secretariat/legal/CurrentListofParties';

export const AIR_INSTRUMENTS: Record<AirInstrumentKey, AirInstrument> = {
  mc99: { key: 'mc99', name: 'Convention for the Unification of Certain Rules for International Carriage by Air, Montreal 1999 (MC99)', source: `${ICAO}/Mtl99_EN.pdf`, listDated: '2026-07-07', checkedOn: '2026-10-29' },
  map4: { key: 'map4', name: 'Montreal Protocol No. 4 (1975) to the Warsaw Convention as amended at The Hague', source: `${ICAO}/MP4_EN.pdf`, listDated: '2021-01-13', checkedOn: '2026-10-29' },
  hague: { key: 'hague', name: 'The Hague Protocol (1955) to the Warsaw Convention', source: `${ICAO}/WC-HP_EN.pdf`, listDated: '2020-03-16', checkedOn: '2026-10-29' },
  warsaw: { key: 'warsaw', name: 'Warsaw Convention (1929)', source: `${ICAO}/WC-HP_EN.pdf`, listDated: '2020-03-16', checkedOn: '2026-10-29' },
};

/**
 * WHO IS PARTY TO WHAT, and from when (entry into force), as the ICAO lists give it. A country on this table with nothing
 * against an instrument is known NOT to be a party to it; a country not on the table at all is one we have not read, and a
 * route to it is "unknown" — never guessed to be one or the other.
 */
export const AIR_PARTIES: Record<string, Partial<Record<AirInstrumentKey, string>>> = {
  KE: { mc99: '2003-11-04', warsaw: '1963-12-12', hague: '1999-10-04', map4: '1999-10-04' },
  UG: { mc99: '2018-01-27', warsaw: '1963-10-22' },
  TZ: { mc99: '2003-11-04', warsaw: '1965-07-06' },
  RW: { mc99: '2015-12-19', warsaw: '1962-07-01', hague: '1991-03-27' },
  BI: {},
  ET: { mc99: '2014-06-22', warsaw: '1950-11-12', map4: '1998-06-14' },
  DJ: {},
  SS: {},
  SD: { mc99: '2017-10-17', warsaw: '1975-05-12', hague: '1975-05-12' },
  CD: { mc99: '2014-09-19', warsaw: '1960-06-30' },
  SO: {},
  ER: {},
  ZM: { warsaw: '1964-10-24', hague: '1970-06-23' },
  MW: { warsaw: '1978-01-25', hague: '1971-09-07' },
  MZ: { mc99: '2014-03-28' },
  ZA: { mc99: '2007-01-21', warsaw: '1955-03-22', hague: '1967-12-17' },
  NG: { mc99: '2003-11-04', warsaw: '1960-10-01', hague: '1969-09-29' },
  GH: { mc99: '2018-08-03', warsaw: '1997-11-09', hague: '1997-11-09', map4: '1998-06-14' },
  EG: { mc99: '2005-04-25', warsaw: '1955-12-05', hague: '1963-08-01', map4: '1998-06-14' },
  MA: { mc99: '2010-06-14', warsaw: '1958-04-05', hague: '1976-02-15', map4: '2012-12-25' },
  BR: { mc99: '2006-07-18', warsaw: '1933-02-13', hague: '1964-09-14', map4: '1998-06-14' },
  RU: { mc99: '2017-08-21', warsaw: '1934-11-18', hague: '1963-08-01' },
  IN: { mc99: '2009-06-30', warsaw: '1947-08-15', hague: '1973-05-15' },
  CN: { mc99: '2005-07-31', warsaw: '1958-10-18', hague: '1975-11-18' },
  IR: { warsaw: '1975-10-06', hague: '1975-10-06', map4: '2016-05-16' },
  AE: { mc99: '2003-11-04', warsaw: '1986-07-03', hague: '1994-01-16', map4: '2000-06-18' },
  ID: { mc99: '2017-05-19', warsaw: '1945-08-17' },
  NL: { mc99: '2004-06-28', warsaw: '1933-09-29', hague: '1963-08-01', map4: '1998-06-14' },
  DE: { mc99: '2004-06-28', warsaw: '1933-12-29', hague: '1963-08-01' },
  BE: { mc99: '2004-06-28', warsaw: '1936-10-11', hague: '1963-11-25', map4: '2003-06-17' },
  FR: { mc99: '2004-06-28', warsaw: '1933-02-13', hague: '1963-08-01' },
  GB: { mc99: '2004-06-28', warsaw: '1933-05-15', hague: '1967-06-01', map4: '1998-06-14' },
  US: { mc99: '2003-11-04', warsaw: '1934-10-29', hague: '2003-12-14', map4: '1999-03-04' },
  QA: { mc99: '2005-01-14', warsaw: '1987-03-22', hague: '1987-03-22' },
  SA: { mc99: '2003-12-14', warsaw: '1969-04-27', hague: '1969-04-27' },
  TR: { mc99: '2011-03-26', warsaw: '1978-06-23', hague: '1978-06-23', map4: '1998-09-12' },
  IL: { mc99: '2011-03-20', warsaw: '1950-01-06', hague: '1964-11-03', map4: '1998-06-14' },
};

/** Is this country a party to this instrument on this day? False for a country we have not read, as for a known non-party. */
export function isAirParty(key: AirInstrumentKey, country: string | undefined, onDay: string): boolean {
  const since = country ? AIR_PARTIES[country.toUpperCase()]?.[key] : undefined;
  return Boolean(since && since <= onDay);
}

export type AirRegime = 'mc99' | 'warsaw_hague_map4' | 'warsaw_hague' | 'warsaw_1929' | 'none' | 'domestic' | 'unknown';
export const AIR_REGIMES: readonly AirRegime[] = ['mc99', 'warsaw_hague_map4', 'warsaw_hague', 'warsaw_1929', 'none', 'domestic', 'unknown'];

/**
 * THE CONVENTION OF A ROUTE, read from the CONTRACT's places of departure and destination (the air waybill's, or the house
 * waybill's for a consolidation) — never the flight path — on the day the waybill was made out. Both ends MC99: MC99. Else
 * the newest Warsaw instrument both share. Nothing shared: none, the airline's own conditions and the law a court picks.
 * One country with no agreed stop abroad: domestic. A country we have not read: unknown.
 */
export function airRegimeOf(from: string | undefined, to: string | undefined, onDay: string, stops: string[] = []): AirRegime {
  const a = from?.toUpperCase();
  const b = to?.toUpperCase();
  if (!a || !b) return 'unknown';
  if (a === b && !stops.some((s) => s.toUpperCase() !== a)) return 'domestic';
  if (!(a in AIR_PARTIES) || !(b in AIR_PARTIES)) return 'unknown';
  const both = (k: AirInstrumentKey) => isAirParty(k, a, onDay) && isAirParty(k, b, onDay);
  // A round trip from one state, with an agreed stop abroad, is international if that one state is a party.
  if (a === b) return isAirParty('mc99', a, onDay) ? 'mc99' : isAirParty('warsaw', a, onDay) ? 'warsaw_1929' : 'none';
  if (both('mc99')) return 'mc99';
  if (both('map4')) return 'warsaw_hague_map4';
  if (both('hague')) return 'warsaw_hague';
  if (both('warsaw')) return 'warsaw_1929';
  return 'none';
}

/** MC99's cargo limit, revised by ICAO under Art. 24 — the limit on the day of the damage, kept with its dates. */
export const MC99_LIMITS: ReadonlyArray<{ from: string; sdrPerKg: number }> = [
  { from: '2003-11-04', sdrPerKg: 17 },
  { from: '2009-12-30', sdrPerKg: 19 },
  { from: '2019-12-28', sdrPerKg: 22 },
  { from: '2024-12-28', sdrPerKg: 26 },
];

export function mc99LimitOn(onDay: string): number {
  return [...MC99_LIMITS].reverse().find((l) => l.from <= onDay)?.sdrPerKg ?? MC99_LIMITS[0].sdrPerKg;
}

/** What each regime says about the airline's liability for the goods — said as the law says it, in its own unit. */
export function airLimits(regime: AirRegime, onDay: string): string[] {
  switch (regime) {
    case 'mc99':
      return [`At most ${mc99LimitOn(onDay)} SDR a kilogram of the gross weight of the package or packages concerned (MC99 Art. 22(3)–(4)), unless a higher value was declared on the air waybill and paid for. The limit cannot be broken, even for wilful misconduct.`];
    case 'warsaw_hague_map4':
      return ['At most 17 SDR a kilogram (Warsaw as amended at The Hague and by Montreal Protocol No. 4, Art. 22(2)), unless a higher value was declared and paid for. The limit cannot be broken.'];
    case 'warsaw_hague':
      return ['At most 250 gold francs a kilogram (Warsaw as amended at The Hague, Art. 22(2)), unless a higher value was declared. The airline loses the limit for damage done recklessly and knowingly (Art. 25), and where the air waybill lacks the liability notice (Art. 9).'];
    case 'warsaw_1929':
      return ['At most 250 gold francs a kilogram (Warsaw 1929, Art. 22(2)), unless a higher value was declared. The airline loses the limit for wilful misconduct (Art. 25), and where the waybill lacks particulars Art. 8 asks for (Art. 9).'];
    case 'none':
      return ['No air convention joins these two countries: the airline’s own conditions of carriage, and the law a court chooses, decide what it answers for.'];
    case 'domestic':
      return ['Carriage inside one country with no agreed stop abroad is not international carriage: that country’s own law governs it.'];
    default:
      return ['We have not read whether these countries are parties to an air convention: the limit is not said here.'];
  }
}

/** When a claim must be made — in calendar days (MC99 Art. 52), from the documents the law names. */
export function airClaims(regime: AirRegime): string[] {
  if (regime === 'mc99' || regime === 'warsaw_hague_map4' || regime === 'warsaw_hague') {
    return [
      'Damage: a written complaint to the airline within 14 days of receipt of the goods (MC99 Art. 31(2); Hague Art. 26(2)).',
      'Delay: within 21 days of the goods being placed at the consignee’s disposal.',
      'A claim in court within two years of arrival, of when the aircraft ought to have arrived, or of when the carriage stopped (Art. 35; Warsaw Art. 29).',
    ];
  }
  if (regime === 'warsaw_1929') return ['Damage: a written complaint within 7 days of receipt; delay within 14 days (Warsaw 1929 Art. 26(2)).', 'A claim in court within two years (Art. 29).'];
  return ['No convention sets the time to complain: read the airline’s own conditions — and complain in writing at once.'];
}

/* ------------------------------------------------------------------ the waybill number -- */

/**
 * The airline prefixes we hold — the first three digits of an air waybill number — agreed in two handlers' tables we read.
 * Not IATA's own list, which we neither copy nor hold (legal.html L35): a prefix not here is one we have not checked.
 */
export const AIRLINES: ReadonlyArray<{ prefix: string; name: string; code: string }> = [
  { prefix: '706', name: 'Kenya Airways', code: 'KQ' },
  { prefix: '071', name: 'Ethiopian Airlines', code: 'ET' },
  { prefix: '157', name: 'Qatar Airways', code: 'QR' },
  { prefix: '176', name: 'Emirates', code: 'EK' },
  { prefix: '074', name: 'KLM / Martinair', code: 'KL' },
  { prefix: '057', name: 'Air France', code: 'AF' },
  { prefix: '235', name: 'Turkish Airlines', code: 'TK' },
  { prefix: '020', name: 'Lufthansa', code: 'LH' },
  { prefix: '459', name: 'RwandAir', code: 'WB' },
  { prefix: '485', name: 'Astral Aviation', code: '8V' },
  { prefix: '065', name: 'Saudia', code: 'SV' },
];
export const AIRLINES_SOURCE = 'WFS Copenhagen airline list (5 July 2025) and the Cargonaut airline–handler table, read 2026-10-29';

export function airlineOfPrefix(prefix: string): { name: string; code: string } | undefined {
  const a = AIRLINES.find((x) => x.prefix === prefix);
  return a ? { name: a.name, code: a.code } : undefined;
}

/** An air waybill number as its digits, or nothing where it cannot be one. "706-1234 5675" → "70612345675". */
export function awbDigits(raw: string | undefined): string {
  return String(raw ?? '').replace(/[\s-]/g, '');
}

/** "706-12345675" — how a waybill number is written. */
export function formatAwb(digits: string): string {
  return digits.length === 11 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
}

/**
 * IS IT AN AIR WAYBILL NUMBER? Eleven digits: three for the airline, eight for the serial, whose last is a check digit — the
 * first seven divided by 7, the remainder (IATA, unweighted modulus 7). So the last digit is never 7, 8 or 9. A wrong one is
 * wrong, not "missing". A house waybill, the forwarder's own, has no check digit and is not checked.
 */
export function awbProblem(raw: string | undefined): 'format' | 'check_digit' | undefined {
  const d = awbDigits(raw);
  if (!/^\d{11}$/.test(d)) return 'format';
  const serial = d.slice(3);
  return Number(serial.slice(0, 7)) % 7 === Number(serial[7]) ? undefined : 'check_digit';
}

/* -------------------------------------------------------------------- the check -- */

/** What the business tells us about the air carriage, as its booking confirmation and its waybill give it. */
export interface HeldAirWaybill {
  /** The airline's waybill number — the master's, for a consolidation. */
  number: string;
  kind: 'master' | 'house' | 'direct';
  houseNumber?: string;
  /** The countries of the places of departure and destination on the waybill (the house waybill's, for a consolidation). */
  from: string;
  to: string;
  /** Countries of agreed stopping places, where the waybill names them. */
  stops?: string[];
  /** The day it was made out (YYYY-MM-DD): the law is read on that day. Absent: today. */
  madeOutOn?: string;
  pieces?: number;
  weightKg?: number;
  /** A value declared for carriage (box 16), in the waybill's own money — absent: "no value declared". */
  declaredValue?: { amount: number; currency: string };
  /** Hague and Warsaw lanes: the notice that the convention may limit liability is printed on it. */
  liabilityNotice?: boolean;
}

export interface AirWaybillCheck {
  number: string;
  /** Wrong: a number that cannot be an air waybill's. */
  problem?: 'format' | 'check_digit';
  airline?: { name: string; code: string; source: string };
  regime: AirRegime;
  rules?: string;
  sources: string[];
  /** The law asks for it on the waybill and we do not hold it. */
  missing: string[];
  /** Needed to match the goods, or for customs, though no convention requires it. */
  ask: string[];
  /** Where the waybill and our own papers disagree. */
  mismatches: string[];
  /** An electronic waybill (Res. 672) is possible: both ends MC99, or both MAP4. */
  electronicPossible: boolean;
  limits: string[];
  claims: string[];
  caveats: string[];
}

/**
 * THE CHECK OF A HELD AIR WAYBILL against the law of its route and our own papers. Pure. It says what the law asks for and
 * we do not hold, where our papers disagree with it, and what it means if something goes wrong — never that the carriage
 * will happen, nor that the waybill is genuine: there is no public registry, and only the airline's own tracking could say
 * it knows a master number.
 */
export function checkAirWaybill(awb: HeldAirWaybill, ours: { pieces?: number; weightKg?: number } = {}, today: string = new Date().toISOString().slice(0, 10)): AirWaybillCheck {
  const digits = awbDigits(awb.number);
  // The airline's own number (master or direct) is checked; a house number is the forwarder's and has no check digit.
  const problem = awbProblem(awb.number);
  const line = digits.length === 11 ? airlineOfPrefix(digits.slice(0, 3)) : undefined;
  const onDay = awb.madeOutOn ?? today;
  const regime = airRegimeOf(awb.from, awb.to, onDay, awb.stops ?? []);
  const missing: string[] = [];
  const ask: string[] = [];
  const mismatches: string[] = [];
  const caveats: string[] = [];
  const sources: string[] = [];
  if (regime === 'mc99') sources.push(AIR_INSTRUMENTS.mc99.source);
  if (regime === 'warsaw_hague_map4') sources.push(AIR_INSTRUMENTS.map4.source);
  if (regime === 'warsaw_hague' || regime === 'warsaw_1929') sources.push(AIR_INSTRUMENTS.hague.source);
  // What the law of the route asks the document to say.
  if (!(awb.weightKg && awb.weightKg > 0) && (regime === 'mc99' || regime === 'warsaw_hague_map4')) missing.push('The weight of the consignment (MC99 Art. 5(c)).');
  if ((regime === 'warsaw_hague' || regime === 'warsaw_1929') && !awb.liabilityNotice) {
    missing.push(regime === 'warsaw_hague' ? 'The notice that the Warsaw Convention may limit the airline’s liability (Hague Art. 8(c)): without it the airline may not be able to limit its liability (Art. 9). This is a consequence for the airline, not a fault of yours.' : 'The particulars Warsaw 1929 Art. 8 asks for, (a) to (i) and (q): without them the airline may lose its limit (Art. 9).');
  }
  // What is needed to match the goods and pass customs, though the convention does not ask it.
  if (!awb.pieces) ask.push('The number of pieces.');
  ask.push('Shipper and consignee with their full addresses, the goods described plainly, and the flight and its date.');
  if (awb.kind === 'house' && !awb.houseNumber) ask.push('The forwarder’s house waybill number, and the master waybill it travels under.');
  // Our papers against the waybill: pieces exactly; weight within 1% or 1 kg — both are evidence of the contract (Art. 11).
  if (ours.pieces && awb.pieces && ours.pieces !== awb.pieces) mismatches.push(`Pieces: the waybill says ${awb.pieces}, our papers ${ours.pieces}.`);
  if (ours.weightKg && awb.weightKg && Math.abs(ours.weightKg - awb.weightKg) > Math.max(1, ours.weightKg * 0.01)) mismatches.push(`Weight: the waybill says ${awb.weightKg} kg, our papers ${ours.weightKg} kg.`);
  if (awb.declaredValue) caveats.push(`A value is declared for carriage (${awb.declaredValue.amount} ${awb.declaredValue.currency}): the limit is that value, not the convention’s.`);
  if (regime === 'unknown') caveats.push('We have not read whether one of these countries is party to an air convention: nothing is said about the law of this route.');
  if (awb.kind === 'house') caveats.push('A house waybill is the forwarder’s contract with you; the airline’s is the master waybill. Complaints may go to either; instructions about the goods only to the one you contracted with (MC99 Art. 42).');
  caveats.push('Holding the waybill says nothing about whether the flight will leave, on time, or with the goods: timetables are not guaranteed, and airlines may fly without any part of the cargo.');
  const electronicPossible = (isAirParty('mc99', awb.from, onDay) && isAirParty('mc99', awb.to, onDay)) || (isAirParty('map4', awb.from, onDay) && isAirParty('map4', awb.to, onDay));
  return {
    number: formatAwb(digits),
    ...(problem ? { problem } : {}),
    ...(line ? { airline: { ...line, source: AIRLINES_SOURCE } } : {}),
    regime,
    ...(regime === 'mc99' ? { rules: AIR_INSTRUMENTS.mc99.name } : regime === 'warsaw_hague_map4' ? { rules: AIR_INSTRUMENTS.map4.name } : regime === 'warsaw_hague' ? { rules: AIR_INSTRUMENTS.hague.name } : regime === 'warsaw_1929' ? { rules: AIR_INSTRUMENTS.warsaw.name } : {}),
    sources,
    missing,
    ask,
    mismatches,
    electronicPossible,
    limits: airLimits(regime, onDay),
    claims: airClaims(regime),
    caveats,
  };
}
