import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BooksService } from '../src/foundation/books/books.service';
import { ACCOUNT_CODES } from '../src/foundation/books/books.types';
import { EntityService } from '../src/foundation/entity/entity.service';
import { OutboxSmsSender } from '../src/foundation/sms/outbox-sms.sender';
import { PayoutNumberService } from '../src/modules/pudo/payout-number.service';
import { WalletGateService } from '../src/modules/pudo/wallet-gate.service';
import { AGREED } from './agreed';

/**
 * A PAYEE'S OWN PAYOUT NUMBER — through the booted application, over HTTP (the user, 2026-10-18: "for the countries
 * where it does work; a number they set").
 *
 * In Kenya a courier is paid by M-Pesa to a number it set and confirmed with a code. With none, the payout run skips it
 * and says why. A change pauses payouts for a day and texts the old number; a payout raised to the old number is not
 * sent to the new one. Staff set none.
 */
describe('a payee’s own payout number, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '48261';
  let operator = '';
  let ke = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = (await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token;
    ke = app.get(EntityService).requireForJurisdiction('KE').entityId;
    // Cash in the Kenyan sister's account: a run pays only what is held.
    app.get(BooksService).post({
      entityId: ke,
      kind: 'top-up',
      ref: 'funding',
      lines: [
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: 50_000 },
        { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: 'did:glos:shop', amount: -50_000 },
      ],
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  /** A courier who rides for themselves in Kenya, signed in to the driver app. */
  async function aCourier(): Promise<{ did: string; token: string }> {
    const phone = `+2547${digits()}1`;
    const onboarded = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Wanjiru', fullName: 'Wanjiru Rider', nationalId: `ID-PAY-${digits()}`, mobile: phone, licenceClasses: ['bike'], jurisdiction: 'KE' }).expect(201);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `pay${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    const session = await http().post('/v1/sbg/drivers/session').send({ phone, pin: PIN, device: enrolled.body.device }).expect(201);
    return { did: onboarded.body.did as string, token: session.body.token.access_token as string };
  }

  const run = async (by: string) => (await http().post(`/v1/sbg/entities/${ke}/payouts/run`).set(bearer(operator)).send({ by }).expect(201)).body;

  it('pays a courier only to a number it set and confirmed — and holds a changed one for a day', async () => {
    const courier = await aCourier();
    const as = bearer(courier.token);
    expect((await http().get('/v1/sbg/payout-number').set(as).expect(200)).body).toEqual({ way: 'mpesa', country: 'KE' });
    // Staff pass every role check; they are refused by name, reading and writing.
    expect((await http().get('/v1/sbg/payout-number').set(bearer(operator)).expect(403)).body.detail).toMatch(/sets its own payout number/);
    await http().post('/v1/sbg/payout-number/code').set(bearer(operator)).send({ phone: '0712000111' }).expect(403);

    // Owed, with no number: skipped, and told why.
    app.get(WalletGateService).driverPayout(courier.did, 400);
    const first = await run('Amina');
    expect(first.skipped.find((s: { payeeDid: string }) => s.payeeDid === courier.did)?.reason).toMatch(/no payout number yet/);

    // A number M-Pesa cannot pay is refused before anything is texted.
    await http().post('/v1/sbg/payout-number/code').set(as).send({ phone: '+255712000111' }).expect(400);
    const n1 = `07${digits()}5`;
    const sent = (await http().post('/v1/sbg/payout-number/code').set(as).send({ phone: n1 }).expect(201)).body;
    expect(sent).toMatchObject({ masked: expect.stringMatching(/^2547\d{2}\*\*\*\d{3}$/), minutes: 10, code: expect.stringMatching(/^\d{6}$/) });
    // The code went to that number: the sandbox's sender kept it.
    const old = `+254${n1.slice(1)}`;
    expect(app.get(OutboxSmsSender).recent(old).some((m) => m.body.includes(sent.code))).toBe(true);
    await http().post('/v1/sbg/payout-number').set(as).send({ code: sent.code === '000000' ? '111111' : '000000' }).expect(400);
    const saved = (await http().post('/v1/sbg/payout-number').set(as).send({ code: sent.code }).expect(201)).body;
    expect(saved).toMatchObject({ way: 'mpesa', masked: sent.masked });
    expect(saved.heldUntil).toBeUndefined();

    // Now the run raises it, to that number.
    const second = await run('Amina');
    const raised = second.raised.find((p: { payeeDid: string }) => p.payeeDid === courier.did);
    expect(raised).toMatchObject({ way: 'mpesa', destination: { masked: sent.masked } });
    expect(JSON.stringify(raised)).not.toContain(old.slice(1)); // the whole number is never on a payout

    // Changed: paused for a day, and the old number is told.
    await http().post('/v1/sbg/payout-number/code').set(as).send({ phone: n1 }).expect(400); // already this one
    const n2 = `01${digits()}5`;
    const again = (await http().post('/v1/sbg/payout-number/code').set(as).send({ phone: n2 }));
    // A minute between codes: the second is refused until then.
    expect(again.status).toBe(429);
  });

  it('pauses a changed number for a day, tells the old one, and never sends a payout raised to the old one', async () => {
    const courier = await aCourier();
    const as = bearer(courier.token);
    const n1 = `07${digits()}5`;
    const s1 = (await http().post('/v1/sbg/payout-number/code').set(as).send({ phone: n1 }).expect(201)).body;
    await http().post('/v1/sbg/payout-number').set(as).send({ code: s1.code }).expect(201);
    app.get(WalletGateService).driverPayout(courier.did, 300);
    const raised = (await run('Amina')).raised.find((p: { payeeDid: string }) => p.payeeDid === courier.did);
    expect(raised?.destination?.masked).toBe(s1.masked);

    // The minute between codes is the service's; a later attempt is what a person does.
    const svc = app.get(PayoutNumberService) as unknown as { rates: Map<string, { lastAt: number }> };
    for (const r of svc.rates.values()) r.lastAt = 0;
    const n2 = `01${digits()}5`;
    const s2 = (await http().post('/v1/sbg/payout-number/code').set(as).send({ phone: n2 }).expect(201)).body;
    const changed = (await http().post('/v1/sbg/payout-number').set(as).send({ code: s2.code }).expect(201)).body;
    expect(changed).toMatchObject({ masked: s2.masked, heldUntil: expect.any(String), oldNumber: 'kept' });
    // The sandbox does not text, but the notice was handed to its sender — addressed to the OLD number.
    const toOld = app.get(OutboxSmsSender).recent(`+254${n1.slice(1)}`);
    expect(toOld.some((m) => m.body.includes('your payout number was changed to') && m.body.includes(s2.masked))).toBe(true);

    // The payout raised to the old number is not sent to the new one — nor while the new one is paused.
    const refused = await http().post(`/v1/sbg/payouts/${raised.payoutId}/submit`).set(bearer(operator)).send({ by: 'Brian' }).expect(409);
    expect(refused.body.detail).toMatch(/payout number was changed/);
    // And the next run skips the payee until the day is out.
    await http().post(`/v1/sbg/payouts/${raised.payoutId}/fail`).set(bearer(operator)).send({ reason: 'number changed' }).expect(201);
    const next = await run('Amina');
    expect(next.skipped.find((s: { payeeDid: string }) => s.payeeDid === courier.did)?.reason).toMatch(/payout number was changed/);
  });
});
