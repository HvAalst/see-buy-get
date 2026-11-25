import { LoadPostingService } from './load-posting.service';
import type { DispatchService } from './dispatch.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import type { BusinessClientService } from './business-client.service';
import type { RegisterFreightDto } from './pudo.dto';

/**
 * 2026-11-24 — WHEN A PERSON PAYS FOR A LOAD THEY POST (route plan part 9; the owner: "sender can choose: QR or iDeal", and "the
 * system will choose the right method depending on the country without the user noticing it"): to the driver at pickup where the
 * driver can ask for it by QR; now, held until delivery, where a company of ours may hold money; else the driver directly.
 */
describe('when a person pays for a load they post', () => {
  const made: Array<Record<string, unknown>> = [];
  const dispatch = { registerFreight: (input: Record<string, unknown>) => (made.push(input), { freightId: `frt_${made.length}`, ...input }) } as unknown as DispatchService;
  const holds = new Set(['NL', 'KE']);
  const presence = { can: (c: string, what: string) => (what === 'holdFloat' ? holds.has(c) : true), closedTo: () => false } as unknown as PresenceService;
  const entities = { forJurisdiction: (c: string) => (holds.has(c) ? { entityId: `sbg-${c.toLowerCase()}` } : undefined) };
  let mollieOn = true;
  const mollie = { via: () => (mollieOn ? 'oauth' : undefined) };
  const svc = new LoadPostingService(dispatch, presence, {} as BusinessClientService, undefined, undefined, undefined, undefined, entities as never, undefined, undefined, mollie as never);
  const anna = { role: 'consumer', did: 'did:person:anna' } as never;
  const AMSTERDAM = { lat: 52.37, lng: 4.9 };
  const NAIROBI = { lat: -1.29, lng: 36.82 };
  const load = (over: Partial<RegisterFreightDto> = {}) => ({ description: 'A bicycle in a box', pickupLocation: AMSTERDAM, pickupLabel: 'Home', destLocation: { lat: 52.09, lng: 5.12 }, destLabel: 'Utrecht', weightKg: 18, contactPhone: '+31612345678', ...over }) as RegisterFreightDto;

  beforeEach(() => {
    made.length = 0;
    mollieOn = true;
  });

  it('offers, by the pickup’s country, paying at pickup where the driver can ask by QR, and held where we may hold money', () => {
    expect(svc.payWaysIn('NL')).toEqual(['at_pickup', 'held']);
    expect(svc.payWaysIn('ke')).toEqual(['held']);
    expect(svc.payWaysIn('ET')).toEqual(['direct']);
    mollieOn = false;
    expect(svc.payWaysIn('NL')).toEqual(['held']);
  });

  it('posts as the person chose: at pickup between the two of them, held with us; held where they did not say', () => {
    svc.post(load({ payWay: 'at_pickup' }), anna);
    expect(made[0]).toMatchObject({ betweenParties: true, commitMode: 'negotiate' });
    expect(made[0].escrow).toBeUndefined();
    expect(made[0].payWay).toBeUndefined();
    svc.post(load({ payWay: 'held' }), anna);
    expect(made[1]).toMatchObject({ escrow: true, sellerEntityId: 'sbg-nl' });
    svc.post(load(), anna);
    expect(made[2]).toMatchObject({ escrow: true });
  });

  it('refuses a way the pickup’s country does not offer, before anything is made', () => {
    expect(() => svc.post(load({ pickupLocation: NAIROBI, payWay: 'at_pickup', contactPhone: '+254712345678' }), anna)).toThrow(/Paying the driver at pickup is not offered in Kenya yet/);
    mollieOn = false;
    expect(() => svc.post(load({ payWay: 'at_pickup' }), anna)).toThrow(/not offered in Netherlands yet/);
    expect(made).toHaveLength(0);
  });
});
