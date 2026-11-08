import type { ZoneProposal } from './types';
import { KE_PROPOSAL } from './ke';

export type { ZoneProposal } from './types';

/**
 * THE FIRST MAPS PROPOSED, ONE PER COUNTRY THAT HAS ONE (2026-11-08; the owner: "make sure that the currency and zone
 * examples of kenya are only written for kenya"). Keyed by country, and asked by country: a country absent here is
 * offered no proposal and sees none of another's. Adding a country is one line, and that country's own data.
 */
const PROPOSALS: Record<string, ZoneProposal> = {
  KE: KE_PROPOSAL,
};

export function proposalFor(country: string | undefined): ZoneProposal | undefined {
  return country ? PROPOSALS[country.toUpperCase()] : undefined;
}
