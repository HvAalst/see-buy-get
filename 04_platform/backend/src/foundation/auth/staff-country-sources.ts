/**
 * 2026-11-01 — WHERE EACH STAFF DOOR'S RECORD COMES FROM, BY COUNTRY (the owner: "everything needs to be separated by
 * country"). STAFF_AREAS says which ROLE a door is for; this says which COUNTRY its record is in, so a member of staff who
 * works in Kenya reaches Kenya's shops, parcels and papers and nothing of the Netherlands'. staff-country.interceptor.ts
 * reads it on every staff request; staff-country-sources.spec.ts fails a staff door this does not declare.
 *
 * Five answers:
 *  - `record`  — the door is about one record named in its path (a shop, a parcel, a company…): another country's answers
 *                as if it did not exist. A record touching several countries (a load across a border) is every one's.
 *  - `country` — the door names a country itself (a country's standing, by its code).
 *  - `list`    — a list or a queue: each row is shown where its country is the reader's.
 *  - `network` — not any country's record: your own staff account, reference data that is the same everywhere.
 *  - `every`   — not separated yet, or the network's as a whole (the engine underneath, figures across countries, settings
 *                that bind every country): only somebody who works in every country reaches it. Said with why, so the
 *                list of what is not yet split by country is this file, read.
 */

/** The kinds of record a country can be read off — each answered by a resolver (staff-country.registry.ts). */
export const RECORD_KINDS = [
  'agent',
  'mdp',
  'vendor',
  'fleet',
  'driver',
  'entity',
  'parcel',
  'freight',
  'import',
  'export',
  'vehicle',
  'payout',
  'funding',
  'unmatched-payment',
  'held-payment',
  'operator',
  'staff-proposal',
  'interest',
  'presence-proposal',
  'id-dispute',
  'account-move',
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/** How a row of a list says its country: a field (or fields) on it, a currency on it, or a record it names. */
export type RowCountry = { field: string | string[] } | { currency: string } | { of: RecordKind; id: string | string[] };

/** One list in a response: the response itself (`at` absent), one field of it, or every list field of it (`*`). */
export interface ListRule {
  at?: string;
  row: RowCountry;
}

export type CountrySource =
  | { record: RecordKind; param: string }
  | { country: 'param' | 'query' | 'body'; name: string }
  | { list: ListRule[] }
  | { network: string }
  | { every: string };

const record = (kind: RecordKind, param: string): CountrySource => ({ record: kind, param });
const list = (...rules: ListRule[]): CountrySource => ({ list: rules });
const every = (why: string): CountrySource => ({ every: why });
const network = (why: string): CountrySource => ({ network: why });

const ENGINE = 'the engine underneath — the network’s, not one country’s records';
const ACROSS = 'figures across every country — not yet split by country';
const SETTING = 'a setting that binds every country';
const NOT_YET = 'not yet split by country';

/** Doors named one by one — read before the rules below. */
export const COUNTRY_SOURCES: Readonly<Record<string, CountrySource>> = {
  // your own staff account, and asking for a colleague (the service gives only countries the asker works in)
  'GET sbg/operators/me': network('your own staff account'),
  'POST sbg/operators/me/two-step': network('your own staff account'),
  'POST sbg/operators/me/two-step/confirm': network('your own staff account'),
  'POST sbg/operators/proposals': network('asking for a colleague: only countries you work in can be given'),
  'POST sbg/operators/proposals/:proposalId/approve': record('staff-proposal', 'proposalId'),
  'POST sbg/operators/proposals/:proposalId/decline': record('staff-proposal', 'proposalId'),
  'GET sbg/operators': list({ at: '*', row: { field: 'countries' } }),
  'POST sbg/operators': every('the first staff account, made with the setup key'),
  'GET sbg/module-info': network('what this server runs'),
  // reference data, the same in every country
  'GET sbg/rail/railways': network('the railways that exist — the same for everybody'),
  'POST sbg/rail/check': network('the law of a lane, worked out — no record of anybody’s'),
  'GET sbg/fx': network('exchange rates — the same for everybody'),
  'GET sbg/border-rules': network('the rules of crossing — the same for everybody'),
  'POST sbg/routing/plan-journey': network('a journey worked out — no record of anybody’s'),
  'GET sbg/imports/known-papers': network('the papers an import can need — the same for everybody'),
  'GET sbg/imports/air/agencies': network('the air cargo agencies that exist — the same for everybody'),

  // the early sign-ups, by country (the owner's first example)
  'GET sbg/interest': list({ at: 'items', row: { field: 'country' } }),
  'DELETE sbg/interest/:noteId': record('interest', 'noteId'),

  // registrations and papers waiting on staff
  'GET sbg/agents': list({ row: { field: 'country' } }),
  'GET sbg/agents/kyc-queue': list({ row: { field: 'country' } }),
  'GET sbg/agents/unfinished': list({ at: 'items', row: { of: 'agent', id: 'did' } }),
  'GET sbg/mdps': list({ row: { field: 'country' } }),
  'GET sbg/hub-papers': list({ row: { field: 'country' } }),
  'GET sbg/fleet/managers': list({ row: { of: 'fleet', id: 'did' } }),
  'GET sbg/fleet/managers/kyc-queue': list({ row: { of: 'fleet', id: 'did' } }),
  'GET sbg/fleet/managers/setting-up': list({ at: 'items', row: { field: 'jurisdiction' } }),
  'GET sbg/fleet/drivers': list({ row: { of: 'driver', id: ['did', 'driverDid'] } }),
  'GET sbg/fleet/drivers/kyc-queue': list({ row: { of: 'driver', id: ['did', 'driverDid'] } }),
  'GET sbg/fleet/drivers/id-photos': list({ at: 'items', row: { of: 'driver', id: 'did' } }),
  'GET sbg/fleet/papers/couriers/:did/contact': record('driver', 'did'),
  'GET sbg/businesses': list({ at: 'items', row: { field: 'country' } }),
  'GET sbg/vendors': list({ row: { field: 'country' } }),
  'GET sbg/entities': list({ row: { field: 'jurisdiction' } }),
  'GET sbg/companies/expiring': list({ at: 'items', row: { of: 'entity', id: 'entityId' } }),
  'GET sbg/presence': list({ at: 'items', row: { field: 'jurisdiction' } }),
  'GET sbg/presence/proposals': list({ at: '*', row: { field: 'jurisdiction' } }),
  'POST sbg/presence/proposals/:proposalId/approve': record('presence-proposal', 'proposalId'),
  'POST sbg/presence/proposals/:proposalId/decline': record('presence-proposal', 'proposalId'),
  'GET sbg/id-disputes': list({ at: '*', row: { of: 'id-dispute', id: 'disputeId' } }),
  'GET sbg/account-moves': list({ at: '*', row: { of: 'account-move', id: 'moveId' } }),

  // parcels, loads and the papers of the road
  'GET sbg/parcels': list({ row: { of: 'parcel', id: 'parcelId' } }),
  'GET sbg/disputes': list({ at: 'disputes', row: { of: 'parcel', id: 'parcelId' } }),
  'POST sbg/disputes/:parcelId/resolve': record('parcel', 'parcelId'),
  'GET sbg/damage-reports': list({ at: 'items', row: { of: 'parcel', id: 'parcelId' } }),
  'GET sbg/lost-parcels': list({ row: { of: 'parcel', id: 'parcelId' } }),
  'GET sbg/dispatch/freight': list({ row: { of: 'freight', id: 'freightId' } }),
  'GET sbg/freight-claims': list({ at: 'claims', row: { of: 'freight', id: 'freightId' } }),
  'POST sbg/freight-claims/:id/resolve': record('freight', 'id'),
  'GET sbg/imports': list({ at: 'items', row: { field: ['originCountry', 'destCountry'] } }),
  'GET sbg/exports': list({ at: 'items', row: { of: 'export', id: 'exportId' } }),

  // money coming in: a request is its company's; a payment with no name on it is the countries of its money
  'GET rails/funding': list({ at: 'items', row: { of: 'entity', id: 'entityId' } }, { at: 'unmatched', row: { currency: 'currency' } }, { at: 'held', row: { currency: 'payment.currency' } }),
  'POST rails/funding/unmatched/:id/apply': record('unmatched-payment', 'id'),
  'POST rails/funding/held/:id/release': record('held-payment', 'id'),
  'POST rails/funding/held/:id/refuse': record('held-payment', 'id'),

  // figures across countries, the live stream, and the audit of reads: the network's as a whole for now
  'GET sbg/dashboard': every(ACROSS),
  'GET sbg/finance': every(ACROSS),
  'GET sbg/heatmap': every(ACROSS),
  'GET sbg/pilot': every(ACROSS),
  'GET sbg/market-pulse': every(ACROSS),
  'POST sbg/market-pulse/recompute': every(ACROSS),
  'GET sbg/network/plan-vs-actual': every(ACROSS),
  'GET sbg/offers/response': every(ACROSS),
  'GET sbg/reputation/review': every(ACROSS),
  'GET sbg/border-waits': every(ACROSS),
  'GET sbg/live': every('the live stream carries every country’s events — not yet split by country'),
  'GET sbg/staff-reads': every('what staff opened, in every country'),
  // settings that bind every country
  'POST sbg/fx': every(SETTING),
  'POST sbg/border-rules': every(SETTING),
  'GET sbg/connections': every('the server’s connections — email, texts, storage — serve every country'),
  'POST sbg/connections/router/check': every('the server’s connections — email, texts, storage — serve every country'),
  'PUT sbg/help/:topic/:key/image': every('help pictures are read in every country'),
  'DELETE sbg/help/:topic/:key/image': every('help pictures are read in every country'),
  'POST sbg/fleet/papers/sweep': every('the papers check runs for every country at once'),
  'GET sbg/fleet/papers': every(NOT_YET),
};

/**
 * Doors by family, in order: the first that matches answers. A route key is "METHOD path" with the path as the
 * controllers write it (`sbg/agents/:did/ledger`).
 */
export const COUNTRY_RULES: ReadonlyArray<readonly [RegExp, CountrySource]> = [
  // the engine underneath
  [/^[A-Z]+ (control-tower|did|gateway|identity|matching|reputation|settlement|shipments|tracking)(\/|$)/, every(ENGINE)],
  // one record named in the path
  [/^[A-Z]+ sbg\/agents\/:did(\/|$)/, record('agent', 'did')],
  [/^[A-Z]+ sbg\/mdps\/:id(\/|$)/, record('mdp', 'id')],
  [/^[A-Z]+ sbg\/vendors\/:id(\/|$)/, record('vendor', 'id')],
  [/^[A-Z]+ sbg\/fleet\/managers\/:did(\/|$)/, record('fleet', 'did')],
  [/^[A-Z]+ sbg\/fleet\/drivers\/:did(\/|$)/, record('driver', 'did')],
  [/^[A-Z]+ sbg\/drivers\/:did(\/|$)/, record('driver', 'did')],
  [/^[A-Z]+ sbg\/entities\/:entityId(\/|$)/, record('entity', 'entityId')],
  [/^[A-Z]+ sbg\/businesses\/:entityId(\/|$)/, record('entity', 'entityId')],
  [/^[A-Z]+ sbg\/depots\/:entityId(\/|$)/, record('entity', 'entityId')],
  [/^[A-Z]+ sbg\/parcels\/:id(\/|$)/, record('parcel', 'id')],
  [/^[A-Z]+ sbg\/dispatch\/freight\/:id(\/|$)/, record('freight', 'id')],
  [/^[A-Z]+ sbg\/imports\/:importId(\/|$)/, record('import', 'importId')],
  [/^[A-Z]+ sbg\/exports\/:exportId(\/|$)/, record('export', 'exportId')],
  [/^[A-Z]+ sbg\/vehicles\/:id(\/|$)/, record('vehicle', 'id')],
  [/^[A-Z]+ sbg\/payouts\/:payoutId(\/|$)/, record('payout', 'payoutId')],
  [/^[A-Z]+ rails\/funding\/:fundingId(\/|$)/, record('funding', 'fundingId')],
  [/^[A-Z]+ sbg\/operators\/:operatorId(\/|$)/, record('operator', 'operatorId')],
  [/^[A-Z]+ sbg\/id-disputes\/:disputeId(\/|$)/, record('id-dispute', 'disputeId')],
  [/^[A-Z]+ sbg\/account-moves\/:moveId(\/|$)/, record('account-move', 'moveId')],
  // a country named in the path
  [/^[A-Z]+ sbg\/presence\/:jurisdiction(\/|$)/, { country: 'param', name: 'jurisdiction' }],
  // families not yet split by country
  [
    /^[A-Z]+ sbg\/(ops|market|pricing|corridors|consignment-notes|conversations|documents|field-observations|fiscal-invoices|flag-cases|paper-reports|gs1-disputes|totes|departures|consignments|media|carriers|route-constraints|risk-register|routing|directory|scan|evidence|flags|declarations|boxes)(\/|$)/,
    every(NOT_YET),
  ],
  [/^[A-Z]+ sbg\/dispatch\/(board|posted|find-load|offers|proposals|publish-ready)(\/|$)/, every(NOT_YET)],
  [/^POST sbg\/dispatch\/freight$/, every(NOT_YET)],
  [/^GET sbg\/(vehicles|drivers)$/, every(NOT_YET)],
  // making a record from the console: the country it will be in is in the body, not yet read here
  [/^POST sbg\/(agents|mdps|entities|imports|depots|vehicles|drivers|drivers\/onboard|drivers\/payout|fleet\/managers)$/, every(NOT_YET)],
  [/^[A-Z]+ sbg\/(parcels\/(accept|book-freight|collect|handover|handover\/manifest))$/, every(NOT_YET)],
  [/^GET sbg\/(depots)$/, every(NOT_YET)],
  [/^[A-Z]+ sbg\/(fleet\/(assignments|dashboard|movers))$/, every(NOT_YET)],
];

/** The source declared for a route key, or undefined when nothing declares it (the spec refuses that). */
export function countrySourceOf(routeKey: string): CountrySource | undefined {
  const named = COUNTRY_SOURCES[routeKey];
  if (named) return named;
  for (const [pattern, source] of COUNTRY_RULES) if (pattern.test(routeKey)) return source;
  return undefined;
}

/** The record kinds the declaration uses — each must have a resolver at boot. */
export function kindsInUse(): RecordKind[] {
  const kinds = new Set<RecordKind>();
  const take = (s: CountrySource) => {
    if ('record' in s) kinds.add(s.record);
    if ('list' in s) for (const r of s.list) if ('of' in r.row) kinds.add(r.row.of);
  };
  Object.values(COUNTRY_SOURCES).forEach(take);
  COUNTRY_RULES.forEach(([, s]) => take(s));
  return [...kinds];
}
