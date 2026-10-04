import { QuoteService } from './quote.service';
import { pdfDataUrl } from '../../foundation/entity/company.test-util';

/**
 * QUOTATIONS FOR ANYONE — the user, 2026-10-04: "we do handle quotations for anyone. Like proforma invoices are common
 * so we have a field for it, but the user needs to confirm open/paid."
 *
 * What must hold: only the two parties touch it, a confirmed payment does not quietly change its figure, and every
 * turn keeps the name of who said so.
 */
describe('a quotation', () => {
  const carrier = { name: 'Kilima Freight', did: 'did:glos:kilima' };
  const shipper = { name: 'Abebe Import PLC', entityId: 'biz-et-abebe', did: 'did:glos:abebe-biz' };
  const stranger = { name: 'Somebody', did: 'did:glos:stranger' };
  const make = (svc: QuoteService, over: Partial<{ agreed: boolean }> = {}) =>
    svc.quote({ subject: { kind: 'freight', id: 'frt_1', code: 'FRT-001' }, issuer: carrier, payer: { name: shipper.name, entityId: shipper.entityId, did: shipper.did }, amount: 18000, currency: 'etb', reference: 'Q-77', ...over }, 'Abebe Kebede');

  it('is a record: an amount, a currency, a reference, open until a party says it is paid', () => {
    const q = make(new QuoteService());
    expect(q).toMatchObject({ amount: 18000, currency: 'ETB', reference: 'Q-77', status: 'open' });
    expect(q.history).toEqual([expect.objectContaining({ what: 'quoted', by: 'Abebe Kebede' })]);
  });

  it('refuses an amount of nothing and a currency that is not three letters', () => {
    const svc = new QuoteService();
    expect(() => svc.quote({ subject: { kind: 'freight', id: 'x' }, issuer: carrier, payer: shipper, amount: 0, currency: 'ETB' }, 'A')).toThrow(/above zero/);
    expect(() => svc.quote({ subject: { kind: 'freight', id: 'x' }, issuer: carrier, payer: shipper, amount: 5, currency: 'birr' }, 'A')).toThrow(/three letters/);
  });

  it('is confirmed paid by either party, by name — never by somebody who is neither', () => {
    const svc = new QuoteService();
    const q = make(svc);
    expect(() => svc.setStatus(q.quoteId, 'paid', stranger)).toThrow(/No such quotation/);
    // A person in the business acts as the business, recognised by its entityId whatever DID they carry.
    const paid = svc.setStatus(q.quoteId, 'paid', { name: 'Selam', entityId: shipper.entityId }, 'TELEBIRR-551');
    expect(paid).toMatchObject({ status: 'paid', paidBy: 'Selam', paidReference: 'TELEBIRR-551' });
    expect(() => svc.setStatus(q.quoteId, 'paid', carrier)).toThrow(/Already confirmed paid by Selam/);
    const open = svc.setStatus(q.quoteId, 'open', carrier);
    expect(open.paidAt).toBeUndefined();
    expect(open.history.map((h) => `${h.what}:${h.by}`)).toEqual(['quoted:Abebe Kebede', 'paid:Selam', 'open:Kilima Freight']);
  });

  it('will not change a figure somebody confirmed paid until it is set back to open', () => {
    const svc = new QuoteService();
    const q = make(svc);
    svc.setStatus(q.quoteId, 'paid', carrier);
    expect(() => make(svc)).toThrow(/set it back to open/);
    svc.setStatus(q.quoteId, 'open', carrier);
    expect(svc.quote({ subject: { kind: 'freight', id: 'frt_1' }, issuer: carrier, payer: shipper, amount: 19000, currency: 'ETB' }, 'Abebe Kebede').amount).toBe(19000);
  });

  it('is agreed by the payer alone', () => {
    const svc = new QuoteService();
    const q = make(svc);
    expect(() => svc.agree(q.quoteId, carrier)).toThrow(/Only Abebe Import PLC can agree/);
    expect(svc.agree(q.quoteId, { name: 'Selam', entityId: shipper.entityId }).agreedBy).toBe('Selam');
  });

  it('keeps the proforma as handed over, fingerprinted, for the two parties alone', () => {
    const svc = new QuoteService();
    const q = make(svc);
    const dataUrl = pdfDataUrl('proforma');
    expect(() => svc.attachProforma(q.quoteId, stranger, { dataUrl })).toThrow(/No such quotation/);
    const withFile = svc.attachProforma(q.quoteId, carrier, { dataUrl, fileName: 'PF-77.pdf' });
    expect(withFile.proforma).toMatchObject({ fileName: 'PF-77.pdf', contentType: 'application/pdf', addedBy: 'Kilima Freight' });
    const file = svc.proformaFile(q.quoteId, { name: 'Selam', entityId: shipper.entityId });
    expect(file.bytes.toString()).toContain('proforma');
    expect(file.fingerprint).toBe(withFile.proforma!.fingerprint);
    expect(() => svc.proformaFile(q.quoteId, stranger)).toThrow(/No proforma/);
    expect(() => svc.attachProforma(q.quoteId, carrier, { dataUrl: 'data:text/plain;base64,aGk=' })).toThrow();
  });
});
