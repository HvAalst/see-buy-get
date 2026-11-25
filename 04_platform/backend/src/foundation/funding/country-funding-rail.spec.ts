import { CountryFundingRail } from './country-funding-rail';
import { MollieFundingRail } from './mollie-funding-rail.adapter';
import type { FundingInstruction, FundingRail, RailPayment } from './funding.types';

/*
 * 2026-11-24 — THE PAYMENT HUB CHOOSES BY COUNTRY (the owner: "the system will choose the right method depending on the country
 * without the user noticing it"): euros through our own Mollie account, every other money as before; each provider's notices
 * reach its own rail; a payment page asks no phone number.
 */
const instruction = (currency: string): FundingInstruction => ({ fundingId: 'fnd_1', payerDid: 'did:person:anna', purpose: 'load', amount: 42.5, currency });
const mpesa = (): FundingRail & { opened: FundingInstruction[]; asked: RailPayment[] } => {
  const self = {
    provider: 'mpesa',
    opened: [] as FundingInstruction[],
    asked: [] as RailPayment[],
    open: async (i: FundingInstruction) => (self.opened.push(i), { reference: 'MP1', instructions: 'Pay by M-Pesa', pushed: true }),
    verify: async () => ({ provider: 'mpesa', providerRef: 'X', amount: 1, currency: 'KES' }),
    canAsk: () => true,
    askAbout: async (p: RailPayment) => (self.asked.push(p), { askedRef: 'Q1' }),
    simulate: () => ({ headers: {}, body: { ok: true } }),
  };
  return self;
};

describe('the payment hub, by the money paid in', () => {
  it('opens euros through Mollie and every other money through the rail it always had, saying which', async () => {
    const base = mpesa();
    const euros = { provider: 'mollie', open: async () => ({ reference: 'R1', instructions: 'Pay on the iDEAL page that opens.', link: 'https://pay.example/x', railRef: 'tr_1' }), verify: async () => ({ provider: 'mollie', paid: false as const, reason: 'x' }) } as FundingRail;
    const hub = new CountryFundingRail({ EUR: euros }, base);
    expect(await hub.open(instruction('EUR'))).toEqual({ reference: 'R1', instructions: 'Pay on the iDEAL page that opens.', link: 'https://pay.example/x', railRef: 'tr_1', provider: 'mollie' });
    expect(await hub.open(instruction('KES'))).toMatchObject({ reference: 'MP1', provider: 'mpesa', pushed: true });
    expect(base.opened.map((i) => i.currency)).toEqual(['KES']);
    // Each provider's notices to its own rail; a phone only where the rail rings one; the sandbox's stand-in passes through.
    expect(hub.forProvider('mollie')).toBe(euros);
    expect(hub.forProvider('mpesa')).toBe(base);
    expect(hub.forProvider('nobody')).toBeUndefined();
    expect(hub.needsPhone('EUR')).toBe(false);
    expect(hub.needsPhone('KES')).toBe(true);
    expect(hub.provider).toBe('mpesa');
    expect(hub.simulate).toBeDefined();
    // A paybill payment is asked about through the rail that carried it.
    await hub.askAbout({ provider: 'mpesa', providerRef: 'P1', amount: 10, currency: 'KES' });
    expect(base.asked).toHaveLength(1);
    await expect(hub.askAbout({ provider: 'mollie', providerRef: 'tr_1', amount: 10, currency: 'EUR' })).rejects.toThrow(/mollie cannot be asked/);
  });
});

describe('euros paid to us through Mollie', () => {
  const mollieWith = (answer: Record<string, unknown>, own: { bearer: string; testmode: boolean } | null = { bearer: 'test_key', testmode: true }) => {
    const made: Array<{ body: Record<string, unknown>; key: string }> = [];
    const asked: string[] = [];
    const svc = {
      ownToken: () => own,
      cfg: { publicBase: 'https://app.seebuyget.example' },
      api: () => ({
        createPayment: async (_b: string, body: Record<string, unknown>, key: string) => (made.push({ body, key }), { id: 'tr_abc123', _links: { checkout: { href: 'https://www.mollie.com/checkout/abc' } } }),
        getPayment: async (_b: string, id: string) => (asked.push(id), answer),
      }),
    };
    return { rail: new MollieFundingRail(svc as never), made, asked };
  };

  it('opens an iDEAL payment on our own account, its page to open and its notice to our door', async () => {
    const { rail, made } = mollieWith({});
    expect(rail.ready()).toBe(true);
    const opened = await rail.open(instruction('eur'));
    expect(opened).toMatchObject({ railRef: 'tr_abc123', link: 'https://www.mollie.com/checkout/abc', provider: 'mollie', instructions: 'Pay on the iDEAL page that opens.' });
    expect(opened.reference).toMatch(/^[2-9A-Z]{8}$/);
    expect(made[0]).toMatchObject({ key: 'funding-fnd_1', body: { amount: { currency: 'EUR', value: '42.50' }, method: 'ideal', webhookUrl: 'https://app.seebuyget.example/v1/rails/funding/mollie/callback', metadata: { fundingId: 'fnd_1', reference: opened.reference } } });
    // Not set up: nothing is opened.
    expect(mollieWith({}, null).rail.ready()).toBe(false);
    await expect(mollieWith({}, null).rail.open(instruction('EUR'))).rejects.toThrow(/Paying online is not set up here yet/);
  });

  it('believes Mollie, not the notice: paid is money with our reference; failed, cancelled or expired is no money; open is not yet', async () => {
    const paid = mollieWith({ status: 'paid', amount: { value: '42.50', currency: 'EUR' }, metadata: { reference: 'ABCD2345' }, paidAt: '2026-11-24T10:00:00Z' });
    expect(await paid.rail.verify({}, { id: 'tr_abc123' })).toEqual({ provider: 'mollie', providerRef: 'tr_abc123', reference: 'ABCD2345', amount: 42.5, currency: 'EUR', paidAt: '2026-11-24T10:00:00Z', payerLabel: 'iDEAL' });
    expect(paid.asked).toEqual(['tr_abc123']);
    expect(await mollieWith({ status: 'canceled' }).rail.verify({}, { id: 'tr_abc123' })).toEqual({ provider: 'mollie', paid: false, railRef: 'tr_abc123', reason: 'The payment was cancelled' });
    expect(await mollieWith({ status: 'expired' }).rail.verify({}, { id: 'tr_abc123' })).toMatchObject({ paid: false, reason: 'The payment was not made in time' });
    await expect(mollieWith({ status: 'open' }).rail.verify({}, { id: 'tr_abc123' })).rejects.toThrow(/not final yet/);
    await expect(paid.rail.verify({}, { id: 'not-a-payment' })).rejects.toThrow(/names its payment/);
  });
});
