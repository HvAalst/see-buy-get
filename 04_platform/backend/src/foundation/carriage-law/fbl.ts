/**
 * THE FIATA BILL OF LADING, HELD AND EXPLAINED — never issued by us (the user, 2026-10-28: "if we optimize for FBL, we must
 * know and report for our users"; 2026-10-29, the choices: the holder records FIATA's check of an electronic FBL with
 * the result attached; the limits in SDR "plus about-US$" at a rate kept as data). Design: 05_engineering/fbl_note.md;
 * research with a source for every claim: 05_engineering/research/fbl_2026-10-29.md.
 *
 * Issuing one would make the issuer "a carrier" for the whole journey, the sea included (FBL cl. 2.1). We hold the one a
 * user's forwarder issued and say: complete as printed for the form's boxes; agreeing with our own papers or not; where
 * to check it is genuine and what was seen there; and what it means. Never "valid": a forged FBL can copy our container
 * number exactly, and FIATA's own check says nothing of who holds it now or whether an original was already surrendered.
 */
export type FblForm = 'fbl' | 'fwb';
export const FBL_FORMS: readonly FblForm[] = ['fbl', 'fwb'];

export interface FblFormFacts {
  key: FblForm;
  name: string;
  conditions: string;
  negotiable: boolean;
  source: string;
}

export const FBL_FORM_FACTS: Record<FblForm, FblFormFacts> = {
  fbl: {
    key: 'fbl',
    name: 'FIATA Multimodal Transport Bill of Lading (FBL)',
    conditions: 'FBL Standard Conditions (1992), subject to the UNCTAD/ICC Rules for Multimodal Transport Documents (ICC Publication 481)',
    negotiable: true,
    source: 'https://fiata.cdn.prismic.io/fiata/afedd989-c99b-4142-9f64-8281c99aa4c5_FIATA_Documents_and_Forms.pdf',
  },
  fwb: {
    key: 'fwb',
    name: 'FIATA Multimodal Transport Waybill (FWB)',
    conditions: 'FWB Standard Conditions (1997)',
    negotiable: false,
    source: 'https://fiata.cdn.prismic.io/fiata/afedd989-c99b-4142-9f64-8281c99aa4c5_FIATA_Documents_and_Forms.pdf',
  },
};

/** The boxes on the face of the form. Every key has its words in the apps (`fbl.box.*`). */
export const FBL_BOXES = [
  'consignor',
  'consignedTo',
  'notify',
  'placeOfReceipt',
  'vessel',
  'portOfLoading',
  'portOfDischarge',
  'placeOfDelivery',
  'marks',
  'packages',
  'description',
  'grossWeight',
  'measurement',
  'freightPayableAt',
  'originals',
  'placeDateOfIssue',
  'signature',
  'deliveryAgent',
] as const;
export type FblBox = (typeof FBL_BOXES)[number];

/**
 * WHAT A BOX IS FOR, and whether its gap is missing (a bank, a consignee or the conditions rely on it) or only a question
 * (needed where there is a sea leg, or as a contract asks).
 */
interface BoxRule {
  key: FblBox;
  rule: string;
  kind: 'missing' | 'ask';
  forms?: FblForm[];
  /** Only where the carriage includes a sea or inland-waterway leg. */
  seaOnly?: boolean;
}

const BOX_RULES: BoxRule[] = [
  { key: 'consignor', rule: 'The form’s face', kind: 'missing' },
  { key: 'consignedTo', rule: 'The form’s face — “to order of” a named party, or the consignee', kind: 'missing' },
  { key: 'notify', rule: 'The form’s face — who is told on arrival', kind: 'ask' },
  { key: 'placeOfReceipt', rule: 'UCP 600 Art. 19(a)(iii) — where it was taken in charge', kind: 'missing' },
  { key: 'vessel', rule: 'The form’s face', kind: 'ask', seaOnly: true },
  { key: 'portOfLoading', rule: 'The form’s face', kind: 'ask', seaOnly: true },
  { key: 'portOfDischarge', rule: 'The form’s face', kind: 'ask', seaOnly: true },
  { key: 'placeOfDelivery', rule: 'UCP 600 Art. 19(a)(iii) — the final destination', kind: 'missing' },
  { key: 'marks', rule: 'The form’s face — for a container, its number and seals', kind: 'missing' },
  { key: 'packages', rule: 'FBL cl. 8.4 — packages counted on the bill are the units the limit counts', kind: 'missing' },
  { key: 'description', rule: 'The form’s face', kind: 'missing' },
  { key: 'grossWeight', rule: 'FBL cl. 8.3 — the limit by the kilogram counts the gross weight', kind: 'missing' },
  { key: 'measurement', rule: 'The form’s face', kind: 'ask' },
  { key: 'freightPayableAt', rule: 'The form’s face', kind: 'ask' },
  { key: 'originals', rule: 'UCP 600 Art. 19(a)(iv) — the full set as stated on it', kind: 'missing', forms: ['fbl'] },
  { key: 'placeDateOfIssue', rule: 'The form’s face — the day it was issued', kind: 'missing' },
  { key: 'signature', rule: 'UCP 600 Art. 19(a)(i) — signed, with the capacity: as carrier, or as agent for a named carrier', kind: 'missing' },
  { key: 'deliveryAgent', rule: 'The form’s face — “For delivery of goods please apply to”', kind: 'missing', forms: ['fbl'] },
];

/** The SDR's value in dollars, kept as data with the day it was read. */
export const SDR_RATE = { usd: 1.35178, on: '2026-10-28', source: 'https://www.imf.org/external/np/fin/data/rms_sdrv.aspx' };
const usd = (sdr: number) => `about US$${(sdr * SDR_RATE.usd).toLocaleString('en', { maximumFractionDigits: sdr * SDR_RATE.usd < 100 ? 2 : 0, minimumFractionDigits: sdr * SDR_RATE.usd < 100 ? 2 : 0 })}`;

/**
 * A COUNTRY'S OWN LAW, where it changes what the bill means — data, never code (a nation's rules stay national). Each with
 * its source; a country with none here says nothing.
 */
export interface FblCountryNote {
  country: string;
  says: string;
  source: string;
}

export const FBL_COUNTRY_NOTES: FblCountryNote[] = [
  { country: 'KE', says: 'Kenya’s law on electronic writing does not reach documents of title (Kenya Information and Communications Act, s. 83B, as read in its 2011 text): an electronic FBL may not stand as title to the goods in Kenya. Kenya has no FIATA association.', source: 'https://ca.go.ke/sites/default/files/CA/Statutes%20and%20Regulations/Kenya-Information-and-Communication-Act-1998.pdf' },
  { country: 'UG', says: 'Uganda’s Electronic Transactions Act 2011 excludes negotiable documents of title (Schedule 2(e)): an electronic FBL may not stand as title to the goods in Uganda.', source: 'SeeBuyGet research, 2026-10-29 (05_engineering/research/fbl_2026-10-29.md, section 2): the Act as published on UNODC SHERLOC, read in full; no stable address recorded' },
  { country: 'ET', says: 'Ethiopia’s Proclamation 548/2007 sets its own limits for multimodal transport — 835 SDR a package or 2.5 SDR a kilogram, delay up to 2.5 times the freight, suit within 2 years — and its operators are licensed (Proclamation 549/2007 Art. 6(7)). Where mandatory, it comes before the printed terms (FBL cl. 7.1).', source: 'https://www.metaappz.com/pdf/ethiopian_laws/federal/2007/pr_548_2007.pdf' },
  { country: 'IN', says: 'India’s Multimodal Transportation of Goods Act 1993 lets only a registered operator issue a multimodal document (s. 3); the register is public.', source: 'https://dgma.gov.in/multimodal-transport-operation/mto-list-of-the-registered-mtos' },
  ...['TZ', 'RW', 'CD', 'SS', 'DJ'].map((country) => ({ country, says: 'Signed the Accra Convention on Negotiable Cargo Documents on 26 October 2026; it is not in force, and reaches only a document that refers to it.', source: 'https://treaties.un.org/Pages/ViewDetails.aspx?src=TREATY&mtdsg_no=X-22&chapter=10&clang=_en' })),
];

/** Where a bill's genuineness can be looked up: for an electronic one FIATA's own page; for paper, the association whose emblem it carries. */
export const FIATA_VERIFY_URL = 'https://fiata.org/document-verification/';
/**
 * FIATA'S OWN DIRECTORY of its members (the user, 2026-10-29: "we do not check, but users can check, so we put a fiata link
 * to their directory"). We check nobody's membership: we point to where anybody can look a forwarder up, under its country.
 */
export const FIATA_DIRECTORY_URL = 'https://fiata.org/directory/';

/** What the holder says of a bill: the form, what is printed, and the facts we hold it against. */
export interface HeldFblFacts {
  form: FblForm;
  printed: FblBox[];
  /** The carriage includes a sea or inland-waterway leg: the limits and the boxes asked depend on it. */
  seaLeg: boolean;
  /** The issuer's country, as printed. */
  issuerCountry: string;
  /** Countries the goods move between — the country notes of each are said. */
  countries: string[];
  electronic: boolean;
}

export interface FblFinding {
  key: FblBox;
  rule: string;
  kind: 'missing' | 'ask';
}

export interface FblCheck {
  form: string;
  conditions: string;
  negotiable: boolean;
  findings: FblFinding[];
  asked: FblBox[];
  complete: boolean;
  /** What it means, in plain words — each with its clause. */
  meaning: string[];
  limits: string[];
  claims: string[];
  country: FblCountryNote[];
  /** Where to look it up, and what such a look-up does and does not prove. */
  genuine: { where: string; says: string; directory: string };
  sdrRate: typeof SDR_RATE;
  sources: string[];
}

/** THE CHECK OF A HELD BILL. Pure: the same bill and the same catalogue give the same answer. */
export function checkFbl(b: HeldFblFacts): FblCheck {
  const facts = FBL_FORM_FACTS[b.form];
  const printed = new Set(b.printed);
  const rules = BOX_RULES.filter((r) => (!r.forms || r.forms.includes(b.form)) && (!r.seaOnly || b.seaLeg));
  const findings = rules.filter((r) => !printed.has(r.key)).map((r) => ({ key: r.key, rule: r.rule, kind: r.kind }));
  const meaning = facts.negotiable
    ? [
        'Negotiable: it is title to the goods, and whoever holds it, endorsed, may receive or pass on the goods (FBL cl. 3.1) — unless it is marked “non negotiable”.',
        'The goods are handed over against one original, surrendered duly endorsed; the others are then void. Only the blue original is an original: a copy, a scan or what SeeBuyGet keeps is not one.',
        'Its particulars are the consignor’s declaration and stand as evidence until shown otherwise; once it has passed in good faith to a consignee who relied on it, they are conclusive (cl. 3.2).',
      ]
    : ['Not negotiable: the consignee need not present it to receive the goods; the consignor may pass the right of control to the consignee (FWB, the box for clause 4).'];
  const limits = [
    b.seaLeg
      ? `At most 666.67 SDR a package (${usd(666.67)}) or 2 SDR a kilogram of gross weight (${usd(2)}), whichever is higher, unless a higher value was declared and accepted before it was taken in charge (FBL cl. 8.3).`
      : `No sea or inland waterway in the carriage: at most 8.33 SDR a kilogram of gross weight (${usd(8.33)}) (FBL cl. 8.5).`,
    'Where it is known on which stage the loss happened, the limit of a convention or mandatory national law for that stage applies instead (cl. 8.6(a)). No East African state is party to the road convention (CMR): a loss on the road there is likely held to the bill’s own limit — a question for a lawyer.',
    'Delay is answered for only if the consignor’s interest in timely delivery was declared and accepted on the bill (cl. 6.2), and then at most twice the freight (cl. 8.7). Goods not delivered 90 days after the date due may be treated as lost (cl. 6.4).',
    'These are limits of the forwarder’s liability, not cargo insurance.',
  ];
  const claims = [
    'Notice in writing at delivery; for damage not apparent, within 6 days after delivery — without it, delivery counts as in good order until shown otherwise (FBL cl. 16).',
    'Suit within 9 months after delivery, or after the date it should have been delivered (cl. 17), and only where the forwarder has its place of business as stated on the bill (cl. 19).',
  ];
  const seen = new Set<string>();
  const country = FBL_COUNTRY_NOTES.filter((n) => [b.issuerCountry, ...b.countries].map((c) => c?.trim().toUpperCase()).includes(n.country) && !seen.has(n.country) && seen.add(n.country));
  const genuine = b.electronic
    ? { where: FIATA_VERIFY_URL, says: 'FIATA’s page says whether the electronic bill was registered, who issued it, and shows it as issued. It does not say who holds it now, whether it was endorsed, or whether an original was already surrendered; an amended bill’s earlier versions no longer check.', directory: FIATA_DIRECTORY_URL }
    : { where: FIATA_DIRECTORY_URL, says: 'There is no public check of a paper bill: its serial number is in the register of the association whose emblem is printed on it — ask that association. Look the issuer up yourself in FIATA’s directory, under its country: SeeBuyGet checks nobody’s membership.', directory: FIATA_DIRECTORY_URL };
  return {
    form: facts.name,
    conditions: facts.conditions,
    negotiable: facts.negotiable,
    findings,
    asked: rules.map((r) => r.key),
    complete: !findings.some((f) => f.kind === 'missing'),
    meaning,
    limits,
    claims,
    country,
    genuine,
    sdrRate: SDR_RATE,
    sources: [facts.source, 'https://fiata.cdn.prismic.io/fiata/300a60b6-eaad-4ee5-a0a4-9066d7fbf34e_LIG_2023.pdf', ...country.map((c) => c.source)],
  };
}
