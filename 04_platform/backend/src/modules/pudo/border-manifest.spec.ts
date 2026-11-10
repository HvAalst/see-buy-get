import type { Entity } from '../../foundation/entity/entity.types';
import { BorderManifestService, manifestFingerprint, type ManifestCarrier, type ManifestFacts } from './border-manifest.service';
import { CommercialInvoiceService, type InvoiceInput } from './commercial-invoice.service';
import type { Freight } from './dispatch.types';

/** 2026-11-10 — the border manifest at Moyale, Kenya–Ethiopia only (border-manifest.types.ts). */
describe('the border manifest at Moyale (2026-11-10)', () => {
  const exporter = { entityId: 'biz-meki', did: 'did:glos:biz-meki', kind: 'business', name: 'Meki Tea Exporters', jurisdiction: 'KE', business: { activities: ['shipper'], taxNo: 'P051234567X' } } as unknown as Entity;
  const load = (over: Partial<Freight> = {}): Freight =>
    ({ freightId: 'frt_m1', code: 'FRT-501', description: 'Black tea, 18 pallets', pickupLabel: 'Meki depot, Nairobi', destLabel: 'Hawassa warehouse', weightKg: 9000, packages: 18, status: 'claimed', postedByDid: exporter.did, pickupCountry: 'KE', destCountry: 'ET', createdAt: '2026-11-10T08:00:00.000Z', ...over }) as Freight;
  const invoice = (over: Partial<InvoiceInput> = {}): InvoiceInput => ({
    number: 'INV-77',
    issuedOn: '2026-11-10',
    importer: { name: 'Hawassa Trading PLC', address: 'Hawassa, Sidama', country: 'ET', taxNo: '0012345678' },
    currency: 'USD',
    reason: 'sale',
    lines: [{ description: 'Black tea CTC, 60 kg sacks', quantity: 150, netKg: 9000, unitValue: 120, originCountry: 'KE', hsCode: '0902.30.00' }],
    declare: true,
    ...over,
  });
  const ready: ManifestCarrier = {
    vehicle: { plate: 'KDA 123A', vehicleClass: 'truck', registrationCountry: 'KE', trailerPlate: 'ZF 4471', yellowCard: { number: 'YC-KE-88231', expiresAt: '2027-06-30' } },
    crew: { name: 'Joseph Kiprop Rotich', licenceNumber: 'DL-55120', passport: { number: 'AK1234567', country: 'KE', expiresAt: '2030-01-31' } },
  };
  const now = Date.parse('2026-11-10T09:00:00Z');
  let invoices: CommercialInvoiceService;
  let manifests: BorderManifestService;
  let f: Freight;
  let facts: ManifestFacts;

  beforeEach(() => {
    invoices = new CommercialInvoiceService();
    manifests = new BorderManifestService(invoices);
    f = load();
    facts = { carrier: ready, seals: [], events: [] };
    manifests.useFacts((id) => (id === f.freightId ? { freight: f, facts } : undefined));
  });

  it('is asked of a load between Kenya and Ethiopia, either way — and of no other pair', () => {
    expect(manifests.pairOf(load())).toBe('KE>ET');
    expect(manifests.pairOf(load({ pickupCountry: 'ET', destCountry: 'KE' }))).toBe('ET>KE');
    for (const [a, b] of [['KE', 'UG'], ['ET', 'DJ'], ['KE', 'KE'], ['NL', 'ET']]) expect(manifests.pairOf(load({ pickupCountry: a, destCountry: b }))).toBeUndefined();
    expect(manifests.gaps(load({ destCountry: 'UG' }), ready)).toEqual([]);
    expect(manifests.status(load({ destCountry: 'UG' }), { mayWrite: true })).toMatchObject({ required: false });
  });

  it('names what is missing and whose it is to give — the invoice first, a paper one of your own not enough', () => {
    const keys = manifests.gaps(f, {}).map((g) => `${g.who}:${g.key}${g.blocking ? '' : '?'}`);
    expect(keys).toEqual(['shipper:invoice', 'shipper:export_entry', 'shipper:etims_invoice', 'shipper:import_declaration?', 'carrier:vehicle', 'carrier:passport']);
    expect(manifests.pickupRefusal(f, {}, now)).toMatch(/^This load crosses at Moyale between Kenya and Ethiopia, and its border manifest is not complete: Its commercial invoice, written and signed here.*The goods are not taken over until it is\.$/);
  });

  it('asks each country’s tax number as that country writes it, and HS codes to eight digits', () => {
    invoices.issue(f, { entity: exporter, name: 'Wanjiku' }, invoice({ importer: { name: 'Hawassa Trading PLC', country: 'ET', taxNo: 'TIN-77' }, lines: [{ description: 'Tea', quantity: 1, netKg: 60, unitValue: 120, originCountry: 'KE', hsCode: '0902.30' }] }), now);
    const words = manifests.gaps(f, ready).map((g) => g.words);
    expect(words).toContain('The receiver’s TIN on the invoice, written as 0012345678');
    expect(words).toContain('Every line’s HS code to 8 digits, as both tariffs classify: 1 line has fewer');
    expect(words.some((w) => /sender’s KRA PIN/.test(w))).toBe(false); // P051234567X is a KRA PIN
  });

  it('takes the customs numbers from the sender or its agent, the import side’s allowed to follow until the post', () => {
    invoices.issue(f, { entity: exporter, name: 'Wanjiku' }, invoice(), now);
    expect(manifests.pickupRefusal(f, ready, now)).toMatch(/Kenyan export entry \(KRA iCMS\) number.*eTIMS invoice number/);
    manifests.setReferences(f, 'Wanjiku, for Meki Tea Exporters', { exportEntry: ' 2026ke-exp-004411 ', etimsInvoice: 'KRAMW0042026' }, now);
    expect(manifests.referencesOf(f.freightId).exportEntry).toEqual({ number: '2026KE-EXP-004411', by: 'Wanjiku, for Meki Tea Exporters', at: '2026-11-10T09:00:00.000Z' });
    expect(manifests.pickupRefusal(f, ready, now)).toBeUndefined(); // the import declaration may follow
    expect(manifests.status(f, { mayWrite: true, now })).toMatchObject({ complete: true, missing: [{ key: 'import_declaration', blocking: false }], referenceNames: { importDeclaration: 'Ethiopian import declaration (ECC eCMS)' } });
    // An eTIMS number is Kenya's: never asked of goods leaving Ethiopia.
    const back = load({ freightId: 'frt_m2', pickupCountry: 'ET', destCountry: 'KE' });
    expect(() => manifests.setReferences(back, 'X', { etimsInvoice: 'K1' })).toThrow(/goods leaving Kenya/);
    expect(manifests.gaps(back, ready).map((g) => g.key)).not.toContain('etims_invoice');
    expect(() => manifests.setReferences(load({ destCountry: 'UG' }), 'X', { exportEntry: 'A' })).toThrow(/Only a load between Kenya and Ethiopia/);
  });

  it('asks the carrier for the vehicle’s registration and Yellow Card in date, and the driver’s passport in date', () => {
    invoices.issue(f, { entity: exporter, name: 'Wanjiku' }, invoice(), now);
    manifests.setReferences(f, 'W', { exportEntry: 'E1', etimsInvoice: 'T1' }, now);
    const lapsed: ManifestCarrier = { vehicle: { plate: 'KDA 123A', vehicleClass: 'truck', yellowCard: { number: 'YC-1', expiresAt: '2026-11-09' } }, crew: { name: 'Joseph', passport: { number: 'AK1', country: 'KE', expiresAt: '2026-10-01' } } };
    const words = manifests.gaps(f, lapsed, now).filter((g) => g.who === 'carrier').map((g) => `${g.who}:${g.words}`);
    expect(words).toEqual(['carrier:Where vehicle KDA 123A is registered, in its papers', 'carrier:Vehicle KDA 123A’s COMESA Yellow Card has run out: its renewed number and expiry, in its papers', 'carrier:Joseph’s passport has run out: the new one, recorded by their fleet office or the network']);
    expect(manifests.pickupRefusal(f, lapsed, now)).toMatch(/Yellow Card has run out/);
  });

  it('freezes a copy at each step, each fingerprinted and checked on the public page — nothing of what it says', () => {
    invoices.issue(f, { entity: exporter, name: 'Wanjiku' }, invoice(), now);
    manifests.setReferences(f, 'W', { exportEntry: 'E1', etimsInvoice: 'T1' }, now);
    // Before pickup: a preview, said so, with no fingerprint.
    expect(manifests.current(f.freightId)).toMatchObject({ doc: { version: 0, reason: expect.stringMatching(/preview/) } });
    expect(manifests.current(f.freightId)!.fingerprint).toBeUndefined();
    f = { ...f, status: 'in_transit', pickedUpAt: '2026-11-10T09:30:00.000Z' };
    facts = { carrier: ready, seals: ['Seal 1 (ISO 17712 class H), applied by the sender: KE 448812'], events: [{ at: '2026-11-10T09:30:00.000Z', words: 'Taken over at Meki depot, Nairobi' }] };
    const first = manifests.freeze(f.freightId, 'Taken over', now)!;
    expect(first.doc).toMatchObject({ number: 'MAN-FRT-501', version: 1, pair: 'KE>ET', consignor: { name: 'Meki Tea Exporters', taxName: 'KRA PIN', taxNo: 'P051234567X' }, consignee: { taxName: 'TIN', taxNo: '0012345678' }, goods: [{ hsCode: '09023000', quantity: 150, lineValue: 18000 }], references: { exportEntry: 'E1', etimsInvoice: 'T1' }, vehicle: { yellowCard: { number: 'YC-KE-88231' } }, crew: { passport: { number: 'AK1234567' } } });
    expect(first.fingerprint).toBe(manifestFingerprint(first.doc));
    // The import declaration after pickup: a new copy; the first stays as it was.
    manifests.setReferences(f, 'W', { importDeclaration: 'ECC-2026-99812' }, now + 60_000);
    const rows = manifests.versionRows(f.freightId);
    expect(rows.map((r) => [r.seq, r.reason])).toEqual([[1, 'Taken over'], [2, 'Customs numbers added by the sender']]);
    expect(rows[0].fingerprint).toBe(first.fingerprint);
    expect(manifests.verify(rows[1].fingerprint)).toMatchObject({ known: true, number: 'MAN-FRT-501', seq: 2, says: expect.stringMatching(/^This is copy 2 of border manifest MAN-FRT-501, as it stood on 2026-11-10 — customs numbers added by the sender\. It was issued by the SeeBuyGet network and has not been altered since\.$/) });
    expect(manifests.verify(rows[0].fingerprint)!.says).not.toMatch(/tea|Hawassa|USD/i);
    expect(manifests.verify('0'.repeat(64))).toBeUndefined();
  });

  it('prints one page for customs, checkpoints and tax: labels in English and Amharic, a QR code to the check page', () => {
    invoices.issue(f, { entity: exporter, name: 'Wanjiku' }, invoice(), now);
    manifests.setReferences(f, 'W', { exportEntry: 'E1', etimsInvoice: 'T1' }, now);
    f = { ...f, status: 'in_transit', pickedUpAt: '2026-11-10T09:30:00.000Z' };
    const v = manifests.freeze(f.freightId, 'Taken over', now)!;
    const html = manifests.htmlFor(v.doc, v.fingerprint);
    for (const s of ['Border manifest — commercial consignment', 'የድንበር ጭነት ዝርዝር', 'Moyale One-Stop Border Post', 'KRA PIN P051234567X', 'TIN 0012345678', '09023000', 'Kenyan export entry (iCMS)', 'COMESA Yellow Card', 'AK1234567', `?note=${v.fingerprint}`, 'the customs declarations are the declarant’s own']) expect(html).toContain(s);
    expect(html).toContain('<svg viewBox="0 0 120 120"');
    expect(html).toContain('Not given yet'); // the import declaration, before the post
    // Escaped: a description is text, never markup.
    const evil = manifests.build({ ...f, description: '<script>x</script>' }, facts, 'Taken over', 3);
    expect(manifests.htmlFor(evil)).not.toContain('<script>x');
  });
});
