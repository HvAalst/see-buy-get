/** What a load's package labels will carry. */
export class PackageLabelsView {
  freightId: string;
  /** How many labels print: one a package, or one for the load when the number of packages was not given. */
  labels: number;
  /** The number of packages, when the shipper gave it. */
  packages?: number;
  /** One SSCC a package, in package order, when the shipper's GS1 company prefix gave them; empty otherwise. */
  codes: string[];
  /** The prefix they were given under. */
  companyPrefix?: string;
  /** 2026-11-09 — the ship-to GLN (AI 410) the labels carry as a barcode: the place's, or the receiver's own. */
  shipToGln?: string;
}
