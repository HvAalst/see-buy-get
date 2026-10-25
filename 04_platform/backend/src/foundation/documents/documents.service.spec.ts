import { DocumentsService, SEED_WRITER, normaliseBody } from './documents.service';
import { AgreementService, agreementSubjects } from './agreement.service';
import type { IntrospectionResult } from '../auth/auth.types';

/**
 * WHAT A SIGN-UP AGREES TO, KEPT AS VERSIONS STAFF WRITE (the user, 2026-10-25: "every sign up needs an agreement of
 * terms of use, use of data, storage of data, cookie statement" — "need cms from the staff console and it's usual
 * track of changes timestamped").
 */
describe('the documents a sign-up agrees to', () => {
  let documents: DocumentsService;
  const amina = { name: 'Amina Otieno', key: 'operator:amina' };
  const brian = { name: 'Brian Kamau', key: 'operator:brian' };
  const T0 = Date.UTC(2026, 9, 25, 9, 0, 0);

  beforeEach(() => {
    documents = new DocumentsService();
    documents.seed(T0);
  });

  const propose = (over: Partial<{ title: string; body: string; changeNote: string; askAgain: boolean }> = {}, who = amina, at = T0 + 60_000) =>
    documents.propose('terms', { title: 'Terms of use', body: `${documents.current('terms').body}\n\n## Something new\n\n- A new line.`, changeNote: 'A new section', askAgain: true, ...over }, who, at);

  describe('the first versions, inserted with the system', () => {
    it('inserts version 1 of each document, published and said to be inserted rather than written', () => {
      for (const kind of ['terms', 'privacy', 'cookies'] as const) {
        expect(documents.current(kind)).toMatchObject({ kind, number: 1, status: 'published', source: 'seed', writtenBy: SEED_WRITER, askAgain: true });
      }
      expect(documents.current('terms').title).toBe('Terms of use');
      expect(documents.current('privacy').body).toContain('## How long it is kept');
      // The agreement itself is now something that is kept, and the notice says so.
      expect(documents.current('privacy').body).toContain('which versions of its terms of use, of this page and of the cookie statement you agreed to');
      expect(documents.current('cookies').body).toContain('SeeBuyGet sets no cookies');
      // A country's own, and a new version told in the app: what the system does, said where people read it.
      expect(documents.current('terms').body).toContain('## A country’s own terms');
      expect(documents.current('terms').body).toContain('When a new version is published, you are told in your SeeBuyGet app');
      expect(documents.current('privacy').body).toContain('The notices in your SeeBuyGet app');
      for (const kind of ['privacy', 'cookies'] as const) expect(documents.current(kind).body).toContain('## When this page changes');
    });

    it('never inserts over what somebody published, and never twice', () => {
      const published = documents.publish(propose().versionId, brian, T0 + 120_000);
      documents.seed(T0 + 180_000);
      expect(documents.current('terms').versionId).toBe(published.versionId);
      expect(documents.list().filter((v) => v.kind === 'terms' && v.source === 'seed')).toHaveLength(1);
    });
  });

  describe('a new version takes two people', () => {
    it('is written by one, changes nothing until a different one publishes it, and is numbered in order', () => {
      const written = propose();
      expect(written).toMatchObject({ status: 'proposed', writtenBy: 'Amina Otieno', basedOn: documents.current('terms').versionId, mine: true });
      expect(written.number).toBeUndefined();
      expect(documents.current('terms').number).toBe(1);
      expect(() => documents.publish(written.versionId, amina)).toThrow(/a different person must publish it/);
      // Two accounts are two people, whatever they are called.
      const published = documents.publish(written.versionId, { name: 'Amina Otieno', key: 'operator:other-amina' }, T0 + 120_000);
      expect(published).toMatchObject({ status: 'published', number: 2, decidedBy: 'Amina Otieno', publishedAt: new Date(T0 + 120_000).toISOString() });
      expect(documents.current('terms').versionId).toBe(written.versionId);
      // The first stays, word for word: what somebody agreed to can always be read back.
      expect(documents.published('terms', 1).source).toBe('seed');
    });

    it('asks for a note saying what changed, refuses a copy of what is published, and takes one proposal at a time', () => {
      expect(() => propose({ changeNote: '  ' })).toThrow(/Say what changed/);
      expect(() => propose({ body: `${documents.current('terms').body}\n\n` })).toThrow(/Nothing in it differs/);
      propose();
      expect(() => propose({ body: 'Something else entirely' }, brian)).toThrow(/already waiting for a second person/);
    });

    it('is declined with a reason that is kept — by anybody, its writer withdrawing it included', () => {
      const written = propose();
      expect(() => documents.decline(written.versionId, brian, ' ')).toThrow(/Say why/);
      const declined = documents.decline(written.versionId, amina, 'Wrong section', T0 + 120_000);
      expect(declined).toMatchObject({ status: 'declined', decidedBy: 'Amina Otieno', reason: 'Wrong section' });
      expect(() => documents.publish(written.versionId, brian)).toThrow(/already declined/);
      // Declined, it makes room for the next.
      expect(propose({ body: 'Another try' }).status).toBe('proposed');
    });

    it('refuses to publish over a version published since it was written: that would undo what came between', () => {
      const written = propose();
      // One proposal at a time makes this rare; a version put in by any other door since must still not be undone.
      const store = (documents as unknown as { versions: Map<string, unknown> }).versions;
      store.set('dv_since', { ...documents.current('terms'), versionId: 'dv_since', number: 2, source: undefined });
      expect(() => documents.publish(written.versionId, brian)).toThrow(/Version 2 was published after this was written/);
    });

    it('says whether a person may publish a version without publishing it — and passes on why it was published', () => {
      const written = propose();
      expect(() => documents.assertPublishable(written.versionId, amina)).toThrow(/a different person must publish it/);
      expect(documents.assertPublishable(written.versionId, brian).status).toBe('proposed');
      expect(documents.current('terms').number).toBe(1);
      const heard: Array<string | undefined> = [];
      documents.whenPublished((_v, occasion) => heard.push(occasion?.established?.company));
      documents.publish(written.versionId, brian, T0 + 120_000, { established: { company: 'SeeBuyGet Kenya Limited' } });
      expect(heard).toEqual(['SeeBuyGet Kenya Limited']);
    });

    it('tells whoever listens of each version published — and a listener that fails takes nothing back', () => {
      const told: number[] = [];
      documents.whenPublished(() => {
        throw new Error('a bell that is down');
      });
      documents.whenPublished((v) => told.push(v.number!));
      expect(documents.publish(propose().versionId, brian).number).toBe(2);
      expect(told).toEqual([2]);
    });
  });

  describe('what a sign-up agrees to', () => {
    it('is the current version of each, and asks again only after a version that says so', () => {
      expect(documents.agreementSet().map((d) => [d.key, d.number, d.since])).toEqual([
        ['terms', 1, 1],
        ['privacy', 1, 1],
        ['cookies', 1, 1],
      ]);
      // A change of wording that asks nothing new of anybody: shown, and nobody is asked again.
      documents.publish(propose({ askAgain: false }).versionId, brian);
      expect(documents.agreementSet()[0]).toMatchObject({ number: 2, since: 1 });
      // One that does: everybody who agreed to an earlier one is asked again.
      documents.publish(propose({ body: 'A new obligation', askAgain: true }).versionId, brian);
      expect(documents.agreementSet()[0]).toMatchObject({ number: 3, since: 3 });
    });

    it('reads back publicly without who wrote it, and lists the history newest first', () => {
      documents.publish(propose({ changeNote: 'Clearer words', askAgain: false }).versionId, brian);
      const view = documents.publicView(documents.current('terms'));
      expect(view).toMatchObject({ key: 'terms', kind: 'terms', number: 2, changeNote: 'Clearer words', path: '/terms/' });
      expect(view).not.toHaveProperty('writtenBy');
      expect(view).not.toHaveProperty('decidedBy');
      expect(documents.publicHistory('terms').map((l) => l.number)).toEqual([2, 1]);
    });
  });

  it('compares texts as they read: line ends and trailing spaces are not a change', () => {
    expect(normaliseBody('A  \r\nB\r\n\r\n\r\n\r\nC  ')).toBe('A\nB\n\nC');
  });
});

describe('who agreed to what', () => {
  let documents: DocumentsService;
  let agreements: AgreementService;
  const ALL = { terms: 1, privacy: 1, cookies: 1 };
  const amina = { name: 'A', key: 'operator:a' };
  const brian = { name: 'B', key: 'operator:b' };
  const publish = (kind: 'terms' | 'privacy' | 'cookies', body: string, askAgain: boolean, country?: string) =>
    documents.publish(documents.propose(kind, { title: country ? `Terms of use for ${country}` : 'Terms of use', body, changeNote: 'A change', askAgain, country }, amina).versionId, brian);

  beforeEach(() => {
    documents = new DocumentsService();
    documents.seed();
    agreements = new AgreementService(documents);
  });

  it('refuses a sign-up that did not agree, agreed to a version that does not exist, or to one a later version replaced', () => {
    expect(() => agreements.require(undefined)).toThrow(/Read and agree/);
    expect(() => agreements.require({ versions: { terms: 1, privacy: 1 } })).toThrow(/Read and agree to the cookie statement first/);
    expect(() => agreements.require({ versions: { ...ALL, terms: 2 } })).toThrow(/terms of use/);
    expect(agreements.require({ versions: ALL })).toEqual(ALL);
    publish('privacy', 'Something new is kept', true);
    expect(() => agreements.require({ versions: ALL })).toThrow(/A new version of what happens to your data was published while you were reading/);
    expect(agreements.require({ versions: { ...ALL, privacy: 2 } })).toEqual({ ...ALL, privacy: 2 });
  });

  it('asks again after signing in only when a version since asks everybody to', () => {
    const me = ['person:did:me'];
    const set = () => documents.agreementSet();
    expect(agreements.needed(me, set())).toBe(true);
    agreements.record(me[0], agreements.require({ versions: ALL }), 'identity/enroll');
    expect(agreements.needed(me, set())).toBe(false);
    publish('terms', 'Clearer', false);
    expect(agreements.needed(me, set())).toBe(false);
    publish('terms', 'A new rule', true);
    expect(agreements.needed(me, set())).toBe(true);
    agreements.record(me[0], agreements.require({ versions: { ...ALL, terms: 3 } }), 'app:driver');
    expect(agreements.needed(me, set())).toBe(false);
    // Kept, every one of them: the highest each agreed to, counted.
    expect(agreements.countsFor('terms')).toEqual({ 3: 1 });
  });

  it('keeps one agreement once', () => {
    agreements.recordIfNew(['person:did:me'], ALL, 'identity/enroll');
    agreements.recordIfNew(['person:did:me'], ALL, 'drivers/signups');
    expect(agreements.latest(['person:did:me'])).toMatchObject({ via: 'identity/enroll' });
  });

  it('agrees as the person, or as the account they signed in to — never as the shop a counter colleague works at, and never as staff', () => {
    const actor = (over: Partial<IntrospectionResult>): IntrospectionResult => ({ active: true, ...over });
    expect(agreementSubjects(actor({ role: 'consumer', did: 'did:p', personDid: 'did:p' }))).toEqual(['person:did:p']);
    expect(agreementSubjects(actor({ role: 'agent', did: 'did:shop' }))).toEqual(['account:did:shop']);
    expect(agreementSubjects(actor({ role: 'agent', did: 'did:shop', personDid: 'did:owner' }))).toEqual(['person:did:owner', 'account:did:shop']);
    expect(agreementSubjects(actor({ role: 'genesis', did: 'did:store' }))).toEqual(['account:did:store']);
    expect(agreementSubjects(actor({ role: 'agent', did: 'did:shop', personDid: 'did:colleague', revocationKey: 'shopstaff:m1' }))).toEqual(['person:did:colleague']);
    expect(agreementSubjects(actor({ role: 'operator', revocationKey: 'operator:amina' }))).toEqual([]);
    expect(agreementSubjects(actor({ role: 'entity_admin', did: 'did:sbg-ke' }))).toEqual([]);
    expect(agreementSubjects(undefined)).toEqual([]);
  });

  it('lets a sign-up under somebody signed in go on with their agreement when it is current, and asks for one when it is not', () => {
    const person = { active: true, role: 'consumer' as const, did: 'did:p', personDid: 'did:p' };
    expect(() => agreements.assertFor(person, undefined, 'fleet/signups')).toThrow(/Read and agree/);
    agreements.assertFor(person, { versions: ALL }, 'fleet/signups');
    expect(agreements.needed(['person:did:p'], documents.agreementSet())).toBe(false);
    expect(() => agreements.assertFor(person, undefined, 'drivers/signups')).not.toThrow();
  });

  /**
   * GENERAL, AND EACH COUNTRY'S OWN (the user, 2026-10-25: "every country needs it's specific adjustments, so there will be
   * the general terms of use, global, and specific terms of use"). Somebody in a country agrees to both.
   */
  describe('a country’s own documents, on top of the general ones', () => {
    it('are in the set only for that country, and only once one is published', () => {
      expect(documents.agreementSet('KE').map((d) => d.key)).toEqual(['terms', 'privacy', 'cookies']);
      const first = documents.propose('terms', { title: 'Terms of use for Kenya', body: 'What Kenyan law adds', changeNote: 'First', askAgain: false, country: 'ke' }, amina);
      // A country's first version is agreed to by everybody there, whatever the writer ticked.
      expect(first).toMatchObject({ country: 'KE', askAgain: true });
      expect(first.basedOn).toBeUndefined();
      expect(documents.agreementSet('KE').map((d) => d.key)).toEqual(['terms', 'privacy', 'cookies']);
      documents.publish(first.versionId, brian);
      expect(documents.agreementSet('KE').map((d) => d.key)).toEqual(['terms', 'privacy', 'cookies', 'terms@KE']);
      expect(documents.agreementSet('KE')[3]).toMatchObject({ number: 1, since: 1, path: '/terms/?country=KE', country: 'KE' });
      // Uganda reads the general text alone; the general text is numbered on its own.
      expect(documents.agreementSet('UG').map((d) => d.key)).toEqual(['terms', 'privacy', 'cookies']);
      expect(documents.current('terms').number).toBe(1);
      expect(documents.countries()).toEqual(['KE']);
      expect(() => documents.propose('terms', { title: 'x', body: 'y', changeNote: 'z', askAgain: false, country: 'ZZ' }, amina)).toThrow(/not a country/);
    });

    it('asks everybody there when the country publishes its own — and keeps what they agreed to when they move between countries', () => {
      const me = ['person:did:me'];
      agreements.record(me[0], agreements.require({ versions: ALL }, 'KE'), 'identity/enroll', 'KE');
      expect(agreements.needed(me, documents.agreementSet('KE'))).toBe(false);
      publish('terms', 'What Kenyan law adds', false, 'KE');
      expect(agreements.needed(me, documents.agreementSet('KE'))).toBe(true);
      expect(() => agreements.require({ versions: ALL }, 'KE')).toThrow(/Read and agree to the terms of use for Kenya first/);
      agreements.record(me[0], agreements.require({ versions: { ...ALL, 'terms@KE': 1 } }, 'KE'), 'app:consumer', 'KE');
      expect(agreements.needed(me, documents.agreementSet('KE'))).toBe(false);
      // In Uganda, what they agreed to in general still counts; Kenya's does not come into it.
      expect(agreements.needed(me, documents.agreementSet('UG'))).toBe(false);
      expect(agreements.personsIn('KE')).toEqual(['did:me']);
    });

    it('lets a sign-up in a country go on when they agreed to its documents already, whatever its form sent', () => {
      const person = { active: true, role: 'consumer' as const, did: 'did:p', personDid: 'did:p' };
      publish('terms', 'What Kenyan law adds', false, 'KE');
      agreements.record('person:did:p', agreements.require({ versions: { ...ALL, 'terms@KE': 1 } }, 'KE'), 'identity/enroll', 'KE');
      // A form that showed another country's set: nothing is asked of them in Kenya, so it does not hold them up.
      expect(() => agreements.assertFor(person, { versions: ALL }, 'fleet/signups', 'KE')).not.toThrow();
      // One that is asked of somebody who never read Kenya's is still refused.
      const other = { ...person, did: 'did:o', personDid: 'did:o' };
      agreements.record('person:did:o', ALL, 'identity/enroll', 'UG');
      expect(() => agreements.assertFor(other, { versions: ALL }, 'fleet/signups', 'KE')).toThrow(/terms of use for Kenya/);
      agreements.assertFor(other, { versions: { ...ALL, 'terms@KE': 1 } }, 'fleet/signups', 'KE');
      expect(agreements.needed(['person:did:o'], documents.agreementSet('KE'))).toBe(false);
    });
  });
});
