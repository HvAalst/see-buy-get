import type { MailBounces } from '../../foundation/mail/mail-bounces.service';
import type { DispatchService } from './dispatch.service';
import type { NotificationService } from './notification.service';
import type { ParcelService } from './parcel.service';
import { ReceiverMailBounces } from './receiver-mail-bounce.service';
import type { VendorService } from './vendor.service';

/*
 * 2026-11-16 — AN EMAIL TO A STORE'S BUYER CAME BACK (the owner: "a bounce deserves a notice"): the store is told in its
 * bell, once per order still on its way or waiting, with the address and what to do — reach the buyer another way — and
 * the notice opens its orders. A load's poster is told the same way (person-loads e2e 16b/16c).
 */
describe('a bounced email to a store’s buyer', () => {
  const setup = (parcels: Array<{ parcelId: string; vendorId?: string; externalOrderId?: string; buyerEmail: string; status: string }>) => {
    const told: Array<{ did: string; kind: string; title: string; body: string; link?: string }> = [];
    const marked: string[] = [];
    const listeners: Array<(address: string) => void> = [];
    const open = new Set(parcels.map((p) => p.parcelId));
    const parcelService = {
      buyerMailedTo: (address: string) => parcels.filter((p) => open.has(p.parcelId) && p.buyerEmail === address.toLowerCase()),
      markBuyerMailBounced: (id: string) => (marked.push(id), open.delete(id)),
    } as unknown as ParcelService;
    const dispatch = { codeMailedTo: () => [], markCodeMailBounced: () => undefined } as unknown as DispatchService;
    const notifications = { notify: async (did: string, n: { kind: string; title: string; body: string; link?: string }) => void told.push({ did, ...n }) } as unknown as NotificationService;
    const vendors = { get: (id: string) => ({ did: `did:glos:${id}` }) } as unknown as VendorService;
    const bounces = { onBounce: (l: (address: string) => void) => void listeners.push(l), stopped: () => undefined } as unknown as MailBounces;
    const service = new ReceiverMailBounces(dispatch, parcelService, notifications, vendors, bounces);
    service.onModuleInit();
    return { told, marked, bounce: (address: string) => listeners.forEach((l) => l(address)) };
  };

  it('the store is told once, with the address and the order, and the notice opens its orders', () => {
    const { told, marked, bounce } = setup([{ parcelId: 'par_1', vendorId: 'ven_duka', externalOrderId: 'DB-1042', buyerEmail: 'amina@exmaple.com', status: 'Ready_For_Pickup' }]);
    bounce('Amina@exmaple.com');
    bounce('amina@exmaple.com');
    expect(told).toEqual([expect.objectContaining({ did: 'did:glos:ven_duka', kind: 'mail_bounced', title: 'An email to your buyer came back: order DB-1042', link: '/?go=orders' })]);
    expect(told[0].body).toContain('amina@exmaple.com');
    expect(told[0].body).toContain('waiting to be collected');
    expect(marked).toEqual(['par_1']);
  });

  it('a parcel still on its way says so; one with no store is told to nobody', () => {
    const { told, bounce } = setup([
      { parcelId: 'par_2', vendorId: 'ven_duka', buyerEmail: 'baraka@example.com', status: 'On_Bus' },
      { parcelId: 'par_3', buyerEmail: 'baraka@example.com', status: 'On_Bus' },
    ]);
    bounce('baraka@example.com');
    expect(told).toHaveLength(1);
    expect(told[0].title).toBe('An email to your buyer came back: parcel par_2');
    expect(told[0].body).toContain('on its way');
  });
});
