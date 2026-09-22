import { MpesaConfig, MpesaFundingRail, accountReference, darajaDate, eastAfricanTimestamp, ipInCidr, maskMsisdn, mpesaConfigFromEnv, normaliseMsisdn } from './mpesa-funding-rail.adapter';
import { FundingRail, isPayment, RailNonPayment, RailPayment } from './funding.types';
import { normaliseReference } from './funding.service';

/**
 * THE M-PESA RAIL, DRIVEN WITHOUT A NETWORK.
 *
 * Every body in this file is a real Daraja payload, copied shape-for-shape from the API those callbacks
 * come from — an STK success with its `CallbackMetadata.Item` list, a cancellation with no metadata at
 * all, a C2B confirmation with every value a string. That is the point of the file: the rail's job is to
 * speak somebody else's dialect correctly, and a test written against a shape we invented would agree
 * with us about a conversation we are having with ourselves.
 *
 * What these tests can and cannot prove is worth being straight about. They prove we build the right
 * request, read the right answer, refuse the wrong provenance, and fall back rather than fail. They
 * cannot prove Safaricom accepts our credentials; nothing on a laptop can. That is a deployment step,
 * and it is written down as one.
 */
describe('the M-Pesa rail', () => {
  const CONFIG: MpesaConfig = {
    env: 'sandbox',
    consumerKey: 'ck_test',
    consumerSecret: 'cs_test',
    shortcode: '174379',
    kind: 'paybill',
    passkey: 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
    callbackBase: 'https://api.seebuyget.test',
  };

  /** Safaricom's own address ranges — the provenance every callback in this file has to arrive from. */
  const FROM_SAFARICOM = { ip: '196.201.214.200' };

  type Call = { url: string; init: RequestInit };
  let calls: Call[];

  /** A stand-in Daraja. Answers are queued per path so a test says only what it cares about. */
  const darajaAnswering = (answers: Record<string, unknown | (() => never)>) => {
    calls = [];
    return (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push({ url: href, init: init ?? {} });
      const key = Object.keys(answers).find((k) => href.includes(k));
      if (!key) throw new Error(`nothing queued for ${href}`);
      const answer = answers[key];
      if (typeof answer === 'function') (answer as () => never)();
      return { ok: true, status: 200, json: async () => answer } as Response;
    }) as unknown as typeof fetch;
  };

  const TOKEN = { access_token: 'tok_abc', expires_in: '3599' };
  const PUSH_ACCEPTED = {
    MerchantRequestID: '29115-34620561-1',
    CheckoutRequestID: 'ws_CO_191220191020363925',
    ResponseCode: '0',
    ResponseDescription: 'Success. Request accepted for processing',
    CustomerMessage: 'Success. Request accepted for processing',
  };

  const ask = (over: Partial<Parameters<MpesaFundingRail['open']>[0]> = {}) => ({
    fundingId: 'fnd_1',
    payerDid: 'did:shop:njeri',
    purpose: 'float' as const,
    amount: 5000,
    currency: 'KES',
    payerPhone: '0722334455',
    ...over,
  });

  /* ============================================================ asking to be paid == */

  describe('STK push — the main path', () => {
    it('asks Safaricom to make the payer’s phone ring, and says so', async () => {
      const rail = new MpesaFundingRail(CONFIG, darajaAnswering({ '/oauth/': TOKEN, '/stkpush/': PUSH_ACCEPTED }));
      const opened = await rail.open(ask());

      expect(opened.pushed).toBe(true);
      expect(opened.railRef).toBe('ws_CO_191220191020363925');
      // The words a shopkeeper reads name the phone, because a prompt on a handset in a drawer is a
      // prompt nobody answers.
      expect(opened.instructions).toContain('254722***455');
      // …and the fallback is in the same breath, not on a second screen.
      expect(opened.instructions).toContain('Paybill 174379');
    });

    it('builds the request Daraja actually expects', async () => {
      const rail = new MpesaFundingRail(CONFIG, darajaAnswering({ '/oauth/': TOKEN, '/stkpush/': PUSH_ACCEPTED }));
      const opened = await rail.open(ask());
      const push = calls.find((c) => c.url.includes('/stkpush/'))!;
      const body = JSON.parse(String(push.init.body));

      expect(push.url).toBe('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest');
      expect((push.init.headers as Record<string, string>).Authorization).toBe('Bearer tok_abc');
      expect(body.TransactionType).toBe('CustomerPayBillOnline');
      expect(body.Amount).toBe(5000);
      expect(body.PartyA).toBe('254722334455');
      expect(body.PhoneNumber).toBe('254722334455');
      expect(body.BusinessShortCode).toBe('174379');
      expect(body.PartyB).toBe('174379');
      expect(body.CallBackURL).toBe('https://api.seebuyget.test/v1/rails/funding/mpesa/callback');

      /*
       * THE PASSWORD IS DERIVED FROM THE TIMESTAMP BESIDE IT, and Daraja rejects a pair that disagrees
       * with a message naming neither. Checked by decoding rather than by recomputing, so a change to how
       * we build it cannot quietly agree with itself.
       */
      expect(Buffer.from(body.Password, 'base64').toString()).toBe(`174379${CONFIG.passkey}${body.Timestamp}`);
      expect(body.Timestamp).toMatch(/^\d{14}$/);
    });

    it('keeps the account reference inside Daraja’s twelve characters, and matching still finds it', async () => {
      const rail = new MpesaFundingRail(CONFIG, darajaAnswering({ '/oauth/': TOKEN, '/stkpush/': PUSH_ACCEPTED }));
      const opened = await rail.open(ask());
      const body = JSON.parse(String(calls.find((c) => c.url.includes('/stkpush/'))!.init.body));

      /*
       * THE CONSTRAINT THAT SHAPES THE WHOLE REFERENCE SCHEME. `SBG-QNTS-QP5D` is thirteen characters and
       * Safaricom truncates silently — producing a reference that matches nothing on the way back and a
       * payment nobody can attribute. Stripped it is eleven, and the service ignores separators and case
       * on both sides, so the printed form and the carried form are the same reference.
       */
      expect(opened.reference).toMatch(/^SBG-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(body.AccountReference.length).toBeLessThanOrEqual(12);
      expect(normaliseReference(body.AccountReference)).toBe(normaliseReference(opened.reference));
    });

    it('reuses its access token instead of fetching one per request', async () => {
      const rail = new MpesaFundingRail(CONFIG, darajaAnswering({ '/oauth/': TOKEN, '/stkpush/': PUSH_ACCEPTED }));
      await rail.open(ask());
      await rail.open(ask({ fundingId: 'fnd_2' }));
      expect(calls.filter((c) => c.url.includes('/oauth/'))).toHaveLength(1);
    });
  });

  /* ================================================================ the fallback == */

  describe('the paybill — the fallback', () => {
    it('sends no prompt when the payer gave no number', async () => {
      const rail = new MpesaFundingRail(CONFIG, darajaAnswering({}));
      const opened = await rail.open(ask({ payerPhone: undefined }));

      expect(opened.pushed).toBeFalsy();
      expect(opened.instructions).toContain('Paybill 174379');
      // Not an error and not worth reporting as one: nobody asked for a prompt.
      expect(opened.pushError).toBeUndefined();
      expect(calls).toHaveLength(0);
    });

    it('falls back, rather than failing, when Safaricom refuses the push', async () => {
      const refused = { ResponseCode: '1', ResponseDescription: 'Unable to lock subscriber, a transaction is already in process' };
      const rail = new MpesaFundingRail(CONFIG, darajaAnswering({ '/oauth/': TOKEN, '/stkpush/': refused }));
      const opened = await rail.open(ask());

      expect(opened.pushed).toBeFalsy();
      expect(opened.instructions).toContain('Paybill 174379');
      // The reason is kept, because "no prompt came" is the first thing a shopkeeper rings about.
      expect(opened.pushError).toMatch(/already in process/);
    });

    it('falls back when Safaricom cannot be reached at all', async () => {
      const rail = new MpesaFundingRail(CONFIG, darajaAnswering({ '/oauth/': () => { throw new Error('ECONNREFUSED'); } }));
      const opened = await rail.open(ask());
      expect(opened.pushed).toBeFalsy();
      expect(opened.instructions).toContain('Paybill 174379');
    });

    it('will not round a payer’s amount to fit a prompt', async () => {
      const rail = new MpesaFundingRail(CONFIG, darajaAnswering({}));
      const opened = await rail.open(ask({ amount: 1500.5 }));

      /*
       * Daraja takes whole shillings only. Rounding would ask the phone for a figure the shop never
       * typed, and — because the books move by what the RAIL says arrived — the request and the payment
       * would disagree for ever by a few cents nobody could explain.
       */
      expect(opened.pushed).toBeFalsy();
      expect(opened.pushError).toMatch(/whole shillings/);
      expect(opened.instructions).toContain('1500.5 KES');
    });

    it('says plainly that it cannot take a currency it cannot take', async () => {
      const rail = new MpesaFundingRail(CONFIG, darajaAnswering({}));
      const opened = await rail.open(ask({ currency: 'ETB', amount: 5000 }));

      expect(opened.pushed).toBeFalsy();
      expect(opened.instructions).toContain('M-Pesa cannot take ETB');
      // …and no paybill number, because paying it into a Kenyan shortcode is not the answer.
      expect(opened.instructions).not.toContain('174379');
    });

    it('offers a till instead of a paybill where the shortcode is one', async () => {
      const rail = new MpesaFundingRail({ ...CONFIG, kind: 'till' }, darajaAnswering({ '/oauth/': TOKEN, '/stkpush/': PUSH_ACCEPTED }));
      const opened = await rail.open(ask());
      const body = JSON.parse(String(calls.find((c) => c.url.includes('/stkpush/'))!.init.body));

      expect(body.TransactionType).toBe('CustomerBuyGoodsOnline');
      expect(opened.instructions).toContain('Buy Goods till 174379');
    });
  });

  /* ============================================================== coming back in == */

  describe('an STK callback', () => {
    /** Safaricom's own success body, shape for shape. */
    const PAID = {
      Body: {
        stkCallback: {
          MerchantRequestID: '29115-34620561-1',
          CheckoutRequestID: 'ws_CO_191220191020363925',
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 5000 },
              { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
              { Name: 'TransactionDate', Value: 20191219102115 },
              { Name: 'PhoneNumber', Value: 254722334455 },
            ],
          },
        },
      },
    };

    /** …and a cancellation, which carries no metadata at all. */
    const CANCELLED = {
      Body: {
        stkCallback: {
          MerchantRequestID: '29115-34620561-1',
          CheckoutRequestID: 'ws_CO_191220191020363925',
          ResultCode: 1032,
          ResultDesc: 'Request cancelled by user',
        },
      },
    };

    const railThatPushed = async (answers: Record<string, unknown | (() => never)> = {}) => {
      const rail = new MpesaFundingRail(CONFIG, darajaAnswering({ '/oauth/': TOKEN, '/stkpush/': PUSH_ACCEPTED, ...answers }));
      const opened = await rail.open(ask());
      return { rail, reference: opened.reference };
    };

    it('reads a paid callback, and knows whose it is', async () => {
      const { rail, reference } = await railThatPushed({ '/stkpushquery/': { ResultCode: '0', ResultDesc: 'The service request is processed successfully.' } });
      const out = (await rail.verify({}, PAID, FROM_SAFARICOM)) as RailPayment;

      expect(isPayment(out)).toBe(true);
      expect(out.providerRef).toBe('NLJ7RT61SV');
      expect(out.amount).toBe(5000);
      expect(out.currency).toBe('KES');
      /*
       * THE CALLBACK DOES NOT CARRY OUR REFERENCE — it never does. Only the CheckoutRequestID comes back,
       * so the rail looks up what `open` remembered. Forget this and every successful STK payment lands
       * in the unattributable pile.
       */
      expect(out.reference).toBe(reference);
      // Daraja's 20191219102115 is East Africa Time; stored as the instant it was.
      expect(out.paidAt).toBe('2019-12-19T07:21:15.000Z');
      expect(out.payerLabel).toContain('254722***455');
    });

    it('reports a cancelled prompt as an answer, not as an error', async () => {
      const { rail } = await railThatPushed();
      const out = await rail.verify({}, CANCELLED, FROM_SAFARICOM);

      /*
       * The most ordinary outcome M-Pesa has. Thrown, it would be answered 4xx — and Safaricom retries
       * anything that is not a 200 until it gets one, about a thing that will never change.
       */
      expect(isPayment(out)).toBe(false);
      const refused = out as RailNonPayment;
      expect(refused.reason).toBe('Request cancelled by user');
      expect(refused.railRef).toBe('ws_CO_191220191020363925');
    });

    it('refuses a paid callback the provider’s own records contradict', async () => {
      const { rail } = await railThatPushed({ '/stkpushquery/': { ResultCode: '1032', ResultDesc: 'Request cancelled by user' } });
      await expect(rail.verify({}, PAID, FROM_SAFARICOM)).rejects.toThrow(/says this checkout was not paid/);
    });

    it('accepts on provenance alone when the provider cannot be asked', async () => {
      /*
       * Daraja routinely answers "the transaction is being processed" to a query made in the same second
       * as its own callback. Refusing money on the strength of our own timing would mean a shop that paid
       * standing at a counter being told nothing arrived.
       */
      const { rail } = await railThatPushed({ '/stkpushquery/': () => { throw new Error('ETIMEDOUT'); } });
      const out = (await rail.verify({}, PAID, FROM_SAFARICOM)) as RailPayment;
      expect(out.providerRef).toBe('NLJ7RT61SV');
    });

    it('…unless the deployment asked not to guess', async () => {
      const rail = new MpesaFundingRail(
        { ...CONFIG, strictQuery: true },
        darajaAnswering({ '/oauth/': TOKEN, '/stkpush/': PUSH_ACCEPTED, '/stkpushquery/': () => { throw new Error('ETIMEDOUT'); } }),
      );
      await rail.open(ask());
      await expect(rail.verify({}, PAID, FROM_SAFARICOM)).rejects.toThrow(/Could not confirm this payment with M-Pesa/);
    });

    it('records a payment it cannot attribute rather than refusing it at the door', async () => {
      // A restart between the prompt and the PIN, or a callback for a checkout this instance never made.
      const rail = new MpesaFundingRail(CONFIG, darajaAnswering({ '/oauth/': TOKEN, '/stkpushquery/': { ResultCode: '0' } }));
      const out = (await rail.verify({}, PAID, FROM_SAFARICOM)) as RailPayment;

      expect(out.providerRef).toBe('NLJ7RT61SV');
      // No reference — the service puts it in the unmatched pile, which is exactly what it is for. The
      // money is real either way; somebody has to say whose.
      expect(out.reference).toBeUndefined();
    });

    it('refuses a paid callback with no receipt number on it', async () => {
      const { rail } = await railThatPushed();
      const noReceipt = { Body: { stkCallback: { ...PAID.Body.stkCallback, CallbackMetadata: { Item: [{ Name: 'Amount', Value: 5000 }] } } } };
      await expect(rail.verify({}, noReceipt, FROM_SAFARICOM)).rejects.toThrow(/receipt number/);
    });
  });

  describe('a C2B paybill confirmation', () => {
    /** Safaricom's confirmation body — flat, every value a string, the reference in BillRefNumber. */
    const CONFIRMATION = {
      TransactionType: 'Pay Bill',
      TransID: 'RKTQDM7W6S',
      TransTime: '20191122063845',
      TransAmount: '400.00',
      BusinessShortCode: '174379',
      BillRefNumber: 'SBGQNTSQP5D',
      OrgAccountBalance: '49197.00',
      MSISDN: '254722334455',
      FirstName: 'John',
      LastName: 'Doe',
    };

    it('reads the payer’s own reference off it', async () => {
      const rail = new MpesaFundingRail(CONFIG, darajaAnswering({}));
      const out = (await rail.verify({}, CONFIRMATION, FROM_SAFARICOM)) as RailPayment;

      expect(out.providerRef).toBe('RKTQDM7W6S');
      expect(out.amount).toBe(400);
      expect(out.reference).toBe('SBGQNTSQP5D');
      expect(out.paidAt).toBe('2019-11-22T03:38:45.000Z');
      expect(out.payerLabel).toContain('John Doe');
      // No query is made: the Transaction Status API answers to a result URL minutes later, so there is
      // nothing to ask right now. A named gap, not an oversight.
      expect(calls).toHaveLength(0);
    });

    it('holds a payment made with no reference at all, instead of guessing', async () => {
      const rail = new MpesaFundingRail(CONFIG, darajaAnswering({}));
      const out = (await rail.verify({}, { ...CONFIRMATION, BillRefNumber: '' }, FROM_SAFARICOM)) as RailPayment;
      expect(out.reference).toBeUndefined();
    });

    it('refuses money paid into somebody else’s shortcode', async () => {
      const rail = new MpesaFundingRail(CONFIG, darajaAnswering({}));
      await expect(rail.verify({}, { ...CONFIRMATION, BusinessShortCode: '999999' }, FROM_SAFARICOM)).rejects.toThrow(/not ours/);
    });
  });

  /* =================================================================== the door == */

  describe('provenance, which is all an unsigned callback has', () => {
    const rail = () => new MpesaFundingRail(CONFIG, darajaAnswering({}));
    const C2B = { TransID: 'RKTQDM7W6S', TransAmount: '400', BusinessShortCode: '174379', BillRefNumber: 'SBGQNTSQP5D' };

    it('refuses a callback from anywhere but Safaricom', async () => {
      await expect(rail().verify({}, C2B, { ip: '203.0.113.7' })).rejects.toThrow(/did not come from M-Pesa/);
    });

    it('refuses one that arrived from nowhere we can name', async () => {
      await expect(rail().verify({}, C2B, {})).rejects.toThrow(/unknown address/);
    });

    it('accepts one from a published range, through an IPv4-in-IPv6 socket', async () => {
      const out = (await rail().verify({}, C2B, { ip: '::ffff:196.201.214.200' })) as RailPayment;
      expect(out.providerRef).toBe('RKTQDM7W6S');
    });

    it('takes a callback from this machine in a sandbox, and refuses one in production', async () => {
      /*
       * FOUND BY WALKING THE PATH, NOT BY A TEST. The first version allowed loopback everywhere so the
       * whole flow could be exercised on a laptop — and a script posting a made-up payment from the same
       * host was credited, which is what a compromised sidecar or an SSRF in our own code would do. Worse:
       * behind nginx on the same machine every caller looks like 127.0.0.1, so the allowlist would have
       * been off for the entire internet while appearing to work.
       */
      const out = (await rail().verify({}, C2B, { ip: '127.0.0.1' })) as RailPayment;
      expect(out.providerRef).toBe('RKTQDM7W6S');

      const live = process.env.GLOS_ENV;
      process.env.GLOS_ENV = 'production';
      try {
        await expect(rail().verify({}, C2B, { ip: '127.0.0.1' })).rejects.toThrow(/from this machine rather than from M-Pesa/);
      } finally {
        if (live === undefined) delete process.env.GLOS_ENV;
        else process.env.GLOS_ENV = live;
      }
    });

    it('checks the address before it reads the body, so a prober learns nothing', async () => {
      // A body we would refuse anyway — the address refusal is the one that comes back.
      await expect(rail().verify({}, { nonsense: true }, { ip: '203.0.113.7' })).rejects.toThrow(/did not come from M-Pesa/);
    });

    it('has no way to stand in for the provider', () => {
      // The sandbox rail can sign a callback for a demo. A live one must not be able to: a payment is
      // confirmed by Safaricom and by nobody wearing our badge. Asserted through the interface, because
      // the class does not declare `simulate` at all — reaching for it directly does not compile, which
      // is the stronger guarantee and the reason this reads the way it does.
      const asRail: FundingRail = rail();
      expect(asRail.simulate).toBeUndefined();
    });
  });

  /* ====================================================================== bits == */

  describe('the small things that decide whether any of it works', () => {
    it('matches a CIDR by prefix, never by string', () => {
      expect(ipInCidr('196.201.214.200', '196.201.214.0/24')).toBe(true);
      expect(ipInCidr('196.201.215.200', '196.201.214.0/24')).toBe(false);
      /*
       * The bug this exists to prevent: `'196.201.214.100'.startsWith('196.201.214.1')` is true, and a
       * range written as a bare address would have admitted a hundred neighbours.
       */
      expect(ipInCidr('196.201.214.100', '196.201.214.1/32')).toBe(false);
      expect(ipInCidr('196.201.214.1', '196.201.214.1/32')).toBe(true);
      expect(ipInCidr('not an address', '196.201.214.0/24')).toBe(false);
      expect(ipInCidr('196.201.214.200', 'rubbish')).toBe(false);
    });

    it('takes a Kenyan number however it was written', () => {
      expect(normaliseMsisdn('0722334455')).toBe('254722334455');
      expect(normaliseMsisdn('+254 722 334 455')).toBe('254722334455');
      expect(normaliseMsisdn('254722334455')).toBe('254722334455');
      expect(normaliseMsisdn('722334455')).toBe('254722334455');
      expect(normaliseMsisdn('0110334455')).toBe('254110334455'); // the newer 01 prefixes
    });

    it('refuses to guess at one it does not recognise', () => {
      /*
       * A prompt sent to a number we guessed at is a PIN request landing on a stranger's phone. Better no
       * prompt than that — the payer gets the paybill.
       */
      expect(normaliseMsisdn('+256772123456')).toBeUndefined(); // Ugandan
      expect(normaliseMsisdn('12345')).toBeUndefined();
      expect(normaliseMsisdn('')).toBeUndefined();
      expect(normaliseMsisdn(undefined)).toBeUndefined();
    });

    it('shows enough of a number to recognise your own and no more', () => {
      expect(maskMsisdn('254722334455')).toBe('254722***455');
    });

    it('stamps the timestamp in East Africa Time whatever the server thinks it is', () => {
      // 2019-12-19T07:21:15Z is 10:21:15 in Nairobi.
      expect(eastAfricanTimestamp(Date.parse('2019-12-19T07:21:15Z'))).toBe('20191219102115');
    });

    it('reads their timestamps back as the instant they were', () => {
      expect(darajaDate(20191219102115)).toBe('2019-12-19T07:21:15.000Z');
      expect(darajaDate('20191122063845')).toBe('2019-11-22T03:38:45.000Z');
      expect(darajaDate('nonsense')).toBeUndefined();
      expect(darajaDate(undefined)).toBeUndefined();
    });

    it('keeps a reference inside twelve characters without changing what it means', () => {
      // Our own scheme strips to eleven, so this assertion alone proves nothing about the limit — a
      // mutation run caught exactly that: slicing at 13 instead of 12 changed no test.
      expect(accountReference('SBG-QNTS-QP5D')).toBe('SBGQNTSQP5D');
      expect(normaliseReference('SBG-QNTS-QP5D')).toBe(accountReference('SBG-QNTS-QP5D'));

      /*
       * So the boundary is exercised with something that actually crosses it. Safaricom truncates a
       * longer AccountReference silently, and a reference truncated on the way out matches nothing on
       * the way back — the payment is real, attributable to nobody, and the shop is told nothing arrived.
       */
      expect(accountReference('SBG-ABCDEFGH-IJKLMNOP')).toHaveLength(12);
      expect(accountReference('SBG-ABCDEFGH-IJKLMNOP')).toBe('SBGABCDEFGHI');
    });
  });

  describe('which rail a deployment gets', () => {
    const FULL = {
      GLOS_MPESA_CONSUMER_KEY: 'ck',
      GLOS_MPESA_CONSUMER_SECRET: 'cs',
      GLOS_MPESA_SHORTCODE: '174379',
      GLOS_MPESA_PASSKEY: 'pk',
      GLOS_MPESA_CALLBACK_BASE: 'https://api.seebuyget.test/',
    };

    it('is configured only when it could actually work', () => {
      expect(mpesaConfigFromEnv(FULL as NodeJS.ProcessEnv)).toMatchObject({ env: 'sandbox', shortcode: '174379', kind: 'paybill' });
      // A trailing slash on the base would produce a double slash in the callback URL Daraja is given.
      expect(mpesaConfigFromEnv(FULL as NodeJS.ProcessEnv)?.callbackBase).toBe('https://api.seebuyget.test');
    });

    it('is NOT configured when any one piece is missing', () => {
      /*
       * There is deliberately no `GLOS_USE_MPESA=1`. A boolean beside an incomplete configuration is how
       * a deployment ends up with a rail that takes top-up requests and can neither prompt anybody nor be
       * called back — which fails in the one place nobody is looking.
       */
      for (const missing of Object.keys(FULL)) {
        const partial = { ...FULL, [missing]: '' };
        expect(mpesaConfigFromEnv(partial as NodeJS.ProcessEnv)).toBeNull();
      }
    });

    it('reads production, the till kind, and an overridden allowlist', () => {
      const config = mpesaConfigFromEnv({
        ...FULL,
        GLOS_MPESA_ENV: 'production',
        GLOS_MPESA_SHORTCODE_KIND: 'till',
        GLOS_MPESA_ALLOWED_IPS: '196.201.214.0/24, 10.0.0.0/8',
        GLOS_MPESA_STRICT_QUERY: '1',
      } as NodeJS.ProcessEnv);
      expect(config).toMatchObject({ env: 'production', kind: 'till', strictQuery: true, allowedCidrs: ['196.201.214.0/24', '10.0.0.0/8'] });
    });
  });
});
