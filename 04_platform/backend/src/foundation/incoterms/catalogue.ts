/**
 * THE TRADE TERMS THAT EXIST — the only place an Incoterm may come from.
 *
 * Incoterms 2020, as published by the ICC. Eleven of them, and a jurisdiction carries the subset somebody
 * switched on (see the presence record). Data, read by everybody and edited by nobody at runtime: what
 * changes at runtime is which terms a country ALLOWS, never which terms exist. The countries catalogue is
 * the same shape and the same reasoning.
 *
 * What each term actually fixes, and the only three facts this system derives from it:
 *
 *   exportClearance   who must clear the goods OUT of the origin country
 *   importClearance   who must clear them IN at the destination
 *   riskPassesAt      where risk of loss or damage moves from seller to buyer
 *
 * The third is the one that reaches our code. Under the C terms the seller pays the freight all the way to
 * destination while risk passed to the buyer at ORIGIN — cost and risk come apart — so goods damaged in
 * transit are the buyer's loss and the buyer is the party with standing to claim. Getting that backwards is
 * the defect this catalogue exists to fix.
 *
 * Deliberately NOT modelled: who owns the goods. An Incoterm does not transfer title and never has.
 */
export type IncotermFamily = 'any' | 'sea';
export type IncotermParty = 'seller' | 'buyer';

export interface CatalogueIncoterm {
  code: string;
  name: string;
  /** 'any' works for any mode of transport; 'sea' is sea and inland waterway only. */
  family: IncotermFamily;
  exportClearance: IncotermParty;
  importClearance: IncotermParty;
  /** Where risk moves. 'origin' means the buyer carries it in transit; 'destination' means the seller does. */
  riskPassesAt: 'origin' | 'destination';
  /** Only CIF and CIP oblige the seller to insure. Everywhere else it is somebody's choice and nobody's duty. */
  sellerInsures: boolean;
  /** What the sender is agreeing to, in words a clerk at a counter can act on. */
  blurb: string;
}

export const INCOTERM_CATALOGUE: readonly CatalogueIncoterm[] = [
  { code: 'EXW', name: 'Ex Works', family: 'any', exportClearance: 'buyer', importClearance: 'buyer', riskPassesAt: 'origin', sellerInsures: false, blurb: 'The buyer collects from the seller and does everything, including clearing the goods for export. Often the wrong choice: a foreign buyer usually cannot file an export declaration in the seller. Prefer FCA.' },
  { code: 'FCA', name: 'Free Carrier', family: 'any', exportClearance: 'seller', importClearance: 'buyer', riskPassesAt: 'origin', sellerInsures: false, blurb: 'The seller clears for export and hands the goods to the carrier. Risk moves there, so damage on the road is the buyer.' },
  { code: 'CPT', name: 'Carriage Paid To', family: 'any', exportClearance: 'seller', importClearance: 'buyer', riskPassesAt: 'origin', sellerInsures: false, blurb: 'The seller pays the carriage to the named place but risk moved when the goods were handed to the first carrier.' },
  { code: 'CIP', name: 'Carriage and Insurance Paid To', family: 'any', exportClearance: 'seller', importClearance: 'buyer', riskPassesAt: 'origin', sellerInsures: true, blurb: 'As CPT, and the seller must insure the goods for the buyer, at the wider cover (Institute Cargo Clauses A since 2020).' },
  { code: 'DAP', name: 'Delivered At Place', family: 'any', exportClearance: 'seller', importClearance: 'buyer', riskPassesAt: 'destination', sellerInsures: false, blurb: 'The seller carries the risk all the way and delivers ready for unloading. The buyer clears the import and pays the duty.' },
  { code: 'DPU', name: 'Delivered at Place Unloaded', family: 'any', exportClearance: 'seller', importClearance: 'buyer', riskPassesAt: 'destination', sellerInsures: false, blurb: 'As DAP, and the seller unloads. The only term that obliges the seller to unload. Replaced DAT in 2020.' },
  { code: 'DDP', name: 'Delivered Duty Paid', family: 'any', exportClearance: 'seller', importClearance: 'seller', riskPassesAt: 'destination', sellerInsures: false, blurb: 'The seller does everything including clearing the import and paying the duty. Often the wrong choice in the other direction: a foreign seller usually cannot be importer of record. Prefer DAP or DPU.' },
  { code: 'FAS', name: 'Free Alongside Ship', family: 'sea', exportClearance: 'seller', importClearance: 'buyer', riskPassesAt: 'origin', sellerInsures: false, blurb: 'Sea only. The seller places the goods alongside the vessel and clears them for export; risk moves there.' },
  { code: 'FOB', name: 'Free On Board', family: 'sea', exportClearance: 'seller', importClearance: 'buyer', riskPassesAt: 'origin', sellerInsures: false, blurb: 'Sea only. Risk moves when the goods are on board at the port of shipment.' },
  { code: 'CFR', name: 'Cost and Freight', family: 'sea', exportClearance: 'seller', importClearance: 'buyer', riskPassesAt: 'origin', sellerInsures: false, blurb: 'Sea only. The seller pays the freight to the destination port, but risk moved on loading at the origin port.' },
  { code: 'CIF', name: 'Cost, Insurance and Freight', family: 'sea', exportClearance: 'seller', importClearance: 'buyer', riskPassesAt: 'origin', sellerInsures: true, blurb: 'Sea only. As CFR, and the seller must insure — at the minimum cover (Institute Cargo Clauses C), which is less than CIP.' },
];

export const INCOTERM_CODES: readonly string[] = INCOTERM_CATALOGUE.map((t) => t.code);

const BY_CODE = new Map(INCOTERM_CATALOGUE.map((t) => [t.code, t]));

/** One term by its code, case-insensitively. Undefined for anything that is not one of the eleven. */
export function incotermEntry(code?: string): CatalogueIncoterm | undefined {
  return code ? BY_CODE.get(code.trim().toUpperCase()) : undefined;
}

export function isIncoterm(code?: string): boolean {
  return Boolean(incotermEntry(code));
}

/**
 * Does this term put the IMPORT clearance, and therefore the duty, on the party the network would be
 * performing it for? True only of DDP. This is what the presence floor keys on: a term that obliges us to
 * clear and bill duty cannot be switched on in a country where we neither collect tax nor pay out.
 */
export function putsDutyOnSeller(code?: string): boolean {
  return incotermEntry(code)?.importClearance === 'seller';
}

/**
 * WHO OWNS THE LOSS WHEN GOODS ARE DAMAGED IN TRANSIT — the one derivation that moves money.
 *
 * 'receiver' wherever risk passed at origin (the E, F and C terms), 'sender' wherever the seller carries it
 * to the destination (the D terms). Absent or unknown term: 'sender', which is what the system did before
 * any of this existed and is what every load already on the record is entitled to.
 */
export function riskBearerOf(code?: string): 'sender' | 'receiver' {
  return incotermEntry(code)?.riskPassesAt === 'origin' ? 'receiver' : 'sender';
}
