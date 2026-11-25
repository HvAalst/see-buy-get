import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import type { PayoutService } from '../../foundation/payouts/payout.service';
import type { PayoutDestinations } from '../../foundation/payouts/payout-ways';
import type { SmsService } from '../../foundation/sms/sms.service';
import type { DriverService } from './driver.service';
import type { FleetManagerService } from './fleet-manager.service';
import type { MdpService } from './mdp.service';
import { PayoutNumberService } from './payout-number.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';

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
      sendCode: async (to: string, code: string, _minutes?: number, _now?: number, via?: string) => {
        texts.push({ to, kind: 'code', body: code, ...(via ? { via } : {}) });
        return via ?? 'sms';
      },
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

  it('2026-11-16 — its code goes the way the payee chose, and says which (the owner: “the same choice”)', async () => {
    const svc = make();
    const sent = await svc.requestCode(courier, '0712 345 678', T0, 'whatsapp');
    expect(texts.at(-1)).toMatchObject({ to: '+254712345678', kind: 'code', via: 'whatsapp' });
    expect(sent.via).toBe('whatsapp');
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

  /*
   * 2026-11-20 — WHERE A PARTNER CONTRACTS AND PAYS (the payments plan, 4c): every hand is paid by the partner, by phone, to a
   * number of its own — a shop too, which has no float there — in its own country's way of writing it, confirmed by a code, and
   * paused for a day after a change, as an M-Pesa number is.
   */
  it('where a partner contracts: every hand sets a number of its own country — a shop too — and the partner pays to it', async () => {
    texts.length = 0;
    const payouts = { registerDestinations: () => undefined } as unknown as PayoutService;
    const drivers = { get: (did: string) => ({ did, jurisdiction: 'ET' }) } as unknown as DriverService;
    const managers = { get: (did: string) => ({ did, jurisdiction: 'ET' }) } as unknown as FleetManagerService;
    const mdps = { list: () => [{ did: 'did:hub-addis', mdpId: 'mdp_addis' }], countryOf: () => 'ET' } as unknown as MdpService;
    const sms = {
      sends: () => false,
      mayGoTo: () => true,
      sendCode: async (to: string, code: string) => (texts.push({ to, kind: 'code', body: code }), 'sms'),
      sendPayoutNumberChanged: async (to: string, masked: string) => void texts.push({ to, kind: 'notice', body: masked }),
    } as unknown as SmsService;
    const agents = { get: (did: string) => ({ did, shopName: 'Bole Duka' }), countryOf: (a: { did: string }) => (a.did.includes('nairobi') ? 'KE' : 'ET') };
    const partners = { partnerAt: (c: string) => (c === 'ET' ? { entityId: 'partner-et', name: 'Addis Courier PLC' } : undefined) };
    const svc = new PayoutNumberService(payouts, drivers, managers, mdps, sms, agents as never, partners as never);
    const shop = { role: 'agent', did: 'did:shop-addis', actorName: 'Almaz' } as IntrospectionResult;
    expect(svc.view(shop)).toEqual({ way: 'partner', paidBy: 'Addis Courier PLC', paysTo: 'phone', country: 'ET' });
    expect(svc.view({ role: 'mdp', did: 'did:hub-addis' } as IntrospectionResult)).toMatchObject({ way: 'partner', paidBy: 'Addis Courier PLC' });
    // A shop where no partner contracts is still paid into its float.
    expect(svc.view({ role: 'agent', did: 'did:shop-nairobi' } as IntrospectionResult).notPayee).toMatch(/float/);
    // The country's own numbers, said with its own code.
    await expect(svc.requestCode(shop, '+254 712 345 678', T0)).rejects.toThrow('Not a mobile number in Ethiopia: write it with its country code, +251…');
    await svc.requestCode(shop, '+251 911 000 123', T0);
    expect(texts.at(-1)).toMatchObject({ to: '+251911000123', kind: 'code' });
    await svc.confirm(shop, texts.at(-1)!.body, T0 + 1000);
    expect(svc.partnerDestination('did:shop-addis', T0 + 2000)).toEqual({ numberId: expect.any(String), masked: '251911***123' });
    // Changed: the old number told, and nothing paid to the new one for a day.
    await svc.requestCode(shop, '0911 000 456', T0 + 2 * 60_000);
    expect(texts.at(-1)).toMatchObject({ to: '+251911000456' });
    await svc.confirm(shop, texts.at(-1)!.body, T0 + 3 * 60_000);
    expect(texts.at(-1)).toMatchObject({ to: '+251911000123', kind: 'notice' });
    expect(svc.partnerDestination('did:shop-addis', T0 + 4 * 60_000)).toEqual({ reason: 'number_new' });
    expect(svc.partnerDestination('did:shop-addis', T0 + 3 * 60_000 + 24 * H + 1)).toMatchObject({ masked: '251911***456' });
    expect(svc.partnerDestination('did:nobody', T0)).toEqual({ reason: 'no_number' });
  });

  /*
   * 2026-11-25 — ROUTE PLAN PART 4: where the partner pays to bank accounts (the European Union), a hand sets its own bank
   * account in Settings — checked, kept sealed, shown by its last four characters; a change pauses payouts for a day — and sets
   * no phone number there.
   */
  it('in Bulgaria a hand sets its own bank account, sealed and checked; a change pauses it a day; no number is set there', async () => {
    const payouts = { registerDestinations: (d: PayoutDestinations) => (registered = d) } as unknown as PayoutService;
    const drivers = { get: (did: string) => ({ did, jurisdiction: 'BG' }) } as unknown as DriverService;
    const managers = { get: (did: string) => ({ did, jurisdiction: 'BG' }) } as unknown as FleetManagerService;
    const mdps = { list: () => [], countryOf: () => 'BG' } as unknown as MdpService;
    const sms = { sends: () => false, mayGoTo: () => true } as unknown as SmsService;
    const agents = { get: (did: string) => ({ did, shopName: 'Magazin Vitosha' }), countryOf: () => 'BG' };
    const partners = { partnerAt: (c: string) => (c === 'BG' ? { entityId: 'partner-bg', name: 'Sofia Partner OOD' } : undefined) };
    const svc = new PayoutNumberService(payouts, drivers, managers, mdps, sms, agents as never, partners as never, new FieldEncryption());
    const ivan = { role: 'driver', did: 'did:courier-ivan', actorName: 'Ivan' } as IntrospectionResult;
    expect(svc.view(ivan)).toEqual({ way: 'partner', paidBy: 'Sofia Partner OOD', paysTo: 'bank', country: 'BG' });
    await expect(svc.requestCode(ivan, '+359 888 123 456', T0)).rejects.toThrow('In Bulgaria you are paid to your bank account: set that instead of a number.');
    expect(() => svc.setBank(ivan, { account: 'BG80 BNBG 9661 1020 3456 79', holder: 'Ivan Petrov' }, T0)).toThrow(/does not add up/);
    expect(() => svc.setBank(ivan, { account: 'BG80 BNBG 9661 1020 3456 78', holder: 'I' }, T0)).toThrow(/holder’s name/);
    expect(() => svc.setBank(ivan, { account: 'BG80 BNBG 9661 1020 3456 78', holder: 'Ivan Petrov', bic: 'BNBG12' }, T0)).toThrow(/Not a BIC/);
    const saved = svc.setBank(ivan, { account: 'bg80 bnbg 9661 1020 3456 78', holder: ' Ivan  Petrov ', bic: 'bnbgbgsf' }, T0);
    expect(saved).toEqual({ way: 'partner', paidBy: 'Sofia Partner OOD', paysTo: 'bank', country: 'BG', masked: 'BG•• •••• 5678', confirmedAt: new Date(T0).toISOString() });
    const to = svc.partnerDestination('did:courier-ivan', T0, 'bank');
    expect(to).toEqual({ numberId: expect.stringMatching(/^pb_/), masked: 'BG•• •••• 5678' });
    expect(svc.fullBank('did:courier-ivan', (to as { numberId: string }).numberId)).toEqual({ account: 'BG80BNBG96611020345678', holder: 'Ivan Petrov', bic: 'BNBGBGSF' });
    expect(svc.fullBank('did:courier-ivan', 'pb_other')).toBeUndefined();
    // Sealed where it is kept: the account is in no record as typed.
    expect(JSON.stringify((svc as unknown as { banks: Map<string, unknown> }).banks.get('did:courier-ivan'))).not.toContain('96611020345678');
    expect(() => svc.setBank(ivan, { account: 'BG80BNBG96611020345678', holder: 'Ivan Petrov' }, T0 + 1000)).toThrow('That is already your payout account.');
    // Changed: nothing paid to the new account for a day, and the money checks see the change.
    svc.setBank(ivan, { account: 'LT12 1000 0111 0100 1000', holder: 'Ivan Petrov' }, T0 + 60_000);
    expect(svc.partnerDestination('did:courier-ivan', T0 + 2 * 60_000, 'bank')).toEqual({ reason: 'bank_new' });
    expect(svc.partnerDestination('did:courier-ivan', T0 + 60_000 + 24 * H + 1, 'bank')).toMatchObject({ masked: 'LT•• •••• 1000' });
    expect(svc.changesOf('did:courier-ivan')).toEqual([new Date(T0 + 60_000).toISOString()]);
    expect(svc.partnerDestination('did:nobody', T0, 'bank')).toEqual({ reason: 'no_bank' });
    // Staff set none; a country that pays by M-Pesa takes no bank account.
    expect(() => svc.setBank({ role: 'operator', actorName: 'Staff Ann' } as IntrospectionResult, { account: 'BG80BNBG96611020345678', holder: 'X Y' }, T0)).toThrow(/sets its own payout number/);
    svc.forget('did:courier-ivan');
    expect(svc.partnerDestination('did:courier-ivan', T0 + 3 * 24 * H, 'bank')).toEqual({ reason: 'no_bank' });
  });

  it('a bank account is refused where the payee is paid by M-Pesa', () => {
    const svc = make();
    expect(() => svc.setBank({ role: 'driver', did: 'did:courier', actorName: 'Amos' } as IntrospectionResult, { account: 'BG80BNBG96611020345678', holder: 'Amos K' }, T0)).toThrow('In Kenya payouts do not go to a bank account.');
  });
});
