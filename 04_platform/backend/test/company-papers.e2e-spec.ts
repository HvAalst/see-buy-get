import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CompanyPapersWatch } from '../src/foundation/entity/company-papers-watch.service';
import { OutboxMailSender } from '../src/foundation/mail/outbox-mail.sender';

/**
 * A COMPANY'S OWN ADMINISTRATOR CAN READ WHAT IS ABOUT TO STOP THEIR COMPANY — through the booted application.
 *
 * The unit spec proves the marks and the email on the real services. This proves the rest: that the application as it
 * is wired has the watch at all, that the list network staff read is now open to a company's administrator for THEIR
 * company and no other, and that it says what they were told.
 */
describe('a company’s papers that are running out, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  let operator = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = (await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token;
  });

  afterAll(async () => {
    await app?.close();
  });

  /** An administrator of that company, signed in to the console as "A company". */
  async function anAdmin(entityId: string, name: string): Promise<{ email: string; token: string; adminId: string }> {
    const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${digits()}@sbg.co.ke`;
    const made = await http().post(`/v1/sbg/entities/${entityId}/admins`).set(bearer(operator)).send({ email, name }).expect(201);
    const signedIn = await http().post('/v1/sbg/entities/admins/login').send({ email, password: made.body.temporaryPassword }).expect(201);
    return { email, token: signedIn.body.token.access_token as string, adminId: made.body.adminId as string };
  }
  const pdf = (label: string) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`).toString('base64')}`;
  /** A company that is switched on puts its own licence on record, with the paper: staff no longer type it. */
  const licenceBy = (token: string, entityId: string, licence: Record<string, unknown>) =>
    http().post(`/v1/sbg/entities/${entityId}/record/declare`).set(bearer(token)).send({ section: 'licences', item: licence, paperDataUrl: pdf(String(licence.number)) }).expect(201);
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  type Row = { entityId: string; reference: string; daysLeft: number; supports: string[]; told?: { stage: number | string; to: number; of: number; nobody?: boolean } };
  const listAs = async (token: string) => ((await http().get('/v1/sbg/companies/expiring').set(bearer(token)).expect(200)).body.items as Row[]);

  it('the company’s administrator reads their own company’s papers and what they were told — and nobody else’s', async () => {
    const ref = `CA/CL/${digits()}`;
    const other = `ET/CL/${digits()}`;
    const wanjiru = await anAdmin('sbg-ke', 'Wanjiru Kamau');
    await licenceBy(wanjiru.token, 'sbg-ke', { kind: 'courier', number: ref, issuer: 'Communications Authority', expiresAt: inDays(10) });
    // Ethiopia's licence is put on record by an administrator who then leaves: the company is left with nobody to tell.
    const abebe = await anAdmin('sbg-et', 'Abebe Bekele');
    await licenceBy(abebe.token, 'sbg-et', { kind: 'courier', number: other, issuer: 'ECA', expiresAt: inDays(20) });
    await http().delete(`/v1/sbg/entities/sbg-et/admins/${abebe.adminId}`).set(bearer(operator)).expect(200);

    // It is THEIR list now: until this it was staff's alone, and their first read of it was a refusal.
    const mine = await listAs(wanjiru.token);
    expect(mine.map((p) => p.reference)).toEqual([ref]);
    expect(mine[0]).toMatchObject({ entityId: 'sbg-ke', supports: ['merchantOfRecord'] });
    expect(mine[0].told).toBeUndefined();
    // Network staff see every company's.
    expect((await listAs(operator)).map((p) => p.reference)).toEqual(expect.arrayContaining([ref, other]));
    // Nobody else reads it at all.
    await http().get('/v1/sbg/companies/expiring').expect(401);

    // The clock comes round: the administrator is emailed, and the list says so to them and to staff.
    const swept = await app.get(CompanyPapersWatch).sweep();
    expect(swept.mails).toBeGreaterThanOrEqual(1);
    const mailed = app.get(OutboxMailSender).recent(wanjiru.email).filter((m) => m.template === 'company-paper-lapsing');
    expect(mailed.map((m) => m.subject)).toEqual([`Courier licence runs out in ${mine[0].daysLeft} days — SeeBuyGet Kenya`]);
    expect((await listAs(wanjiru.token))[0].told).toMatchObject({ stage: 14, to: 1, of: 1 });
    expect((await listAs(operator)).find((p) => p.reference === ref)!.told).toMatchObject({ stage: 14, to: 1, of: 1 });

    // WHERE SHE SEES IT: her company's own record — the one screen every administrator of a company has. It carries
    // what is running out and what was said, for that company and no other.
    const record = (await http().get('/v1/sbg/entities/sbg-ke/record').set(bearer(wanjiru.token)).expect(200)).body as { expiring: Row[] };
    expect(record.expiring.map((p) => p.reference)).toEqual([ref]);
    expect(record.expiring[0].told).toMatchObject({ stage: 14, to: 1, of: 1 });

    // Ethiopia's company has nobody to tell: its own administrator-to-be reads that it went nowhere — and none of Kenya's.
    const selam = await anAdmin('sbg-et', 'Selam Tesfaye');
    const theirs = await listAs(selam.token);
    expect(theirs.map((p) => p.reference)).toEqual([other]);
    expect(theirs[0].told).toMatchObject({ nobody: true });
    // Now there is somebody: at the next look they are told, at the same mark.
    await app.get(CompanyPapersWatch).sweep();
    expect(app.get(OutboxMailSender).recent(selam.email).filter((m) => m.template === 'company-paper-lapsing')).toHaveLength(1);
    expect((await listAs(selam.token))[0].told).toMatchObject({ stage: 30, to: 1, of: 1 });

    // SHE RENEWS IT HERSELF, with the paper: it is off the list at once, with nobody at SeeBuyGet entering a date.
    await http().post('/v1/sbg/entities/sbg-ke/record/declare').set(bearer(wanjiru.token)).send({ section: 'licences', was: ref, item: { number: ref, issuer: 'Communications Authority', expiresAt: inDays(400) }, paperDataUrl: pdf('renewed') }).expect(201);
    expect(await listAs(wanjiru.token)).toEqual([]);
  });
});
