import { catalogueEntry } from '../countries/catalogue';
import type { CompanyDocumentService } from './company-documents.service';
import type { EntityService } from './entity.service';

/** A tiny but real PDF as a data URL. The label makes each file's bytes — and so its fingerprint — distinct. */
export const pdfDataUrl = (label: string): string => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`).toString('base64')}`;

/**
 * Put together everything a company needs before it may be switched on: a complete record, and every paper verified
 * by a second person. Amina enters and uploads; Brian verifies — two people, as the rule requires.
 */
export function makeCompanyReady(entities: EntityService, documents: CompanyDocumentService, entityId: string): void {
  const entity = entities.get(entityId);
  const obligations = catalogueEntry(entity.jurisdiction)?.obligations ?? [];
  entities.updateRecord(
    entityId,
    {
      legalName: `${entity.name} Limited`,
      legalForm: 'private_limited',
      registrationNumber: `REG-${entityId}`,
      registeredAddress: { line1: '1 Independence Avenue', city: 'Capital', country: entity.jurisdiction },
      representatives: [{ name: 'Grace Director', role: 'Managing director', signing: 'alone' }],
      beneficialOwners: [{ name: 'SeeBuyGet Group', sharePct: 100 }],
      taxRegistrations: [{ kind: 'vat', number: `VAT-${entityId}` }],
      ...(entity.kind === 'sister' ? { bankAccounts: [{ bankName: 'National Bank', accountName: entity.name, accountNumber: '0001', currency: entity.currency, purpose: 'payouts' }] } : {}),
      obligations: obligations.map((o) => ({ key: o.key, reference: `REF-${o.key}` })),
    },
    'Amina',
  );
  const paper = (kind: string, relatesTo?: string) => {
    const document = documents.upload({ entityId, kind, title: kind, dataUrl: pdfDataUrl(`${entityId}:${kind}:${relatesTo ?? ''}`), relatesTo, by: 'Amina' });
    documents.verify(entityId, document.documentId, 'Brian');
  };
  paper('certificate_of_incorporation');
  paper('tax_registration_certificate');
  if (entity.kind === 'sister') paper('bank_confirmation');
  for (const o of obligations) paper('obligation_registration', o.key);
}
