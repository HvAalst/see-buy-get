import { Injectable, Optional } from '@nestjs/common';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { DocumentsService } from '../../foundation/documents/documents.service';
import type { DocumentVersion } from '../../foundation/documents/documents.types';
import { CompanyReadinessService } from '../../foundation/entity/company-readiness.service';
import type { CompanyAddress } from '../../foundation/entity/company-record.types';
import { EntityService } from '../../foundation/entity/entity.service';
import type { Entity } from '../../foundation/entity/entity.types';

/**
 * A COMPANY OF OURS IN A COUNTRY, AND THE TERMS THAT NAME IT (the user, 2026-10-25, to the recommendation "when a
 * company is set up in a country, staff publish that country's own terms naming the company; everyone there is told in
 * the bell and agrees on their next opening; their records move to that company at the same time": "yes").
 *
 * - Switching a company of ours on waits for the country's terms of use naming it: one more line on the company's
 *   readiness, so the same two-person approval that switches it on refuses until they are written.
 * - Those terms are published BY that approval, never before it: nobody is asked to agree to a company that is not
 *   switched on yet. Publishing them on their own is refused while the company they name is a draft.
 * - The records follow by themselves. A shop, hub, store, fleet or courier that signed up while no company of ours was
 *   there stored none, and is read through the country's company from the moment it is switched on (entityIdOrNone).
 */
@Injectable()
export class CountryTermsService {
  constructor(
    private readonly documents: DocumentsService,
    private readonly entities: EntityService,
    @Optional() readiness?: CompanyReadinessService,
  ) {
    readiness?.also((entity) => {
      if (entity.kind !== 'sister' || !entity.jurisdiction) return [];
      const country = catalogueEntry(entity.jurisdiction)?.name ?? entity.jurisdiction;
      const current = this.documents.currentOrNone('terms', entity.jurisdiction);
      const met = Boolean((current && this.names(current.body, entity)) || this.waitingFor(entity.jurisdiction));
      return [
        {
          key: 'country_terms',
          met,
          label: `Its terms of use for ${country}, naming it, written under Terms and notices by one of you: they are published by the approval that switches it on, and everybody in ${country} is asked to agree to them`,
        },
      ];
    });
  }

  /** What people are told the company is called: its legal name where its record has one, else its name here. */
  nameOf(entity: Entity): string {
    return this.entities.recordOf(entity.entityId).legalName?.trim() || entity.name;
  }

  /** The names a text may call this company by: its name here, its legal name, its trading name. */
  namesOf(entity: Entity): string[] {
    const record = this.entities.recordOf(entity.entityId);
    return [entity.name, record.legalName, record.tradingName].map((n) => (n ?? '').trim()).filter((n) => n.length >= 3);
  }

  /** Does this text name the company — by any of its names, whatever their case. */
  names(text: string, entity: Entity): boolean {
    const haystack = text.toLowerCase();
    return this.namesOf(entity).some((name) => haystack.includes(name.toLowerCase()));
  }

  /** The country's terms of use waiting to be published that name its company of ours (draft or active), if any. */
  waitingFor(jurisdiction: string): { version: DocumentVersion; company: Entity } | undefined {
    const company = this.entities.sisterRecordFor(jurisdiction);
    const pending = company ? this.documents.pending('terms', jurisdiction) : undefined;
    return company && pending && this.names(pending.body, company) ? { version: pending, company } : undefined;
  }

  /**
   * HELD FOR THE SWITCH-ON: a version of a country's terms naming a company of ours that is still a draft. Published by
   * the approval that switches it on — the company it names, when it is. Undefined for anything else.
   */
  heldFor(version: DocumentVersion): Entity | undefined {
    if (version.kind !== 'terms' || !version.country || version.status !== 'proposed') return undefined;
    const company = this.entities.sisterRecordFor(version.country);
    return company && company.status === 'draft' && this.names(version.body, company) ? company : undefined;
  }

  /**
   * A FIRST TEXT TO WRITE FROM — the country's terms naming its company, from the company's own record: who people
   * there agree with, and that it adds to the general terms. Nothing it does not know is said; staff and the lawyer
   * write the rest. Undefined where the country has no company of ours on record.
   */
  draft(jurisdiction: string): { title: string; body: string; changeNote: string; company: string } | undefined {
    const company = this.entities.sisterRecordFor(jurisdiction);
    if (!company) return undefined;
    const record = this.entities.recordOf(company.entityId);
    const country = catalogueEntry(jurisdiction)?.name ?? jurisdiction;
    const name = this.nameOf(company);
    const registered = [record.registrationNumber ? `registered under number ${record.registrationNumber}` : '', record.registeredAddress ? `at ${addressLine(record.registeredAddress)}` : '']
      .filter(Boolean)
      .join(', ');
    return {
      title: `Terms of use — ${country}`,
      body: [
        `## Who you agree with in ${country}`,
        '',
        `- In ${country}, you agree with ${name}${registered ? `, ${registered}` : ''}. It is SeeBuyGet’s company in ${country}: from the day it is switched on, it is the company you work with there.`,
        `- These terms add to SeeBuyGet’s general terms of use and do not replace them. Where the two say different things about the same matter, these apply in ${country}.`,
      ].join('\n'),
      changeNote: `${name} runs SeeBuyGet in ${country} from today: it is the company you agree with there.`,
      company: name,
    };
  }
}

function addressLine(a: CompanyAddress): string {
  return [a.line1, a.line2, a.city, a.region, a.postalCode, catalogueEntry(a.country)?.name ?? a.country].map((x) => (x ?? '').trim()).filter(Boolean).join(', ');
}
