import type { SbgClient } from '../client';

/**
 * A BUYER'S TAX INVOICES (KRA eTIMS, Kenya only): a shop's, a store's, or a person's for their own send. The server
 * answers each with its own and nobody else's; outside Kenya there are none.
 */
export function createFiscalApi(sbg: SbgClient) {
  return {
    /** A shop's or a store's own, the newest first: what it claims its VAT back with. */
    myFiscalInvoices: () => sbg.request((c) => c.GET('/v1/sbg/fiscal-invoices/mine', {})),
    /** The ones for one parcel, where the caller bought it: none for anybody else. */
    parcelFiscalInvoices: (parcelId: string) => sbg.request((c) => c.GET('/v1/sbg/parcels/{id}/fiscal-invoices', { params: { path: { id: parcelId } } })),
    /** One as a page, once KRA has recorded it: the buyer's first opening is the original, every other a copy. */
    fiscalInvoicePage: (invoiceId: string) => sbg.request((c) => c.GET('/v1/sbg/fiscal-invoices/{invoiceId}/invoice.html', { params: { path: { invoiceId } }, parseAs: 'text' })),
    /** A shop's or a store's own tax number, where its country has one (Kenya: the KRA PIN); `applies: false` elsewhere. */
    myTaxNumber: () => sbg.request((c) => c.GET('/v1/sbg/fiscal-invoices/my-tax-number', {})),
    /** Give it, or take it away with an empty one. */
    setMyTaxNumber: (number: string) => sbg.request((c) => c.PUT('/v1/sbg/fiscal-invoices/my-tax-number', { body: { number } })),
  };
}

export type FiscalApi = ReturnType<typeof createFiscalApi>;
