import { HolderNamesService } from './holder-names.service';
import type { CustodyLeg, Parcel } from './pudo.types';

/**
 * WHO HAS IT NOW, BY NAME (plan R1): a shop by its name, a hub by its name (recorded as its name, or its id), on the road the
 * company we contract with — a fleet's trading name, or the name an independent courier rides under — and the vehicle.
 * Never an id nobody can read, never a person's phone.
 */
describe('naming who has it now', () => {
  const agents = { find: (did: string) => (did === 'did:shop:1' ? { shopName: 'Mama Sarah Shop' } : undefined) };
  const mdps = { find: (id: string) => (id === 'mdp_ab12' ? { name: 'Nairobi West hub' } : undefined) };
  const drivers = {
    get: (did: string) => {
      if (did === 'did:drv:fleet') return { did, managerDid: 'did:mgr:1', displayName: 'Driver J.' };
      if (did === 'did:drv:own') return { did, displayName: 'Otieno Rides' };
      throw new Error('no such driver');
    },
  };
  const managers = { get: (did: string) => (did === 'did:mgr:1' ? { companyName: 'Kilima Logistics Ltd', tradingName: 'Kilima' } : undefined) };
  const fleet = { vehicleForDriver: (did: string) => (did === 'did:drv:fleet' ? { vehicleClass: 'van' } : did === 'did:drv:own' ? { vehicleClass: 'motorcycle' } : undefined) };
  const svc = new HolderNamesService({} as never, {} as never, agents as never, mdps as never, drivers as never, managers as never, fleet as never);
  const leg = (holderKind: CustodyLeg['holderKind'], holderId: string): CustodyLeg => ({ holderKind, holderId, from: '2026-11-15T10:00:00.000Z' });
  const p = {} as Parcel;

  it('a shop and a hub by name; a hub recorded by its name or its id', () => {
    expect(svc.ofLeg(leg('shop', 'did:shop:1'), p)).toEqual({ kind: 'shop', name: 'Mama Sarah Shop', since: '2026-11-15T10:00:00.000Z' });
    expect(svc.ofLeg(leg('hub', 'Ghala Kuu'), p)).toMatchObject({ kind: 'hub', name: 'Ghala Kuu' });
    expect(svc.ofLeg(leg('hub', 'mdp_ab12'), p)).toMatchObject({ kind: 'hub', name: 'Nairobi West hub' });
    // An id nobody can look up is never shown; the hub the parcel is at is read instead, where there is one.
    expect(svc.ofLeg(leg('hub', 'mdp_ffff'), p)?.name).toBeUndefined();
    expect(svc.ofLeg(leg('hub', 'mdp_ffff'), { atMdpId: 'mdp_ab12' } as Parcel)?.name).toBe('Nairobi West hub');
  });

  it('on the road: the fleet’s trading name, or the courier’s own, with the vehicle — never the driver of a fleet by name', () => {
    expect(svc.ofLeg(leg('driver', 'did:drv:fleet'), p)).toMatchObject({ kind: 'carrier', name: 'Kilima', vehicle: 'van' });
    expect(svc.ofLeg(leg('driver', 'did:drv:own'), p)).toMatchObject({ kind: 'carrier', name: 'Otieno Rides', vehicle: 'motorcycle' });
    // A badge nobody knows: on the road, with nobody named.
    expect(svc.ofLeg(leg('driver', 'BADGE-77'), p)).toEqual({ kind: 'carrier', since: '2026-11-15T10:00:00.000Z' });
  });

  it('still with the sender; nothing for the receiver', () => {
    expect(svc.ofLeg(leg('sender', 'vendor-1'), p)).toEqual({ kind: 'sender', since: '2026-11-15T10:00:00.000Z' });
    expect(svc.ofLeg(leg('receiver', 'hash'), p)).toBeUndefined();
  });
});
