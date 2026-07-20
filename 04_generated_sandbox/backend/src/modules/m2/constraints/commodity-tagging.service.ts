import { Injectable } from '@nestjs/common';

// Automatic requirement tagging from commodity (M2-031). A declared commodity suggests handling
// codes which are pre-applied; the shipper can still override. Keyword rules here; production
// would key off the HS code + a curated commodity-requirement matrix.

const COMMODITY_RULES: Array<{ match: RegExp; codes: string[] }> = [
  { match: /(vaccine|pharma|insulin|biologic)/i, codes: ['TEMP_2_8C', 'FRAGILE'] },
  { match: /(frozen|ice cream)/i, codes: ['TEMP_FROZEN'] },
  { match: /(fresh|produce|seafood|meat|dairy|perishable)/i, codes: ['PERISHABLE', 'TEMP_2_8C'] },
  { match: /(electronic|phone|laptop|glass|ceramic|lens)/i, codes: ['FRAGILE', 'SHOCK_SENSITIVE'] },
  { match: /(flammable|fuel|petrol|gasoline|paint|solvent|ethanol)/i, codes: ['DG_CLASS_3'] },
  { match: /(explosive|ammunition|fireworks)/i, codes: ['DG_CLASS_1'] },
  { match: /(lithium|battery|batteries)/i, codes: ['DG_CLASS_9'] },
  { match: /(jewel|gold|diamond|art|luxury|watch)/i, codes: ['HIGH_VALUE', 'SECURITY_SEAL'] },
  { match: /(document|paper|certificate)/i, codes: ['KEEP_DRY'] },
];

@Injectable()
export class CommodityTaggingService {
  /** Suggested handling codes for a free-text commodity description (deduped). */
  suggest(description?: string): string[] {
    if (!description) return [];
    const codes = new Set<string>();
    for (const rule of COMMODITY_RULES) {
      if (rule.match.test(description)) rule.codes.forEach((c) => codes.add(c));
    }
    return [...codes];
  }
}
