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
