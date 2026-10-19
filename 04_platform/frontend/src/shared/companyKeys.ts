import type { Translate } from './i18n';

/*
 * A COMPANY'S KEYS FOR ITS OWN SYSTEMS (backend company-key.types.ts; the user, round 12: an API for businesses and fleets;
 * "Same as the system" — a business's owners make and take away its keys, any manager of a fleet under their name). Said
 * the same way in the Business app and the Fleet app.
 */

export interface CompanyKey {
  keyId: string;
  mode: 'test' | 'live';
  label?: string;
  hint: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
}

export interface CompanyKeyIssued {
  key: CompanyKey;
  /** The key itself, in this answer only. */
  secret: string;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** "Live key · ERP · …a3f9": which world, what it is called, and how to tell it from the others. */
export function keyTitle(k: CompanyKey, t: Translate): string {
  return [t(k.mode === 'live' ? 'companyKeys.live' : 'companyKeys.test'), k.label, `…${k.hint}`].filter(Boolean).join(' · ');
}

/** Who made it and when; when it was last used, or not yet; or who took it away. */
export function keyLine(k: CompanyKey, t: Translate): string {
  if (k.revokedAt) return t('companyKeys.revoked', { name: k.revokedBy ?? '', when: when(k.revokedAt) });
  return `${t('companyKeys.made', { name: k.createdBy, when: when(k.createdAt) })} ${k.lastUsedAt ? t('companyKeys.used', { when: when(k.lastUsedAt) }) : t('companyKeys.unused')}`;
}

/** The ones that work first, newest first; those taken away after, newest first. */
export function keysInOrder(keys: CompanyKey[]): CompanyKey[] {
  return [...keys].sort((a, b) => Number(Boolean(a.revokedAt)) - Number(Boolean(b.revokedAt)) || b.createdAt.localeCompare(a.createdAt));
}
