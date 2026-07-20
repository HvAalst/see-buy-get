import { Injectable } from '@nestjs/common';
import { HS_CODE_RE } from './ewaybill-schema';

// Commodity & HS code harmonization (M2-024). Sandbox keyword lookup + format validation;
// production validates against the live WCO tariff nomenclature.

export interface HsSuggestion {
  code: string;
  heading: string;
}

const KEYWORD_HS: Array<{ match: RegExp; code: string; heading: string }> = [
  { match: /(vaccine|pharma|medicine|drug)/i, code: '300490', heading: 'Medicaments, packaged' },
  { match: /(coffee)/i, code: '090111', heading: 'Coffee, not roasted' },
  { match: /(electronic|phone|laptop|computer)/i, code: '851762', heading: 'Communication apparatus' },
  { match: /(textile|garment|clothing|apparel)/i, code: '610910', heading: 'T-shirts, cotton' },
  { match: /(wine|spirit|liquor)/i, code: '220421', heading: 'Wine, ≤2L' },
  { match: /(machine|machinery|equipment)/i, code: '847989', heading: 'Machines, individual functions' },
  { match: /(furniture)/i, code: '940360', heading: 'Wooden furniture' },
];

@Injectable()
export class HsCodeService {
  /** Validate HS code format (6/8/10 digits). */
  isValid(code: string): boolean {
    return HS_CODE_RE.test(code);
  }

  /** Suggest an HS code from a free-text commodity description. */
  suggest(description: string): HsSuggestion | null {
    if (!description) return null;
    const hit = KEYWORD_HS.find((k) => k.match.test(description));
    return hit ? { code: hit.code, heading: hit.heading } : null;
  }
}
