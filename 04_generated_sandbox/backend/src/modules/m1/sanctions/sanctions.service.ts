import { Injectable } from '@nestjs/common';

// Sanctions / PEP screening (T-105, UDIW-014). Sandbox model: a small denylist screened
// at registration and continuously (re-run on each verification step). A positive match
// drives automatic suspension upstream in IdentityService.

export interface ScreeningResult {
  hit: boolean;
  matchedList?: string;
  matchedTerm?: string;
}

@Injectable()
export class SanctionsScreeningService {
  // Lowercased denylist. In production this is a continuous feed (OFAC, EU, UN, PEP, adverse media).
  private readonly denylist = new Map<string, string>([
    ['ofac test person', 'OFAC-SDN'],
    ['blocked entity', 'EU-Consolidated'],
    ['sanctioned individual', 'UN-1267'],
  ]);

  screen(fullName: string): ScreeningResult {
    const needle = (fullName ?? '').trim().toLowerCase();
    if (!needle) return { hit: false };
    for (const [term, list] of this.denylist) {
      if (needle.includes(term)) return { hit: true, matchedList: list, matchedTerm: term };
    }
    return { hit: false };
  }

  /** Test/ops hook to extend the denylist. */
  addDeniedTerm(term: string, list: string): void {
    this.denylist.set(term.toLowerCase(), list);
  }
}
