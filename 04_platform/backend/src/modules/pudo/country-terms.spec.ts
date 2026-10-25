import { DocumentsService } from '../../foundation/documents/documents.service';
import type { ReadinessItem } from '../../foundation/entity/company-readiness.service';
import type { Entity } from '../../foundation/entity/entity.types';
import { CountryTermsService } from './country-terms.service';

/**
 * A COMPANY OF OURS AND THE TERMS THAT NAME IT (the user, 2026-10-25: "yes" to — when a company is set up in a country,
 * staff publish that country's own terms naming the company, everyone there is told and agrees, their records move).
 */
describe('a country’s terms naming its company of ours', () => {
  const amina = { name: 'Amina', key: 'operator:amina' };
  const kenya = { entityId: 'ent_ke', kind: 'sister', jurisdiction: 'KE', name: 'SeeBuyGet Kenya', status: 'draft' } as Entity;
  const records: Record<string, Record<string, unknown>> = {
    ent_ke: { legalName: 'SeeBuyGet Kenya Limited', registrationNumber: 'PVT-1', registeredAddress: { line1: '1 Kenyatta Avenue', city: 'Nairobi', country: 'KE' } },
  };

  /** `null`: no company of ours on record in the country. */
  const build = (company: Entity | null = kenya) => {
    const documents = new DocumentsService();
    documents.seed();
    let readiness: ((entity: Entity) => ReadinessItem[]) | undefined;
    const terms = new CountryTermsService(
      documents,
      { sisterRecordFor: (code?: string) => (company && code === company.jurisdiction ? company : undefined), recordOf: (id: string) => records[id] ?? {} } as never,
      { also: (check: (entity: Entity) => ReadinessItem[]) => (readiness = check) } as never,
    );
    const write = (body: string) => documents.propose('terms', { title: 'Terms of use — Kenya', body, changeNote: 'Who you agree with', askAgain: true, country: 'KE' }, amina);
    return { documents, terms, write, readiness: () => readiness!(company ?? kenya)[0] };
  };

  it('is one more line on the company’s readiness: met once terms naming it are written, by any of its names', () => {
    const { terms, write, readiness } = build();
    expect(readiness()).toMatchObject({ key: 'country_terms', met: false });
    expect(readiness().label).toContain('Its terms of use for Kenya, naming it');
    // Terms that do not name it do not count.
    const other = write('In Kenya, the Data Protection Act applies.');
    expect(terms.waitingFor('KE')).toBeUndefined();
    expect(readiness().met).toBe(false);
    expect(other.status).toBe('proposed');
  });

  it('finds the terms waiting for it — whatever case they name it in — and holds them while it is a draft', () => {
    const { terms, write, readiness } = build();
    const version = write('## Who you agree with in Kenya\n\n- In Kenya, you agree with seebuyget kenya limited.');
    expect(terms.waitingFor('KE')?.version.versionId).toBe(version.versionId);
    expect(readiness().met).toBe(true);
    expect(terms.heldFor(version)?.entityId).toBe('ent_ke');
    // Switched on, it is held no longer.
    const { terms: on, write: writeOn } = build({ ...kenya, status: 'active' } as Entity);
    expect(on.heldFor(writeOn('In Kenya, you agree with SeeBuyGet Kenya.'))).toBeUndefined();
  });

  it('writes a first text from the company’s record: who people agree with there, and that it adds to the general terms', () => {
    const { terms } = build();
    const draft = terms.draft('KE')!;
    expect(draft.title).toBe('Terms of use — Kenya');
    expect(draft.body).toContain('In Kenya, you agree with SeeBuyGet Kenya Limited, registered under number PVT-1, at 1 Kenyatta Avenue, Nairobi, Kenya.');
    expect(draft.body).toContain('These terms add to SeeBuyGet’s general terms of use and do not replace them.');
    expect(draft.changeNote).toBe('SeeBuyGet Kenya Limited runs SeeBuyGet in Kenya from today: it is the company you agree with there.');
    expect(terms.nameOf(kenya)).toBe('SeeBuyGet Kenya Limited');
    // Where no company of ours is on record, there is nothing to write from.
    expect(build(null).terms.draft('KE')).toBeUndefined();
  });
});
