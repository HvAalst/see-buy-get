import { describe, expect, it } from 'vitest';
import {
  EMPTY_FEE_FORM,
  EMPTY_IMPORT_FORM,
  EMPTY_RECEIPT_FORM,
  EMPTY_ROAD_FORM,
  companyPapers,
  consignmentPapers,
  feeQuoteBlocker,
  feeTone,
  knownNotAsked,
  liveGrants,
  outstanding,
  outstandingCount,
  paperTone,
  publishBlocker,
  readinessOf,
  receiptBlocker,
  registerBlocker,
  roadBlocker,
  slugOf,
  type ImportDetailView,
  type ImportRow,
  type KnownPaper,
  type RequiredPaperView,
} from './imports';
import type { CompanyDocument } from './company';

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  importId: 'imp_1',
  code: 'IMP-001',
  status: 'appointed',
  goodsDescription: 'Factory plant',
  originCountry: 'NL',
  destCountry: 'ET',
  destPort: 'Djibouti',
  importerEntityId: 'importer',
  youAre: 'importer',
  accepted: 0,
  asked: 0,
  waitingOnYou: 0,
  feeState: 'none',
  createdAt: '2026-09-16T10:00:00.000Z',
  ...over,
});

const paper = (over: Partial<RequiredPaperView> = {}): RequiredPaperView => ({
  key: 'invoice',
  label: 'Invoice',
  addedBy: 'Selam',
  addedAt: '2026-09-16T10:00:00.000Z',
  stale: false,
  expired: false,
  state: 'waiting',
  ...over,
});

const doc = (over: Partial<CompanyDocument> = {}): CompanyDocument =>
  ({ documentId: 'doc_1', entityId: 'importer', kind: 'licence', title: 'Investment licence', version: 1, fingerprint: 'f', contentType: 'application/pdf', size: 1, uploadedBy: 'Hans', uploadedAt: '2026-09-16', status: 'verified', ...over }) as CompanyDocument;

describe('a container, its papers, and the agent who clears them', () => {
  it('refuses what the server would refuse, before the call is made', () => {
    expect(registerBlocker(EMPTY_IMPORT_FORM)).toBe('tower.imports.need.goods');
    const filled = { ...EMPTY_IMPORT_FORM, goodsDescription: 'Plant', originCountry: 'NL', destCountry: 'ET', destPort: 'Djibouti' };
    expect(registerBlocker(filled)).toBeNull();
    expect(registerBlocker({ ...filled, originCountry: 'Netherlands' })).toBe('tower.imports.need.origin');
    expect(registerBlocker({ ...filled, destCountry: '' })).toBe('tower.imports.need.dest');
    expect(registerBlocker({ ...filled, destPort: '  ' })).toBe('tower.imports.need.port');
    expect(registerBlocker({ ...filled, etaAt: 'soon' })).toBe('tower.imports.need.date');
    expect(registerBlocker({ ...filled, etaAt: '2026-11-01' })).toBeNull();
  });

  it('will not let an agent publish an empty list, or the same paper twice under different wording', () => {
    expect(publishBlocker([])).toBe('tower.imports.need.label');
    expect(publishBlocker([{ label: '   ' }])).toBe('tower.imports.need.label');
    // The server derives the same key from both, so the screen catches it rather than letting the call fail.
    expect(publishBlocker([{ label: 'Packing list' }, { label: 'packing  list' }])).toBe('tower.imports.need.unique');
    expect(publishBlocker([{ label: 'Packing list' }, { label: 'Invoice' }])).toBeNull();
    expect(slugOf('Ministry of Agriculture permit')).toBe('ministry_of_agriculture_permit');
  });

  it('prompts the agent with what OTHERS were asked for here, and drops what is already on their list', () => {
    const known: KnownPaper[] = [
      { key: 'investment_licence', label: 'Investment licence', agents: 4, times: 9, firstAskedAt: '2026-01-01', lastAskedAt: '2026-09-01' },
      { key: 'ministry_of_agriculture_permit', label: 'Ministry of Agriculture permit', agents: 2, times: 3, firstAskedAt: '2026-02-01', lastAskedAt: '2026-08-01' },
    ];
    // The agent has thought of the licence and not of the permit — which is the two-week container, exactly.
    const missed = knownNotAsked(known, [{ label: 'Investment licence' }]);
    expect(missed.map((k) => k.key)).toEqual(['ministry_of_agriculture_permit']);
    // Nothing is proposed once the agent has listed everything others asked for.
    expect(knownNotAsked(known, [{ label: 'Investment licence' }, { key: 'ministry_of_agriculture_permit', label: 'MoA permit' }])).toEqual([]);
  });

  it('says nothing before it has read, and counts only what is waiting on this reader', () => {
    expect(outstandingCount(null)).toBeNull();
    expect(outstandingCount([])).toBe(0);
    expect(outstandingCount([row({ waitingOnYou: 2 }), row({ waitingOnYou: 1 })])).toBe(3);
  });

  it('shows an accepted paper that cannot be relied on as loudly as a rejected one', () => {
    expect(paperTone(paper({ state: 'accepted' }))).toBe('ok');
    expect(paperTone(paper({ state: 'supplied' }))).toBe('warn');
    expect(paperTone(paper({ state: 'waiting' }))).toBe('quiet');
    expect(paperTone(paper({ state: 'rejected' }))).toBe('bad');
    // The failure this slice exists to prevent must never look calm.
    expect(paperTone(paper({ state: 'accepted', expired: true }))).toBe('bad');
    expect(paperTone(paper({ state: 'accepted', stale: true }))).toBe('bad');
  });

  it('puts what is still in the way at the top, and keeps a broken acceptance in the list', () => {
    const detail = {
      ...row({ accepted: 2, asked: 3 }),
      required: [paper({ key: 'a', label: 'A', state: 'accepted' }), paper({ key: 'b', label: 'B', state: 'waiting' }), paper({ key: 'c', label: 'C', state: 'accepted', expired: true })],
      documents: [],
      grants: [],
      money: { canBill: true, canPayOut: true },
      customsHolds: [],
      cargoGaps: [],
    } as ImportDetailView;
    expect(outstanding(detail).map((p) => p.key)).toEqual(['b', 'c']);
    expect(readinessOf(detail)).toEqual({ accepted: 2, asked: 3, done: false });
    expect(readinessOf({ accepted: 3, asked: 3 })).toMatchObject({ done: true });
    // Nothing asked for yet is not "done" — an empty list is not a cleared container.
    expect(readinessOf({ accepted: 0, asked: 0 }).done).toBe(false);
  });

  it('separates the papers a standing grant reaches from the ones tied to this container', () => {
    const docs = [doc({ documentId: 'd1' }), doc({ documentId: 'd2', relatesTo: 'IMP-001', kind: 'packing_list' }), doc({ documentId: 'd3', relatesTo: 'IMP-002', kind: 'packing_list' }), doc({ documentId: 'd4', status: 'superseded' })];
    expect(companyPapers(docs).map((d) => d.documentId)).toEqual(['d1']);
    expect(consignmentPapers(docs, 'imp-001').map((d) => d.documentId)).toEqual(['d2']);
  });

  it('refuses a fee, a receipt and a road leg that the server would refuse anyway', () => {
    expect(feeQuoteBlocker(EMPTY_FEE_FORM)).toBe('tower.imports.needAmount');
    expect(feeQuoteBlocker({ amount: '0', note: '' })).toBe('tower.imports.needAmount');
    expect(feeQuoteBlocker({ amount: 'lots', note: '' })).toBe('tower.imports.needAmount');
    expect(feeQuoteBlocker({ amount: '4500', note: 'Port dues' })).toBeNull();

    // The reference is the whole point of a receipt: without it nothing can be checked afterwards.
    expect(receiptBlocker(EMPTY_RECEIPT_FORM)).toBe('tower.imports.needReference');
    expect(receiptBlocker({ reference: 'MPESA-1', amount: '' })).toBeNull();
    expect(receiptBlocker({ reference: 'MPESA-1', amount: '-2' })).toBe('tower.imports.needAmount');

    expect(roadBlocker(EMPTY_ROAD_FORM)).toBe('tower.imports.needPort');
    expect(roadBlocker({ lat: '11.6', lng: '43.14', destLabel: '', weightKg: '10' })).toBe('tower.imports.needDest');
    expect(roadBlocker({ lat: '11.6', lng: '43.14', destLabel: 'Addis', weightKg: '0' })).toBe('tower.imports.needAmount');
    expect(roadBlocker({ lat: '11.6', lng: '43.14', destLabel: 'Addis', weightKg: '12000' })).toBeNull();
    // Zero is a real coordinate, and a screen that treats it as "not given" refuses a legitimate port.
    expect(roadBlocker({ lat: '0', lng: '0', destLabel: 'Null Island', weightKg: '1' })).toBeNull();
  });

  it('shows a fee as settled only once money actually arrived', () => {
    expect(feeTone('none')).toBe('quiet');
    expect(feeTone('quoted')).toBe('warn');
    // Agreed is not paid — it stays somebody's turn to act.
    expect(feeTone('accepted')).toBe('warn');
    expect(feeTone('paid')).toBe('ok');
  });

  it('reads "who can see our papers" as the live grants only', () => {
    const grants = [
      { grantId: 'g1', scope: 'company' as const, ownerEntityId: 'importer', readerEntityId: 'agent', grantedBy: 'Hans', grantedAt: '2026-09-16' },
      { grantId: 'g2', scope: 'consignment' as const, ownerEntityId: 'importer', readerEntityId: 'old', grantedBy: 'Hans', grantedAt: '2026-08-01', revokedAt: '2026-09-01', revokedBy: 'Hans' },
    ];
    expect(liveGrants(grants).map((g) => g.grantId)).toEqual(['g1']);
  });
});
