/**
 * HOW A COUNTRY'S TAX AUTHORITY IS TOLD OF A SALE — decided per country, never for the network as a whole.
 *
 * Kenya: KRA's eTIMS, every sale and credit note the Kenyan company makes (the user, 2026-10-18: "make sure eTIMS is
 * only used for kenya as it not applies to any other country"). Every other country: nothing is sent anywhere by this
 * code — another country's e-invoicing (Tanzania's, Uganda's…) is its own system, listed as an obligation in the
 * country catalogue and not built. Read off the country of the COMPANY THAT CHARGES (the sister, Merchant of Record),
 * never off the buyer, the parcel's route or the server.
 */
export type FiscalWay = 'etims';

const BY_COUNTRY: Readonly<Record<string, FiscalWay>> = { KE: 'etims' };

export function fiscalWayOf(country: string | undefined): FiscalWay | undefined {
  return country ? BY_COUNTRY[country.toUpperCase()] : undefined;
}

/**
 * THE NUMBER A BUSINESS GIVES SO ITS TAX INVOICES CARRY IT — what lets a VAT-registered shop or store claim the tax
 * back. Each country's own, or none (the user, 2026-10-18: "kra pin is kenya specific, build things in a way that they
 * do not interfere with other nations regulations"). Kenya: the KRA PIN — a letter (A a person, P a business), nine
 * digits, a letter. Every other country: nothing is asked, nothing is shown, and setting one is refused.
 */
export interface BuyerTaxNumber {
  /** Its name in that country, said as it is said there. */
  name: string;
  pattern: RegExp;
  example: string;
}

const BUYER_NUMBER: Readonly<Record<string, BuyerTaxNumber>> = {
  KE: { name: 'KRA PIN', pattern: /^[AP]\d{9}[A-Z]$/, example: 'P051234567X' },
};

export function buyerTaxNumberOf(country: string | undefined): BuyerTaxNumber | undefined {
  return country ? BUYER_NUMBER[country.toUpperCase()] : undefined;
}
