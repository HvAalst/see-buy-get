import type { MessageKey } from './i18n';

/**
 * 2026-11-10 — WHAT A BORDER MANIFEST STILL LACKS, in the reader's language (Kenya–Ethiopia, the Moyale post). The server
 * names each gap by a stable key and says it in English with its particulars; a screen says the key in the language
 * chosen, and the server's own sentence for a key it does not know yet.
 */
const GAP_WORDS: Readonly<Record<string, MessageKey>> = {
  invoice: 'common.manifest.gap.invoice',
  consignor_tax: 'common.manifest.gap.consignor_tax',
  consignee_tax: 'common.manifest.gap.consignee_tax',
  consignor_country: 'common.manifest.gap.consignor_country',
  consignee_country: 'common.manifest.gap.consignee_country',
  hs_codes: 'common.manifest.gap.hs_codes',
  export_entry: 'common.manifest.gap.export_entry',
  etims_invoice: 'common.manifest.gap.etims_invoice',
  import_declaration: 'common.manifest.gap.import_declaration',
  vehicle: 'common.manifest.gap.vehicle',
  vehicle_country: 'common.manifest.gap.vehicle_country',
  yellow_card: 'common.manifest.gap.yellow_card',
  passport: 'common.manifest.gap.passport',
};

export interface ManifestGapView {
  key: string;
  who: 'shipper' | 'carrier';
  words: string;
  blocking?: boolean;
}

export function manifestGapWords(g: ManifestGapView, t: (key: MessageKey) => string): string {
  const key = GAP_WORDS[g.key];
  return key ? t(key) : g.words;
}

/** The two countries whose offices see the border papers: a fleet elsewhere is asked nothing of Moyale. */
export const MOYALE_COUNTRIES: readonly string[] = ['KE', 'ET'];
