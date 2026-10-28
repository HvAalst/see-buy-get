/**
 * THE LAW A RAIL CONSIGNMENT IS CARRIED UNDER, AND WHAT ITS NOTE MUST SAY. The user, 2026-10-28: "for now we hold the
 * note but we should be able to see whether it is valid" — and, before that, "Not just the african nations, europe deals
 * with eCIM so we should be fit and flexible". Design: 05_engineering/rail_note.md; research with a source for every
 * claim: 05_engineering/research/rail_*_2026-10-28.md.
 *
 * SeeBuyGet issues no rail note: everywhere the railway (or a state system) issues it — the e-CIM in the railway's own
 * system, Russia's waybill filed to the state system, Brazil's CT-e, India's eT-RR. We HOLD the railway's note and say
 * whether it carries what the law of its lane asks for, and what a gap costs. Never "valid" on our own word: "complete
 * for these rules, as printed", with the day the rules were checked.
 *
 * As with the road (catalogue.ts), membership and conditions are FACTS kept here with their source and the day checked —
 * data read by everybody, edited by nobody at runtime. A railway whose conditions we have not read says so; nothing is
 * guessed in its place.
 */
export type RailInstrumentKey = 'cim' | 'smgs' | 'atit';

export interface RailInstrument {
  key: RailInstrumentKey;
  name: string;
  source: string;
  checkedOn: string;
  /** The parties, by ISO country code. A date where membership takes effect later than the day it was checked. */
  parties: Record<string, string | true>;
  /** Members whose membership is suspended: listed, and NOT counted as parties. */
  suspended?: string[];
  /** CIM Art. 1 §6: states that apply CIM only on the lines in the CIM list of railway lines. */
  linesOnly?: string[];
}

const each = (codes: string): Record<string, true> => Object.fromEntries(codes.split(/\s+/).filter(Boolean).map((c) => [c, true as const]));

export const RAIL_INSTRUMENTS: Record<RailInstrumentKey, RailInstrument> = {
  cim: {
    key: 'cim',
    name: 'Uniform Rules concerning the Contract of International Carriage of Goods by Rail (CIM), Appendix B to COTIF',
    source: 'https://otif.org/en/?page_id=51',
    checkedOn: '2026-10-28',
    // 51 Member States. In Africa only Algeria, Morocco and Tunisia. Jordan is an associate (advisory only), not a party.
    parties: each('AF AL DZ AM AT AZ BE BA BG HR CZ DK EE FI FR GE DE GR HU IR IE IT LV LB LI LT LU MD MC ME MA NL MK NO PK PL PT RO RU RS SK SI ES SE CH TR TN UA GB'),
    suspended: ['IQ', 'SY'],
    // The CIM list of railway lines, restructured 12.09.2024 (OTIF NOT-24058 to NOT-24062).
    linesOnly: ['AZ', 'EE', 'GE', 'RU', 'UA'],
  },
  smgs: {
    key: 'smgs',
    name: 'Agreement on International Railway Freight Communications (SMGS)',
    source: 'https://en.osjd.org/en/8910/page/106077?id=2990',
    checkedOn: '2026-10-28',
    // 26 parties, as of 1 July 2026. OSJD membership is not the same: the Republic of Korea, Cuba and the Czech Republic
    // are OSJD members but not SMGS parties. No African state is either.
    parties: each('AL AZ AF BY BG CN EE GE HU IR KZ KP KG LA LV LT MD MN PL RU SK TJ TM UA UZ VN'),
  },
  atit: {
    key: 'atit',
    name: 'Agreement on International Land Transport (ATIT), Chapter III, rail',
    source: 'https://www.argentina.gob.ar/normativa/nacional/20787/texto',
    checkedOn: '2026-10-28',
    parties: each('AR BO BR CL PY PE UY'),
  },
};

export function isRailParty(key: RailInstrumentKey, country: string | undefined, onDay: string): boolean {
  const c = country?.trim().toUpperCase();
  if (!c || RAIL_INSTRUMENTS[key].suspended?.includes(c)) return false;
  const at = RAIL_INSTRUMENTS[key].parties[c];
  return at === true || (typeof at === 'string' && at <= onDay);
}

/**
 * THE REGIME OF A RAIL CARRIAGE between two countries, on a day:
 *
 *   national       both ends in one country (or a country not known) — its law and its railway's conditions
 *   cim            both ends in CIM states (Art. 1 §1)
 *   smgs           both ends in SMGS states — checked before `cim_lines`, so Russia–Poland is SMGS
 *   cim_lines      both in CIM, one applying it only on its listed lines (Art. 1 §6): CIM only where the route is on them
 *   cim_smgs       one end CIM, the other SMGS: two successive contracts, on the common CIM/SMGS note where the
 *                  railways agree it (GLV-CIM/SMGS; CIM Art. 6 §8, SMGS Art. 13), else re-consigned at the changeover
 *   cim_if_agreed  one end in a CIM state, the other in none: CIM only if the parties agree (Art. 1 §2)
 *   atit           both ends in ATIT states
 *   contract       two countries no instrument joins: the railway's own conditions and the law they name
 */
export type RailRegime = 'national' | 'cim' | 'smgs' | 'cim_lines' | 'cim_smgs' | 'cim_if_agreed' | 'atit' | 'contract';
export const RAIL_REGIMES: readonly RailRegime[] = ['national', 'cim', 'smgs', 'cim_lines', 'cim_smgs', 'cim_if_agreed', 'atit', 'contract'];

export function railRegimeOf(from: string | undefined, to: string | undefined, onDay: string): RailRegime {
  const a = from?.trim().toUpperCase();
  const b = to?.trim().toUpperCase();
  if (!a || !b || a === b) return 'national';
  const cim = (c: string) => isRailParty('cim', c, onDay);
  const smgs = (c: string) => isRailParty('smgs', c, onDay);
  const linesOnly = (c: string) => RAIL_INSTRUMENTS.cim.linesOnly?.includes(c) ?? false;
  if (cim(a) && cim(b) && !linesOnly(a) && !linesOnly(b)) return 'cim';
  if (smgs(a) && smgs(b)) return 'smgs';
  if (cim(a) && cim(b)) return 'cim_lines';
  if ((cim(a) && smgs(b)) || (smgs(a) && cim(b))) return 'cim_smgs';
  if (cim(a) || cim(b)) return 'cim_if_agreed';
  if (isRailParty('atit', a, onDay) && isRailParty('atit', b, onDay)) return 'atit';
  return 'contract';
}

/**
 * WHAT A RAIL NOTE CAN CARRY — the union of what the laws below ask for. The holder of a note ticks what is printed on
 * it; the check compares that with the lane's rules. Every key has its words in the apps (`rail.particular.*`).
 */
export const RAIL_PARTICULARS = [
  'madeOut',
  'consignor',
  'consignee',
  'carrier',
  'from',
  'takenOverOn',
  'to',
  'borderStations',
  'goods',
  'goodsCode',
  'packing',
  'dangerous',
  'packages',
  'marks',
  'mass',
  'massMethod',
  'wagon',
  'container',
  'seals',
  'documents',
  'charges',
  'transitPeriod',
  'dates',
  'noteNumber',
  'statement',
  'consignorSigned',
  'carrierSigned',
] as const;
export type RailParticular = (typeof RAIL_PARTICULARS)[number];

/** What is carried on the note: a container (or other intermodal unit), a whole wagon, or packages. */
export const RAIL_LOADS = ['container', 'wagon', 'packages'] as const;
export type RailLoad = (typeof RAIL_LOADS)[number];

/**
 * ONE PARTICULAR A RULE ASKS FOR. `when` limits it to a kind of load or to dangerous goods; `unless` is a condition the
 * note alone cannot show (customs papers, seals) — such a gap is asked about, never counted as missing.
 */
export interface RailRequirement {
  key: RailParticular;
  rule: string;
  when?: RailLoad | 'dangerous';
  unless?: 'no_documents' | 'no_seals' | 'nothing_to_pay';
}

const req = (rule: string, keys: string, extra: Partial<RailRequirement> = {}): RailRequirement[] =>
  keys.split(/\s+/).filter(Boolean).map((key) => ({ key: key as RailParticular, rule, ...extra }));

/** CIM Art. 7 §1 (a)–(p), with the signatures of Art. 6 §3. */
const CIM_RULES: RailRequirement[] = [
  ...req('CIM Art. 7 §1 (a)', 'madeOut'),
  ...req('CIM Art. 7 §1 (b)', 'consignor'),
  ...req('CIM Art. 7 §1 (c)', 'carrier'),
  ...req('CIM Art. 7 §1 (e)', 'from takenOverOn'),
  ...req('CIM Art. 7 §1 (f)', 'to'),
  ...req('CIM Art. 7 §1 (g)', 'consignee'),
  ...req('CIM Art. 7 §1 (h)', 'goods packing'),
  ...req('CIM Art. 7 §1 (h), as RID describes them', 'dangerous', { when: 'dangerous' }),
  ...req('CIM Art. 7 §1 (i)', 'packages marks', { when: 'packages' }),
  ...req('CIM Art. 7 §1 (j)', 'wagon', { when: 'wagon' }),
  ...req('CIM Art. 7 §1 (l)', 'container', { when: 'container' }),
  ...req('CIM Art. 7 §1 (m)', 'mass'),
  ...req('CIM Art. 7 §1 (n)', 'documents', { unless: 'no_documents' }),
  ...req('CIM Art. 7 §1 (o)', 'charges', { unless: 'nothing_to_pay' }),
  ...req('CIM Art. 7 §1 (p)', 'statement'),
  ...req('CIM Art. 6 §3', 'consignorSigned carrierSigned'),
];

/** SMGS Art. 15 §1 (1)–(17). */
const SMGS_RULES: RailRequirement[] = [
  ...req('SMGS Art. 15 §1 (1)', 'consignor'),
  ...req('SMGS Art. 15 §1 (2)', 'consignee'),
  ...req('SMGS Art. 15 §1 (3)', 'carrier'),
  ...req('SMGS Art. 15 §1 (4)', 'from'),
  ...req('SMGS Art. 15 §1 (5)', 'to'),
  ...req('SMGS Art. 15 §1 (6)', 'borderStations'),
  ...req('SMGS Art. 15 §1 (7)', 'goods goodsCode'),
  ...req('SMGS Art. 15 §1 (8)', 'noteNumber'),
  ...req('SMGS Art. 15 §1 (9)', 'packing'),
  ...req('SMGS Art. 15 §1 (10)', 'packages'),
  ...req('SMGS Art. 15 §1 (11)', 'mass'),
  ...req('SMGS Art. 15 §1 (12)', 'wagon'),
  ...req('SMGS Art. 15 §1 (12)', 'container', { when: 'container' }),
  ...req('SMGS Art. 15 §1 (13)', 'documents', { unless: 'no_documents' }),
  ...req('SMGS Art. 15 §1 (14)', 'charges'),
  ...req('SMGS Art. 15 §1 (15)', 'seals', { unless: 'no_seals' }),
  ...req('SMGS Art. 15 §1 (16)', 'massMethod'),
  ...req('SMGS Art. 15 §1 (17)', 'madeOut'),
];

/**
 * A RAILWAY AND THE CONDITIONS ITS NOTE IS UNDER. `particulars` absent: we have not read what its note must carry, and
 * the check says so. `limits` and `claims` are the facts a holder needs when something goes wrong, each with its clause.
 */
export interface Railway {
  key: string;
  name: string;
  countries: string[];
  conditions: string;
  source: string;
  checkedOn: string;
  particulars?: RailRequirement[];
  limits: string[];
  claims: string[];
  /** Whether its note may be, or must be, electronic. */
  electronic?: { rule: 'required' | 'allowed'; from?: string; system?: string; form?: 'cte' };
  /** Said beside the check — a limit of what we could verify, or an open legal question. */
  caveat?: string;
}

export const RAILWAYS: Railway[] = [
  {
    key: 'krc',
    name: 'Kenya Railways',
    countries: ['KE'],
    conditions: 'Kenya Railways Tariff Book, Appendix II: Standard Conditions of Carriage of Goods (SGR and metre gauge)',
    source: 'https://krc.co.ke/wp-content/uploads/2026/06/Kenya-Railways-Tariff-Book.pdf',
    checkedOn: '2026-10-28',
    particulars: [
      ...req('Conditions cl. 8', 'from takenOverOn goods packing marks packages mass consignor consignee to charges'),
      ...req('Conditions cl. 8', 'documents', { unless: 'no_documents' }),
      ...req('Conditions cl. 7', 'consignorSigned'),
    ],
    limits: ['The declared value is the most the railway pays; with no value declared, KSh 20,000 (cl. 9).'],
    claims: ['Notice of a claim within 7 days, the claim within 6 months (cl. 22); a suit within 1 year (cl. 23).', 'Governed by the laws of Kenya or Uganda (cl. 32).'],
    electronic: { rule: 'allowed' },
    caveat: 'The Kenya Railways Corporation Act (Cap. 397) was repealed by the Government Owned Enterprises Act 2025; the form of the note itself was not seen.',
  },
  {
    key: 'urc',
    name: 'Uganda Railways',
    countries: ['UG'],
    conditions: 'Uganda Railways Corporation Act, Cap. 331, and the railway’s tariff notice',
    source: 'https://media.ulii.org/media/legislation/17847/source_file/2ac276819de5fbfd/1992-13.pdf',
    checkedOn: '2026-10-28',
    limits: ['The railway is liable only where negligence is proved (s. 58(1)), up to the declared value (s. 61).'],
    claims: ['Notice within 7 days; a claim for non-delivery within 3 months (s. 51); a suit within 12 months (s. 52(b)).'],
    caveat: 'Uganda Railways’ conditions of carriage were not found: what its note must carry was not checked.',
  },
  {
    key: 'trc',
    name: 'Tanzania Railways',
    countries: ['TZ'],
    conditions: 'Railways Act 2017 (Cap. 170) and the Tariff Book',
    source: 'https://media.tanzlii.org/media/legislation/325008/source_file/102bfe86d1eedb4c/2017-10.pdf',
    checkedOn: '2026-10-28',
    limits: ['Liable unless it proves one of the listed causes (s. 38); listed valuables at most two million shillings unless declared (s. 41).'],
    claims: ['No time limit for claims was found in the Act.'],
    caveat: 'The Tariff Book’s conditions (and the SGR’s) were not found: what its “document of receipt” must carry was not checked.',
  },
  {
    key: 'tazara',
    name: 'TAZARA (Tanzania–Zambia Railway)',
    countries: ['TZ', 'ZM'],
    conditions: 'Tanzania-Zambia Railway Act (Cap. 143 Tanzania; Cap. 454 Zambia)',
    source: 'https://commons.laws.africa/akn/tz/act/1995/4/eng@2002-07-31.pdf',
    checkedOn: '2026-10-28',
    limits: ['Liable unless it proves one of the listed causes (s. 40).'],
    claims: ['A written claim within 90 days of the day the goods were to be delivered (s. 84).'],
    caveat: 'TAZARA’s consignment note form was not seen: what it must carry was not checked.',
  },
  {
    key: 'edr',
    name: 'Ethiopia–Djibouti Railway',
    countries: ['ET', 'DJ'],
    conditions: 'Proclamation 547/2007 on the carriage of goods by land (rail wagons included, Art. 2(8))',
    source: 'https://www.lawethiopia.com/images/federal_proclamation/proclamations_by_number/547.ae..pdf',
    checkedOn: '2026-10-28',
    particulars: [
      ...req('Proclamation 547/2007 Art. 6(1)', 'madeOut consignor carrier consignee from takenOverOn to goods packing packages marks mass charges'),
      ...req('Proclamation 547/2007 Art. 6(1)', 'dangerous', { when: 'dangerous' }),
      ...req('Proclamation 547/2007 Art. 6(1)', 'documents', { unless: 'no_documents' }),
      ...req('Proclamation 547/2007 Art. 5', 'consignorSigned carrierSigned'),
    ],
    limits: ['SDR 835 a package or SDR 2.5 a kilogram, whichever is higher; for delay, up to the carriage charge (Art. 27).'],
    claims: ['Hidden damage noticed within 7 days, delay within 15 days; suit within 2 years (Art. 35).'],
    caveat: 'Djibouti’s own carriage rules and the railway’s conditions were not found; on the Djibouti side other rules may apply.',
  },
  {
    key: 'rzd',
    name: 'Russian Railways',
    countries: ['RU'],
    conditions: 'Charter of Railway Transport (Federal Law 18-FZ) and the Rules of carriage (Mintrans Order 256/2020)',
    source: 'https://www.consultant.ru/document/cons_doc_LAW_40444/',
    checkedOn: '2026-10-28',
    particulars: [
      ...req('Mintrans Order 256/2020, ch. IV', 'from to consignor consignee charges goods packing mass noteNumber transitPeriod takenOverOn'),
      ...req('Mintrans Order 256/2020, ch. IV', 'seals', { unless: 'no_seals' }),
    ],
    limits: ['The goods’ invoice or declared value, with no cap by weight (art. 96); delay 6% of the charge a day, at most 50% (art. 97).'],
    claims: ['A claim to the railway first, within 6 months (art. 123); suit within 1 year (art. 125).'],
    electronic: { rule: 'required', from: '2026-09-01', system: 'the state system for electronic transport documents (ГИС ЭПД)' },
  },
  {
    key: 'china_railway',
    name: 'China State Railway',
    countries: ['CN'],
    conditions: 'Railway Law (art. 11) and the MOT Rail Goods Transport Rules 2026 (in force 1 May 2026)',
    source: 'https://www.gov.cn/zhengce/202603/content_7063679.htm',
    checkedOn: '2026-10-28',
    particulars: [
      ...req('MOT Rules 2026 art. 12', 'consignor consignee from to goods packing packages mass takenOverOn transitPeriod charges wagon'),
      ...req('MOT Rules 2026 art. 12', 'container', { when: 'container' }),
      ...req('MOT Rules 2026 art. 12', 'seals', { unless: 'no_seals' }),
    ],
    limits: ['Up to the declared value, or else the limit set by the railway authority; neither applies for intent or gross negligence (Railway Law art. 17).'],
    claims: ['Court limitation 3 years (Civil Code art. 188).'],
    electronic: { rule: 'allowed' },
    caveat: 'Domestic carriage only (Rules art. 2); the amount of the statutory limit was not verified.',
  },
  {
    key: 'indian_railways',
    name: 'Indian Railways',
    countries: ['IN'],
    conditions: 'Railways Act 1989: forwarding note (s. 64) and railway receipt (s. 65)',
    source: 'https://courtbook.in/railways-act-1989/section-65',
    checkedOn: '2026-10-28',
    limits: ['Rs 50 a kilogram with no value declared (s. 103 and the 1990 Rules, r. 3).'],
    claims: ['Notice within 6 months (s. 106); a claim to the Railway Claims Tribunal within 3 years.'],
    electronic: { rule: 'allowed', system: 'eT-RR (electronic railway receipt, FOIS)' },
    caveat: 'The receipt’s form is “as specified by the Central Government” and was not retrieved: what it must carry was not checked.',
  },
  {
    key: 'brazil',
    name: 'A Brazilian rail concessionaire',
    countries: ['BR'],
    conditions: 'Decreto 1.832/1996, ANTT Res. 5.944/2021 and the Civil Code (arts. 743–756)',
    source: 'https://www.legisweb.com.br/legislacao/?id=52591',
    checkedOn: '2026-10-28',
    limits: ['Up to the value declared by the shipper (Decreto 1.832/1996 art. 32; Civil Code art. 750) — which must be on the note (ANTT Res. 5.944/2021 art. 12 §3).'],
    claims: ['Hidden damage within 10 days (Civil Code art. 754); claims within 1 year.'],
    electronic: { rule: 'required', from: '2012-12-01', system: 'CT-e, model 57 (electronic transport document)', form: 'cte' },
    caveat: 'Brazil’s rail law sets no list of particulars; the CT-e’s own schema fixes them, and a CT-e exists only once the tax authority has authorised it — look its key up there.',
  },
  {
    key: 'kai',
    name: 'KAI (Indonesian railways)',
    countries: ['ID'],
    conditions: 'Law 23/2007 (art. 141) and Minister of Transport Regulation PM 48/2014 (art. 7(5))',
    source: 'https://peraturan.bpk.go.id/Download/94450/pm_48_tahun_2014.pdf',
    checkedOn: '2026-10-28',
    particulars: [...req('PM 48/2014 art. 7(5)', 'carrier consignor goods mass from to dates charges carrierSigned')],
    limits: ['Actual loss, without lost profit or charges already paid; no cap found (Law 23/2007 art. 158).'],
    claims: ['Short 7-day windows for claims (PP 72/2009 arts. 175–177).'],
    caveat: 'PM 48/2014 assumes paper copies signed by the railway; whether an electronic note counts is a question for counsel.',
  },
  {
    key: 'transnet',
    name: 'Transnet Freight Rail',
    countries: ['ZA'],
    conditions: 'Transnet Freight Rail Standard Conditions of Carriage (a contract, not a statute)',
    source: 'https://www.transnet.net/TFR-Customers',
    checkedOn: '2026-10-28',
    limits: ['Set by its conditions (clauses 24–26); the current text was not seen.'],
    claims: ['Set by its conditions; an earlier version (1998) lapsed claims after 180 days.'],
    caveat: 'The current conditions were not retrieved: nothing about the note was checked.',
  },
  {
    key: 'etihad_rail',
    name: 'Etihad Rail',
    countries: ['AE'],
    conditions: 'Etihad Rail Standard Haulage Terms v10 (February 2026) and the Commercial Transactions Law (Decree-Law 50/2022)',
    source: 'https://corporate-cdn.etihadrail.ae/uploads/ff1b5e5329d8ded256d71c5ec8a696c0.pdf',
    checkedOn: '2026-10-28',
    limits: ['AED 30,000 a container; 8.33 SDR a kilogram for cargo damaged with its container (Standard Haulage Terms).'],
    claims: ['Damage noticed within 2 days, claims within 2 months (Standard Haulage Terms); by statute 6 months domestic, 1 year international (art. 319).'],
    caveat: 'Etihad Rail works on forwarding instructions and a receipt that “shall not evidence” the goods (cl. 7.2): there is no consignment note to check.',
  },
  {
    key: 'rai',
    name: 'RAI (Iranian railways)',
    countries: ['IR'],
    conditions: 'Law on Open Access to the Rail Transport Network (2005), art. 8, and the Commercial Code (arts. 377–394)',
    source: 'https://www.qavanin.ir/Law/PrintText/87708',
    checkedOn: '2026-10-28',
    limits: ['The goods’ value unless agreed otherwise (Commercial Code art. 386).'],
    claims: ['One year (art. 393).'],
    caveat: 'One waybill per wagon, in a form set by the railway’s board; the form was not found.',
  },
];

export function railwayOf(key: string | undefined): Railway | undefined {
  return key ? RAILWAYS.find((r) => r.key === key) : undefined;
}

/** The railways that work in a country — what a holder picks from. */
export function railwaysIn(country: string | undefined): Railway[] {
  const c = country?.trim().toUpperCase();
  return c ? RAILWAYS.filter((r) => r.countries.includes(c)) : [];
}

/**
 * THE CORRIDOR AGREEMENTS: they commit their states to accept a rail waybill across the border, and regulate the
 * handover between railways — never the shipper's contract, its note's particulars or its limits.
 */
const RAIL_CORRIDORS = [
  { states: ['BI', 'CD', 'KE', 'RW', 'SS', 'UG'], says: 'Northern Corridor states accept the Standard Rail Waybill for inter-state and transit carriage (NCTTA Protocol 4, Art. 7); the railways hand over wagons, goods and documents at the border (Protocol 5).' },
  { states: ['BI', 'CD', 'MW', 'RW', 'TZ', 'UG', 'ZM'], says: 'Central Corridor states accept each other’s rail waybill for inter-state and transit carriage (Protocol 4, Art. 7).' },
];

/** The convention-level facts a holder needs once the lane is under CIM or SMGS. */
const CIM_LIMITS = ['17 SDR a kilogram of gross mass short (Art. 30 §2), unless a higher value (Art. 34) or a special interest in delivery (Art. 35) is declared on the note; delay up to four times the carriage charge (Art. 33).'];
const CIM_CLAIMS = ['Hidden damage: ask for it to be ascertained within 7 days of acceptance; delay: within 60 days (Art. 47). Suit within 1 year (Art. 48).'];
const SMGS_CLAIMS = ['Claims within 9 months, or 2 months for delay (SMGS limitation period).'];

/**
 * BRAZIL'S CT-e ACCESS KEY: 44 digits, the model (57) at digits 21–22, and a check digit by modulo 11 with weights 2–9
 * from the right. A key that fails is a mistyped key, or not a CT-e.
 */
export function cteKeyProblem(key: string): 'length' | 'model' | 'check_digit' | undefined {
  const k = key.replace(/\s+/g, '');
  if (!/^\d{44}$/.test(k)) return 'length';
  if (k.slice(20, 22) !== '57') return 'model';
  let sum = 0;
  for (let i = 42, w = 2; i >= 0; i -= 1, w = w === 9 ? 2 : w + 1) sum += Number(k[i]) * w;
  const r = sum % 11;
  const dv = r < 2 ? 0 : 11 - r;
  return Number(k[43]) === dv ? undefined : 'check_digit';
}

/** What the holder says of a note: the lane, what it carries, and what is printed on it. */
export interface HeldRailNote {
  from: string;
  to: string;
  /** The day the note was made out (YYYY-MM-DD) — the law is read on that day. */
  madeOutOn: string;
  railway?: string;
  load: RailLoad;
  dangerous?: boolean;
  printed: RailParticular[];
  /** An electronic note: the reference in the railway's system, and whether the printout carries its printout line. */
  electronic?: { reference?: string; printoutLine?: boolean };
}

export interface RailNoteFinding {
  key: RailParticular;
  rule: string;
  /** Missing: the rules ask for it. Ask: the rules ask for it only if something the note cannot show is so. */
  kind: 'missing' | 'ask';
  unless?: RailRequirement['unless'];
}

export interface RailNoteCheck {
  regime: RailRegime;
  /** The rules the particulars were read against — a convention, a railway's conditions, or none we could read. */
  rules: string[];
  railway?: string;
  checkedOn: string;
  sources: string[];
  findings: RailNoteFinding[];
  /** Every particular the rules ask of this note — what its holder is asked to look for. */
  asked: RailParticular[];
  /** True when there were rules to read against and nothing they ask for is missing. */
  complete: boolean;
  /** Said when there are no rules we could read for this note: the particulars were not checked. */
  notChecked?: string;
  electronic: Array<{ code: 'cte_length' | 'cte_model' | 'cte_check_digit' | 'electronic_required' | 'printout_line' | 'no_reference' | 'electronic_in_question'; detail: string }>;
  limits: string[];
  claims: string[];
  caveats: string[];
}

const SAY_REGIME: Record<RailRegime, string> = {
  national: '',
  cim: 'Both ends are in CIM states: the CIM applies (Art. 1 §1).',
  smgs: 'Both ends are in SMGS states: the SMGS applies.',
  cim_lines: 'Both ends are in CIM states, one of which applies it only on its listed lines (Art. 1 §6): the CIM applies only where the route is on those lines.',
  cim_smgs: 'One end is a CIM state, the other an SMGS one: two successive contracts — on the common CIM/SMGS note where the railways agree it, or re-consigned at the changeover.',
  cim_if_agreed: 'One end is a CIM state, the other in none: the CIM applies only if the parties agreed it (Art. 1 §2) — the CIM statement on the note shows it.',
  atit: 'Both ends are ATIT states: its Chapter III applies, on the nationally approved “Carta de Porte Internacional – TIF”.',
  contract: 'No rail convention joins these two countries: the carriage is under the railway’s own conditions and the law they name.',
};

/**
 * THE CHECK OF A HELD NOTE against the law of its lane. Pure: the same note and catalogue give the same answer.
 */
export function checkRailNote(note: HeldRailNote): RailNoteCheck {
  const regime = railRegimeOf(note.from, note.to, note.madeOutOn);
  const railway = railwayOf(note.railway);
  const printed = new Set(note.printed);
  const statementPrinted = printed.has('statement');
  const rules: RailRequirement[] = [];
  const names: string[] = [];
  const sources: string[] = [];
  const limits: string[] = [];
  const claims: string[] = [];
  const caveats: string[] = [];
  if (SAY_REGIME[regime]) caveats.push(SAY_REGIME[regime]);
  for (const c of RAIL_CORRIDORS) if (regime !== 'national' && c.states.includes(note.from.toUpperCase()) && c.states.includes(note.to.toUpperCase())) caveats.push(c.says);

  const useCim = regime === 'cim' || regime === 'cim_smgs' || ((regime === 'cim_if_agreed' || regime === 'cim_lines') && statementPrinted);
  const useSmgs = regime === 'smgs' || regime === 'cim_smgs';
  if (useCim) {
    rules.push(...CIM_RULES);
    names.push(RAIL_INSTRUMENTS.cim.name);
    sources.push(RAIL_INSTRUMENTS.cim.source);
    limits.push(...CIM_LIMITS);
    claims.push(...CIM_CLAIMS);
  }
  if (useSmgs) {
    rules.push(...SMGS_RULES);
    names.push(RAIL_INSTRUMENTS.smgs.name);
    sources.push(RAIL_INSTRUMENTS.smgs.source);
    claims.push(...SMGS_CLAIMS);
  }
  if (regime === 'atit') sources.push(RAIL_INSTRUMENTS.atit.source);
  // A national lane, or one under the railway's own conditions: the railway's rules, where we have read them.
  if (!useCim && !useSmgs && railway) {
    if (railway.particulars) {
      rules.push(...railway.particulars);
      names.push(railway.conditions);
    }
    sources.push(railway.source);
    limits.push(...railway.limits);
    claims.push(...railway.claims);
    if (railway.caveat) caveats.push(railway.caveat);
  }

  const applies = (r: RailRequirement) => !r.when || (r.when === 'dangerous' ? Boolean(note.dangerous) : r.when === note.load);
  const seen = new Set<string>();
  const findings: RailNoteFinding[] = [];
  const asked = [...new Set(rules.filter(applies).map((r) => r.key))];
  for (const r of rules.filter(applies)) {
    if (printed.has(r.key) || seen.has(r.key)) continue;
    seen.add(r.key);
    findings.push({ key: r.key, rule: r.rule, kind: r.unless ? 'ask' : 'missing', ...(r.unless ? { unless: r.unless } : {}) });
  }

  const electronic: RailNoteCheck['electronic'] = [];
  const e = railway?.electronic;
  if (note.electronic) {
    const ref = note.electronic.reference?.trim();
    if (!ref) electronic.push({ code: 'no_reference', detail: 'An electronic note has a reference in the railway’s system: without it, nobody can look it up.' });
    if (ref && e?.form === 'cte' && !useCim && !useSmgs) {
      const p = cteKeyProblem(ref);
      if (p) electronic.push({ code: `cte_${p}`, detail: p === 'length' ? 'A CT-e access key is 44 digits.' : p === 'model' ? 'Digits 21–22 of a rail CT-e key are 57: this key is another document.' : 'The key’s last digit does not match the rest: a digit is mistyped.' });
    }
    if (useCim && note.electronic.printoutLine === false) electronic.push({ code: 'printout_line', detail: 'A printout of an electronic CIM note must say “Printout of the electronic consignment note – date – produced by” the carrier (GLV-CIM, Appendix 1).' });
    if (railway?.key === 'kai' && !useCim && !useSmgs) electronic.push({ code: 'electronic_in_question', detail: railway.caveat ?? '' });
  } else if (e?.rule === 'required' && (!e.from || note.madeOutOn >= e.from) && !useCim && !useSmgs) {
    electronic.push({ code: 'electronic_required', detail: `${railway!.name}’s note is electronic since ${e.from}, in ${e.system}: a paper note is allowed only in the cases the law lists.` });
  }

  const checked = rules.length > 0;
  const notChecked = checked
    ? undefined
    : regime === 'atit'
      ? 'The ATIT asks for “all the data the form requires”, on a nationally approved form we have not seen: the particulars were not checked.'
      : railway
        ? `What ${railway.name}’s note must carry was not checked: ${railway.caveat ?? 'its conditions were not read.'}`
        : 'Name the railway: the particulars are checked against its conditions.';
  return {
    regime,
    rules: names,
    ...(railway ? { railway: railway.name } : {}),
    checkedOn: railway?.checkedOn ?? RAIL_INSTRUMENTS.cim.checkedOn,
    sources,
    findings,
    asked,
    complete: checked && !findings.some((f) => f.kind === 'missing') && !electronic.some((x) => x.code !== 'electronic_in_question'),
    ...(notChecked ? { notChecked } : {}),
    electronic,
    limits,
    claims,
    caveats,
  };
}
