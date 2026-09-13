import type { MessageKey } from '../../shared/i18n';
import { PRESENCE_CAPABILITIES, samePerson, type CatalogueCountry, type PresenceCapability } from './presence';
import type { EntityRow } from './money';

/**
 * CA3–CA8 — A COMPANY, RECORDED PROPERLY, as the console reads and edits it.
 *
 * The server checks every field and decides readiness; this file only shapes what the screen shows and says what
 * the screen refuses before the server has to — above all, that the person who uploaded a paper may not verify it.
 */

export const LEGAL_FORMS = ['private_limited', 'public_limited', 'branch_of_foreign_company', 'partnership', 'sole_proprietorship', 'cooperative', 'other'] as const;
export const SIGNING_AUTHORITIES = ['alone', 'jointly', 'none'] as const;
export const TAX_KINDS = ['vat', 'corporate_income', 'withholding', 'payroll', 'customs', 'other'] as const;
export const BANK_PURPOSES = ['payouts', 'collections', 'general'] as const;
export const LICENCE_KINDS = ['courier', 'postal', 'transport_operator', 'customs_broker', 'money_handling', 'other'] as const;
export const INSURANCE_KINDS = ['goods_in_transit', 'claims_provision', 'public_liability', 'motor_fleet', 'other'] as const;
export const DOCUMENT_KINDS = [
  'certificate_of_incorporation',
  'memorandum_and_articles',
  'tax_registration_certificate',
  'bank_confirmation',
  'licence',
  'insurance_policy',
  'representative_id',
  'beneficial_ownership',
  'obligation_registration',
  'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface CompanyAddress {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  country: string;
}

export interface CompanyRecord {
  legalName?: string;
  tradingName?: string;
  legalForm?: string;
  registrationNumber?: string;
  registrationDate?: string;
  registeredAddress?: CompanyAddress;
  operatingAddress?: CompanyAddress;
  representatives: Array<{ name: string; role: string; signing: string }>;
  beneficialOwners: Array<{ name: string; sharePct: number; nationality?: string }>;
  taxRegistrations: Array<{ kind: string; number: string; authority?: string }>;
  bankAccounts: Array<{ bankName: string; accountName: string; accountNumber: string; currency: string; purpose: string }>;
  licences: Array<{ kind: string; number: string; issuer: string; expiresAt: string; supports: PresenceCapability[] }>;
  insurance: Array<{ kind: string; insurer: string; policyNumber: string; coverAmount?: number; currency?: string; expiresAt: string; supports: PresenceCapability[] }>;
  obligations: Array<{ key: string; reference: string; registeredAt?: string }>;
}

export interface ReadinessItem {
  key: string;
  met: boolean;
  label: string;
}

export interface CompanyDocument {
  documentId: string;
  entityId: string;
  kind: DocumentKind;
  title: string;
  relatesTo?: string;
  version: number;
  fingerprint: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
  expiresAt?: string;
  status: 'awaiting_verification' | 'verified' | 'rejected' | 'superseded';
  verifiedBy?: string;
  verifiedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  supersededBy?: string;
}

export interface LocalObligation {
  key: string;
  name: string;
  authority?: string;
}

export interface CapabilityLapse {
  capability: PresenceCapability;
  entityId: string;
  source: 'licence' | 'insurance';
  kind: string;
  reference: string;
  expiredAt: string;
}

export interface CompanyChange {
  at: string;
  by: string;
  what: string;
  from: string;
  to: string;
}

/** `GET /entities/:id/record`. */
export interface CompanyRecordView {
  entity: { entityId: string; name: string; kind: 'group' | 'sister' | 'partner'; jurisdiction?: string; currency?: string; status: 'draft' | 'active' };
  record: CompanyRecord;
  readiness: { entityId: string; ready: boolean; items: ReadinessItem[] } | null;
  documents: CompanyDocument[];
  obligations: LocalObligation[];
  lapses: CapabilityLapse[];
  changes: CompanyChange[];
}

/** `GET /companies/expiring`. */
export interface ExpiringItem {
  entityId: string;
  name: string;
  jurisdiction?: string;
  source: 'licence' | 'insurance';
  kind: string;
  reference: string;
  expiresAt: string;
  supports: PresenceCapability[];
  lapsed: boolean;
  daysLeft: number;
}

/* ------------------------------------------------------------------ labels -- */

export const LEGAL_FORM_LABEL: Record<(typeof LEGAL_FORMS)[number], MessageKey> = {
  private_limited: 'tower.company.legalForm.private_limited',
  public_limited: 'tower.company.legalForm.public_limited',
  branch_of_foreign_company: 'tower.company.legalForm.branch_of_foreign_company',
  partnership: 'tower.company.legalForm.partnership',
  sole_proprietorship: 'tower.company.legalForm.sole_proprietorship',
  cooperative: 'tower.company.legalForm.cooperative',
  other: 'tower.company.legalForm.other',
};
export const SIGNING_LABEL: Record<(typeof SIGNING_AUTHORITIES)[number], MessageKey> = {
  alone: 'tower.company.signing.alone',
  jointly: 'tower.company.signing.jointly',
  none: 'tower.company.signing.none',
};
export const TAX_LABEL: Record<(typeof TAX_KINDS)[number], MessageKey> = {
  vat: 'tower.company.tax.vat',
  corporate_income: 'tower.company.tax.corporate_income',
  withholding: 'tower.company.tax.withholding',
  payroll: 'tower.company.tax.payroll',
  customs: 'tower.company.tax.customs',
  other: 'tower.company.tax.other',
};
export const PURPOSE_LABEL: Record<(typeof BANK_PURPOSES)[number], MessageKey> = {
  payouts: 'tower.company.purpose.payouts',
  collections: 'tower.company.purpose.collections',
  general: 'tower.company.purpose.general',
};
export const LICENCE_LABEL: Record<(typeof LICENCE_KINDS)[number], MessageKey> = {
  courier: 'tower.company.licence.courier',
  postal: 'tower.company.licence.postal',
  transport_operator: 'tower.company.licence.transport_operator',
  customs_broker: 'tower.company.licence.customs_broker',
  money_handling: 'tower.company.licence.money_handling',
  other: 'tower.company.licence.other',
};
export const INSURANCE_LABEL: Record<(typeof INSURANCE_KINDS)[number], MessageKey> = {
  goods_in_transit: 'tower.company.insurance.goods_in_transit',
  claims_provision: 'tower.company.insurance.claims_provision',
  public_liability: 'tower.company.insurance.public_liability',
  motor_fleet: 'tower.company.insurance.motor_fleet',
  other: 'tower.company.insurance.other',
};
export const DOCUMENT_LABEL: Record<DocumentKind, MessageKey> = {
  certificate_of_incorporation: 'tower.company.docKind.certificate_of_incorporation',
  memorandum_and_articles: 'tower.company.docKind.memorandum_and_articles',
  tax_registration_certificate: 'tower.company.docKind.tax_registration_certificate',
  bank_confirmation: 'tower.company.docKind.bank_confirmation',
  licence: 'tower.company.docKind.licence',
  insurance_policy: 'tower.company.docKind.insurance_policy',
  representative_id: 'tower.company.docKind.representative_id',
  beneficial_ownership: 'tower.company.docKind.beneficial_ownership',
  obligation_registration: 'tower.company.docKind.obligation_registration',
  other: 'tower.company.docKind.other',
};

const options = <T extends string>(values: readonly T[], labels: Record<T, MessageKey>) => values.map((value) => ({ value, labelKey: labels[value] }));

/* ------------------------------------------------------------ list sections -- */

/** One column of a list section — what the row editor draws, and how the value is sent back. */
export interface FieldSpec {
  key: string;
  labelKey: MessageKey;
  type: 'text' | 'number' | 'date' | 'select' | 'caps';
  options?: Array<{ value: string; labelKey: MessageKey }>;
}

export type ListSection = 'representatives' | 'beneficialOwners' | 'taxRegistrations' | 'bankAccounts' | 'licences' | 'insurance';

export const SECTION_FIELDS: Record<ListSection, FieldSpec[]> = {
  representatives: [
    { key: 'name', labelKey: 'tower.company.f.name', type: 'text' },
    { key: 'role', labelKey: 'tower.company.f.role', type: 'text' },
    { key: 'signing', labelKey: 'tower.company.f.signing', type: 'select', options: options(SIGNING_AUTHORITIES, SIGNING_LABEL) },
  ],
  beneficialOwners: [
    { key: 'name', labelKey: 'tower.company.f.name', type: 'text' },
    { key: 'sharePct', labelKey: 'tower.company.f.sharePct', type: 'number' },
    { key: 'nationality', labelKey: 'tower.company.f.nationality', type: 'text' },
  ],
  taxRegistrations: [
    { key: 'kind', labelKey: 'tower.company.f.taxKind', type: 'select', options: options(TAX_KINDS, TAX_LABEL) },
    { key: 'number', labelKey: 'tower.company.f.number', type: 'text' },
    { key: 'authority', labelKey: 'tower.company.f.authority', type: 'text' },
  ],
  bankAccounts: [
    { key: 'bankName', labelKey: 'tower.company.f.bankName', type: 'text' },
    { key: 'accountName', labelKey: 'tower.company.f.accountName', type: 'text' },
    { key: 'accountNumber', labelKey: 'tower.company.f.accountNumber', type: 'text' },
    { key: 'currency', labelKey: 'tower.company.f.currency', type: 'text' },
    { key: 'purpose', labelKey: 'tower.company.f.purpose', type: 'select', options: options(BANK_PURPOSES, PURPOSE_LABEL) },
  ],
  licences: [
    { key: 'kind', labelKey: 'tower.company.f.licenceKind', type: 'select', options: options(LICENCE_KINDS, LICENCE_LABEL) },
    { key: 'number', labelKey: 'tower.company.f.number', type: 'text' },
    { key: 'issuer', labelKey: 'tower.company.f.issuer', type: 'text' },
    { key: 'expiresAt', labelKey: 'tower.company.f.expiresAt', type: 'date' },
    { key: 'supports', labelKey: 'tower.company.f.supports', type: 'caps' },
  ],
  insurance: [
    { key: 'kind', labelKey: 'tower.company.f.insuranceKind', type: 'select', options: options(INSURANCE_KINDS, INSURANCE_LABEL) },
    { key: 'insurer', labelKey: 'tower.company.f.insurer', type: 'text' },
    { key: 'policyNumber', labelKey: 'tower.company.f.policyNumber', type: 'text' },
    { key: 'coverAmount', labelKey: 'tower.company.f.coverAmount', type: 'number' },
    { key: 'expiresAt', labelKey: 'tower.company.f.expiresAt', type: 'date' },
    { key: 'supports', labelKey: 'tower.company.f.supports', type: 'caps' },
  ],
};

export const SECTION_TITLE: Record<ListSection, MessageKey> = {
  representatives: 'tower.company.s.representatives',
  beneficialOwners: 'tower.company.s.owners',
  taxRegistrations: 'tower.company.s.tax',
  bankAccounts: 'tower.company.s.bank',
  licences: 'tower.company.s.licences',
  insurance: 'tower.company.s.insurance',
};

/** A row being edited is all strings (and a capability list); that is what inputs hold. */
export type EditRow = Record<string, string | PresenceCapability[]>;

export function emptyRow(fields: FieldSpec[]): EditRow {
  const row: EditRow = {};
  for (const f of fields) row[f.key] = f.type === 'caps' ? [] : f.type === 'select' ? (f.options?.[0]?.value ?? '') : '';
  return row;
}

/** Rows from the record into editable strings. */
export function toEditRows(section: ListSection, record: CompanyRecord): EditRow[] {
  return (record[section] as Array<Record<string, unknown>>).map((item) => {
    const row: EditRow = {};
    for (const f of SECTION_FIELDS[section]) {
      const v = item[f.key];
      row[f.key] = f.type === 'caps' ? ((Array.isArray(v) ? v : []) as PresenceCapability[]) : v == null ? '' : String(v);
    }
    return row;
  });
}

/**
 * Rows back into what the server reads. Empty optional fields are left out rather than sent as '' — the server
 * treats a missing field as "not given", and an empty string as a value somebody typed. A licence or policy whose
 * "permits" was never touched is sent WITHOUT it, so the server applies what that kind of paper permits by default.
 */
export function fromEditRows(section: ListSection, rows: EditRow[], touchedCaps: boolean[] = []): Array<Record<string, unknown>> {
  return rows.map((row, i) => {
    const out: Record<string, unknown> = {};
    for (const f of SECTION_FIELDS[section]) {
      const v = row[f.key];
      if (f.type === 'caps') {
        if (touchedCaps[i]) out[f.key] = v;
        continue;
      }
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s) continue;
      out[f.key] = f.type === 'number' ? Number(s) : s;
    }
    return out;
  });
}

/* ------------------------------------------------------------------ rules -- */

/** How much of the checklist is done — said as a count, never a percentage that implies the items weigh the same. */
export function readinessCounts(readiness: CompanyRecordView['readiness']): { met: number; total: number } {
  const items = readiness?.items ?? [];
  return { met: items.filter((i) => i.met).length, total: items.length };
}

/** CA4 — may this person verify this paper? Never the uploader: two people, as for switching a country on. */
export function documentBlocker(document: CompanyDocument, who: string | undefined): MessageKey | null {
  if (document.status !== 'awaiting_verification') return 'tower.company.doc.notAwaiting';
  if (!who?.trim()) return 'tower.company.doc.needName';
  if (samePerson(who, document.uploadedBy)) return 'tower.company.doc.ownUpload';
  return null;
}

/** The fingerprint as a reader compares it: grouped, and long enough to be worth comparing. */
export function shortFingerprint(fingerprint: string): string {
  return (fingerprint.slice(0, 16).match(/.{1,4}/g) ?? []).join(' ') + '…';
}

/** Which kinds of paper are FOR one particular licence, policy or obligation. */
export function needsRelatesTo(kind: string): boolean {
  return kind === 'licence' || kind === 'insurance_policy' || kind === 'obligation_registration';
}

/** The choices a paper of this kind can be for: the recorded licence numbers, policy numbers or the country's obligations. */
export function relatesToChoices(kind: string, record: CompanyRecord, obligations: LocalObligation[]): Array<{ value: string; label: string }> {
  if (kind === 'licence') return record.licences.map((l) => ({ value: l.number, label: l.number }));
  if (kind === 'insurance_policy') return record.insurance.map((p) => ({ value: p.policyNumber, label: p.policyNumber }));
  if (kind === 'obligation_registration') return obligations.map((o) => ({ value: o.key, label: o.name }));
  return [];
}

/** What stops a paper being put on record — said before the upload is attempted. */
export function uploadBlocker(form: { kind: string; relatesTo: string; title: string; dataUrl: string }): MessageKey | null {
  if (!form.title.trim()) return 'tower.company.doc.needTitle';
  if (needsRelatesTo(form.kind) && !form.relatesTo) return 'tower.company.doc.needRelatesTo';
  if (!form.dataUrl) return 'tower.company.doc.needFile';
  return null;
}

/** What stops a draft company being created. One company of ours per country; any number of partners. */
export function companyCreateBlocker(form: { kind: 'sister' | 'partner'; jurisdiction: string; name: string }, catalogue: CatalogueCountry[], companies: EntityRow[]): MessageKey | null {
  if (!form.jurisdiction) return 'tower.company.create.needCountry';
  if (!catalogue.some((c) => c.code === form.jurisdiction)) return 'tower.company.create.needCountry';
  if (!form.name.trim()) return 'tower.company.create.needName';
  if (form.kind === 'sister' && companies.some((c) => c.kind === 'sister' && c.jurisdiction === form.jurisdiction)) return 'tower.company.create.hasSister';
  return null;
}

/** How loudly a lapsing paper should be shown: gone already, or within two weeks. */
export function expiryTone(item: Pick<ExpiringItem, 'lapsed' | 'daysLeft'>): 'bad' | 'warn' | 'quiet' {
  if (item.lapsed) return 'bad';
  return item.daysLeft <= 14 ? 'warn' : 'quiet';
}

export { PRESENCE_CAPABILITIES };
