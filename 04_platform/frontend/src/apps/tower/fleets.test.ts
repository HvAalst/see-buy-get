import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { EMPTY_FLEET_FORM, FLEET_PAPERS, fleetBody, fleetCountries, fleetFormBlocker, fleetStep, fleetSystemWords, fleetsWaitingOnMe, joiningWaiting, papersOf, type FleetForm, type FleetSetupRow } from './fleets';

const papers = (enteredByMe: boolean) => ({ businessRegCertRef: 'med_reg', operatorLicenceRef: 'med_lic', ownerIdRef: 'med_id', proofOfAddressRef: 'med_addr', submittedAt: '2026-10-11T10:00:00.000Z', enteredBy: 'Amina Otieno', enteredByMe });
const row = (over: Partial<FleetSetupRow>): FleetSetupRow => ({
  did: 'did:glos:fleet',
  companyName: 'Kilima Logistics',
  status: 'DRAFT',
  contactPhone: '+254711000201',
  requirements: { businessRegistrationNo: 'BR-1', transportOperatorLicence: 'TOL-1', taxId: 'TAX-1' },
  createdAt: '2026-10-11T09:00:00.000Z',
  ...over,
});

describe('fleetStep — what is next for a fleet, and whose it is', () => {
  it('a fleet just registered needs its papers put on record', () => {
    expect(fleetStep(row({ status: 'DRAFT' }))).toBe('papers');
    // Sent back: the same step again, whatever is left of the last attempt.
    expect(fleetStep(row({ status: 'DRAFT', refused: { reason: 'The licence is last year’s', at: 'x' } }))).toBe('papers');
  });
  it('papers on record wait for a member of staff OTHER than the one who put them there', () => {
    expect(fleetStep(row({ status: 'KYC_PENDING', papers: papers(false) }))).toBe('approve');
    expect(fleetStep(row({ status: 'KYC_PENDING', papers: papers(true) }))).toBe('colleague');
  });
  it('an approved fleet needs its bond recorded, and only then is it active', () => {
    expect(fleetStep(row({ status: 'APPROVED', papers: papers(true) }))).toBe('bond');
    expect(fleetStep(row({ status: 'ACTIVE', papers: papers(true), loginCode: 'FM-ABC123' }))).toBe('active');
    expect(fleetStep(row({ status: 'SUSPENDED' }))).toBe('suspended');
  });
});

describe('papersOf — the pictures on record, in the order they were asked for', () => {
  it('lists all four, and none before there are any', () => {
    expect(papersOf(row({ papers: papers(false) }))).toEqual(['med_reg', 'med_lic', 'med_id', 'med_addr']);
    expect(papersOf(row({}))).toEqual([]);
    expect(FLEET_PAPERS.map(([, kind]) => kind)).toEqual(['kyc_registration', 'kyc_licence', 'kyc_id', 'kyc_address']);
  });
});

describe('fleetsWaitingOnMe — only what this reader can move', () => {
  it('counts papers to enter, a colleague’s to look at and a bond to record; not one’s own entry, nor a fleet that is through', () => {
    const rows = [
      row({ did: 'a', status: 'DRAFT' }),
      row({ did: 'b', status: 'KYC_PENDING', papers: papers(false) }),
      row({ did: 'c', status: 'KYC_PENDING', papers: papers(true) }),
      row({ did: 'd', status: 'APPROVED' }),
      row({ did: 'e', status: 'ACTIVE' }),
      row({ did: 'f', status: 'SUSPENDED' }),
    ];
    expect(fleetsWaitingOnMe(rows)).toBe(3);
    expect(fleetsWaitingOnMe([])).toBe(0);
  });
  it('is not a zero before it has been read', () => {
    expect(fleetsWaitingOnMe(null)).toBeNull();
  });
  // The user, 2026-10-23: a fleet signs itself up. Sent back, it sends its own papers again: it waits on the fleet.
  it('a fleet that signed itself up and was sent back waits on the fleet, not on us; its papers wait on any one of us', () => {
    const theirs = row({ did: 'g', status: 'DRAFT', signedUpAt: '2026-10-23T09:00:00Z' });
    expect(fleetStep(theirs)).toBe('theirs');
    expect(fleetStep(row({ did: 'h', status: 'KYC_PENDING', signedUpAt: '2026-10-23T09:00:00Z', papers: papers(false) }))).toBe('approve');
    expect(fleetsWaitingOnMe([theirs, row({ did: 'h', status: 'KYC_PENDING', signedUpAt: '2026-10-23T09:00:00Z', papers: papers(false) })])).toBe(1);
  });
});

describe('the form a fleet is registered with', () => {
  const full: FleetForm = { companyName: ' Kilima Logistics ', jurisdiction: 'ke', contactPhone: '+254 711 000 201', ownerFullName: 'Kilima Owner', ownerNationalId: 'ID-1', depotAddress: 'Enterprise Road', businessRegistrationNo: 'BR-1', transportOperatorLicence: 'TOL-1', taxId: 'TAX-1' };
  it('names the first thing still missing, in the order the form is laid out', () => {
    expect(fleetFormBlocker(EMPTY_FLEET_FORM)).toBe('companyName');
    expect(fleetFormBlocker({ ...full, depotAddress: '  ' })).toBe('depotAddress');
    expect(fleetFormBlocker({ ...full, jurisdiction: '' })).toBe('jurisdiction');
    expect(fleetFormBlocker({ ...full, taxId: '' })).toBe('taxId');
    expect(fleetFormBlocker(full)).toBeNull();
  });
  it('sends what was typed, tidied: no stray spaces, the country in capitals, the phone as one number', () => {
    expect(fleetBody(full)).toEqual({
      companyName: 'Kilima Logistics',
      jurisdiction: 'KE',
      contactPhone: '+254711000201',
      ownerFullName: 'Kilima Owner',
      ownerNationalId: 'ID-1',
      depotAddress: 'Enterprise Road',
      requirements: { businessRegistrationNo: 'BR-1', transportOperatorLicence: 'TOL-1', taxId: 'TAX-1' },
    });
  });
});

describe('fleetSystemWords — a fleet’s own system, counted for staff', () => {
  it('says it is not set up, or what became of its messages, and whether it sends where its vehicles are', () => {
    expect(fleetSystemWords({ hasAddress: false, delivered: 0, waiting: 0, givenUp: 0, positions: false }, t)).toBe('No system of its own set up.');
    expect(fleetSystemWords({ hasAddress: true, delivered: 40, waiting: 2, givenUp: 1, positions: false }, t)).toBe('Its system: 40 arrived · 2 waiting · 1 given up.');
    expect(fleetSystemWords({ hasAddress: true, delivered: 40, waiting: 0, givenUp: 0, positions: true }, t)).toBe('Its system: 40 arrived · 0 waiting · 0 given up. Sends where its vehicles are.');
    // Round 12 — its keys, when it holds any that work; a fleet with keys and no address still shows them.
    expect(fleetSystemWords({ hasAddress: false, delivered: 0, waiting: 0, givenUp: 0, positions: false, keys: { live: 1, test: 2 } }, t)).toBe('No system of its own set up. Keys: 1 live, 2 test.');
    expect(fleetSystemWords({ hasAddress: true, delivered: 3, waiting: 0, givenUp: 0, positions: false, keys: { live: 0, test: 0 } }, t)).toBe('Its system: 3 arrived · 0 waiting · 0 given up.');
  });
});

describe('fleetCountries — a fleet is registered where the network is switched on', () => {
  it('offers the countries that are on, and none that are only watched', () => {
    const catalogue = [
      { code: 'KE', name: 'Kenya', level: 'established' },
      { code: 'UG', name: 'Uganda', level: 'matched' },
      { code: 'LV', name: 'Latvia', level: 'observed' },
    ];
    expect(fleetCountries(catalogue)).toEqual([
      { code: 'KE', name: 'Kenya' },
      { code: 'UG', name: 'Uganda' },
    ]);
    expect(fleetCountries(null)).toEqual([]);
  });
});

describe('joiningWaiting — the number beside the screen', () => {
  const fleet = (status: FleetSetupRow['status'], enteredByMe = false): FleetSetupRow => ({
    did: 'did:glos:fleet:' + status + enteredByMe,
    companyName: 'A fleet',
    status,
    contactPhone: '+254700000000',
    requirements: { businessRegistrationNo: 'BR', transportOperatorLicence: 'TOL', taxId: 'TAX' },
    createdAt: '2026-10-11T08:00:00.000Z',
    ...(status === 'DRAFT' ? {} : { papers: { businessRegCertRef: 'a', operatorLicenceRef: 'b', ownerIdRef: 'c', proofOfAddressRef: 'd', submittedAt: '2026-10-11T09:00:00.000Z', enteredByMe } }),
  });
  it('counts shops, drivers, hubs and the fleets this reader can move — and not the fleet waiting on a colleague', () => {
    expect(joiningWaiting([{}, {}], [{}], [fleet('KYC_PENDING'), fleet('KYC_PENDING', true), fleet('ACTIVE')], [{}])).toBe(5);
  });
  it('a hub alone is counted, and nothing read is not a zero', () => {
    expect(joiningWaiting(null, null, null, [{}])).toBe(1);
    expect(joiningWaiting(null, null, null, null)).toBeNull();
  });
  it('a rider’s ID photo waiting to be seen is counted too (round 39)', () => {
    expect(joiningWaiting(null, null, null, null, [{}, {}])).toBe(2);
    expect(joiningWaiting([{}], null, null, null, [{}])).toBe(2);
    expect(joiningWaiting(null, null, null, null, null)).toBeNull();
  });
  it('a fleet alone is enough to be counted: the screen held nothing but shops once', () => {
    expect(joiningWaiting([], [], [fleet('DRAFT')], [])).toBe(1);
    expect(joiningWaiting([], [], [fleet('APPROVED')], [])).toBe(1);
  });
  it('is unknown only while nothing has been read, and counts what HAS been read meanwhile', () => {
    expect(joiningWaiting(null, null, null, null)).toBeNull();
    expect(joiningWaiting(null, null, [fleet('DRAFT')], null)).toBe(1);
    expect(joiningWaiting([], null, null, null)).toBe(0);
  });
});
