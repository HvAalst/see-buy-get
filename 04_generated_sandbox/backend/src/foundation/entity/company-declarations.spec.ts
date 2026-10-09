import { Test } from '@nestjs/testing';
import { EntityService } from './entity.service';
import { adminKey, EntityAdminService } from './entity-admin.service';
import { CompanyDocumentService } from './company-documents.service';
import { CompanyDeclarationService, recordKeeper } from './company-declarations.service';
import { AuthService } from '../auth/auth.service';
import { DidService } from '../did/did.service';
import { LedgerService } from '../ledger/ledger.service';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { EventBus } from '../events/event-bus.service';
import { OperationalStore } from '../data-firewall/operational-store.service';
import { MailService } from '../mail/mail.service';
import { OutboxMailSender } from '../mail/outbox-mail.sender';
import { MAIL_SENDER } from '../mail/mail.types';

/**
 * A COMPANY THAT IS SWITCHED ON KEEPS ITS OWN RECORD — on the real company, administrator, document and mail
 * services (the user, 2026-10-09: "the company themselves could update their docs and not by staff").
 *
 * What is proved here is the bargain that replaces a member of staff typing a date: a change comes WITH its paper or
 * not at all, it counts at once, it cannot be used to keep something switched on that should go off, it is kept
 * whole, and the people who would know are told.
 */
describe('a company that is switched on keeps its own record', () => {
  let entities: EntityService;
  let admins: EntityAdminService;
  let documents: CompanyDocumentService;
  let declarations: CompanyDeclarationService;
  let outbox: OutboxMailSender;
  let mail: MailService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EntityService, EntityAdminService, CompanyDocumentService, CompanyDeclarationService, AuthService, DidService, LedgerService, EventBus, OperationalStore,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        MailService, OutboxMailSender, { provide: MAIL_SENDER, useExisting: OutboxMailSender },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    admins = moduleRef.get(EntityAdminService);
    documents = moduleRef.get(CompanyDocumentService);
    declarations = moduleRef.get(CompanyDeclarationService);
    outbox = moduleRef.get(OutboxMailSender);
    mail = moduleRef.get(MailService);
  });

  afterEach(() => mail.onModuleDestroy());

  const KE = 'sbg-ke';
  const NOW = Date.parse('2026-10-09T09:00:00.000Z');
  const pdf = (label: string) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`).toString('base64')}`;
  const anAdmin = (entityId: string, name: string) => {
    const email = `${name.toLowerCase().replace(/\W+/g, '.')}@sbg.co.ke`;
    const made = admins.create(entityId, { email, name }, 'Amina Otieno');
    return { email, name, key: adminKey(made.adminId) };
  };
  type Who = ReturnType<typeof anAdmin>;
  const declare = (who: Who, input: { section: string; was?: string; item?: Record<string, unknown>; paper?: { kind?: string; title?: string; dataUrl?: string } }, now = NOW) =>
    declarations.declare({ entityId: KE, by: who.name, byKey: who.key, ...input }, now);
  const COURIER = { kind: 'courier', number: 'CA/CL/0042', issuer: 'Communications Authority', expiresAt: '2026-12-10' };
  const licences = () => entities.recordOf(KE).licences;
  const told = (address: string) => outbox.recent(address).filter((m) => m.template === 'company-record-changed');

  /* ------------------------------------------------------------------ the act -- */

  it('a licence is put on record by the company with its paper: it counts at once, the paper is kept under its fingerprint, and what was said is kept whole', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const { declaration, document } = await declare(wanjiru, { section: 'licences', item: COURIER, paper: { dataUrl: pdf('licence 2026') } });

    expect(licences()).toEqual([{ ...COURIER, supports: ['merchantOfRecord'] }]);
    expect(document).toMatchObject({ entityId: KE, kind: 'licence', relatesTo: 'CA/CL/0042', expiresAt: '2026-12-10', uploadedBy: 'Wanjiru Kamau', version: 1, status: 'declared' });
    expect(document!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(documents.file(KE, document!.documentId).intact).toBe(true);
    expect(declaration).toMatchObject({
      entityId: KE,
      section: 'licences',
      change: 'added',
      now: 'CA/CL/0042',
      wasWords: '—',
      nowWords: 'courier licence CA/CL/0042, good until 2026-12-10',
      documentId: document!.documentId,
      by: 'Wanjiru Kamau',
      at: new Date(NOW).toISOString(),
    });
    expect(declaration.was).toBeUndefined();
    expect(declaration.after).toEqual({ ...COURIER, supports: ['merchantOfRecord'] });
    expect(declarations.list(KE)).toEqual([declaration]);
    expect(declarations.ofDocument(document!.documentId)).toEqual(declaration);
    // The company's own log says it as a sentence, with the person on it.
    expect(entities.changes(KE, 1)[0]).toMatchObject({ by: 'Wanjiru Kamau', what: 'record', from: '—', to: 'courier licence CA/CL/0042, good until 2026-12-10 — with its paper' });
  });

  it('a renewal counts the moment it is on record: what the lapsed licence switched off is back on, and nobody at SeeBuyGet typed anything', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    entities.updateRecord(KE, { licences: [{ ...COURIER, expiresAt: '2026-10-01' }] }, 'Amina Otieno'); // as it stood when the company was switched on
    expect(entities.lapsesFor('KE', NOW).map((l) => l.capability)).toEqual(['merchantOfRecord']);

    const { declaration } = await declare(wanjiru, { section: 'licences', was: 'CA/CL/0042', item: { number: 'CA/CL/0042', issuer: 'Communications Authority', expiresAt: '2027-10-01' }, paper: { dataUrl: pdf('renewed') } });

    expect(entities.lapsesFor('KE', NOW)).toEqual([]);
    expect(licences()).toEqual([{ ...COURIER, expiresAt: '2027-10-01', supports: ['merchantOfRecord'] }]);
    expect(declaration).toMatchObject({ change: 'changed', was: 'CA/CL/0042', now: 'CA/CL/0042', wasWords: 'courier licence CA/CL/0042, good until 2026-10-01', nowWords: 'courier licence CA/CL/0042, good until 2027-10-01' });
    // What it was is kept whole: it is what can be put back.
    expect(declaration.before).toEqual({ ...COURIER, expiresAt: '2026-10-01', supports: ['merchantOfRecord'] });
  });

  it('NO PAPER, NO CHANGE — and a paper that is refused leaves the record exactly as it was', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    await expect(declare(wanjiru, { section: 'licences', item: COURIER })).rejects.toMatchObject({ code: 'FIELD_REQUIRED' });
    await expect(declare(wanjiru, { section: 'licences', item: COURIER, paper: { dataUrl: '' } })).rejects.toMatchObject({ code: 'FIELD_REQUIRED' });
    // Not a document at all.
    await expect(declare(wanjiru, { section: 'licences', item: COURIER, paper: { dataUrl: 'data:text/plain;base64,aGVsbG8gd29ybGQ=' } })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    expect(licences()).toEqual([]);
    expect(documents.list(KE)).toEqual([]);
    expect(declarations.list(KE)).toEqual([]);

    // The very file already on record for it is not a renewal: the date does not move on an old paper.
    await declare(wanjiru, { section: 'licences', item: COURIER, paper: { dataUrl: pdf('the one paper') } });
    await expect(declare(wanjiru, { section: 'licences', was: 'CA/CL/0042', item: { ...COURIER, expiresAt: '2027-12-10' }, paper: { dataUrl: pdf('the one paper') } })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(licences()[0].expiresAt).toBe('2026-12-10');
    expect(declarations.list(KE)).toHaveLength(1);
    // And a record that is refused leaves no paper behind: a date that is not a date.
    await expect(declare(wanjiru, { section: 'licences', was: 'CA/CL/0042', item: { ...COURIER, expiresAt: 'next year' }, paper: { dataUrl: pdf('another paper') } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(documents.list(KE)).toHaveLength(1);
  });

  /* ------------------------------------------------------------------ what it cannot be used for -- */

  it('WHAT A PAPER PERMITS IS NOT THE COMPANY’S TO CHANGE: not by unticking it, and not by calling the licence something else', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    entities.updateRecord(KE, { licences: [COURIER] }, 'Amina Otieno');
    expect(licences()[0].supports).toEqual(['merchantOfRecord']);

    // Sent with nothing ticked — which, kept, would let it run out and switch nothing off.
    await declare(wanjiru, { section: 'licences', was: 'CA/CL/0042', item: { number: 'CA/CL/0042', issuer: 'Communications Authority', expiresAt: '2027-12-10', supports: [] }, paper: { dataUrl: pdf('a') } });
    expect(licences()[0]).toMatchObject({ kind: 'courier', expiresAt: '2027-12-10', supports: ['merchantOfRecord'] });
    // Called another kind of licence.
    await expect(declare(wanjiru, { section: 'licences', was: 'CA/CL/0042', item: { ...COURIER, kind: 'other' }, paper: { dataUrl: pdf('b') } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(licences()[0].kind).toBe('courier');
    // A NEW one permits what its kind permits, whatever was sent with it.
    await declare(wanjiru, { section: 'licences', item: { kind: 'money_handling', number: 'CBK/MH/7', issuer: 'Central Bank of Kenya', expiresAt: '2027-06-30', supports: [] }, paper: { dataUrl: pdf('c') } });
    expect(licences().find((l) => l.number === 'CBK/MH/7')!.supports).toEqual(['holdFloat', 'cashOnDelivery']);
  });

  it('a paper that permits something is NOT TAKEN OFF the record — taken off, nothing would lapse. One that permits nothing is, and needs no paper', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    entities.updateRecord(KE, { licences: [COURIER], insurance: [{ kind: 'public_liability', insurer: 'Jubilee', policyNumber: 'PL-17', expiresAt: '2026-11-06' }] }, 'Amina Otieno');

    await expect(declare(wanjiru, { section: 'licences', was: 'CA/CL/0042' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(licences()).toHaveLength(1);

    const { declaration, document } = await declare(wanjiru, { section: 'insurance', was: 'PL-17' });
    expect(entities.recordOf(KE).insurance).toEqual([]);
    expect(document).toBeUndefined();
    expect(declaration).toMatchObject({ change: 'removed', was: 'PL-17', wasWords: 'public liability policy PL-17 with Jubilee, good until 2026-11-06', nowWords: 'taken off the record' });
    expect(declaration.documentId).toBeUndefined();
    expect(declaration.now).toBeUndefined();
    expect(entities.changes(KE, 1)[0]).toMatchObject({ by: 'Wanjiru Kamau', to: 'taken off the record' });
    // Saying neither what it is to be nor what goes is not a change.
    await expect(declare(wanjiru, { section: 'insurance' })).rejects.toMatchObject({ code: 'FIELD_REQUIRED' });
  });

  it('a renewal under a NEW NUMBER replaces the licence — it does not leave the old one beside it to lapse — and the old paper is marked as replaced', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    await declare(wanjiru, { section: 'licences', item: COURIER, paper: { dataUrl: pdf('2026') } });
    const { document } = await declare(wanjiru, { section: 'licences', was: 'ca/cl/0042', item: { number: 'CA/CL/0099', issuer: 'Communications Authority', expiresAt: '2027-12-10' }, paper: { dataUrl: pdf('2027') } });

    expect(licences().map((l) => l.number)).toEqual(['CA/CL/0099']);
    const papers = documents.list(KE);
    expect(papers.find((d) => d.relatesTo === 'CA/CL/0042')).toMatchObject({ status: 'superseded', supersededBy: document!.documentId });
    expect(papers.find((d) => d.relatesTo === 'CA/CL/0099')).toMatchObject({ status: 'declared', version: 1 });

    // A number already on the record is not taken by another item, by renewal or as a new one; and what is not there cannot be changed.
    await declare(wanjiru, { section: 'licences', item: { kind: 'money_handling', number: 'CBK/MH/7', issuer: 'Central Bank of Kenya', expiresAt: '2027-06-30' }, paper: { dataUrl: pdf('mh') } });
    await expect(declare(wanjiru, { section: 'licences', was: 'CBK/MH/7', item: { number: 'CA/CL/0099', issuer: 'Central Bank of Kenya', expiresAt: '2027-06-30' }, paper: { dataUrl: pdf('x') } })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(declare(wanjiru, { section: 'licences', item: { ...COURIER, number: 'ca/cl/0099' }, paper: { dataUrl: pdf('y') } })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(declare(wanjiru, { section: 'licences', was: 'NO/SUCH/1', item: COURIER, paper: { dataUrl: pdf('z') } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(licences().map((l) => l.number)).toEqual(['CA/CL/0099', 'CBK/MH/7']);
  });

  it('a bank account and who may sign change with their papers too — the right kind of paper — and are taken off without one', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const bank = await declare(wanjiru, { section: 'bankAccounts', item: { bankName: 'KCB', accountName: 'SeeBuyGet Kenya Ltd', accountNumber: '1100223344', currency: 'kes' }, paper: { dataUrl: pdf('bank letter') } });
    expect(bank.document).toMatchObject({ kind: 'bank_confirmation', relatesTo: '1100223344', status: 'declared' });
    expect(entities.recordOf(KE).bankAccounts).toEqual([{ bankName: 'KCB', accountName: 'SeeBuyGet Kenya Ltd', accountNumber: '1100223344', currency: 'KES', purpose: 'general' }]);
    expect(bank.declaration.nowWords).toBe('KCB account 1100223344 (KES, SeeBuyGet Kenya Ltd)');

    const signer = { name: 'Otieno Odhiambo', role: 'Director', signing: 'alone' };
    // A licence is not the paper behind who may sign.
    await expect(declare(wanjiru, { section: 'representatives', item: signer, paper: { kind: 'licence', dataUrl: pdf('wrong') } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(entities.recordOf(KE).representatives).toEqual([]);
    const rep = await declare(wanjiru, { section: 'representatives', item: signer, paper: { kind: 'memorandum_and_articles', title: 'Board resolution, 3 Oct 2026', dataUrl: pdf('resolution') } });
    expect(rep.document).toMatchObject({ kind: 'memorandum_and_articles', title: 'Board resolution, 3 Oct 2026', relatesTo: 'Otieno Odhiambo', status: 'declared' });
    expect(rep.declaration.nowWords).toBe('Otieno Odhiambo, Director — signs alone');

    const gone = await declare(wanjiru, { section: 'representatives', was: 'otieno odhiambo' });
    expect(gone.declaration.change).toBe('removed');
    expect(entities.recordOf(KE).representatives).toEqual([]);
    // The parts that switch nothing do not come this way.
    await expect(declare(wanjiru, { section: 'beneficialOwners', item: { name: 'Hans', sharePct: 100 }, paper: { dataUrl: pdf('q') } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  /* ------------------------------------------------------------------ whose record it is -- */

  it('ONLY A COMPANY THAT IS SWITCHED ON: until then its record is staff’s to enter, and a customer’s business and the group never keep one this way', async () => {
    const draft = entities.createCompany({ kind: 'sister', jurisdiction: 'UG', name: 'SeeBuyGet Uganda' }, 'Amina Otieno');
    const partner = entities.createCompany({ kind: 'partner', jurisdiction: 'TZ', name: 'Pwani Clearing' }, 'Amina Otieno');
    expect([recordKeeper(draft), recordKeeper(partner), recordKeeper(entities.get(KE)), recordKeeper(entities.group()), recordKeeper({ kind: 'business' })]).toEqual(['staff', 'staff', 'company', 'staff', 'staff']);

    const asked = { entityId: draft.entityId, section: 'licences', item: { ...COURIER, number: 'UCC/CL/0007', issuer: 'Uganda Communications Commission' }, paper: { dataUrl: pdf('ug') }, by: 'Nakato Namuli' };
    await expect(declarations.declare(asked, NOW)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(entities.recordOf(draft.entityId).licences).toEqual([]);
    await expect(declarations.declare({ ...asked, entityId: entities.group().entityId }, NOW)).rejects.toMatchObject({ code: 'INVALID_STATE' });

    // Switched on, it is theirs — a partner the same as a company of ours.
    entities.activate(draft.entityId, 'Amina Otieno');
    entities.activate(partner.entityId, 'Amina Otieno');
    expect([recordKeeper(entities.get(draft.entityId)), recordKeeper(entities.get(partner.entityId))]).toEqual(['company', 'company']);
    await declarations.declare(asked, NOW);
    expect(entities.recordOf(draft.entityId).licences.map((l) => l.number)).toEqual(['UCC/CL/0007']);
    // And it always names the person.
    await expect(declarations.declare({ ...asked, by: '  ' }, NOW)).rejects.toMatchObject({ code: 'FIELD_REQUIRED' });
  });

  it('a paper the company put on record itself is not turned down, or verified, by one person at SeeBuyGet', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const { document } = await declare(wanjiru, { section: 'licences', item: COURIER, paper: { dataUrl: pdf('licence') } });
    expect(() => documents.reject(KE, document!.documentId, 'Amina Otieno', 'I do not like it')).toThrow(/counts/);
    expect(() => documents.verify(KE, document!.documentId, 'Amina Otieno')).toThrow(/declared/);
    expect(documents.list(KE)[0].status).toBe('declared');
    expect(licences()).toHaveLength(1);
    // A paper put on record the old way still waits for a second person: switching a company on is unchanged.
    expect(documents.upload({ entityId: KE, kind: 'certificate_of_incorporation', title: 'Certificate', dataUrl: pdf('cert'), by: 'Amina Otieno' }).status).toBe('awaiting_verification');
  });

  /* ------------------------------------------------------------------ who is told -- */

  it('THE PEOPLE WHO WOULD KNOW ARE TOLD: every other administrator of the company, and of the company above it — not the one who did it, and nobody else', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const otieno = anAdmin(KE, 'Otieno Odhiambo');
    const hans = anAdmin(entities.group().entityId, 'Hans van Aalst');
    const selam = anAdmin('sbg-et', 'Selam Tesfaye');

    const added = await declare(wanjiru, { section: 'licences', item: COURIER, paper: { dataUrl: pdf('2026') } });
    expect(added.told).toBe(2);
    expect(told(otieno.email).map((m) => m.subject)).toEqual(['Wanjiru Kamau added a licence on SeeBuyGet Kenya’s record']);
    expect(told(hans.email)).toHaveLength(1);
    expect(told(wanjiru.email)).toEqual([]);
    expect(told(selam.email)).toEqual([]);
    const text = told(otieno.email)[0].text;
    expect(text).toContain('Was: —');
    expect(text).toContain('Now: courier licence CA/CL/0042, good until 2026-12-10');
    expect(text).toContain('counts from now: nobody at SeeBuyGet checks it first');

    // A renewal by the other one: now Wanjiru is told, and Otieno is not.
    await declare(otieno, { section: 'licences', was: 'CA/CL/0042', item: { number: 'CA/CL/0042', issuer: 'Communications Authority', expiresAt: '2027-12-10' }, paper: { dataUrl: pdf('2027') } });
    expect(told(wanjiru.email).map((m) => m.subject)).toEqual(['Otieno Odhiambo changed a licence on SeeBuyGet Kenya’s record']);
    expect(told(wanjiru.email)[0].text).toContain('Was: courier licence CA/CL/0042, good until 2026-12-10');
    expect(told(otieno.email)).toHaveLength(1);
    expect(told(hans.email)).toHaveLength(2);

    // Something taken off is said as that, and promises no paper.
    await declare(wanjiru, { section: 'bankAccounts', item: { bankName: 'KCB', accountName: 'SeeBuyGet Kenya Ltd', accountNumber: '1100223344', currency: 'KES' }, paper: { dataUrl: pdf('bank') } });
    await declare(wanjiru, { section: 'bankAccounts', was: '1100223344' });
    const off = told(otieno.email).find((m) => m.subject === 'Wanjiru Kamau took a bank account off SeeBuyGet Kenya’s record')!;
    expect(off.text).toContain('Now: taken off the record');
    expect(off.text).not.toContain('The paper behind it');
  });
});
