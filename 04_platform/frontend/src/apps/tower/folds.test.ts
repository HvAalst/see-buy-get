import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import type { CompanyDocument, CompanyRecord, CompanyRecordView } from './company';
import type { PaperCase } from './paperReports';
import type { CatalogueCountry, PresenceProposalRow } from './presence';
import type { EntityPricing } from './money';
import { contactFold } from './contactCard';
import {
  addressesHint,
  adminsHint,
  amountsFold,
  changesHint,
  createCompanyHint,
  daysHint,
  decidedHint,
  documentsFold,
  impactHint,
  lapsesFold,
  legalHint,
  listHint,
  newCountryFold,
  obligationsHint,
  partOfItem,
  partsStillToDo,
  priceHint,
  readinessFold,
  runningOutFold,
  topUpFeeHint,
  waitFold,
} from './folds';

/**
 * THE LONG CONFIGURATION SCREENS, FOLDED: what each section says while shut, and when it opens itself.
 *
 * A closed fold's second line is the section's STATE — so each case below is a different state, and each says what a
 * reader deciding whether to open it needs. And a fold opens itself only when something in it is waiting on the reader.
 */
const TODAY = '2026-11-01';

const record = (over: Partial<CompanyRecord> = {}): CompanyRecord => ({
  representatives: [],
  beneficialOwners: [],
  taxRegistrations: [],
  bankAccounts: [],
  licences: [],
  insurance: [],
  obligations: [],
  ...over,
});

const doc = (over: Partial<CompanyDocument> = {}): CompanyDocument => ({
  documentId: 'd1',
  entityId: 'e1',
  kind: 'certificate_of_incorporation',
  title: 'Certificate',
  version: 1,
  fingerprint: 'ab'.repeat(32),
  contentType: 'application/pdf',
  size: 10,
  uploadedBy: 'Wanjiru',
  uploadedAt: '2026-10-30T10:00:00Z',
  status: 'verified',
  ...over,
});

const reportCase = (over: Partial<PaperCase> = {}): PaperCase =>
  ({ caseId: 'c1', documentId: 'd1', state: 'open', reports: [], answerBy: '2026-11-10T00:00:00Z', ...over }) as unknown as PaperCase;

describe('a company record — which section the switch-on checklist sends you to', () => {
  const rec = record({
    licences: [
      { kind: 'courier', number: 'L-OLD', issuer: 'CA', expiresAt: '2026-10-01', supports: [] },
      { kind: 'courier', number: 'L-OK', issuer: 'CA', expiresAt: '2027-10-01', supports: [] },
    ],
    insurance: [{ kind: 'goods_in_transit', insurer: 'Jubilee', policyNumber: 'P-1', expiresAt: '2027-01-01', supports: [] }],
    obligations: [{ key: 'data', reference: 'ODPC-1' }],
  });

  it('sends each item of the checklist to the part where it is put right', () => {
    expect(partOfItem('legal_name', rec, TODAY)).toBe('legal');
    expect(partOfItem('legal_form', rec, TODAY)).toBe('legal');
    expect(partOfItem('registration_number', rec, TODAY)).toBe('legal');
    expect(partOfItem('registered_address', rec, TODAY)).toBe('addresses');
    expect(partOfItem('signing_authority', rec, TODAY)).toBe('representatives');
    expect(partOfItem('beneficial_owners', rec, TODAY)).toBe('beneficialOwners');
    expect(partOfItem('tax_registration', rec, TODAY)).toBe('taxRegistrations');
    expect(partOfItem('bank_account', rec, TODAY)).toBe('bankAccounts');
    expect(partOfItem('doc:certificate_of_incorporation', rec, TODAY)).toBe('documents');
  });

  it('a lapsed licence is put right under Licences; one in date is missing its verified paper', () => {
    expect(partOfItem('licence:L-OLD', rec, TODAY)).toBe('licences');
    expect(partOfItem('licence:L-OK', rec, TODAY)).toBe('documents');
    expect(partOfItem('insurance:P-1', rec, TODAY)).toBe('documents');
    expect(partOfItem('insurance:P-GONE', rec, TODAY)).toBe('insurance');
  });

  it('a country registration with no number goes to the registrations; one with a number lacks its paper', () => {
    expect(partOfItem('obligation:data', rec, TODAY)).toBe('documents');
    expect(partOfItem('obligation:tax', rec, TODAY)).toBe('obligations');
  });

  it('an item this screen has no part for opens none', () => {
    expect(partOfItem('contact_card', rec, TODAY)).toBeNull();
  });

  it('opens nothing once the company keeps its own record, or once the checklist is done', () => {
    const items = [{ key: 'legal_name', met: false, label: '' }];
    expect([...partsStillToDo({ keeper: 'company', readiness: { entityId: 'e1', ready: false, items }, record: rec }, TODAY)]).toEqual([]);
    expect([...partsStillToDo({ keeper: 'staff', readiness: { entityId: 'e1', ready: true, items: [] }, record: rec }, TODAY)]).toEqual([]);
    expect([...partsStillToDo({ keeper: 'staff', readiness: null, record: rec }, TODAY)]).toEqual([]);
  });

  it('opens each part with an unmet item, and none that is met', () => {
    const items = [
      { key: 'legal_name', met: false, label: '' },
      { key: 'legal_form', met: true, label: '' },
      { key: 'beneficial_owners', met: true, label: '' },
      { key: 'licence:L-OLD', met: false, label: '' },
      { key: 'obligation:data', met: false, label: '' },
    ];
    expect([...partsStillToDo({ keeper: 'staff', readiness: { entityId: 'e1', ready: false, items }, record: rec }, TODAY)].sort()).toEqual(['documents', 'legal', 'licences']);
  });
});

describe('a company record — what each section says while shut', () => {
  it('the checklist: done of how many, open while anything is left', () => {
    const items = [
      { key: 'a', met: true, label: '' },
      { key: 'b', met: false, label: '' },
    ];
    expect(readinessFold({ keeper: 'staff', readiness: { entityId: 'e1', ready: false, items } }, t)).toEqual({ hint: '1 of 2 done', open: true });
    expect(readinessFold({ keeper: 'staff', readiness: { entityId: 'e1', ready: true, items: [] } }, t)).toEqual({ hint: 'Everything done — ready to switch on', open: false });
    expect(readinessFold({ keeper: 'company', readiness: { entityId: 'e1', ready: false, items } }, t)).toEqual({ hint: 'The company keeps its own record', open: false });
  });

  it('readiness: a warning still to see to opens the fold and is counted beside its state — on or not, never in the count (2026-11-12)', () => {
    const items = [{ key: 'legal_name', met: true, label: 'x' }];
    const warnings = [{ key: 'warn:price_card', met: false, label: 'a card' }, { key: 'warn:hub_list_figures', met: true, label: 'figures' }];
    expect(readinessFold({ keeper: 'company', readiness: { entityId: 'e1', ready: true, items, warnings } }, t)).toEqual({ hint: 'The company keeps its own record · 1 warning', open: true });
    expect(readinessFold({ keeper: 'staff', readiness: { entityId: 'e1', ready: true, items, warnings } }, t)).toEqual({ hint: 'Everything done — ready to switch on · 1 warning', open: true });
    expect(readinessFold({ keeper: 'staff', readiness: { entityId: 'e1', ready: false, items: [...items, { key: 'tax', met: false, label: 'y' }], warnings } }, t)).toEqual({ hint: '1 of 2 done · 1 warning', open: true });
    // Every warning seen to: as before.
    expect(readinessFold({ keeper: 'company', readiness: { entityId: 'e1', ready: true, items, warnings: [warnings[1]] } }, t)).toEqual({ hint: 'The company keeps its own record', open: false });
  });

  it('legal: the name, the form and the number — or that nothing is on record', () => {
    expect(legalHint(record(), t)).toBe('Nothing on record yet');
    expect(legalHint(record({ legalName: 'Kilima Logistics Ltd', legalForm: 'private_limited', registrationNumber: 'PVT-9' }), t)).toBe('Kilima Logistics Ltd · Private limited company · PVT-9');
    expect(legalHint(record({ tradingName: 'Kilima' }), t)).toBe('Kilima');
  });

  it('addresses: where it is registered, and where it operates if somewhere else', () => {
    const at = (city: string) => ({ line1: '1 Road', city, country: 'KE' });
    expect(addressesHint(record(), t)).toBe('No address on record yet');
    expect(addressesHint(record({ registeredAddress: at('Nairobi') }), t)).toBe('Registered in Nairobi');
    expect(addressesHint(record({ registeredAddress: at('Nairobi'), operatingAddress: at('Mombasa') }), t)).toBe('Registered in Nairobi · operating in Mombasa');
    expect(addressesHint(record({ registeredAddress: at('Nairobi'), operatingAddress: at('Nairobi') }), t)).toBe('Registered and operating in Nairobi');
    expect(addressesHint(record({ operatingAddress: at('Mombasa') }), t)).toBe('Operating in Mombasa · no registered address');
  });

  it('the lists: how many, in each list’s own words — and none, said as none', () => {
    expect(listHint('representatives', record(), TODAY, t)).toBe('Nobody named yet');
    expect(
      listHint('representatives', record({ representatives: [{ name: 'A', role: 'Director', signing: 'alone' }, { name: 'B', role: 'Secretary', signing: 'none' }] }), TODAY, t),
    ).toBe('2 people named, 1 may sign');
    expect(listHint('beneficialOwners', record(), TODAY, t)).toBe('No owner on record yet');
    expect(listHint('beneficialOwners', record({ beneficialOwners: [{ name: 'A', sharePct: 100 }] }), TODAY, t)).toBe('1 owner on record');
    expect(listHint('taxRegistrations', record(), TODAY, t)).toBe('No tax number on record yet');
    expect(listHint('taxRegistrations', record({ taxRegistrations: [{ kind: 'vat', number: '1' }, { kind: 'corporate_income', number: '2' }] }), TODAY, t)).toBe('2 numbers on record');
    expect(listHint('bankAccounts', record(), TODAY, t)).toBe('No bank account on record yet');
    const account = (currency: string) => ({ bankName: 'KCB', accountName: 'Kilima', accountNumber: currency, currency, purpose: 'payouts' });
    expect(listHint('bankAccounts', record({ bankAccounts: [account('KES'), account('USD'), account('KES')] }), TODAY, t)).toBe('3 accounts · KES, USD');
    expect(listHint('licences', record(), TODAY, t)).toBe('No licence on record yet');
    expect(listHint('insurance', record(), TODAY, t)).toBe('No policy on record yet');
  });

  it('licences and policies say how many have lapsed beside how many there are', () => {
    const licence = (number: string, expiresAt: string) => ({ kind: 'courier', number, issuer: 'CA', expiresAt, supports: [] });
    expect(listHint('licences', record({ licences: [licence('1', '2027-01-01')] }), TODAY, t)).toBe('1 licence on record');
    expect(listHint('licences', record({ licences: [licence('1', '2027-01-01'), licence('2', '2026-10-31')] }), TODAY, t)).toBe('2 licences on record · 1 lapsed');
    expect(listHint('insurance', record({ insurance: [{ kind: 'goods_in_transit', insurer: 'J', policyNumber: 'P', expiresAt: '2027-01-01', supports: [] }] }), TODAY, t)).toBe('1 policy on record');
  });

  it('what the country requires: how many of its registrations carry a number', () => {
    expect(obligationsHint({ obligations: [], record: record() }, t)).toBe('Nothing listed for this country');
    const obligations = [
      { key: 'data', name: 'Data protection' },
      { key: 'tax', name: 'Tax' },
    ];
    expect(obligationsHint({ obligations, record: record({ obligations: [{ key: 'data', reference: 'ODPC-1' }, { key: 'tax', reference: ' ' }] }) }, t)).toBe('1 of 2 registered');
  });

  it('a lapse says what can no longer be done, and always arrives open', () => {
    const lapse = (capability: 'takeIn' | 'holdFloat') => ({ capability, entityId: 'e1', source: 'licence' as const, kind: 'courier', reference: 'L', expiredAt: '2026-10-01' });
    expect(lapsesFold({ lapses: [lapse('takeIn'), lapse('holdFloat'), lapse('takeIn')] }, t)).toEqual({ hint: 'Can no longer take goods in, hold float', open: true });
  });

  it('a history: how many changes, and the last one — whatever order they arrive in', () => {
    const when = (iso: string) => iso.slice(0, 10);
    expect(changesHint([], when, t)).toBe('Nothing changed yet');
    expect(changesHint([{ at: '2026-10-01T09:00:00Z' }, { at: '2026-10-20T09:00:00Z' }, { at: '2026-10-05T09:00:00Z' }], when, t)).toBe('3 changes, the last on 2026-10-20');
  });
});

describe('the papers — the one part of a record that holds work', () => {
  const staff = { company: false, canVerify: true, who: 'Otieno', named: true };
  const company = { company: true, canVerify: false };
  const view = (documents: CompanyDocument[], reports: PaperCase[] = []): Pick<CompanyRecordView, 'documents' | 'reports'> => ({ documents, reports });

  it('says how many papers count, leaving out the replaced ones', () => {
    expect(documentsFold(view([]), staff, new Set(), t)).toEqual({ hint: 'Nothing on record yet', open: false });
    expect(documentsFold(view([doc(), doc({ documentId: 'd2', status: 'superseded' })]), staff, new Set(), t)).toEqual({ hint: '1 paper on record', open: false });
  });

  it('opens for staff who can verify a paper waiting for a second person — never for the one who put it on record', () => {
    const waiting = doc({ status: 'awaiting_verification', uploadedBy: 'Wanjiru', mine: false });
    expect(documentsFold(view([waiting]), staff, new Set(), t)).toEqual({ hint: '1 paper on record · 1 waiting for a second person', open: true });
    expect(documentsFold(view([{ ...waiting, mine: true }]), staff, new Set(), t).open).toBe(false);
    expect(documentsFold(view([waiting]), { ...staff, canVerify: false }, new Set(), t).open).toBe(false);
  });

  it('opens for the company while a report on one of its papers has no answer from it', () => {
    expect(documentsFold(view([doc()], [reportCase()]), company, new Set(), t)).toEqual({ hint: '1 paper on record · 1 reported', open: true });
    expect(documentsFold(view([doc()], [reportCase({ answer: { at: '2026-10-31T00:00:00Z', by: 'Admin', note: 'Renewed' } })]), company, new Set(), t).open).toBe(false);
    // Staff decide reports on their own screen, not here.
    expect(documentsFold(view([doc()], [reportCase()]), staff, new Set(), t).open).toBe(false);
    expect(documentsFold(view([doc()], [reportCase({ state: 'dismissed' })]), company, new Set(), t).hint).toBe('1 paper on record');
  });

  it('opens while the switch-on checklist still needs a paper', () => {
    expect(documentsFold(view([]), staff, new Set(['documents']), t).open).toBe(true);
    expect(documentsFold(view([]), staff, new Set(['legal']), t).open).toBe(false);
  });
});

describe('licences and policies running out — on a company’s record and on the companies screen', () => {
  const item = (daysLeft: number, lapsed = false) => ({ daysLeft, lapsed });

  it('says nothing lapses, shut, when nothing does', () => {
    expect(runningOutFold([], t)).toEqual({ hint: 'Nothing lapses in the next 60 days', open: false });
  });

  it('stays shut while everything is more than two weeks away, and says when the first one runs out', () => {
    expect(runningOutFold([item(40), item(21)], t)).toEqual({ hint: '2 papers run out, the first in 21 days', open: false });
  });

  it('opens once one has two weeks left, or has lapsed', () => {
    expect(runningOutFold([item(40), item(14)], t)).toEqual({ hint: '2 papers run out, the first in 14 days', open: true });
    expect(runningOutFold([item(1)], t)).toEqual({ hint: '1 paper runs out, the first in 1 day', open: true });
    expect(runningOutFold([item(0)], t).hint).toBe('1 paper runs out, the first today');
    expect(runningOutFold([item(-3, true), item(30)], t)).toEqual({ hint: '1 paper has lapsed · 1 paper runs out, the first in 30 days', open: true });
    expect(runningOutFold([item(-3, true), item(-9, true)], t)).toEqual({ hint: '2 papers have lapsed', open: true });
  });
});

describe('the companies — create a company', () => {
  it('says how many drafts are still waiting to be switched on', () => {
    expect(createCompanyHint([{ kind: 'group' }, { kind: 'sister', status: 'active' }], t)).toBe('No draft waiting to be switched on');
    expect(createCompanyHint([{ kind: 'sister', status: 'draft' }, { kind: 'partner', status: 'draft' }, { kind: 'group', status: 'draft' }], t)).toBe('2 drafts not switched on yet');
  });
});

describe('the rates — what each knob is set to now', () => {
  const row = (key: EntityPricing['amounts'][number]['key'], amount: number, own = false) => ({ key, amount, own, startsAt: amount });

  it('a parcel’s figures: how many this company set — open when a parcel pays out more than it brings in', () => {
    const fine = { amounts: [row('wholesale', 10), row('mdpSortFee', 1), row('shelvingFee', 1), row('releaseFee', 1, true)] };
    expect(amountsFold(fine, t)).toEqual({ hint: '1 of 4 set by this company', open: false });
    expect(amountsFold({ amounts: [row('wholesale', 10)] }, t).hint).toBe('All at the figures every company starts from');
    // Read off the record: an own figure that pays out 12 against a price of 10.
    const over = { amounts: [row('wholesale', 10), row('mdpSortFee', 4), row('shelvingFee', 4), { key: 'releaseFee' as const, amount: 4, own: true, startsAt: 1 }] };
    expect(amountsFold(over, t).open).toBe(true);
  });

  it('the top-up fee as charged today — or that there is none', () => {
    expect(topUpFeeHint({ currency: 'KES' }, t)).toBe('No fee — topping up costs nothing');
    expect(topUpFeeHint({ currency: 'KES', topUpFee: { amount: 20, freeAbove: 1000 } } as Pick<EntityPricing, 'topUpFee' | 'currency'>, t)).toBe(`20 KES on anything under ${(1000).toLocaleString()} KES`);
  });

  it('who can sign in, and what each rate did', () => {
    expect(adminsHint(null, t)).toBe(t('tower.admins.loading'));
    expect(adminsHint([], t)).toBe('Nobody can sign in yet');
    expect(adminsHint([{ adminId: 'a', email: 'a@x', name: 'A', entityId: 'e', createdAt: '' }], t)).toBe('1 person can sign in');
    expect(impactHint({ spells: [] }, t)).toBe('Nothing priced yet');
    const spell = { feePct: 0.02, shipments: 1, gross: 1, margin: 1, avgMargin: 1, from: '', to: '' };
    expect(impactHint({ spells: [spell] }, t)).toBe('1 period so far');
    expect(impactHint({ spells: [spell, spell] }, t)).toBe('2 periods to compare');
  });
});

describe('the market — each figure on its own headline', () => {
  it('how long loads wait — open when waits are lengthening', () => {
    expect(waitFold(undefined, t)).toEqual({ hint: 'Nothing taken in this window', open: false });
    const wait = { medianHours: 6, loads: 12, priorMedianHours: 4, priorLoads: 10, stretching: false, thin: false };
    expect(waitFold(wait, t)).toEqual({ hint: '6 hours to be taken, typically', open: false });
    expect(waitFold({ ...wait, stretching: true }, t).open).toBe(true);
  });

  it('what agreed prices cleared at — withheld, with its count, on a thin sample', () => {
    expect(priceHint(undefined, null, t)).toBe('No negotiated loads in this window');
    expect(priceHint({ loads: 2, medianRatio: 1.3, thin: true }, null, t)).toBe('Too few to say — 2 negotiated loads');
    expect(priceHint({ loads: 40, medianRatio: 1.12, thin: false }, 12, t)).toBe('12% above the rate card, typically');
  });

  it('posted against taken: the last seven days, summed', () => {
    const day = (posted: number, taken: number) => ({ postedLoads: posted, claimedLoads: taken });
    expect(daysHint([], t)).toBe('Nothing posted in the last seven days');
    expect(daysHint([day(100, 100), ...Array.from({ length: 7 }, () => day(3, 2))], t)).toBe('Last seven days: 21 posted, 14 taken');
  });
});

describe('where we operate', () => {
  const catalogue = [{ code: 'KE', name: 'Kenya' }, { code: 'UG', name: 'Uganda' }, { code: 'TZ', name: 'Tanzania' }] as CatalogueCountry[];

  it('switch a country on: how many are not on the list — open while one is chosen in the form', () => {
    expect(newCountryFold({ jurisdiction: '' }, [{ jurisdiction: 'KE' }], catalogue, t)).toEqual({ hint: '2 countries not on the list yet', open: false });
    expect(newCountryFold({ jurisdiction: 'UG' }, [{ jurisdiction: 'KE' }, { jurisdiction: 'UG' }], catalogue, t)).toEqual({ hint: '1 country not on the list yet', open: true });
  });

  it('recently decided: the latest decision, said as its row says it', () => {
    const p = (over: Partial<PresenceProposalRow>): PresenceProposalRow => ({ proposalId: 'p', jurisdiction: 'KE', level: 'partnered', gains: [], proposedBy: 'A', proposedAt: '', expiresAt: '2026-10-01', status: 'approved', ...over }) as PresenceProposalRow;
    expect(decidedHint([], catalogue, t)).toBe('');
    expect(
      decidedHint([p({ jurisdiction: 'UG', status: 'declined', decidedBy: 'Otieno', reason: 'no float', decidedAt: '2026-10-02' }), p({ decidedBy: 'Amina', decidedAt: '2026-10-20' })], catalogue, t),
    ).toBe('Latest: Kenya, approved by Amina');
    expect(decidedHint([p({ jurisdiction: 'TZ', status: 'expired', expiresAt: '2026-10-30' })], catalogue, t)).toBe('Latest: Tanzania, expired — nobody decided');
  });
});

describe('how to reach a yard, folded beside its register', () => {
  it('says the number to ring and the hours — and opens itself when there is no way to reach them', () => {
    expect(contactFold(null, 'none')).toEqual({ hint: 'none', open: true });
    expect(contactFold({ phone: ' ', email: '' }, 'none')).toEqual({ hint: 'none', open: true });
    expect(contactFold({ phone: '+254 712 345 678', hours: 'Mon–Sat 6–18' }, 'none')).toEqual({ hint: '+254 712 345 678 · Mon–Sat 6–18', open: false });
    expect(contactFold({ email: 'gate@example.com' }, 'none')).toEqual({ hint: 'gate@example.com', open: false });
  });
});
