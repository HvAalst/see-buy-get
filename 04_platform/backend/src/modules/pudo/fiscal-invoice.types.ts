import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * TAX INVOICES (the user, 2026-10-18: "KRA eTIMS invoices", the Kenyan company "not registered yet", "eTIMS only for
 * Kenya"). One for every sale the Kenyan company makes and a credit note for every sale it gives back, made from the
 * books posting of that sale (so no path that charges can forget one), numbered in one unbroken series per company
 * before anything is sent, and recorded with KRA's eTIMS on its own time — a counter never waits on KRA.
 *
 * Until the company is registered, nothing reaches KRA: on a laptop a stand-in answers, said SANDBOX on the document;
 * on a server the invoice waits, said "not sent to KRA". See 05_engineering/etims.md.
 */

/** KRA's tax bands: A exempt, B 16%, C zero-rated, D non-VAT, E 8% (OSCU spec v2.0 §4). */
export type EtimsTaxBand = 'A' | 'B' | 'C' | 'D' | 'E';

/** Where an invoice stands with KRA. */
export type EtimsState = 'waiting' | 'recorded' | 'refused' | 'needs_check' | 'not_sendable';

/** What KRA's eTIMS answered a recorded sale with — what goes on the document, and nothing else proves it. */
export class EtimsReceipt {
  curRcptNo: number;
  totRcptNo: number;
  intrlData: string;
  rcptSign: string;
  /** KRA's date and time of the record, yyyyMMddhhmmss. */
  sdcDateTime: string;
  sdcId: string;
  mrcNo: string;
  /** The company's KRA PIN and branch it was recorded under, and on which of KRA's systems — what the QR code checks it with. */
  @ApiPropertyOptional() tin?: string;
  @ApiPropertyOptional() bhfId?: string;
  @ApiPropertyOptional({ enum: ['sandbox', 'production'], description: 'KRA’s test system, or KRA itself.' }) env?: 'sandbox' | 'production';
  /** Answered by the stand-in on a laptop: nothing was sent to KRA. */
  @ApiPropertyOptional() sandbox?: boolean;
}

export class EtimsStatus {
  @ApiProperty({ enum: ['waiting', 'recorded', 'refused', 'needs_check', 'not_sendable'] }) state: EtimsState;
  tries: number;
  @ApiPropertyOptional() lastTriedAt?: string;
  @ApiPropertyOptional({ description: 'Why it is not recorded: KRA’s own words, or why it cannot be sent.' }) note?: string;
  @ApiPropertyOptional() receipt?: EtimsReceipt;
}

export class FiscalBuyer {
  @ApiProperty({ enum: ['shop', 'store', 'person'] }) kind: 'shop' | 'store' | 'person';
  /** The shop's DID, the store's vendor id, or the person's DID: who may read it. */
  @ApiPropertyOptional() id?: string;
  name: string;
  /** Their KRA PIN, where we hold one: what lets them claim the VAT back. */
  @ApiPropertyOptional() pin?: string;
}

export class FiscalLine {
  description: string;
  /** The price without the tax, the tax, and the two together. */
  net: number;
  tax: number;
  gross: number;
  /** Absent where the rate charged has no band in eTIMS: then the invoice is not sendable, and says why. */
  @ApiPropertyOptional({ enum: ['A', 'B', 'C', 'D', 'E'] }) band?: EtimsTaxBand;
  /** The rate, as a percentage (16 for 16%). */
  ratePct: number;
}

export class FiscalInvoice {
  invoiceId: string;
  entityId: string;
  /** The company's own name and its KRA PIN, as they were when the invoice was made. */
  seller: string;
  @ApiPropertyOptional() sellerPin?: string;
  country: string;
  /**
   * The company's own number for it: one unbroken series per company, sales and credit notes together. 0 for one that
   * cannot be sent (a rate eTIMS has no band for): a number given to it would be a gap in what KRA receives.
   */
  number: number;
  @ApiProperty({ enum: ['sale', 'credit'] }) kind: 'sale' | 'credit';
  /** A credit note's: the number of the sale it gives back. */
  @ApiPropertyOptional() originalNumber?: number;
  /** The books entry it was made from, and what it was for: a parcel, a load, a top-up. */
  entryId: string;
  ref?: string;
  buyer: FiscalBuyer;
  line: FiscalLine;
  currency: string;
  @ApiProperty({ enum: ['cash', 'prepaid'] }) paidBy: 'cash' | 'prepaid';
  at: string;
  etims: EtimsStatus;
}

/** A shop's or a store's own tax number, where its country has one (Kenya: the KRA PIN). Absent everywhere else. */
export class BuyerTaxNumberView {
  @ApiProperty({ description: 'Whether this country asks for one at all. False: nothing to show.' }) applies: boolean;
  /** Its name there ("KRA PIN"), and what one looks like. */
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional() example?: string;
  /** The one this shop or store gave; its invoices carry it from then on. */
  @ApiPropertyOptional() number?: string;
}

/** The console's list: the invoices, and how the Kenyan company stands with eTIMS on this server. */
export class FiscalInvoiceList {
  @ApiProperty({ type: [FiscalInvoice] }) items: FiscalInvoice[];
  total: number;
  @ApiProperty({ description: 'How many in each state.' }) counts: Record<string, number>;
  @ApiProperty({ enum: ['kra', 'stand_in', 'not_set_up'], description: 'Whether invoices go to KRA, to the laptop stand-in, or wait.' }) rail: 'kra' | 'stand_in' | 'not_set_up';
  @ApiPropertyOptional({ enum: ['sandbox', 'production'], description: 'Where they go to KRA: its test system, or KRA itself.' }) env?: 'sandbox' | 'production';
  @ApiPropertyOptional({ enum: ['etims'], description: 'How the company asked about tells its tax authority of a sale: eTIMS for Kenya’s, absent for every other.' }) way?: 'etims';
}
