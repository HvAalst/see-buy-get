import { PersonLoadPayService } from './person-load-pay.service';

/**
 * 2026-11-24 — A PERSON'S LOAD PAID FIRST, BY THE COUNTRY'S WAY (route plan part 9; the owner: "the system will choose the right
 * method depending on the country without the user noticing it"): where the payment hub's rail for the money rings a phone
 * (M-Pesa), the number is asked; where it opens a page (iDEAL through Mollie), no number is asked and the page comes back.
 */
describe('a person’s load paid first, by the way of its country’s money', () => {
  const world = (currency: string, ringsPhone: boolean) => {
    const opened: Array<Record<string, unknown>> = [];
    const dispatch = {
      requireFreightPublic: () => ({ freightId: 'frt_1', code: 'FRT-1', postedByDid: 'did:person:anna', escrow: true, sellerEntityId: 'sbg-x', status: 'available' }),
      requireProposalPublic: () => ({ proposalId: 'prp_1', freightId: 'frt_1', status: 'open', price: 100, driverDid: 'did:drv:1' }),
      chargeFor: () => 110,
      holdForPayment: () => undefined,
    };
    const funding = {
      needsPhone: () => ringsPhone,
      open: async (input: Record<string, unknown>) => (opened.push(input), { fundingId: 'fnd_1', reference: 'REF2345', instructions: ringsPhone ? 'Check your phone' : 'Pay on the iDEAL page that opens.', ...(ringsPhone ? { pushed: true } : { link: 'https://www.mollie.com/checkout/x' }) }),
    };
    const entities = { get: () => ({ entityId: 'sbg-x', currency }) };
    const svc = new PersonLoadPayService(dispatch as never, funding as never, {} as never, entities as never, {} as never);
    return { svc, opened };
  };

  it('in euros: no number asked; the page to pay on comes back, and nothing rings', async () => {
    const { svc, opened } = world('EUR', false);
    const view = await svc.pay('did:person:anna', 'frt_1', { proposalId: 'prp_1' });
    expect(view).toMatchObject({ state: 'awaiting', amount: 110, currency: 'EUR', link: 'https://www.mollie.com/checkout/x' });
    expect(view.phoneMasked).toBeUndefined();
    expect(opened[0]).toEqual({ payerKind: 'person', payerDid: 'did:person:anna', purpose: 'load', amount: 110 });
  });

  it('in shillings: the number is asked, refused without it, and rung', async () => {
    const { svc, opened } = world('KES', true);
    await expect(svc.pay('did:person:anna', 'frt_1', { proposalId: 'prp_1' })).rejects.toThrow(/Give the number M-Pesa should ask/);
    expect(opened).toHaveLength(0);
    const view = await svc.pay('did:person:anna', 'frt_1', { proposalId: 'prp_1', phone: '+254711000111' });
    expect(view).toMatchObject({ phoneMasked: expect.stringContaining('254'), pushed: true });
    expect(view.link).toBeUndefined();
    expect(opened[0]).toMatchObject({ payerPhone: '+254711000111', amount: 110 });
  });
});
