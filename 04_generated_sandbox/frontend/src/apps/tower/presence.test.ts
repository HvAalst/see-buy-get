import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_LABEL,
  LEVEL_DEFAULTS,
  PRESENCE_CAPABILITIES,
  approvalBlocker,
  impactIsEmpty,
  capabilityStates,
  countryNameOf,
  levelBlocker,
  levelEffect,
  needsSecondPerson,
  newCountryBlocker,
  overridesOf,
  pendingFor,
  presenceRows,
  samePerson,
  takeInPromise,
  type CatalogueCountry,
  type PresenceProposalRow,
  type PresenceRow,
} from './presence';

/**
 * The presence map.
 *
 * Every test here is about one failure in different clothes: a country appearing to have permissions
 * nobody granted it. The screen can cause that four ways — by offering "established" where no company
 * exists, by hiding that a capability was deliberately switched off, by making a level change look like
 * a rename rather than a loss of cover, and by implying goods are ours to answer for when they are not.
 */

const row = (over: Partial<PresenceRow> = {}): PresenceRow => ({
  jurisdiction: 'ZM',
  level: 'matched',
  capabilities: { ...LEVEL_DEFAULTS.matched },
  hasEntity: false,
  recorded: true,
  ...over,
});

/**
 * THE TWO LISTS MUST NAME THE SAME SET.
 *
 * This file keeps its own PRESENCE_CAPABILITIES because the console ORDERS them by consequence and the
 * server has no opinion about that. A different order is fine; a different SET is a capability the
 * console can never show. That is not hypothetical — fieldEvidence was added on the server and this
 * line was not touched, so the one capability that most needs a deliberate operator would have been
 * invisible to every operator.
 */
describe('the console-s own copy of the capability list', () => {
  it('names exactly the capabilities the contract does', () => {
    // Read off the generated contract rather than restated here: a test that writes out its own
    // expectation would go stale in step with the thing it is guarding.
    const contract = readFileSync('src/lib/sbg/schema.d.ts', 'utf8');
    const line = contract.match(/lost: \([^)]*\)\[\]/)?.[0];
    // Proves the guard read something: a regex that quietly matches nothing would pass every future
    // change, which is the trap this project has already been caught by once.
    expect(line).toContain('merchantOfRecord');
    const fromContract = [...line!.matchAll(/"([a-zA-Z]+)"/g)].map((x) => x[1]);
    expect(fromContract.length).toBeGreaterThan(5);
    expect([...PRESENCE_CAPABILITIES].sort()).toEqual([...fromContract].sort());
  });

  it('has a label for every one of them — an unlabelled tag renders as nothing', () => {
    for (const c of PRESENCE_CAPABILITIES) expect(CAPABILITY_LABEL[c]).toBeTruthy();
  });
});

describe('the map', () => {
  it('reads strongest first, then by country', () => {
    const rows = presenceRows([
      row({ jurisdiction: 'ZM', level: 'matched' }),
      row({ jurisdiction: 'KE', level: 'established', hasEntity: true, capabilities: { ...LEVEL_DEFAULTS.established } }),
      row({ jurisdiction: 'AO', level: 'observed', capabilities: { ...LEVEL_DEFAULTS.observed } }),
      row({ jurisdiction: 'ET', level: 'established', hasEntity: true, capabilities: { ...LEVEL_DEFAULTS.established } }),
    ]);
    expect(rows.map((r) => r.jurisdiction)).toEqual(['ET', 'KE', 'ZM', 'AO']);
  });
});

describe('what a country may do', () => {
  it('marks the capabilities somebody deliberately moved', () => {
    // "This country cannot hold float" and "somebody TURNED OFF float here" are different facts, and
    // only one of them is worth asking about.
    const states = capabilityStates(row({ capabilities: { ...LEVEL_DEFAULTS.matched, payouts: true } }));
    expect(states.find((s) => s.capability === 'payouts')).toEqual({ capability: 'payouts', on: true, overridden: true });
    expect(states.find((s) => s.capability === 'takeIn')).toEqual({ capability: 'takeIn', on: true, overridden: false });
  });

  it('sends back only the exceptions, so a level change still moves everything else', () => {
    expect(overridesOf(row({ capabilities: { ...LEVEL_DEFAULTS.matched, payouts: true } }))).toEqual({ payouts: true });
    expect(overridesOf(row())).toEqual({});
  });
});

describe('moving a country', () => {
  it('refuses to offer ESTABLISHED where no company transacts', () => {
    // A flag must never be the thing that creates a Merchant of Record, a float and a claims provision
    // out of nothing. The screen says so before the server has to.
    expect(levelBlocker(row({ hasEntity: false }), 'established')).toBe('tower.presence.needsCompany');
    expect(levelBlocker(row({ hasEntity: true }), 'established')).toBeNull();
    expect(levelBlocker(row(), 'matched')).toBeNull();
  });

  it('says what the move would actually cost', () => {
    // A level is a word; the word is not the consequence. Dropping out of established stops the
    // charging, the float and the cover — an operator reads that before pressing, not in a claim.
    const ke = row({ jurisdiction: 'KE', level: 'established', hasEntity: true, capabilities: { ...LEVEL_DEFAULTS.established } });
    const { gained, lost } = levelEffect(ke, 'matched');
    expect(gained).toEqual([]);
    expect(lost).toEqual(expect.arrayContaining(['merchantOfRecord', 'holdFloat', 'cashOnDelivery', 'claims', 'tax', 'payouts']));
    expect(lost).not.toContain('takeIn'); // goods still move — that is the whole point of matched
  });

  it('counts a gain from the country as it stands, not from its level', () => {
    // A country already granted payouts by hand gains nothing from a level that also grants them.
    const zm = row({ capabilities: { ...LEVEL_DEFAULTS.matched, payouts: true } });
    expect(levelEffect(zm, 'established').gained).not.toContain('payouts');
    expect(levelEffect(zm, 'established').gained).toContain('claims');
  });
});

const catalogue = (over: Partial<CatalogueCountry> = {}): CatalogueCountry => ({
  code: 'ZM',
  name: 'Zambia',
  currency: 'ZMW',
  dialCode: '+260',
  drivingSide: 'left',
  languages: ['en'],
  postalCode: true,
  idDocuments: ['nrc'],
  priceable: true,
  level: 'observed',
  ...over,
});

const proposal = (over: Partial<PresenceProposalRow> = {}): PresenceProposalRow => ({
  proposalId: 'pp_1',
  jurisdiction: 'ZM',
  level: 'matched',
  gains: ['takeIn'],
  proposedBy: 'Amina',
  proposedAt: '2026-09-13T08:00:00Z',
  expiresAt: '2026-09-20T08:00:00Z',
  status: 'pending',
  ...over,
});

describe('CA1 — a country comes from the catalogue', () => {
  const form = (jurisdiction: string, level: PresenceRow['level'] = 'matched') => ({ jurisdiction, level, note: '' });

  it('refuses two letters that are not a country', () => {
    expect(newCountryBlocker(form(''), [], [catalogue()])).toBe('tower.presence.needCode');
    expect(newCountryBlocker(form('ZZ'), [], [catalogue()])).toBe('tower.presence.badCode');
    expect(newCountryBlocker(form('ZM'), [], [catalogue()])).toBeNull();
  });

  it('will not switch on a country the rate book cannot price in', () => {
    expect(newCountryBlocker(form('ZM'), [], [catalogue({ priceable: false })])).toBe('tower.presence.needsRate');
    // Recording it as merely observed switches nothing on, so no rate is needed.
    expect(newCountryBlocker(form('ZM', 'observed'), [], [catalogue({ priceable: false })])).toBeNull();
    // A country already taking goods in is not being switched on.
    expect(newCountryBlocker(form('ZM', 'matched'), [row()], [catalogue({ priceable: false })])).toBeNull();
    // …and Partnered still needs a partner, whatever the rate book holds (CA7).
    expect(newCountryBlocker(form('ZM', 'partnered'), [row()], [catalogue({ priceable: false })])).toBe('tower.presence.needsPartner');
  });

  it('names a country from the catalogue, and falls back to its code', () => {
    expect(countryNameOf('ZM', [catalogue()])).toBe('Zambia');
    expect(countryNameOf('ZM', null)).toBe('ZM');
  });
});

describe('CA9 — what winding a country down leaves behind', () => {
  const empty = {
    jurisdiction: 'ZM',
    toLevel: 'observed' as const,
    lost: [],
    gained: [],
    closing: false,
    shelves: { total: 0, ours: 0, theirs: 0, unstamped: 0 },
    inTransit: 0,
    freight: { open: 0, claimed: 0 },
    owed: [],
    registered: { shops: 0, stores: 0, hubs: 0, fleets: 0, couriers: 0 },
  };

  it('is empty only when nothing at all would be left behind', () => {
    expect(impactIsEmpty(empty)).toBe(true);
    expect(impactIsEmpty({ ...empty, closing: true })).toBe(false);
    expect(impactIsEmpty({ ...empty, registered: { ...empty.registered, couriers: 1 } })).toBe(false);
    expect(impactIsEmpty({ ...empty, owed: [{ entityId: 'sbg-ke', name: 'K', currency: 'KES', amount: 5, suppliers: 1 }] })).toBe(false);
  });
});

describe('CA3 + CA7 — a real company before Established or Partnered', () => {
  it('offers Established on a ready draft company, and Partnered only with a partner', () => {
    const draft = (ready: boolean, kind: 'sister' | 'partner' = 'sister') => row({ companies: [{ entityId: 'x', name: 'X', kind, status: 'draft', ready }] });
    expect(levelBlocker(draft(false), 'established')).toBe('tower.presence.needsCompany');
    expect(levelBlocker(draft(true), 'established')).toBeNull();
    expect(levelBlocker(row(), 'partnered')).toBe('tower.presence.needsPartner');
    expect(levelBlocker(draft(true, 'partner'), 'partnered')).toBeNull();
    expect(levelBlocker(row({ companies: [{ entityId: 'p', name: 'P', kind: 'partner', status: 'active', ready: false }] }), 'partnered')).toBeNull();
  });
});

describe('CA2 — two people switch a country on', () => {
  it('never lets the proposer approve their own change, however they spell their name', () => {
    expect(approvalBlocker(proposal(), 'Amina')).toBe('tower.presence.ownProposal');
    expect(approvalBlocker(proposal(), '  amina ')).toBe('tower.presence.ownProposal');
    expect(approvalBlocker(proposal(), 'Brian')).toBeNull();
    expect(approvalBlocker(proposal(), '')).toBe('tower.presence.needName');
    expect(approvalBlocker(proposal({ status: 'approved' }), 'Brian')).toBe('tower.presence.alreadyDecided');
  });

  it('asks for a second person only when the change gives the country something', () => {
    expect(needsSecondPerson(row({ level: 'observed', capabilities: { ...LEVEL_DEFAULTS.observed } }), 'matched')).toBe(true);
    expect(needsSecondPerson(row(), 'observed')).toBe(false); // a lowering: one person, recorded
    expect(samePerson('A  B', 'a b')).toBe(true);
    expect(samePerson('', '')).toBe(false);
  });

  it('finds the change waiting on a country', () => {
    expect(pendingFor([proposal({ status: 'declined' }), proposal({ proposalId: 'pp_2' })], 'ZM')?.proposalId).toBe('pp_2');
    expect(pendingFor(null, 'ZM')).toBeUndefined();
  });
});

describe('who answers for the goods', () => {
  it('is OURS only where a sister is on the hook', () => {
    expect(takeInPromise(row({ level: 'established', hasEntity: true, capabilities: { ...LEVEL_DEFAULTS.established } }))).toBe('ours');
  });

  it('is THEIRS where goods may move and no sister can answer', () => {
    expect(takeInPromise(row())).toBe('theirs');
  });

  it('is NONE where nothing may be taken in', () => {
    expect(takeInPromise(row({ level: 'observed', capabilities: { ...LEVEL_DEFAULTS.observed } }))).toBe('none');
  });
});
