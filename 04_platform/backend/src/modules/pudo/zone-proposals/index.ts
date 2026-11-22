import type { ZoneProposal } from './types';
import { ET_PROPOSAL } from './et';
import { KE_PROPOSAL } from './ke';
import { NL_PROPOSAL } from './nl';
import { UG_PROPOSAL } from './ug';
import { BG_PROPOSAL } from './bg';

export type { ZoneProposal } from './types';

/**
 * THE FIRST MAPS PROPOSED, ONE PER COUNTRY THAT HAS ONE (2026-11-08; the owner: "make sure that the currency and zone
 * examples of kenya are only written for kenya"). Keyed by country, and asked by country: a country absent here is
 * offered no proposal and sees none of another's. Adding a country is one line, and that country's own data.
 */
const PROPOSALS: Record<string, ZoneProposal> = {
  KE: KE_PROPOSAL,
  // 2026-11-09 — the Netherlands, where SeeBuyGet is tested (the owner: "wire in the map for the Netherlands").
  NL: NL_PROPOSAL,
  // 2026-11-10 — Ethiopia, for its draft company (the owner: "set up a draft for both Kenya and Ethiopia").
  ET: ET_PROPOSAL,
  // 2026-11-10 — Uganda, where a business is registered (the owner: "check for a zone map of Uganda").
  UG: UG_PROPOSAL,
  // 2026-11-22 — Bulgaria, the far end of the Netherlands–Bulgaria route (the plan, part 10; the owner: "continue part 10 and 5").
  BG: BG_PROPOSAL,
};

export function proposalFor(country: string | undefined): ZoneProposal | undefined {
  return country ? PROPOSALS[country.toUpperCase()] : undefined;
}
