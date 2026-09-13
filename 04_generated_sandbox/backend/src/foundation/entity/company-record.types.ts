import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GlosError } from '../http/glos-error';
import { catalogueEntry } from '../countries/catalogue';
import { PRESENCE_CAPABILITIES, type CapabilityLapse, type PresenceCapability } from '../presence/presence.types';

/**
 * CA3 — WHAT MAKES A COMPANY OF OURS REAL (user, 2026-09-13).
 *
 * Until this, a sister was a name, a country and a currency written in code. A company that can charge
 * customers, hold their money and answer for their goods has a legal form, a registration, people who may
 * sign for it, owners, tax numbers, a bank, licences and insurance — and none of that could be recorded.
 * Entered from the super-admin side when the company is activated; a country we only MATCH holds none of it,
 * because nothing of ours is incorporated there.
 */

export const LEGAL_FORMS = ['private_limited', 'public_limited', 'branch_of_foreign_company', 'partnership', 'sole_proprietorship', 'cooperative', 'other'] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];

/** Who may bind the company: on their own signature, only together with another, or not at all. */
export const SIGNING_AUTHORITIES = ['alone', 'jointly', 'none'] as const;
export type SigningAuthority = (typeof SIGNING_AUTHORITIES)[number];

export const TAX_KINDS = ['vat', 'corporate_income', 'withholding', 'payroll', 'customs', 'other'] as const;
export type TaxKind = (typeof TAX_KINDS)[number];

export const BANK_PURPOSES = ['payouts', 'collections', 'general'] as const;
export type BankPurpose = (typeof BANK_PURPOSES)[number];

export const LICENCE_KINDS = ['courier', 'postal', 'transport_operator', 'customs_broker', 'money_handling', 'other'] as const;
export type LicenceKind = (typeof LICENCE_KINDS)[number];

export const INSURANCE_KINDS = ['goods_in_transit', 'claims_provision', 'public_liability', 'motor_fleet', 'other'] as const;
export type InsuranceKind = (typeof INSURANCE_KINDS)[number];

/**
 * CA5 — what each kind of licence or policy PERMITS, when nobody says otherwise. When it lapses, these switch off.
 * A courier licence is what lets us sell a delivery; money handling is what lets a float and cash pass through us;
 * a goods-in-transit policy is what pays a claim. The rest support no capability by default, and may be told to.
 */
export const LICENCE_SUPPORTS: Record<LicenceKind, PresenceCapability[]> = {
  courier: ['merchantOfRecord'],
  postal: ['merchantOfRecord'],
  transport_operator: [],
  customs_broker: [],
  money_handling: ['holdFloat', 'cashOnDelivery'],
  other: [],
};
export const INSURANCE_SUPPORTS: Record<InsuranceKind, PresenceCapability[]> = {
  goods_in_transit: ['claims'],
  claims_provision: ['claims'],
  public_liability: [],
  motor_fleet: [],
  other: [],
};

export class CompanyAddress {
  @ApiProperty() line1: string;
  @ApiPropertyOptional() line2?: string;
  @ApiProperty() city: string;
  @ApiPropertyOptional() region?: string;
  @ApiPropertyOptional() postalCode?: string;
  /** ISO-3166 — a registered address may sit in another country (a branch of a foreign company). */
  @ApiProperty() country: string;
}

export class Representative {
  @ApiProperty() name: string;
  @ApiProperty() role: string;
  @ApiProperty({ enum: SIGNING_AUTHORITIES }) signing: SigningAuthority;
}

export class BeneficialOwner {
  @ApiProperty() name: string;
  /** Percentage held, above zero and at most a hundred; all owners together never exceed a hundred. */
  @ApiProperty() sharePct: number;
  @ApiPropertyOptional() nationality?: string;
}

export class TaxRegistration {
  @ApiProperty({ enum: TAX_KINDS }) kind: TaxKind;
  @ApiProperty() number: string;
  @ApiPropertyOptional() authority?: string;
}

export class BankAccount {
  @ApiProperty() bankName: string;
  @ApiProperty() accountName: string;
  @ApiProperty() accountNumber: string;
  @ApiProperty() currency: string;
  @ApiProperty({ enum: BANK_PURPOSES }) purpose: BankPurpose;
}

export class CompanyLicence {
  @ApiProperty({ enum: LICENCE_KINDS }) kind: LicenceKind;
  @ApiProperty() number: string;
  @ApiProperty() issuer: string;
  /** YYYY-MM-DD. A licence with no expiry is not accepted: the watch cannot guard what it cannot date. */
  @ApiProperty() expiresAt: string;
  @ApiProperty({ enum: PRESENCE_CAPABILITIES, isArray: true }) supports: PresenceCapability[];
}

export class InsurancePolicy {
  @ApiProperty({ enum: INSURANCE_KINDS }) kind: InsuranceKind;
  @ApiProperty() insurer: string;
  @ApiProperty() policyNumber: string;
  @ApiPropertyOptional() coverAmount?: number;
  @ApiPropertyOptional() currency?: string;
  @ApiProperty() expiresAt: string;
  @ApiProperty({ enum: PRESENCE_CAPABILITIES, isArray: true }) supports: PresenceCapability[];
}

/** CA8 — a local obligation met: which one (the catalogue's key) and the reference it was met under. */
export class ObligationRecord {
  @ApiProperty() key: string;
  @ApiProperty() reference: string;
  @ApiPropertyOptional() registeredAt?: string;
}

export class CompanyRecord {
  @ApiPropertyOptional() legalName?: string;
  @ApiPropertyOptional() tradingName?: string;
  @ApiPropertyOptional({ enum: LEGAL_FORMS }) legalForm?: LegalForm;
  @ApiPropertyOptional() registrationNumber?: string;
  @ApiPropertyOptional() registrationDate?: string;
  @ApiPropertyOptional() registeredAddress?: CompanyAddress;
  @ApiPropertyOptional() operatingAddress?: CompanyAddress;
  @ApiProperty({ type: [Representative] }) representatives: Representative[];
  @ApiProperty({ type: [BeneficialOwner] }) beneficialOwners: BeneficialOwner[];
  @ApiProperty({ type: [TaxRegistration] }) taxRegistrations: TaxRegistration[];
  @ApiProperty({ type: [BankAccount] }) bankAccounts: BankAccount[];
  @ApiProperty({ type: [CompanyLicence] }) licences: CompanyLicence[];
  @ApiProperty({ type: [InsurancePolicy] }) insurance: InsurancePolicy[];
  @ApiProperty({ type: [ObligationRecord] }) obligations: ObligationRecord[];
}

export function emptyRecord(): CompanyRecord {
  return { representatives: [], beneficialOwners: [], taxRegistrations: [], bankAccounts: [], licences: [], insurance: [], obligations: [] };
}

/* ------------------------------------------------------------------ validation -- */

const fail = (message: string): never => {
  throw new GlosError('VALIDATION_FAILED', message);
};
const text = (value: unknown, what: string, required = true): string | undefined => {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s && required) fail(`${what} is required`);
  return s || undefined;
};
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], what: string): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${what} must be one of: ${allowed.join(', ')}`);
  return value as T;
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const date = (value: unknown, what: string, required = true): string | undefined => {
  const s = text(value, what, required);
  if (!s) return undefined;
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) fail(`${what} must be a date written YYYY-MM-DD`);
  return s;
};
const list = (value: unknown, what: string): Record<string, unknown>[] => {
  if (!Array.isArray(value)) fail(`${what} must be a list`);
  return (value as unknown[]).map((item, i) => {
    if (!item || typeof item !== 'object') fail(`${what} ${i + 1} is not a record`);
    return item as Record<string, unknown>;
  });
};
const supportsOf = (value: unknown, fallback: PresenceCapability[], what: string): PresenceCapability[] => {
  if (value == null) return [...fallback];
  if (!Array.isArray(value)) fail(`${what} must be a list of capabilities`);
  return [...new Set((value as unknown[]).map((c) => oneOf(c, PRESENCE_CAPABILITIES, what)))];
};

function address(value: unknown, what: string, home: string): CompanyAddress {
  if (!value || typeof value !== 'object') return fail(`${what} is not an address`);
  const a = value as Record<string, unknown>;
  const country = (text(a.country, `${what} country`, false) ?? home).toUpperCase();
  if (!catalogueEntry(country)) fail(`${what}: ${country} is not a country in the catalogue`);
  return {
    line1: text(a.line1, `${what} first line`)!,
    ...(text(a.line2, '', false) ? { line2: text(a.line2, '', false) } : {}),
    city: text(a.city, `${what} city`)!,
    ...(text(a.region, '', false) ? { region: text(a.region, '', false) } : {}),
    ...(text(a.postalCode, '', false) ? { postalCode: text(a.postalCode, '', false) } : {}),
    country,
  };
}

/**
 * Check and tidy the sections a caller sent. Each section given REPLACES the one on record — a record is edited
 * the way a form is saved, and a partial merge of lists is how a deleted representative quietly survives.
 */
export function normaliseRecordPatch(patch: Record<string, unknown>, home: { jurisdiction: string }): Partial<CompanyRecord> {
  const out: Partial<CompanyRecord> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined;

  if (has('legalName')) out.legalName = text(patch.legalName, 'Legal name');
  if (has('tradingName')) out.tradingName = text(patch.tradingName, 'Trading name', false);
  if (has('legalForm')) out.legalForm = oneOf(patch.legalForm, LEGAL_FORMS, 'Legal form');
  if (has('registrationNumber')) out.registrationNumber = text(patch.registrationNumber, 'Registration number');
  if (has('registrationDate')) out.registrationDate = date(patch.registrationDate, 'Registration date');
  if (has('registeredAddress')) out.registeredAddress = address(patch.registeredAddress, 'Registered address', home.jurisdiction);
  if (has('operatingAddress')) out.operatingAddress = address(patch.operatingAddress, 'Operating address', home.jurisdiction);

  if (has('representatives')) {
    out.representatives = list(patch.representatives, 'Representative').map((r, i) => ({
      name: text(r.name, `Representative ${i + 1} name`)!,
      role: text(r.role, `Representative ${i + 1} role`)!,
      signing: oneOf(r.signing, SIGNING_AUTHORITIES, `Representative ${i + 1} signing authority`),
    }));
  }
  if (has('beneficialOwners')) {
    out.beneficialOwners = list(patch.beneficialOwners, 'Beneficial owner').map((o, i) => {
      const share = Number(o.sharePct);
      if (!Number.isFinite(share) || share <= 0 || share > 100) fail(`Beneficial owner ${i + 1} must hold more than 0% and at most 100%`);
      return { name: text(o.name, `Beneficial owner ${i + 1} name`)!, sharePct: Math.round(share * 100) / 100, ...(text(o.nationality, '', false) ? { nationality: text(o.nationality, '', false)!.toUpperCase() } : {}) };
    });
    const total = out.beneficialOwners.reduce((s, o) => s + o.sharePct, 0);
    if (total > 100.0001) fail(`The owners together hold ${Math.round(total * 100) / 100}% — no company is owned more than once`);
  }
  if (has('taxRegistrations')) {
    const seen = new Set<string>();
    out.taxRegistrations = list(patch.taxRegistrations, 'Tax registration').map((t, i) => {
      const reg = { kind: oneOf(t.kind, TAX_KINDS, `Tax registration ${i + 1} kind`), number: text(t.number, `Tax registration ${i + 1} number`)!, ...(text(t.authority, '', false) ? { authority: text(t.authority, '', false) } : {}) };
      const key = `${reg.kind}:${reg.number.toUpperCase()}`;
      if (seen.has(key)) fail(`Tax registration ${reg.number} is listed twice`);
      seen.add(key);
      return reg;
    });
  }
  if (has('bankAccounts')) {
    out.bankAccounts = list(patch.bankAccounts, 'Bank account').map((b, i) => {
      const currency = text(b.currency, `Bank account ${i + 1} currency`)!.toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) fail(`Bank account ${i + 1} currency must be a three-letter code`);
      return {
        bankName: text(b.bankName, `Bank account ${i + 1} bank`)!,
        accountName: text(b.accountName, `Bank account ${i + 1} account name`)!,
        accountNumber: text(b.accountNumber, `Bank account ${i + 1} number`)!,
        currency,
        purpose: b.purpose == null ? 'general' : oneOf(b.purpose, BANK_PURPOSES, `Bank account ${i + 1} purpose`),
      };
    });
  }
  if (has('licences')) {
    out.licences = list(patch.licences, 'Licence').map((l, i) => {
      const kind = oneOf(l.kind, LICENCE_KINDS, `Licence ${i + 1} kind`);
      return {
        kind,
        number: text(l.number, `Licence ${i + 1} number`)!,
        issuer: text(l.issuer, `Licence ${i + 1} issuer`)!,
        expiresAt: date(l.expiresAt, `Licence ${i + 1} expiry`)!,
        supports: supportsOf(l.supports, LICENCE_SUPPORTS[kind], `Licence ${i + 1} supports`),
      };
    });
  }
  if (has('insurance')) {
    out.insurance = list(patch.insurance, 'Insurance policy').map((p, i) => {
      const kind = oneOf(p.kind, INSURANCE_KINDS, `Insurance policy ${i + 1} kind`);
      const cover = p.coverAmount == null || p.coverAmount === '' ? undefined : Number(p.coverAmount);
      if (cover !== undefined && (!Number.isFinite(cover) || cover < 0)) fail(`Insurance policy ${i + 1} cover must be a positive amount`);
      return {
        kind,
        insurer: text(p.insurer, `Insurance policy ${i + 1} insurer`)!,
        policyNumber: text(p.policyNumber, `Insurance policy ${i + 1} number`)!,
        ...(cover !== undefined ? { coverAmount: cover } : {}),
        ...(text(p.currency, '', false) ? { currency: text(p.currency, '', false)!.toUpperCase() } : {}),
        expiresAt: date(p.expiresAt, `Insurance policy ${i + 1} expiry`)!,
        supports: supportsOf(p.supports, INSURANCE_SUPPORTS[kind], `Insurance policy ${i + 1} supports`),
      };
    });
  }
  if (has('obligations')) {
    out.obligations = list(patch.obligations, 'Obligation').map((o, i) => ({
      key: text(o.key, `Obligation ${i + 1}`)!,
      reference: text(o.reference, `Obligation ${i + 1} reference`)!,
      ...(date(o.registeredAt, '', false) ? { registeredAt: date(o.registeredAt, '', false) } : {}),
    }));
  }
  return out;
}

/* --------------------------------------------------------------- CA5: expiry -- */

/** The day a licence or policy stops counting: it is good THROUGH its expiry date, gone the day after. */
export function lapsesAt(expiresAt: string): number {
  return Date.parse(`${expiresAt}T00:00:00Z`) + 86_400_000;
}

/** Every licence and policy on a record, with what it supports and when it lapses. */
export function datedItemsOf(record: CompanyRecord | undefined): Array<{ source: 'licence' | 'insurance'; kind: string; reference: string; expiresAt: string; supports: PresenceCapability[] }> {
  if (!record) return [];
  return [
    ...record.licences.map((l) => ({ source: 'licence' as const, kind: l.kind, reference: l.number, expiresAt: l.expiresAt, supports: l.supports })),
    ...record.insurance.map((p) => ({ source: 'insurance' as const, kind: p.kind, reference: p.policyNumber, expiresAt: p.expiresAt, supports: p.supports })),
  ];
}

/** What a company's lapsed licences and policies switch off, each naming the document that did it. */
export function lapsesOf(entityId: string, record: CompanyRecord | undefined, now: number): CapabilityLapse[] {
  const lapses: CapabilityLapse[] = [];
  for (const item of datedItemsOf(record)) {
    if (lapsesAt(item.expiresAt) > now) continue;
    for (const capability of item.supports) {
      lapses.push({ capability, entityId, source: item.source, kind: item.kind, reference: item.reference, expiredAt: item.expiresAt });
    }
  }
  return lapses;
}
