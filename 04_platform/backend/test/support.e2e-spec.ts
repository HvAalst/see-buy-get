import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OutboxMailSender } from '../src/foundation/mail/outbox-mail.sender';
import { RateLimitGuard } from '../src/foundation/http/rate-limit.guard';

/**
 * WRITING TO US, over the wire (the user, 2026-10-22: "direct message field that is sorted by category by the system for
 * sbg staff ... They will have to leave their email"). Anybody writes, signed in or not, choosing what it is about and
 * giving an address; they are thanked with a reference. Staff read them sorted — what cannot wait first, then whoever
 * has waited longest — answer by email, and close them.
 */
describe('writing to us, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const write = (body: Record<string, unknown>) => http().post('/v1/sbg/support/messages').send(body);

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
  // Every test writes from the one address this machine has: each starts with the per-caller count at nought.
  beforeEach(() => (app.get(RateLimitGuard) as unknown as { hits: Map<string, unknown> }).hits.clear());

  it('is written with no sign-in, thanked with a reference, and the person is emailed it', async () => {
    const email = `Writer.${digits()}@Example.com`;
    const sent = (await write({ category: 'parcel', email, message: 'My parcel has said on its way for three days now.', about: 'follow-shop-order', from: 'send', locale: 'en' }).expect(201)).body;
    expect(sent.reference).toMatch(/^SBG-[A-HJ-NP-Z2-9]{6}$/);
    const [mail] = app.get(OutboxMailSender).recent(email.toLowerCase());
    expect(mail.template).toBe('support-received');
    expect(mail.text).toContain(sent.reference);
    expect(mail.text).toContain('A parcel: sending, collecting or tracking it');
  });

  it('refuses what is not a message: no address, a short line, a category nobody offers', async () => {
    expect((await write({ category: 'parcel', message: 'Where is my parcel please?' })).status).toBe(400);
    expect((await write({ category: 'parcel', email: 'not an address', message: 'Where is my parcel please?' })).body.code).toBe('VALIDATION_FAILED');
    expect((await write({ category: 'parcel', email: `a.${digits()}@example.com`, message: 'help' })).status).toBe(400);
    expect((await write({ category: 'refund-now', email: `a.${digits()}@example.com`, message: 'Where is my parcel please?' })).status).toBe(400);
  });

  it('thanks a form-filling machine like anybody, and keeps nothing it sent', async () => {
    const email = `bot.${digits()}@example.com`;
    const sent = (await write({ category: 'other', email, message: 'Buy cheap things at our site today', website: 'http://spam.example' }).expect(201)).body;
    expect(sent.reference).toMatch(/^SBG-/);
    expect(app.get(OutboxMailSender).recent(email)).toHaveLength(0);
    const inbox = (await http().get('/v1/sbg/ops/support').set(bearer(operator)).expect(200)).body;
    expect(inbox.items.some((m: { email: string }) => m.email === email)).toBe(false);
  });

  it('is read by staff sorted: what cannot wait first, then whoever has waited longest — every category counted', async () => {
    const tag = digits();
    const first = (await write({ category: 'money', email: `m1.${tag}@example.com`, message: `My payout did not arrive ${tag}` }).expect(201)).body.reference;
    const second = (await write({ category: 'sign-in', email: `m2.${tag}@example.com`, message: `I cannot sign in on my new phone ${tag}` }).expect(201)).body.reference;
    const urgent = (await write({ category: 'safety', email: `m3.${tag}@example.com`, message: `A driver asked me for my collection code ${tag}` }).expect(201)).body.reference;
    const inbox = (await http().get('/v1/sbg/ops/support').set(bearer(operator)).expect(200)).body;
    const refs = inbox.items.map((m: { reference: string }) => m.reference);
    expect(refs[0]).toBe(inbox.items.find((m: { urgent: boolean }) => m.urgent).reference);
    expect(refs).toContain(urgent);
    expect(refs.indexOf(first)).toBeLessThan(refs.indexOf(second));
    expect(inbox.counts.map((c: { category: string }) => c.category)).toEqual(['sign-in', 'parcel', 'damage', 'money', 'joining', 'business', 'safety', 'privacy', 'other']);
    expect(inbox.counts.find((c: { category: string }) => c.category === 'safety').open).toBeGreaterThanOrEqual(1);
    expect(inbox.keptDays).toBe(180);
    // Only staff read them.
    expect((await http().get('/v1/sbg/ops/support')).status).toBe(401);
  });

  it('is answered by email, to the address given, under the name of who answered — and closed', async () => {
    const email = `answer.${digits()}@example.com`;
    const ref = (await write({ category: 'joining', email, message: 'How long does it take to approve my shop?' }).expect(201)).body.reference;
    const answered = (await http().post(`/v1/sbg/ops/support/${ref}/answer`).set(bearer(operator)).send({ text: 'Usually within two working days of your papers arriving.' }).expect(201)).body;
    expect(answered).toMatchObject({ status: 'answered', answers: [{ text: 'Usually within two working days of your papers arriving.', mailed: false }] });
    const [mail] = app.get(OutboxMailSender).recent(email);
    expect(mail.template).toBe('support-answer');
    expect(mail.text).toContain('Usually within two working days');
    expect(mail.text).toContain(ref);
    // Answered is no longer waiting; it is under answered.
    const open = (await http().get('/v1/sbg/ops/support').set(bearer(operator))).body.items.map((m: { reference: string }) => m.reference);
    expect(open).not.toContain(ref);
    expect((await http().get('/v1/sbg/ops/support?status=answered').set(bearer(operator))).body.items.map((m: { reference: string }) => m.reference)).toContain(ref);
    const closed = (await http().post(`/v1/sbg/ops/support/${ref}/close`).set(bearer(operator)).expect(201)).body;
    expect(closed.status).toBe('closed');
    expect((await http().post(`/v1/sbg/ops/support/${ref}/answer`).set(bearer(operator)).send({ text: 'One more thing.' })).body.code).toBe('INVALID_STATE');
    expect((await http().post('/v1/sbg/ops/support/SBG-NOPE00/close').set(bearer(operator))).status).toBe(404);
  });

  it('takes ten from one caller in a quarter of an hour, and turns the eleventh away', async () => {
    for (let i = 1; i <= 10; i += 1) await write({ category: 'other', email: `caller${i}.${digits()}@example.com`, message: `Question number ${i} from one caller` }).expect(201);
    const eleventh = await write({ category: 'other', email: `caller11.${digits()}@example.com`, message: 'Question number 11 from one caller' });
    expect([eleventh.status, eleventh.body.code]).toEqual([429, 'RATE_LIMITED']);
  });

  it('takes five open messages from one address, and says the sixth waits for those to be answered', async () => {
    const email = `many.${digits()}@example.com`;
    for (let i = 1; i <= 5; i += 1) await write({ category: 'other', email, message: `Question number ${i} about my account` }).expect(201);
    const sixth = await write({ category: 'other', email, message: 'Question number 6 about my account' });
    expect([sixth.status, sixth.body.code]).toEqual([429, 'RATE_LIMITED']);
    expect(sixth.body.detail).toMatch(/several messages waiting for an answer already/);
  });
});
