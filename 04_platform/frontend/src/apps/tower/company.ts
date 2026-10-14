import type { MessageKey } from '../../shared/i18n';
import { PRESENCE_CAPABILITIES, ownOf, type CatalogueCountry, type PresenceCapability } from './presence';
import type { EntityRow } from './money';
import type { PaperCase } from './paperReports';

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
  // CL2a — the papers an import needs. Most belong to ONE container, which they say by carrying that
  // consignment's code as `relatesTo`.
  'packing_list',
  'commercial_invoice',
  'bill_of_lading',
  'certificate_of_origin',
  'import_permit',
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
  /** `declared`: put on record by a company that keeps its own record. It counts from that moment. */
  status: 'awaiting_verification' | 'verified' | 'rejected' | 'superseded' | 'declared' | 'struck';
  /** `struck`: two members of staff decided, on a report, that it does not count. */
  struckBy?: string;
  struckAt?: string;
  strikeReason?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  supersededBy?: string;
  /** Said by the server to whoever is reading: THEY put this one on record. Absent from a server that predates it. */
  mine?: boolean;
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

/** One change a company made itself to a part of its record that switches something, with the paper it came with. */
export interface CompanyDeclaration {
  declarationId: string;
  entityId: string;
  section: PaperBoundSection;
  change: 'added' | 'changed' | 'removed';
  was?: string;
  now?: string;
  wasWords: string;
  nowWords: string;
  documentId?: string;
  by: string;
  at: string;
}

/** `GET /entities/:id/record`. */
export interface CompanyRecordView {
  entity: { entityId: string; name: string; kind: 'group' | 'sister' | 'partner'; jurisdiction?: string; currency?: string; status: 'draft' | 'active' };
  /** Who keeps this record: network staff until the company is switched on, the company itself from then. */
  keeper?: 'staff' | 'company';
  record: CompanyRecord;
  declarations?: CompanyDeclaration[];
  /** What has been said against its papers, and what was decided. For the company: what was said, never by whom. */
  reports?: PaperCase[];
  readiness: { entityId: string; ready: boolean; items: ReadinessItem[] } | null;
  documents: CompanyDocument[];
  obligations: LocalObligation[];
  lapses: CapabilityLapse[];
  /** CA5 — this company's licences and policies that are running out, with what its administrators were told. */
  expiring?: ExpiringItem[];
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
  /**
   * What the company's administrators were last told about this paper: at which mark (days before it runs out, or
   * 'lapsed'), when, and to how many of how many. `nobody`: there was no administrator to tell. Absent: nothing said yet.
   */
  told?: { stage: number | 'lapsed'; at: string; to: number; of: number; nobody?: boolean };
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
  packing_list: 'tower.company.docKind.packing_list',
  commercial_invoice: 'tower.company.docKind.commercial_invoice',
  bill_of_lading: 'tower.company.docKind.bill_of_lading',
  certificate_of_origin: 'tower.company.docKind.certificate_of_origin',
  import_permit: 'tower.company.docKind.import_permit',
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

/* ------------------------------------------- a company that keeps its own record -- */

/** The parts of a record that change only together with their paper — the server's list, said once for the screen. */
export const PAPER_BOUND = ['licences', 'insurance', 'bankAccounts', 'representatives'] as const;
export type PaperBoundSection = (typeof PAPER_BOUND)[number];
export const isPaperBound = (section: ListSection): section is PaperBoundSection => (PAPER_BOUND as readonly string[]).includes(section);

/** What each part calls one of its items: the thing a paper is "for". */
export const REFERENCE_FIELD: Record<PaperBoundSection, string> = { licences: 'number', insurance: 'policyNumber', bankAccounts: 'accountNumber', representatives: 'name' };

/** The kinds of paper that stand behind a change to each part. The first is what it is taken to be. */
export const PAPER_KINDS_FOR: Record<PaperBoundSection, DocumentKind[]> = {
  licences: ['licence'],
  insurance: ['insurance_policy'],
  bankAccounts: ['bank_confirmation'],
  representatives: ['representative_id', 'memorandum_and_articles', 'other'],
};

/**
 * WHOSE HANDS A RECORD IS IN, for the person looking at it.
 *
 * Staff keep it until the company is switched on; the company keeps it from then, and staff no longer change it.
 * `mine`: this reader is offered a change. The other reads — every field shown, none offered — because a Save the
 * server refuses is worse than no Save.
 */
export function recordHands(view: Pick<CompanyRecordView, 'keeper'> | null, reader: 'operator' | 'company'): { keeper: 'staff' | 'company'; mine: boolean } {
  const keeper = view?.keeper ?? 'staff';
  return { keeper, mine: keeper === 'staff' ? reader === 'operator' : reader === 'company' };
}

/** What is said over a record, to whoever is reading it: whose it is to change, and how. */
export function recordLede(hands: { keeper: 'staff' | 'company' }, reader: 'operator' | 'company'): MessageKey {
  if (reader === 'operator') return hands.keeper === 'staff' ? 'tower.company.lede' : 'tower.company.ledeTheirs';
  return hands.keeper === 'company' ? 'tower.company.ledeOwn' : 'tower.company.ledeDraft';
}

/** What to do about a paper that is running out, to whoever is reading: it is in the company's hands once it is on. */
export function runningOutHint(hands: { keeper: 'staff' | 'company' }, reader: 'operator' | 'company'): MessageKey {
  if (reader === 'operator') return hands.keeper === 'company' ? 'tower.company.runningOut.staff' : 'tower.company.runningOut.staffDraft';
  return hands.keeper === 'company' ? 'tower.company.runningOut.own' : 'tower.company.runningOut.ownDraft';
}

/**
 * May the company take this off its record? A licence or policy that PERMITS something: never — what switches a
 * capability off is a lapsed paper ON the record, so taking a lapsing one off would keep the company trading.
 */
export function mayTakeOff(section: PaperBoundSection, item: Record<string, unknown>): boolean {
  if (section !== 'licences' && section !== 'insurance') return true;
  return !Array.isArray(item.supports) || item.supports.length === 0;
}

/** The fields the company fills for one item: never what a paper permits, and never the kind of one already on record. */
export function declareFields(section: PaperBoundSection, changing: boolean): FieldSpec[] {
  return SECTION_FIELDS[section].filter((f) => f.type !== 'caps' && !(changing && f.key === 'kind'));
}

/** What stops a change with its paper from being sent — said before the server has to. */
export function declareBlocker(section: PaperBoundSection, row: EditRow, hasPaper: boolean): MessageKey | null {
  const filled = (key: string) => typeof row[key] === 'string' && (row[key] as string).trim() !== '';
  if (!filled(REFERENCE_FIELD[section])) return 'tower.company.declare.needReference';
  if ((section === 'licences' || section === 'insurance') && !filled('expiresAt')) return 'tower.company.declare.needDate';
  if (!hasPaper) return 'tower.company.declare.needPaper';
  return null;
}

/** What is sent: which item it replaces (absent: a new one), the item as typed, and the paper. Never what it permits. */
export function declarationBody(section: PaperBoundSection, was: string | undefined, row: EditRow, paper: { dataUrl: string; kind?: DocumentKind }): Record<string, unknown> {
  const [item] = fromEditRows(section, [row]);
  return { section, ...(was ? { was } : {}), item, paperDataUrl: paper.dataUrl, ...(paper.kind && paper.kind !== PAPER_KINDS_FOR[section][0] ? { paperKind: paper.kind } : {}) };
}

/** One item of a paper-bound part, as two lines a reader recognises. */
export function itemLine(section: PaperBoundSection, item: Record<string, unknown>, t: (key: MessageKey, vars?: Record<string, string | number>) => string): { title: string; detail: string } {
  const s = (key: string) => String(item[key] ?? '');
  if (section === 'licences') return { title: `${t(LICENCE_LABEL[s('kind') as keyof typeof LICENCE_LABEL] ?? 'tower.company.licence.other')} · ${s('number')}`, detail: t('tower.company.declare.goodUntil', { who: s('issuer'), date: s('expiresAt') }) };
  if (section === 'insurance') return { title: `${t(INSURANCE_LABEL[s('kind') as keyof typeof INSURANCE_LABEL] ?? 'tower.company.insurance.other')} · ${s('policyNumber')}`, detail: t('tower.company.declare.goodUntil', { who: s('insurer'), date: s('expiresAt') }) };
  if (section === 'bankAccounts') return { title: `${s('bankName')} · ${s('accountNumber')}`, detail: `${s('accountName')} · ${s('currency')} · ${t(PURPOSE_LABEL[s('purpose') as keyof typeof PURPOSE_LABEL] ?? 'tower.company.purpose.general')}` };
  return { title: s('name'), detail: `${s('role')} · ${t(SIGNING_LABEL[s('signing') as keyof typeof SIGNING_LABEL] ?? 'tower.company.signing.none')}` };
}

/* ------------------------------------------------------------------ rules -- */

/** How much of the checklist is done — said as a count, never a percentage that implies the items weigh the same. */
export function readinessCounts(readiness: CompanyRecordView['readiness']): { met: number; total: number } {
  const items = readiness?.items ?? [];
  return { met: items.filter((i) => i.met).length, total: items.length };
}

/** CA4 — may this person verify this paper? Never the uploader: two people, as for switching a country on. */
export function documentBlocker(document: CompanyDocument, who: string | undefined, named = false): MessageKey | null {
  if (document.status !== 'awaiting_verification') return 'tower.company.doc.notAwaiting';
  if (!who?.trim()) return 'tower.company.doc.needName';
  if (ownOf(document.mine, named, who, document.uploadedBy)) return 'tower.company.doc.ownUpload';
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

/**
 * WHAT THE COMPANY WAS TOLD about a paper that is running out — the line under it, for staff and for the company.
 *
 * The row that matters most is the one where the reminder went NOWHERE: a company with no administrator login hears
 * nothing however often the clock comes round, and only somebody reading this list can know. That one is a warning;
 * the rest are plain facts.
 */
export function toldWords(
  item: Pick<ExpiringItem, 'told'>,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
  when: (iso: string) => string,
): { text: string; tone: 'warn' | 'quiet' } | null {
  const told = item.told;
  if (!told) return null;
  if (told.nobody) return { text: t('tower.companies.told.nobody', { when: when(told.at) }), tone: 'warn' };
  if (told.to === 0) return { text: t('tower.companies.told.notHandedOver', { of: told.of, when: when(told.at) }), tone: 'warn' };
  // Some of them and not all: said as that, because "3 were emailed" hides the two who were not.
  if (told.to < told.of) return { text: t('tower.companies.told.some', { to: told.to, of: told.of, when: when(told.at) }), tone: 'warn' };
  return { text: t(told.to === 1 ? 'tower.companies.told.one' : 'tower.companies.told.many', { to: told.to, when: when(told.at) }), tone: 'quiet' };
}

/**
 * HOW MANY PAPERS NEED THE COMPANY NOW: lapsed, or inside their last two weeks — the ones shown loudly. Null while the
 * list is unread, and null when there are none: this is the number beside a company's own record, which is not a
 * queue and earns a number only when something on it is waiting.
 */
export function papersWaiting(items: ExpiringItem[] | null): number | null {
  if (!items) return null;
  return items.filter((item) => expiryTone(item) !== 'quiet').length || null;
}

/** How loudly a lapsing paper should be shown: gone already, or within two weeks. */
export function expiryTone(item: Pick<ExpiringItem, 'lapsed' | 'daysLeft'>): 'bad' | 'warn' | 'quiet' {
  if (item.lapsed) return 'bad';
  return item.daysLeft <= 14 ? 'warn' : 'quiet';
}

export { PRESENCE_CAPABILITIES };
