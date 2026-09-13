import { describe, expect, it } from 'vitest';
import {
  LEVEL_DEFAULTS,
  approvalBlocker,
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
    expect(newCountryBlocker(form('ZM', 'partnered'), [row()], [catalogue({ priceable: false })])).toBeNull();
  });

  it('names a country from the catalogue, and falls back to its code', () => {
    expect(countryNameOf('ZM', [catalogue()])).toBe('Zambia');
    expect(countryNameOf('ZM', null)).toBe('ZM');
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
