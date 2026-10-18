import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BooksService } from '../src/foundation/books/books.service';
import { ACCOUNT_CODES } from '../src/foundation/books/books.types';
import { EntityService } from '../src/foundation/entity/entity.service';
import { MPESA_PAYOUT_RAIL, MpesaPayoutRail } from '../src/foundation/payouts/mpesa-payout-rail.adapter';
import { WalletGateService } from '../src/modules/pudo/wallet-gate.service';

/**
 * PAYING OUT BY M-PESA — through the booted application, over HTTP, against a stand-in Daraja.
 *
 * A Kenyan courier with a number of its own is raised a payout, a second member of staff approves it, it goes to
 * M-Pesa as a business payment to that number, and M-Pesa's result — posted to the public door — is what pays it in
 * the books. Staff cannot fail it while M-Pesa is working on it.
 */
describe('paying out by M-Pesa, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '48261';
  let operator = '';
  let ke = '';
  const sentToDaraja: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    const daraja = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('/oauth/')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: '3599' }) } as Response;
      const body = JSON.parse(String(init?.body ?? '{}'));
      sentToDaraja.push(body);
      return { ok: true, status: 200, json: async () => ({ ConversationID: `AG_${sentToDaraja.length}`, OriginatorConversationID: body.OriginatorConversationID, ResponseCode: '0', ResponseDescription: 'Accept the service request successfully.' }) } as Response;
    }) as unknown as typeof fetch;
    const rail = new MpesaPayoutRail({ env: 'sandbox', consumerKey: 'k', consumerSecret: 's', shortcode: '600999', initiator: 'sbg-api', securityCredential: 'ENC', callbackBase: 'https://sbg.example' }, daraja);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MPESA_PAYOUT_RAIL).useValue(rail).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = (await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token;
    ke = app.get(EntityService).requireForJurisdiction('KE').entityId;
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

  /** A Kenyan courier, signed in, with a payout number of its own. */
  async function aCourierWithANumber(): Promise<{ did: string; number: string }> {
    const phone = `+2547${digits()}1`;
    const onboarded = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Achieng', fullName: 'Achieng Rider', nationalId: `ID-B2C-${digits()}`, mobile: phone, licenceClasses: ['bike'], jurisdiction: 'KE' }).expect(201);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `b2c${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    const token = (await http().post('/v1/sbg/drivers/session').send({ phone, pin: PIN, device: enrolled.body.device }).expect(201)).body.token.access_token as string;
    const number = `07${digits()}2`;
    const sent = (await http().post('/v1/sbg/payout-number/code').set(bearer(token)).send({ phone: number }).expect(201)).body;
    await http().post('/v1/sbg/payout-number').set(bearer(token)).send({ code: sent.code }).expect(201);
    return { did: onboarded.body.did as string, number: `254${number.slice(1)}` };
  }

  it('sends a business payment to the courier’s own number, and pays it in the books only on M-Pesa’s result', async () => {
    const courier = await aCourierWithANumber();
    app.get(WalletGateService).driverPayout(courier.did, 250.75);
    const run = (await http().post(`/v1/sbg/entities/${ke}/payouts/run`).set(bearer(operator)).send({ by: 'Amina' }).expect(201)).body;
    const raised = run.raised.find((p: { payeeDid: string }) => p.payeeDid === courier.did);
    expect(raised).toMatchObject({ way: 'mpesa', amount: 250 }); // whole shillings; the 75 cents stay owed

    const sent = (await http().post(`/v1/sbg/payouts/${raised.payoutId}/submit`).set(bearer(operator)).send({ by: 'Brian' }).expect(201)).body;
    expect(sent).toMatchObject({ status: 'submitted', providerRef: expect.stringMatching(/^AG_/), railRef: expect.any(String) });
    const toDaraja = sentToDaraja.at(-1)!;
    expect(toDaraja).toMatchObject({ CommandID: 'BusinessPayment', Amount: 250, PartyB: courier.number, OriginatorConversationID: sent.railRef });

    // Staff cannot fail it while M-Pesa is working on it, nor say it was paid without M-Pesa's receipt.
    await http().post(`/v1/sbg/payouts/${raised.payoutId}/fail`).set(bearer(operator)).send({ reason: 'impatient' }).expect(409);
    await http().post(`/v1/sbg/payouts/${raised.payoutId}/settle`).set(bearer(operator)).send({}).expect(400);

    // A result about somebody else's request is refused; M-Pesa's own result pays it.
    const result = (originator: string, conversation: string) => ({
      Result: {
        ResultType: 0,
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        OriginatorConversationID: originator,
        ConversationID: conversation,
        TransactionID: 'NLJ41HAY6Q',
        ResultParameters: { ResultParameter: [{ Key: 'TransactionAmount', Value: 250 }, { Key: 'TransactionReceipt', Value: 'NLJ41HAY6Q' }] },
      },
    });
    await http().post('/v1/rails/payouts/mpesa/result').send(result('not-ours', sent.providerRef)).expect(400);
    const answer = await http().post('/v1/rails/payouts/mpesa/result').send(result(sent.railRef, sent.providerRef)).expect(200);
    expect(answer.body).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
    const listed = (await http().get(`/v1/sbg/entities/${ke}/payouts`).set(bearer(operator)).expect(200)).body;
    const paid = (Array.isArray(listed) ? listed : listed.items).find((p: { payoutId: string }) => p.payoutId === raised.payoutId);
    expect(paid).toMatchObject({ status: 'settled', providerRef: 'NLJ41HAY6Q', entryId: expect.any(String) });
    // Said twice by M-Pesa, paid once.
    await http().post('/v1/rails/payouts/mpesa/result').send(result(sent.railRef, sent.providerRef)).expect(200);
    const owed = -app.get(BooksService).balance(ke, ACCOUNT_CODES.PAYABLE_PROVIDER, undefined, courier.did);
    expect(owed).toBeCloseTo(0.75, 2);
  });
});
