import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import type { PayoutService } from '../../foundation/payouts/payout.service';
import type { PayoutDestinations } from '../../foundation/payouts/payout-ways';
import type { SmsService } from '../../foundation/sms/sms.service';
import type { DriverService } from './driver.service';
import type { FleetManagerService } from './fleet-manager.service';
import type { MdpService } from './mdp.service';
import { PayoutNumberService } from './payout-number.service';

/**
 * WHO SETS A PAYOUT NUMBER, and what the payout run is told. A courier is paid itself; a fleet driver is not — its fleet
 * is, and the fleet's office sets the number; a hub sets its own; a shop is paid into its float; staff set none.
 */
describe('a payee’s own payout number', () => {
  const H = 3_600_000;
  const T0 = Date.parse('2026-10-18T08:00:00Z');
  let registered: PayoutDestinations;
  const texts: Array<{ to: string; kind: string; body: string }> = [];

  const make = (fleetCountry = 'KE') => {
    texts.length = 0;
    const payouts = { registerDestinations: (d: PayoutDestinations) => (registered = d) } as unknown as PayoutService;
    const drivers = {
      get: (did: string) => (did === 'did:courier' ? { did, jurisdiction: 'KE' } : { did, managerDid: 'did:fleet', jurisdiction: 'KE' }),
    } as unknown as DriverService;
    const managers = { get: (did: string) => ({ did, jurisdiction: fleetCountry }) } as unknown as FleetManagerService;
    const mdps = { list: () => [{ did: 'did:hub', mdpId: 'mdp_1' }], countryOf: () => 'KE' } as unknown as MdpService;
    const sms = {
      sends: () => false,
      mayGoTo: () => true,
      sendCode: async (to: string, code: string) => void texts.push({ to, kind: 'code', body: code }),
      sendPayoutNumberChanged: async (to: string, masked: string) => void texts.push({ to, kind: 'notice', body: masked }),
    } as unknown as SmsService;
    const svc = new PayoutNumberService(payouts, drivers, managers, mdps, sms);
    svc.onModuleInit();
    return svc;
  };
  const courier = { role: 'driver', did: 'did:courier', actorName: 'Wanjiru' } as IntrospectionResult;

  it('is the courier’s own, the fleet’s (set by its office) and the hub’s — never a fleet driver’s, a shop’s or staff’s', () => {
    const svc = make();
    expect(svc.view(courier)).toEqual({ way: 'mpesa', country: 'KE' });
    expect(svc.view({ role: 'driver', did: 'did:fleet-driver' } as IntrospectionResult).notPayee).toMatch(/fleet is paid/);
    expect(svc.view({ role: 'agent', did: 'did:shop' } as IntrospectionResult).notPayee).toMatch(/float/);
    expect(() => svc.view({ role: 'operator' } as IntrospectionResult)).toThrow(/sets its own payout number/);
    expect(svc.view({ role: 'fleet_manager', did: 'did:fleet', tenant: 'did:fleet' } as IntrospectionResult)).toEqual({ way: 'mpesa', country: 'KE' });
    expect(svc.view({ role: 'mdp', did: 'did:hub' } as IntrospectionResult)).toEqual({ way: 'mpesa', country: 'KE' });
    // A fleet in a country that pays by hand has no number to set.
    expect(make('ET').view({ role: 'fleet_manager', did: 'did:fleet', tenant: 'did:fleet' } as IntrospectionResult)).toEqual({ way: 'by_hand', country: 'ET' });
  });

  it('is set by a code texted to that number, and tells the run where to pay — and, after a change, to wait a day', async () => {
    const svc = make();
    expect(registered.of('did:courier', 'mpesa', T0)).toEqual({ reason: 'no payout number yet: the payee sets it in Settings' });
    const sent = await svc.requestCode(courier, '0712 345 678', T0);
    expect(texts).toEqual([{ to: '+254712345678', kind: 'code', body: sent.code }]);
    await expect(svc.confirm(courier, '999999' === sent.code ? '111111' : '999999', T0)).rejects.toThrow(/Wrong or expired/);
    const first = await svc.confirm(courier, sent.code!, T0);
    expect(first).toMatchObject({ masked: '254712***678' });
    const at = registered.of('did:courier', 'mpesa', T0) as { numberId: string; masked: string };
    expect(at.masked).toBe('254712***678');
    expect(registered.full('did:courier', at.numberId)).toBe('254712345678');
    expect(registered.full('did:courier', 'pn_other')).toBeUndefined();

    const again = await svc.requestCode(courier, '0110 000 222', T0 + 2 * 60_000);
    const changed = await svc.confirm(courier, again.code!, T0 + 2 * 60_000);
    expect(changed).toMatchObject({ masked: '254110***222', heldUntil: new Date(T0 + 2 * 60_000 + 24 * H).toISOString(), oldNumber: 'kept' });
    expect(texts.at(-1)).toEqual({ to: '+254712345678', kind: 'notice', body: '254110***222' });
    expect(registered.of('did:courier', 'mpesa', T0 + 3 * H)).toMatchObject({ reason: expect.stringMatching(/was changed/) });
    expect(registered.of('did:courier', 'mpesa', T0 + 25 * H)).toMatchObject({ masked: '254110***222' });
  });

  it('refuses a number M-Pesa cannot pay, the number it already is, and a country that pays by hand — before texting', async () => {
    const svc = make();
    await expect(svc.requestCode(courier, '+255 712 345 678', T0)).rejects.toThrow(/Not a Kenyan mobile number/);
    expect(texts).toEqual([]);
    const sent = await svc.requestCode(courier, '0712345678', T0);
    await svc.confirm(courier, sent.code!, T0);
    await expect(svc.requestCode(courier, '+254712345678', T0 + 2 * 60_000)).rejects.toThrow(/already your payout number/);
    expect(texts).toHaveLength(1);
    const byHand = make('ET');
    await expect(byHand.requestCode({ role: 'fleet_manager', did: 'did:fleet', tenant: 'did:fleet' } as IntrospectionResult, '0712345678', T0)).rejects.toThrow(/made by hand/);
    expect(texts).toEqual([]);
  });
});
