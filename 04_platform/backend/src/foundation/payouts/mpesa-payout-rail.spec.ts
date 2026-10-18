import { MpesaPayoutRail, mpesaPayoutConfigFromEnv, type MpesaPayoutConfig } from './mpesa-payout-rail.adapter';

/**
 * PAYING OUT BY M-PESA, against a stand-in Daraja. What it sends (a business payment to the payee's own number, with an
 * id of ours), the three answers it gives (taken, refused, unknown — never "refused" for an answer it could not read),
 * and which results it takes: from Safaricom's addresses, about a request of ours, for the amount we sent.
 */
describe('the M-Pesa payout rail', () => {
  const CONFIG: MpesaPayoutConfig = {
    env: 'sandbox',
    consumerKey: 'key',
    consumerSecret: 'secret',
    shortcode: '600999',
    initiator: 'sbg-api',
    securityCredential: 'ENCRYPTED==',
    callbackBase: 'https://sbg.example',
  };
  const FROM_SAFARICOM = { ip: '196.201.214.200' };
  let calls: Array<{ url: string; body?: Record<string, unknown> }> = [];

  /** Daraja, answering each path with what it is given — or failing the way a line does. */
  const daraja = (b2c: { status?: number; json?: unknown; fail?: string }) => {
    calls = [];
    return (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (String(url).includes('/oauth/')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: '3599' }) } as Response;
      if (b2c.fail) throw new Error(b2c.fail);
      const status = b2c.status ?? 200;
      return { ok: status < 400, status, json: async () => b2c.json ?? {} } as Response;
    }) as unknown as typeof fetch;
  };
  const accepted = { ConversationID: 'AG_20261018_1', OriginatorConversationID: 'x', ResponseCode: '0', ResponseDescription: 'Accept the service request successfully.' };
  const pay = { payoutId: 'pay_1', payeeDid: 'did:courier', amount: 400, currency: 'KES', msisdn: '254712345678' };

  it('sends a business payment, from our shortcode to the payee’s own number, with an id of ours and our result URLs', async () => {
    const rail = new MpesaPayoutRail(CONFIG, daraja({ json: accepted }));
    const outcome = await rail.submit(pay);
    const sent = calls.find((c) => c.url.includes('/mpesa/b2c/v3/paymentrequest'))!;
    expect(sent.body).toMatchObject({
      InitiatorName: 'sbg-api',
      SecurityCredential: 'ENCRYPTED==',
      CommandID: 'BusinessPayment',
      Amount: 400,
      PartyA: '600999',
      PartyB: '254712345678',
      ResultURL: 'https://sbg.example/v1/rails/payouts/mpesa/result',
      QueueTimeOutURL: 'https://sbg.example/v1/rails/payouts/mpesa/timeout',
      Occasion: 'pay_1',
    });
    expect(outcome).toEqual({ taken: true, railRef: sent.body!.OriginatorConversationID, providerRef: 'AG_20261018_1' });
  });

  it('says refused only when Daraja refused — and unknown when it could not tell', async () => {
    expect(await new MpesaPayoutRail(CONFIG, daraja({ status: 400, json: { errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid PartyB' } })).submit(pay)).toEqual({
      taken: false,
      refused: 'Bad Request - Invalid PartyB',
    });
    expect(await new MpesaPayoutRail(CONFIG, daraja({ json: { ResponseCode: '1', ResponseDescription: 'Rejected' } })).submit(pay)).toEqual({ taken: false, refused: 'Rejected' });
    const lost = await new MpesaPayoutRail(CONFIG, daraja({ fail: 'socket hang up' })).submit(pay);
    expect(lost).toMatchObject({ taken: 'unknown', railRef: expect.any(String), why: expect.stringMatching(/may have gone/) });
    expect(await new MpesaPayoutRail(CONFIG, daraja({ status: 503, json: {} })).submit(pay)).toMatchObject({ taken: 'unknown' });
  });

  it('pays only Kenyan shillings, in whole shillings, to a number — refused before anything is sent', async () => {
    const rail = new MpesaPayoutRail(CONFIG, daraja({ json: accepted }));
    expect(await rail.submit({ ...pay, currency: 'ETB' })).toMatchObject({ taken: false, refused: expect.stringMatching(/Kenyan shillings/) });
    expect(await rail.submit({ ...pay, amount: 40.5 })).toMatchObject({ taken: false, refused: expect.stringMatching(/whole shillings/) });
    expect(await rail.submit({ ...pay, msisdn: undefined })).toMatchObject({ taken: false });
    expect(calls).toEqual([]);
  });

  describe('its results', () => {
    const resultFor = (originatorId: string, over: Record<string, unknown> = {}) => ({
      Result: {
        ResultType: 0,
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        OriginatorConversationID: originatorId,
        ConversationID: 'AG_20261018_1',
        TransactionID: 'NLJ41HAY6Q',
        ResultParameters: { ResultParameter: [{ Key: 'TransactionAmount', Value: 400 }, { Key: 'TransactionReceipt', Value: 'NLJ41HAY6Q' }] },
        ...over,
      },
    });
    const sent = async () => {
      const rail = new MpesaPayoutRail(CONFIG, daraja({ json: accepted }));
      const outcome = (await rail.submit(pay)) as { railRef: string };
      return { rail, id: outcome.railRef };
    };

    it('settles on a paid result about a request of ours — once', async () => {
      const { rail, id } = await sent();
      expect(rail.result(resultFor(id), FROM_SAFARICOM)).toEqual({ payoutId: 'pay_1', paid: true, receipt: 'NLJ41HAY6Q', amount: 400 });
      expect(rail.result(resultFor(id), FROM_SAFARICOM)).toEqual({ payoutId: 'pay_1', repeat: true });
    });

    it('says not paid, with M-Pesa’s words, on a result that is not a success', async () => {
      const { rail, id } = await sent();
      expect(rail.result(resultFor(id, { ResultCode: 2001, ResultDesc: 'The initiator information is invalid.' }), FROM_SAFARICOM)).toEqual({
        payoutId: 'pay_1',
        paid: false,
        reason: 'The initiator information is invalid.',
      });
    });

    it('takes nobody’s word but Safaricom’s, about a request of ours, for the amount we sent', async () => {
      const { rail, id } = await sent();
      expect(() => rail.result(resultFor(id), { ip: '41.90.1.1' })).toThrow(/did not come from M-Pesa/);
      expect(() => rail.result(resultFor('somebody-else'), FROM_SAFARICOM)).toThrow(/not about a payout we sent/);
      expect(() => rail.result(resultFor(id, { ConversationID: 'AG_OTHER' }), FROM_SAFARICOM)).toThrow(/different M-Pesa conversation/);
      const short = rail.result(resultFor(id, { ResultParameters: { ResultParameter: [{ Key: 'TransactionAmount', Value: 4000 }, { Key: 'TransactionReceipt', Value: 'NLJ41HAY6Q' }] } }), FROM_SAFARICOM);
      expect(short).toMatchObject({ payoutId: 'pay_1', unsure: expect.stringMatching(/paid 4000, not 400/) });
    });

    it('says a timed-out queue is not known to be paid or not', async () => {
      const { rail, id } = await sent();
      expect(rail.timeout(resultFor(id, { ResultCode: 1, ResultDesc: 'The service request has timed out.' }), FROM_SAFARICOM)).toMatchObject({ payoutId: 'pay_1', unsure: expect.stringMatching(/queue timed out/) });
    });

    it('takes a result from this machine only in a sandbox', async () => {
      const { rail, id } = await sent();
      const before = process.env.GLOS_ENV;
      process.env.GLOS_ENV = 'production';
      try {
        expect(() => rail.result(resultFor(id), { ip: '127.0.0.1' })).toThrow(/from this machine/);
      } finally {
        if (before === undefined) delete process.env.GLOS_ENV;
        else process.env.GLOS_ENV = before;
      }
      expect(rail.result(resultFor(id), { ip: '::ffff:127.0.0.1' })).toMatchObject({ paid: true });
    });
  });

  it('is set up only when every piece is given', () => {
    const env = {
      GLOS_MPESA_CONSUMER_KEY: 'k',
      GLOS_MPESA_CONSUMER_SECRET: 's',
      GLOS_MPESA_B2C_SHORTCODE: '600999',
      GLOS_MPESA_B2C_INITIATOR: 'sbg-api',
      GLOS_MPESA_B2C_SECURITY_CREDENTIAL: 'ENC',
      GLOS_MPESA_CALLBACK_BASE: 'https://sbg.example/',
    };
    expect(mpesaPayoutConfigFromEnv(env)).toMatchObject({ env: 'sandbox', shortcode: '600999', callbackBase: 'https://sbg.example' });
    expect(mpesaPayoutConfigFromEnv({ ...env, GLOS_MPESA_ENV: 'production' })?.env).toBe('production');
    expect(mpesaPayoutConfigFromEnv({ ...env, GLOS_MPESA_B2C_SECURITY_CREDENTIAL: '' })).toBeNull();
  });
});
