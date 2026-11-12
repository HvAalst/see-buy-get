import { Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { catalogueEntry } from '../countries/catalogue';
import { appsSpeak, languageName, mainLanguageOf } from '../countries/app-languages';
import { CompanyDocumentService } from './company-documents.service';
import { lapsesAt } from './company-record.types';
import { EntityService } from './entity.service';
import type { Entity } from './entity.types';

/**
 * CA3 — IS THIS COMPANY READY TO BE SWITCHED ON?
 *
 * Established stays derived, never typed — and it now derives from more than a company existing: the record must
 * be complete, every paper it rests on verified by a second person, every licence and policy in date, and every
 * local obligation met (CA8). Only then may two people approve the country up to Established (or, for a partner,
 * Partnered). Each item is a sentence a person can act on, not a score.
 */
export class ReadinessItem {
  /** Stable key a screen translates: `legal_name`, `doc:certificate_of_incorporation`, `licence:<number>`… */
  @ApiProperty() key: string;
  @ApiProperty() met: boolean;
  /** The English sentence, for a reader without a translation. */
  @ApiProperty() label: string;
}

export class CompanyReadiness {
  @ApiProperty() entityId: string;
  @ApiProperty() ready: boolean;
  @ApiProperty({ type: [ReadinessItem] }) items: ReadinessItem[];
  /**
   * 2026-11-12 — WORTH DOING, NEVER A BLOCK (the owner: "a warning on the company's readiness list rather than a hard block"):
   * what makes the company work as it should once it is on — said before it is switched on and after; never counted in
   * `ready`, never refused at switch-on.
   */
  @ApiProperty({ type: [ReadinessItem] }) warnings: ReadinessItem[];
}

@Injectable()
export class CompanyReadinessService {
  /**
   * WHAT ELSE A COMPANY HAS TO HAVE BEFORE IT IS SWITCHED ON, said by whatever part of the system holds it — its own
   * published entry, for one: where people are sent and when it receives visitors (the user, 2026-10-08: "it's part
   * of the turn on process"). They say so here rather than being imported, so this stays the foundation's.
   */
  private readonly others: Array<(entity: Entity) => ReadinessItem[]> = [];
  /** 2026-11-12 — warnings other parts of the system say: shown, never counted in `ready`. */
  private readonly warns: Array<(entity: Entity) => ReadinessItem[]> = [];

  constructor(
    private readonly entities: EntityService,
    private readonly documents: CompanyDocumentService,
  ) {}

  also(check: (entity: Entity) => ReadinessItem[]): void {
    this.others.push(check);
  }

  /** 2026-11-12 — a warning, said here by whatever part holds it: shown with the list, never stopping a switch-on. */
  alsoWarn(check: (entity: Entity) => ReadinessItem[]): void {
    this.warns.push(check);
  }

  readinessOf(entityId: string, now = Date.now()): CompanyReadiness {
    const entity = this.entities.get(entityId);
    const record = this.entities.recordOf(entityId);
    const items: ReadinessItem[] = [];
    const add = (key: string, met: boolean, label: string) => items.push({ key, met, label });
    const verified = (kind: string, relatesTo?: string) => this.documents.isVerified(entityId, kind, relatesTo);
    const isSister = entity.kind === 'sister';

    add('legal_name', Boolean(record.legalName), 'The legal name, as registered');
    add('legal_form', Boolean(record.legalForm), 'The legal form of the company');
    add('registration_number', Boolean(record.registrationNumber), 'The company registration number');
    add('registered_address', Boolean(record.registeredAddress), 'The registered address');
    const alone = record.representatives.filter((r) => r.signing === 'alone').length;
    const jointly = record.representatives.filter((r) => r.signing === 'jointly').length;
    add('signing_authority', alone >= 1 || jointly >= 2, 'Someone who may sign for the company — alone, or two together');
    add('beneficial_owners', record.beneficialOwners.length > 0, 'Who owns the company');
    add('tax_registration', record.taxRegistrations.length > 0, 'At least one tax registration number');
    if (isSister) {
      add('bank_account', record.bankAccounts.some((b) => b.currency === entity.currency), `A bank account in ${entity.currency ?? 'the company’s currency'}, so suppliers can be paid`);
    }

    add('doc:certificate_of_incorporation', verified('certificate_of_incorporation'), 'The certificate of incorporation, verified by a second person');
    add('doc:tax_registration_certificate', verified('tax_registration_certificate'), 'The tax registration certificate, verified by a second person');
    if (isSister) add('doc:bank_confirmation', verified('bank_confirmation'), 'A letter from the bank confirming the account, verified by a second person');

    for (const licence of record.licences) {
      const inDate = lapsesAt(licence.expiresAt) > now;
      add(`licence:${licence.number}`, inDate && verified('licence', licence.number), `Licence ${licence.number}: in date, and its paper verified by a second person`);
    }
    for (const policy of record.insurance) {
      const inDate = lapsesAt(policy.expiresAt) > now;
      add(`insurance:${policy.policyNumber}`, inDate && verified('insurance_policy', policy.policyNumber), `Policy ${policy.policyNumber}: in date, and its paper verified by a second person`);
    }

    // 2026-11-09 — THE APPS IN THE COUNTRY'S LANGUAGE (the owner: "when we draft a company; the language should be wired in"):
    // its main language, every screen written in it, before a company of ours switches the country on. English is written.
    const language = isSister ? mainLanguageOf(entity.jurisdiction) : undefined;
    if (language && language !== 'en') {
      const country = catalogueEntry(entity.jurisdiction)?.name ?? entity.jurisdiction ?? 'its country';
      add(`language:${language}`, appsSpeak(language), `The apps written in ${languageName(language)}, the main language of ${country}: every screen, so people there use SeeBuyGet in their own language`);
    }

    // CA8 — what the country itself requires of anybody operating there.
    for (const obligation of catalogueEntry(entity.jurisdiction)?.obligations ?? []) {
      const met = record.obligations.some((o) => o.key === obligation.key && o.reference) && verified('obligation_registration', obligation.key);
      add(`obligation:${obligation.key}`, met, `${obligation.name}${obligation.authority ? ` (${obligation.authority})` : ''}: registered, and its paper verified by a second person`);
    }

    for (const check of this.others) items.push(...check(entity));

    // 2026-11-12 — WARNINGS (the owner: weakness 1). A hub's own sort and pass-on fees are capped at a multiple of the
    // country's list figures (D3): figures left at the network's starting numbers — not in the country's money — send every
    // real hub fee to staff for approval.
    const warnings: ReadinessItem[] = [];
    if (isSister) {
      const own = (key: 'mdpSortFee' | 'mdpPassOnFee') => typeof entity.amounts?.[key] === 'number';
      warnings.push({
        key: 'warn:hub_list_figures',
        met: own('mdpSortFee') && own('mdpPassOnFee'),
        label: `A hub's list figures — its fee for each parcel sorted and for each bag passed on — set in ${entity.currency ?? 'the company’s money'} on Rates & tax: a hub's own fees are capped at ${this.entities.hubFeeCeilingFor(entityId)} times them, so the network's starting figures send every real fee to staff for approval`,
      });
    }
    for (const check of this.warns) warnings.push(...check(entity));

    return { entityId, ready: items.every((i) => i.met), items, warnings };
  }
}
