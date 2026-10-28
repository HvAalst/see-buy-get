import { cleanDraft, sliBasis, sliGaps, sliHtml, sliStale, type SliFacts } from './export-sli';
import type { SliDraftDto } from './export-sli.types';

/*
 * THE SHIPPER'S LETTER OF INSTRUCTION (2026-10-28): the form cleaned as it is saved, what signing still needs, and the
 * page drawn from the export's facts — the same page, byte for byte, for the same facts and form.
 */
const facts: SliFacts = {
  code: 'EXP-007',
  shipper: { name: 'Kericho Tea', address: 'Box 1, Kericho', registrationNo: 'PVT-1', country: 'KE' },
  forwarder: 'Pwani Forwarders',
  bookedWith: 'forwarder',
  booking: 'MBA4471',
  vessel: 'MSC Nairobi',
  voyage: '044E',
  loadingPort: 'Mombasa',
  terminal: 'Kipevu container terminal',
  originCountry: 'KE',
  destCountry: 'NL',
  container: { type: '22G1', number: 'MSCU1234566', seals: ['KE 552190'] },
  vgm: { kg: 18640, method: 1, signatory: 'Wanjiku' },
  papers: ['Commercial invoice'],
};
const form = (over: Partial<SliDraftDto> = {}): SliDraftDto => ({
  consigneeKind: 'named',
  consignee: { name: 'Van Rees Tea BV', address: 'Rotterdam' },
  notifySameAsConsignee: true,
  dischargePort: 'Rotterdam',
  freight: 'collect',
  blRelease: 'originals',
  lines: [{ packages: 640, packageKind: 'bags', description: 'Black tea', grossKg: 18400, hsCode: '0902.40' }],
  ...over,
});
const at = Date.parse('2026-10-28T10:00:00Z');

describe('the shipper’s letter of instruction', () => {
  it('cleans the form: three originals by default, an HS code only where it is one, the UN number written as one', () => {
    const d = cleanDraft(form({ lines: [{ packages: 640, packageKind: ' bags ', description: 'Black tea', grossKg: 18400.04, hsCode: 'tea' }], dangerous: { unNumber: '1263', hazardClass: '3' } }), 'Wanjiku', at);
    expect(d.originals).toBe(3);
    expect(d.lines[0]).toEqual({ packages: 640, packageKind: 'bags', description: 'Black tea', grossKg: 18400 });
    expect(d.dangerous).toEqual({ unNumber: 'UN1263', hazardClass: '3' });
    expect(cleanDraft(form({ blRelease: 'sea_waybill' }), 'Wanjiku', at).originals).toBeUndefined();
  });

  it('says what signing still needs — and a bill made out to order needs someone to notify', () => {
    expect(sliGaps(undefined, { hazardous: false, containerNo: 'X' })).toEqual(['Fill in the form']);
    expect(sliGaps(cleanDraft(form(), 'W', at), { hazardous: false, containerNo: 'MSCU1234566' })).toEqual([]);
    const toOrder = cleanDraft(form({ consigneeKind: 'to_order', notifySameAsConsignee: false }), 'W', at);
    expect(sliGaps(toOrder, { hazardous: false, containerNo: 'X' })).toEqual(['Who is notified on arrival — a bill made out to order names nobody else']);
    const bank = cleanDraft(form({ consigneeKind: 'to_order_of_bank', notify: { name: 'Buyer', address: 'Rotterdam' }, notifySameAsConsignee: false }), 'W', at);
    expect(sliGaps(bank, { hazardous: false, containerNo: 'X' })).toEqual(['The bank the bill is made out to the order of']);
    expect(sliGaps(cleanDraft(form(), 'W', at), { hazardous: true, containerNo: 'X' })).toEqual(['The dangerous goods’ UN number and class']);
    expect(sliGaps(cleanDraft(form(), 'W', at), { hazardous: false })).toEqual(['The box’s number, on the export']);
  });

  it('draws the same page for the same facts and form, marks a draft, and its basis ignores the papers that come later', () => {
    const d = cleanDraft(form(), 'W', at);
    const sign = { version: 1, signedBy: 'Wanjiku', signedAt: '2026-10-28T10:00:00.000Z' };
    expect(sliHtml(facts, d, sign)).toBe(sliHtml(facts, d, sign));
    expect(sliHtml(facts, d, sign)).toContain('0902.40');
    expect(sliHtml(facts, d, 'draft')).toContain('DRAFT');
    expect(sliBasis({ ...facts, papers: ['Commercial invoice', 'Packing list'] })).toBe(sliBasis(facts));
    expect(sliBasis({ ...facts, container: { ...facts.container, number: 'TGHU1234567' } })).not.toBe(sliBasis(facts));
  });

  it('is out of date when a fact it carried changed — not when a weight or a seal came in after signing', () => {
    const signedWithout = { basis: sliBasis({ ...facts, vgm: undefined, container: { ...facts.container, seals: [] } }) };
    expect(sliStale(signedWithout, facts)).toBe(false);
    const signedWith = { basis: sliBasis(facts), vgmKg: 18640, seals: ['KE 552190'] };
    expect(sliStale(signedWith, facts)).toBe(false);
    expect(sliStale(signedWith, { ...facts, vgm: { kg: 21900, method: 1, signatory: 'Wanjiku' } })).toBe(true);
    expect(sliStale(signedWith, { ...facts, container: { ...facts.container, seals: ['KE 552191'] } })).toBe(true);
    expect(sliStale(signedWith, { ...facts, booking: 'MBA9999' })).toBe(true);
  });
});
